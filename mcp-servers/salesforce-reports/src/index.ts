#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.ts';
import { SalesforceClient } from './client.ts';
import { findTool, visibleTools } from './tools/index.ts';
import { assertNoCredentialArguments } from './guards.ts';
import { Refusal, SalesforceApiError } from './errors.ts';

const VERSION = '0.1.0';

export async function createServer(client: SalesforceClient): Promise<Server> {
  const server = new Server(
    { name: 'salesforce-reports', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools(client.config.enableWrites).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, any>;

    const tool = findTool(name);
    if (!tool) {
      return errorResult({
        error: true,
        message:
          `Unknown tool "${name}". This server wraps the Salesforce Reports and Dashboards REST API only: ` +
          'no CRM record writes, no Apex, no Metadata API deploys, no CRM Analytics.',
        available: visibleTools(client.config.enableWrites).map(t => t.name),
      });
    }

    try {
      // Credentials are configured at startup. Checked before the handler so a
      // credential-shaped argument never reaches a code path that might log it.
      assertNoCredentialArguments(args);
      const result = await tool.handler(client, args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      if (e instanceof Refusal) return errorResult(e.toPayload());
      if (e instanceof SalesforceApiError) return errorResult(e.toPayload());
      return errorResult({
        error: true,
        message: e instanceof Error ? e.message : String(e),
        tool: name,
      });
    }
  });

  return server;
}

function errorResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

async function main() {
  const config = loadConfig();
  const client = new SalesforceClient(config);

  // Connect before serving. A server that advertises tools it cannot authenticate
  // for turns every call into a runtime auth error instead of one startup failure.
  const user = await client.connect();
  console.error(
    `[salesforce-reports] connected: ${client.instanceUrl} | running user ${user.username} ` +
      `(${user.timeZone}) | API ${config.apiVersion} | writes ${config.enableWrites ? 'ENABLED' : 'disabled'}` +
      (config.writeFolderAllowlist ? ` | folders ${config.writeFolderAllowlist.join(',')}` : ''),
  );

  const server = await createServer(client);
  await server.connect(new StdioServerTransport());
}

// Only run when invoked directly, so tests can import createServer.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main().catch(err => {
    console.error(`[salesforce-reports] startup failed: ${err.message}`);
    process.exit(1);
  });
}
