/**
 * The acceptance pathway: an MCP client talking to the real server over a real
 * transport, with only the Salesforce HTTP layer faked. Nothing here calls a
 * handler directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/index.ts';
import { SalesforceClient } from '../src/client.ts';
import { loadConfig } from '../src/config.ts';
import { makeFakeSalesforce, ENV } from './fake-salesforce.ts';

async function connect(env: Partial<NodeJS.ProcessEnv> = {}) {
  const { fetchImpl, calls } = makeFakeSalesforce();
  const config = loadConfig({ ...ENV, ...env });
  const sf = new SalesforceClient(config, fetchImpl);
  await sf.connect();

  const server = await createServer(sf);
  const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, calls, sf };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { payload: JSON.parse(res.content[0]!.text), isError: res.isError === true };
}

test('startup reads the running user identity and timezone from the org', async () => {
  const { sf } = await connect();
  assert.equal(sf.user.username, 'integration.user@example.com');
  assert.equal(sf.user.timeZone, 'America/Los_Angeles');
  assert.equal(sf.instanceUrl, 'https://example-instance.my.salesforce.com');
});

test('the API host comes from instance_url, never from the login host', async () => {
  const { client, calls } = await connect();
  await call(client, 'run_report', { report_id: '00O000000000001AAA' });
  const apiCalls = calls.filter(c => c.url.includes('/services/data/'));
  assert.ok(apiCalls.length > 0);
  for (const c of apiCalls) {
    assert.ok(
      c.url.startsWith('https://example-instance.my.salesforce.com'),
      `API call went to the wrong host: ${c.url}`,
    );
  }
});

test('with writes disabled the write tools are not advertised at all', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name);
  assert.equal(names.length, 9);
  for (const w of ['create_report', 'update_report', 'clone_report', 'clone_dashboard']) {
    assert.ok(!names.includes(w), `${w} must not be advertised when writes are off`);
  }
  assert.ok(names.includes('run_report'));
  assert.ok(names.includes('bulk_query'));
});

test('a write is refused by the handler too, not only hidden from the listing', async () => {
  const { client } = await connect();
  const { payload, isError } = await call(client, 'create_report', {
    report_metadata: { name: 'X', reportType: { type: 'Opportunity' } },
  });
  assert.ok(isError);
  assert.equal(payload.code, 'WRITES_DISABLED');
  assert.match(payload.supported_route, /SF_ENABLE_REPORT_WRITES/);
});

test('with writes enabled all thirteen tools are advertised and create_report works', async () => {
  const { client, calls } = await connect({ SF_ENABLE_REPORT_WRITES: 'true' });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 13);

  const { payload, isError } = await call(client, 'create_report', {
    report_metadata: {
      name: 'Open pipeline by stage',
      reportType: { type: 'Opportunity' },
      reportFormat: 'SUMMARY',
      folderId: '00l000000000000AAA',
      aggregates: ['s!AMOUNT', 'RowCount'],
    },
  });
  assert.equal(isError, false);
  assert.equal(payload.created, true);
  assert.equal(payload.report_id, '00O000000000008AAA');

  const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/analytics/reports'))!;
  assert.ok(post, 'must POST to /analytics/reports');
  assert.equal((post.body as any).reportMetadata.name, 'Open pipeline by stage');
  assert.equal(post.headers['Content-Type'], 'application/json');
});

test('the folder allowlist bounds an enabled write', async () => {
  const { client } = await connect({
    SF_ENABLE_REPORT_WRITES: 'true',
    SF_WRITE_FOLDER_ALLOWLIST: '00lALLOWED000000AAA',
  });

  const denied = await call(client, 'create_report', {
    report_metadata: { name: 'X', reportType: { type: 'Opportunity' }, folderId: '00lOTHER00000000AAA' },
  });
  assert.ok(denied.isError);
  assert.equal(denied.payload.code, 'FOLDER_NOT_ALLOWED');

  const missing = await call(client, 'create_report', {
    report_metadata: { name: 'X', reportType: { type: 'Opportunity' } },
  });
  assert.ok(missing.isError, 'an omitted folder must not bypass the allowlist');
  assert.equal(missing.payload.code, 'FOLDER_NOT_ALLOWED');

  const allowed = await call(client, 'create_report', {
    report_metadata: { name: 'X', reportType: { type: 'Opportunity' }, folderId: '00lALLOWED000000AAA' },
  });
  assert.equal(allowed.isError, false);
});

test('allData is surfaced at the TOP LEVEL of a run result, with the aggregate still reported', async () => {
  const { client } = await connect();
  const { payload } = await call(client, 'run_report', { report_id: '00O000000000001AAA' });

  assert.equal(payload.all_data, false, 'all_data must be at the top level of the payload');
  assert.equal(payload.truncated, true);
  assert.match(payload.truncation_note, /aggregates and grand totals above ARE computed over the full result set/i);
  assert.match(payload.truncation_note, /bulk_query/);

  // The aggregate is exact even though the rows are truncated, so it is reported.
  assert.deepEqual(payload.grand_total, [{ label: '$4,200,000', value: 4200000 }]);
  assert.equal(payload.detail_row_count, 2);
  assert.equal(payload.provenance.all_data, false);
  assert.equal(payload.provenance.cap_hit, true);
});

test('every response carries the running user, timezone and API version', async () => {
  const { client } = await connect();
  for (const [name, args] of [
    ['list_reports', {}],
    ['run_report', { report_id: '00O000000000001AAA' }],
    ['list_dashboards', {}],
    ['describe_org_limits', {}],
  ] as Array<[string, Record<string, unknown>]>) {
    const { payload } = await call(client, name, args);
    const p = payload.provenance;
    assert.ok(p, `${name} returned no provenance`);
    assert.equal(p.running_user.username, 'integration.user@example.com');
    assert.equal(p.running_user_timezone, 'America/Los_Angeles');
    assert.equal(p.api_version, 'v60.0');
    assert.ok(p.scope_note.includes('field-level security'));
  }
});

test('list_reports uses SOQL against the Report object, not the recently-viewed REST list', async () => {
  const { client, calls } = await connect();
  const { payload } = await call(client, 'list_reports', { folder_name: 'GTM Reports' });

  assert.equal(payload.reports.length, 2);
  assert.match(payload.query_used, /FROM Report/);
  assert.match(payload.note, /recently-viewed/);
  assert.ok(
    !calls.some(c => c.method === 'GET' && /\/analytics\/reports(\?|$)/.test(c.url)),
    'must not call the 200-recently-viewed REST list resource',
  );
});

test('run_report_with_filters overrides for that run only and does not save', async () => {
  const { client, calls } = await connect();
  const { payload, isError } = await call(client, 'run_report_with_filters', {
    report_id: '00O000000000001AAA',
    report_metadata: { standardDateFilter: { column: 'CLOSE_DATE', durationValue: 'LAST_QUARTER' } },
  });

  assert.equal(isError, false);
  assert.equal(payload.overrides_saved, false);
  const post = calls.find(c => c.method === 'POST' && c.url.includes('/analytics/reports/00O'))!;
  assert.ok(post);
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.ok(!calls.some(c => c.method === 'PATCH'), 'a filtered run must not PATCH the stored report');
});

test('filter types the API cannot apply are refused, not silently dropped', async () => {
  const { client } = await connect();
  for (const key of ['crossFilters', 'standardFilters', 'topRows']) {
    const { payload, isError } = await call(client, 'run_report_with_filters', {
      report_id: '00O000000000001AAA',
      report_metadata: { [key]: [{ anything: true }] },
    });
    assert.ok(isError, `${key} must be refused`);
    assert.equal(payload.code, 'FILTER_TYPE_NOT_SUPPORTED');
    assert.ok(payload.supported_route.length > 0);
  }
});

test('the 20-custom-filter ceiling is enforced client-side, because Salesforce ignores the excess silently', async () => {
  const { client } = await connect();
  const filters = Array.from({ length: 21 }, (_, i) => ({ column: `C${i}`, operator: 'equals', value: 'x' }));
  const { payload, isError } = await call(client, 'run_report_with_filters', {
    report_id: '00O000000000001AAA',
    report_metadata: { reportFilters: filters },
  });
  assert.ok(isError);
  assert.equal(payload.code, 'FILTER_LIMIT_EXCEEDED');
  assert.match(payload.reason, /silently ignores/);
});

test('credential-shaped arguments are refused before the handler runs', async () => {
  const { client, calls } = await connect();
  const before = calls.length;
  const { payload, isError } = await call(client, 'run_report', {
    report_id: '00O000000000001AAA',
    access_token: 'leaked',
  });
  assert.ok(isError);
  assert.equal(payload.code, 'CREDENTIAL_IN_ARGUMENT');
  assert.equal(calls.length, before, 'no HTTP call may be made with a credential argument present');
});

test('bulk_query follows the Sforce-Locator loop to exhaustion and joins the pages', async () => {
  const { client, calls } = await connect();
  const { payload, isError } = await call(client, 'bulk_query', {
    soql: 'SELECT Id, Amount FROM Opportunity',
  });

  assert.equal(isError, false);
  assert.equal(payload.state, 'JobComplete');
  assert.equal(payload.complete, true);
  assert.equal(payload.pages_fetched, 2, 'must follow the locator to the second page');
  assert.equal(payload.truncated, false);
  // Header row appears once; page two's header is stripped.
  assert.equal(payload.csv, 'Id,Amount\n006A,1000\n006B,2000\n006C,3000\n');
  assert.equal((payload.csv.match(/Id,Amount/g) ?? []).length, 1);

  const resultCalls = calls.filter(c => c.url.includes('/results'));
  assert.equal(resultCalls.length, 2);
  assert.ok(resultCalls[1]!.url.includes('locator=LOCATOR_PAGE_2'));
});

test('bulk_query states whether deleted records are included, both ways', async () => {
  const { client } = await connect();
  const plain = await call(client, 'bulk_query', { soql: 'SELECT Id FROM Opportunity' });
  assert.equal(plain.payload.operation, 'query');
  assert.match(plain.payload.deleted_records_note, /EXCLUDED/);

  const all = await call(client, 'bulk_query', { soql: 'SELECT Id FROM Opportunity', include_deleted: true });
  assert.equal(all.payload.operation, 'queryAll');
  assert.match(all.payload.deleted_records_note, /ARE included/);
});

test('a large extract requires explicit confirmation', async () => {
  const { client } = await connect({ SF_LARGE_EXTRACT_ROWS: '1000' });
  const refused = await call(client, 'bulk_query', {
    soql: 'SELECT Id FROM Opportunity',
    estimated_rows: 500000,
  });
  assert.ok(refused.isError);
  assert.equal(refused.payload.code, 'LARGE_EXTRACT_UNCONFIRMED');

  const confirmed = await call(client, 'bulk_query', {
    soql: 'SELECT Id FROM Opportunity',
    estimated_rows: 500000,
    confirm_large_extract: true,
  });
  assert.equal(confirmed.isError, false);
});

test('an unknown tool names what this server does not do instead of failing blankly', async () => {
  const { client } = await connect();
  const { payload, isError } = await call(client, 'create_opportunity', { name: 'X' });
  assert.ok(isError);
  assert.match(payload.message, /Reports and Dashboards REST API only/);
  assert.match(payload.message, /no Apex/);
  assert.ok(Array.isArray(payload.available));
});

test('get_dashboard_results does not claim completeness it cannot establish', async () => {
  const { client } = await connect();
  const { payload } = await call(client, 'get_dashboard_results', { dashboard_id: '01Z000000000001AAA' });
  assert.equal(payload.all_data, null, 'allData is unavailable on this surface and must be null, not true');
  assert.match(payload.completeness_note, /does not expose allData per component/);
  assert.match(payload.refresh_note, /not a live query/);
});

test('clone_dashboard states that authoring is impossible over this API', async () => {
  const { client } = await connect({ SF_ENABLE_REPORT_WRITES: 'true' });
  const { payload, isError } = await call(client, 'clone_dashboard', {
    source_dashboard_id: '01Z000000000001AAA',
    name: 'GTM overview copy',
  });
  assert.equal(isError, false);
  assert.equal(payload.created, true);
  assert.match(payload.note, /Clone only/);
  assert.match(payload.note, /Metadata API/);
});

test('run_report_async queues, then returns the result with the 24-hour retention warning', async () => {
  const { client } = await connect();
  const queued = await call(client, 'run_report_async', { report_id: '00O000000000001AAA' });
  assert.equal(queued.payload.ready, false);
  assert.equal(queued.payload.instance_id, '0LG000000000001AAA');

  const fetched = await call(client, 'run_report_async', {
    report_id: '00O000000000001AAA',
    instance_id: '0LG000000000001AAA',
  });
  assert.equal(fetched.payload.ready, true);
  assert.equal(fetched.payload.all_data, false);
  assert.match(fetched.payload.retention_note, /24-hour rolling window/);
});

test('describe_org_limits reports the analytics ceilings and the client budget', async () => {
  const { client } = await connect();
  const { payload } = await call(client, 'describe_org_limits');
  assert.equal(payload.analytics_limits_documented.report_detail_rows.value, 2000);
  assert.equal(payload.analytics_limits_documented.custom_field_filters_per_run, 20);
  assert.equal(payload.analytics_limits_documented.synchronous_report_runs.per_org_per_hour, 500);
  assert.ok(payload.client_budget_remaining.sync_runs_this_hour > 0);
  assert.match(payload.note, /not values read from\s+this org/);
});
