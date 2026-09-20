import type { SalesforceClient } from '../client.ts';
import * as reports from './reports.ts';
import * as dashboards from './dashboards.ts';
import * as bulk from './bulk.ts';
import { WRITE_TOOLS } from '../guards.ts';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  isWrite: boolean;
  handler: (client: SalesforceClient, args: Record<string, any>) => Promise<unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const bool = (description: string) => ({ type: 'boolean', description });
const num = (description: string) => ({ type: 'integer', description });

export const TOOLS: ToolDef[] = [
  {
    name: 'list_reports',
    description:
      'List saved reports via SOQL against the Report object — the full org catalogue. Deliberately not ' +
      'GET /analytics/reports, which returns only up to 200 recently-viewed reports for the running user and ' +
      'makes a populated org look empty. Supports folder and name filters.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_name: str('Exact folder name to filter by.'),
        name_contains: str('Substring match on the report name.'),
        limit: num('Max rows (default 200, max 2000).'),
      },
    },
    isWrite: false,
    handler: reports.listReports,
  },
  {
    name: 'describe_report',
    description:
      'Describe a report: reportMetadata, reportExtendedMetadata and reportTypeMetadata. Call this before ' +
      'overriding filters or authoring a report of the same type — it carries the exact column API names and ' +
      'the operators each column supports, which are report-type and org specific and cannot be guessed.',
    inputSchema: {
      type: 'object',
      properties: { report_id: str('The 15- or 18-character report id.') },
      required: ['report_id'],
    },
    isWrite: false,
    handler: reports.describeReport,
  },
  {
    name: 'run_report',
    description:
      'Run a saved report synchronously and return its results. allData is surfaced at the top level of the ' +
      'response: when false, the aggregates are still exact over the full result set but the detail rows were ' +
      'silently truncated at 2,000 with no pagination. Synchronous runs die at the 2-minute platform timeout — ' +
      'use run_report_async for anything heavy.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: str('The report id.'),
        include_details: bool('Include detail rows (default true). False returns aggregates only and is much cheaper.'),
      },
      required: ['report_id'],
    },
    isWrite: false,
    handler: reports.runReport,
  },
  {
    name: 'run_report_with_filters',
    description:
      'Run a report with reportMetadata overrides applied TO THAT RUN ONLY — nothing is saved and the stored ' +
      'report is unchanged. This is the correct way to answer "the same report but last quarter". Rejects the ' +
      'filter types the API cannot apply when filtering (cross filters, standard report filters, row-limit ' +
      'filters) and enforces the 20-custom-filter ceiling, which Salesforce silently ignores rather than erroring on.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: str('The report id.'),
        report_metadata: {
          type: 'object',
          description:
            'A reportMetadata object with the fields to override, e.g. standardDateFilter, reportFilters, ' +
            'groupingsDown. Start from describe_report output.',
        },
        include_details: bool('Include detail rows (default true).'),
      },
      required: ['report_id', 'report_metadata'],
    },
    isWrite: false,
    handler: reports.runReportWithFilters,
  },
  {
    name: 'run_report_async',
    description:
      'Run a report asynchronously, for reports that exceed the 2-minute synchronous timeout. Call without ' +
      'instance_id to queue a run; call again with the returned instance_id to fetch the result. Results live ' +
      'in a 24-hour rolling window and must be persisted, not re-read tomorrow.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: str('The report id.'),
        instance_id: str('Omit to queue a run; supply to fetch a queued run.'),
        report_metadata: { type: 'object', description: 'Optional run-only overrides, same shape as run_report_with_filters.' },
      },
      required: ['report_id'],
    },
    isWrite: false,
    handler: reports.runReportAsync,
  },
  {
    name: 'list_dashboards',
    description: 'List dashboards visible to the running user.',
    inputSchema: { type: 'object', properties: {} },
    isWrite: false,
    handler: dashboards.listDashboards,
  },
  {
    name: 'get_dashboard_results',
    description:
      'Fetch a dashboard\'s last-refreshed component results. These are stored values, not a live query: the ' +
      'refreshDate in the payload is the real freshness of the numbers. This surface does not expose allData ' +
      'per component, so completeness cannot be asserted here — run the source report to establish it.',
    inputSchema: {
      type: 'object',
      properties: { dashboard_id: str('The dashboard id.') },
      required: ['dashboard_id'],
    },
    isWrite: false,
    handler: dashboards.getDashboardResults,
  },
  {
    name: 'bulk_query',
    description:
      'Extract rows with Bulk API 2.0 — the supported escape hatch from the report API\'s 2,000-row ceiling. ' +
      'Creates a query job, polls to JobComplete, and pages results through the Sforce-Locator loop until it is ' +
      'exhausted. Returns CSV. Note that you are re-implementing the report\'s logic when you do this, and that ' +
      'custom summary formulas (PARENTGROUPVAL, PREVGROUPVAL, ROWCOUNT) exist only inside reports and cannot be ' +
      'reproduced here at all.',
    inputSchema: {
      type: 'object',
      properties: {
        soql: str('The SOQL query. Compound fields (Address, geolocation) are not supported — request components individually.'),
        include_deleted: bool('Use queryAll, including soft-deleted and archived records. Off by default; the result states which was used.'),
        estimated_rows: num('Your row estimate. Above the configured threshold, confirm_large_extract is required.'),
        confirm_large_extract: bool('Explicit confirmation for a large extract.'),
        job_id: str('Poll and retrieve an existing job instead of creating one.'),
        max_pages: num('Result pages to fetch before returning a lower bound (default 50).'),
        wait: bool('False returns the job id immediately without polling.'),
      },
      required: [],
    },
    isWrite: false,
    handler: bulk.bulkQuery,
  },
  {
    name: 'describe_org_limits',
    description:
      'Report org limits plus the documented analytics ceilings (2,000 report rows, 500 synchronous runs/hour, ' +
      '1,200 asynchronous requests/hour) and this server\'s own remaining hourly budget, so work can be planned ' +
      'before the first call rather than discovered at the limit.',
    inputSchema: { type: 'object', properties: {} },
    isWrite: false,
    handler: bulk.describeOrgLimits,
  },

  /* ------------------------- gated writes ------------------------- */

  {
    name: 'create_report',
    description:
      'Create a real, saved, persistent report object via POST /analytics/reports with a reportMetadata body. ' +
      'Minimum body is name + reportType. This is the one thing no other Salesforce MCP server does. ' +
      'Call describe_report on an existing report of the same type first: column API names are report-type and ' +
      'org specific, and a guessed name produces a report that saves and returns nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        report_metadata: {
          type: 'object',
          description:
            'reportMetadata. Required: name, reportType ({"type":"Opportunity"}). Common: reportFormat ' +
            '(TABULAR|SUMMARY|MATRIX), folderId, detailColumns, groupingsDown, aggregates ("s!AMOUNT" sum, ' +
            '"a!" average, "mx!" max, "mn!" min, "RowCount"), standardDateFilter, reportFilters.',
        },
      },
      required: ['report_metadata'],
    },
    isWrite: true,
    handler: reports.createReport,
  },
  {
    name: 'update_report',
    description:
      'Update a saved report definition via PATCH. This changes the report for everyone who uses it, including ' +
      'dashboard components and scheduled deliveries built on it.',
    inputSchema: {
      type: 'object',
      properties: {
        report_id: str('The report id.'),
        report_metadata: { type: 'object', description: 'The reportMetadata fields to change.' },
      },
      required: ['report_id', 'report_metadata'],
    },
    isWrite: true,
    handler: reports.updateReport,
  },
  {
    name: 'clone_report',
    description: 'Clone a report via POST /analytics/reports?cloneId= with a new name, optionally into a named folder.',
    inputSchema: {
      type: 'object',
      properties: {
        source_report_id: str('The report to clone.'),
        name: str('Name for the new report.'),
        folder_id: str('Destination folder id.'),
      },
      required: ['source_report_id', 'name'],
    },
    isWrite: true,
    handler: reports.cloneReport,
  },
  {
    name: 'clone_dashboard',
    description:
      'Clone a dashboard via POST /analytics/dashboards?cloneId=. CLONE ONLY — the Reports and Dashboards REST ' +
      'API cannot author a dashboard from a specification and cannot edit components. That requires the Metadata ' +
      'API, which this server does not wrap.',
    inputSchema: {
      type: 'object',
      properties: {
        source_dashboard_id: str('The dashboard to clone.'),
        name: str('Name for the new dashboard.'),
        folder_id: str('Destination folder id.'),
      },
      required: ['source_dashboard_id', 'name'],
    },
    isWrite: true,
    handler: dashboards.cloneDashboard,
  },
];

/**
 * With writes off, the write tools are not advertised at all — the agent cannot
 * attempt what it cannot see. The handlers still refuse independently, because a
 * gate that exists only in the tool listing is not a gate.
 */
export function visibleTools(enableWrites: boolean): ToolDef[] {
  return enableWrites ? TOOLS : TOOLS.filter(t => !t.isWrite);
}

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find(t => t.name === name);
}

export { WRITE_TOOLS };
