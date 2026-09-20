import type { SalesforceClient } from '../client.ts';
import { provenance } from '../provenance.ts';
import { assertFolderAllowed, assertWritesEnabled, HARD_REFUSALS } from '../guards.ts';

type Args = Record<string, any>;

export async function listDashboards(client: SalesforceClient, _args: Args) {
  const { data } = await client.request<{ dashboards?: unknown[] }>('analytics/dashboards');
  const dashboards = data.dashboards ?? [];
  return {
    dashboards,
    count: dashboards.length,
    note:
      'Dashboards visible to the running user. For a full catalogue independent of folder visibility, ' +
      'SOQL the Dashboard object instead.',
    provenance: provenance(client, 'salesforce_report_api', { rowCount: dashboards.length }),
  };
}

export async function getDashboardResults(client: SalesforceClient, args: Args) {
  const { data } = await client.request<Record<string, any>>(
    `analytics/dashboards/${encodeURIComponent(args.dashboard_id)}/results`,
  );

  return {
    dashboard_id: args.dashboard_id,
    results: data,
    // Dashboard components are backed by reports, and each of those runs under the
    // same 2,000-row detail cap. The dashboard surface does not expose allData per
    // component, so the flag cannot be asserted here — say so rather than implying
    // completeness.
    all_data: null,
    completeness_note:
      'This surface does not expose allData per component. Each component is backed by a report subject to the ' +
      '2,000-row detail cap; component aggregates are computed over the full result set. To assert completeness ' +
      'for a specific figure, run its source report with run_report and read allData there.',
    refresh_note:
      'These are the dashboard\'s last-refreshed values, not a live query. The refreshDate in the payload is the ' +
      'figure\'s real freshness — a dashboard refreshed weekly shows week-old numbers with today\'s timestamp on ' +
      'the page around it.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

export async function cloneDashboard(client: SalesforceClient, args: Args) {
  assertWritesEnabled(client.config, 'clone_dashboard');
  assertFolderAllowed(client.config, args.folder_id);

  const body: Record<string, any> = { name: args.name };
  if (args.folder_id) body.folderId = args.folder_id;

  const { data } = await client.request<Record<string, any>>('analytics/dashboards', {
    method: 'POST',
    body,
    query: { cloneId: args.source_dashboard_id },
  });

  return {
    created: true,
    dashboard_id: data.id ?? null,
    cloned_from: args.source_dashboard_id,
    name: args.name,
    note:
      'Clone only. The Reports and Dashboards REST API cannot create a dashboard from a specification, and it ' +
      'cannot edit the clone\'s components. Layout and component changes are a human task in Salesforce, or a ' +
      'Metadata API deployment, which this server does not wrap.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

/** Exposed so the server can answer an authoring request with a refusal instead of an approximation. */
export function refuseDashboardAuthoring(): never {
  throw HARD_REFUSALS.dashboardAuthoring!;
}
