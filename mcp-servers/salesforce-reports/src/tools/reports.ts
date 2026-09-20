import type { SalesforceClient } from '../client.ts';
import { provenance } from '../provenance.ts';
import { readRunResponse, type RunResponse } from '../factmap.ts';
import {
  assertFolderAllowed,
  assertWritesEnabled,
  validateReportMetadataOverride,
} from '../guards.ts';
import { Refusal } from '../errors.ts';

type Args = Record<string, any>;

/**
 * list_reports deliberately uses SOQL, not GET /analytics/reports.
 * The REST list resource returns only up to 200 RECENTLY-VIEWED reports for the
 * running user, so an agent using it reports a near-empty org.
 */
export async function listReports(client: SalesforceClient, args: Args) {
  const where: string[] = [];
  if (args.folder_name) where.push(`FolderName = '${escapeSoql(args.folder_name)}'`);
  if (args.name_contains) where.push(`Name LIKE '%${escapeSoql(args.name_contains)}%'`);
  const limit = Math.min(Number(args.limit ?? 200), 2000);

  const soql =
    'SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate, LastModifiedDate, OwnerId ' +
    'FROM Report' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY FolderName, Name LIMIT ${limit}`;

  const { data } = await client.request<{ totalSize: number; done: boolean; records: unknown[] }>(
    'query',
    { query: { q: soql } },
  );

  return {
    reports: data.records,
    total_size: data.totalSize,
    complete: data.done && data.records.length < limit,
    query_used: soql,
    note:
      'Enumerated via SOQL against the Report object, which is the full catalogue. ' +
      'GET /analytics/reports would return only up to 200 recently-viewed reports for the running user ' +
      'and would describe a near-empty org.',
    provenance: provenance(client, 'salesforce_soql', { rowCount: data.records.length }),
  };
}

export async function describeReport(client: SalesforceClient, args: Args) {
  const { data } = await client.request<Record<string, unknown>>(
    `analytics/reports/${encodeURIComponent(args.report_id)}/describe`,
  );
  return {
    report_metadata: data.reportMetadata ?? null,
    report_extended_metadata: data.reportExtendedMetadata ?? null,
    report_type_metadata: data.reportTypeMetadata ?? null,
    note:
      'Call this before overriding filters or authoring a report of this type. reportTypeMetadata carries the ' +
      'exact column API names, which columns are filterable and with which operators. Column names are ' +
      'report-type and org specific; a guessed name produces a report that saves and returns nothing.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

export async function runReport(client: SalesforceClient, args: Args) {
  const includeDetails = args.include_details !== false;
  const { data } = await client.request<RunResponse>(
    `analytics/reports/${encodeURIComponent(args.report_id)}`,
    { query: { includeDetails: String(includeDetails) }, budget: 'sync_run' },
  );
  return runPayload(client, data);
}

export async function runReportWithFilters(client: SalesforceClient, args: Args) {
  const md = args.report_metadata as Record<string, unknown>;
  if (!md || typeof md !== 'object') {
    throw new Refusal(
      'FILTER_TYPE_NOT_SUPPORTED',
      'report_metadata is required and must be a reportMetadata object.',
      'Call describe_report first and modify the reportMetadata block it returns.',
    );
  }
  validateReportMetadataOverride(md);

  const { data } = await client.request<RunResponse>(
    `analytics/reports/${encodeURIComponent(args.report_id)}`,
    {
      method: 'POST',
      body: { reportMetadata: md },
      query: { includeDetails: String(args.include_details !== false) },
      budget: 'sync_run',
    },
  );

  return {
    ...runPayload(client, data),
    overrides_saved: false,
    overrides_note:
      'Overrides applied to this run only. Nothing was saved; the stored report definition is unchanged.',
  };
}

export async function runReportAsync(client: SalesforceClient, args: Args) {
  if (args.instance_id) {
    const { data } = await client.request<RunResponse & { status?: string; errorMessage?: string }>(
      `analytics/reports/${encodeURIComponent(args.report_id)}/instances/${encodeURIComponent(args.instance_id)}`,
      { budget: 'async_request' },
    );
    if (data.status && data.status !== 'Success') {
      return {
        instance_id: args.instance_id,
        status: data.status,
        error_message: data.errorMessage ?? null,
        ready: false,
        note: 'Poll again. Statuses are New, Running, Success, Error.',
        provenance: provenance(client, 'salesforce_report_api'),
      };
    }
    return {
      instance_id: args.instance_id,
      status: data.status ?? 'Success',
      ready: true,
      ...runPayload(client, data),
      retention_note:
        'Asynchronous results live in a 24-hour rolling window, up to 2,000 listable instances. ' +
        'Persist this result now; it will not be re-readable tomorrow.',
    };
  }

  const body = args.report_metadata ? { reportMetadata: args.report_metadata } : {};
  if (args.report_metadata) validateReportMetadataOverride(args.report_metadata);

  const { data } = await client.request<{ id: string; status: string }>(
    `analytics/reports/${encodeURIComponent(args.report_id)}/instances`,
    { method: 'POST', body, budget: 'async_request' },
  );

  return {
    instance_id: data.id,
    status: data.status,
    ready: false,
    note:
      'Instance queued. Call run_report_async again with this instance_id to fetch the result. ' +
      'Asynchronous runs exist because synchronous runs die at the 2-minute platform API timeout; ' +
      'the 2,000-row detail cap applies to both.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

/* ----------------------------- writes ----------------------------- */

export async function createReport(client: SalesforceClient, args: Args) {
  assertWritesEnabled(client.config, 'create_report');
  const md = args.report_metadata as Record<string, unknown>;
  if (!md?.name || !md?.reportType) {
    throw new Refusal(
      'FILTER_TYPE_NOT_SUPPORTED',
      'report_metadata requires at least name and reportType. reportType takes the shape {"type": "Opportunity"}.',
      'Call describe_report on an existing report of the intended type and copy its reportMetadata shape.',
    );
  }
  assertFolderAllowed(client.config, md.folderId as string | undefined);

  const { data } = await client.request<Record<string, any>>('analytics/reports', {
    method: 'POST',
    body: { reportMetadata: md },
  });

  return {
    created: true,
    report_id: data.reportMetadata?.id ?? data.id ?? null,
    name: data.reportMetadata?.name ?? md.name,
    folder_id: data.reportMetadata?.folderId ?? md.folderId ?? null,
    report_metadata: data.reportMetadata ?? null,
    note:
      'A real, saved, persistent report object was created. It is visible to anyone with access to its folder. ' +
      'If folderId was omitted it is in the running user\'s private folder, which is probably not where the ' +
      'requester expects to find it.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

export async function updateReport(client: SalesforceClient, args: Args) {
  assertWritesEnabled(client.config, 'update_report');
  const md = args.report_metadata as Record<string, unknown>;
  if (md?.folderId) assertFolderAllowed(client.config, md.folderId as string);

  const { data } = await client.request<Record<string, any>>(
    `analytics/reports/${encodeURIComponent(args.report_id)}`,
    { method: 'PATCH', body: { reportMetadata: md } },
  );

  return {
    updated: true,
    report_id: args.report_id,
    report_metadata: data.reportMetadata ?? null,
    note:
      'The stored report definition changed for everyone who uses it. Any dashboard component, scheduled ' +
      'delivery or saved link built on this report now reflects the new definition.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

export async function cloneReport(client: SalesforceClient, args: Args) {
  assertWritesEnabled(client.config, 'clone_report');
  assertFolderAllowed(client.config, args.folder_id);

  const body: Record<string, unknown> = { reportMetadata: { name: args.name } };
  if (args.folder_id) (body.reportMetadata as Record<string, unknown>).folderId = args.folder_id;

  const { data } = await client.request<Record<string, any>>('analytics/reports', {
    method: 'POST',
    body,
    query: { cloneId: args.source_report_id },
  });

  return {
    created: true,
    report_id: data.reportMetadata?.id ?? data.id ?? null,
    cloned_from: args.source_report_id,
    name: data.reportMetadata?.name ?? args.name,
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

/* ----------------------------- shared ----------------------------- */

function runPayload(client: SalesforceClient, data: RunResponse) {
  const result = readRunResponse(data);
  return {
    // allData is at the top level of the payload, deliberately, on every response.
    all_data: result.allData,
    truncated: result.truncated,
    truncation_note: result.truncation_note,
    grand_total: result.grand_total,
    groupings: result.groupings,
    detail_row_count: result.detail_row_count,
    detail_rows: result.detail_rows,
    aggregate_columns: result.aggregate_columns,
    detail_columns: result.detail_columns,
    applied_filters: result.applied_filters,
    value_note:
      'Each cell carries both value (for arithmetic) and __label (locale-formatted, for display). ' +
      'Parsing a label back to a number is how currency symbols and thousands separators corrupt a calculation.',
    provenance: provenance(client, 'salesforce_report_api', {
      rowCount: result.detail_row_count,
      allData: result.allData,
      capHit: result.truncated,
      note: result.truncated
        ? 'Aggregates are exact over the full result set; detail rows are a truncated extract.'
        : undefined,
    }),
  };
}

/** SOQL string literals escape backslash and single quote. Nothing else is interpolated. */
function escapeSoql(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
