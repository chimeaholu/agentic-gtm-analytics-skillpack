import type { SalesforceClient } from '../client.ts';
import { provenance } from '../provenance.ts';
import { assertLargeExtractConfirmed } from '../guards.ts';
import { SalesforceApiError } from '../errors.ts';

type Args = Record<string, any>;

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 150; // ~5 minutes; a longer job is retrieved by re-invoking with job_id

/**
 * Bulk API 2.0 query — the escape hatch from the report API's 2,000-row ceiling.
 *
 * Three stages: create the job, poll to JobComplete, then page the results with
 * the Sforce-Locator header. The locator loop is the part hand-rolled clients get
 * wrong: the first page looks complete, and the remaining pages are never fetched.
 */
export async function bulkQuery(client: SalesforceClient, args: Args) {
  assertLargeExtractConfirmed(client.config, args.estimated_rows, args.confirm_large_extract);

  const operation: 'query' | 'queryAll' = args.include_deleted ? 'queryAll' : 'query';

  if (!args.job_id) {
    const { data } = await client.request<{ id: string; state: string }>('jobs/query', {
      method: 'POST',
      body: { operation, query: args.soql },
    });

    if (args.wait === false) {
      return {
        job_id: data.id,
        state: data.state,
        complete: false,
        operation,
        note: 'Job created. Call bulk_query again with this job_id to poll and retrieve results.',
        provenance: provenance(client, 'salesforce_bulk_api_2'),
      };
    }
    args = { ...args, job_id: data.id };
  }

  const jobId: string = args.job_id;
  let state = '';
  let info: Record<string, any> = {};

  for (let i = 0; i < MAX_POLLS; i++) {
    const { data } = await client.request<Record<string, any>>(`jobs/query/${jobId}`);
    info = data;
    state = data.state;
    if (state === 'JobComplete' || state === 'Failed' || state === 'Aborted') break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (state !== 'JobComplete') {
    return {
      job_id: jobId,
      state,
      complete: false,
      operation,
      error_message: info.errorMessage ?? null,
      note:
        state === 'Failed' || state === 'Aborted'
          ? 'The job terminated without producing results.'
          : 'Still running. Call bulk_query again with this job_id; the job continues server-side.',
      provenance: provenance(client, 'salesforce_bulk_api_2'),
    };
  }

  const { csv, pages, locatorExhausted } = await fetchAllPages(client, jobId, Number(args.max_pages ?? 50));

  return {
    job_id: jobId,
    state,
    complete: locatorExhausted,
    operation,
    include_deleted: operation === 'queryAll',
    deleted_records_note:
      operation === 'queryAll'
        ? 'queryAll was used: soft-deleted (Recycle Bin) and archived records ARE included in these rows. ' +
          'Filter on IsDeleted to separate them. Recycle Bin retention is 15 days, after which counts shift ' +
          'with no event to point at.'
        : 'Soft-deleted and archived records are EXCLUDED. Set include_deleted to reconcile against a count ' +
          'that includes them.',
    pages_fetched: pages,
    records_processed: info.numberRecordsProcessed ?? null,
    csv,
    truncated: !locatorExhausted,
    truncation_note: locatorExhausted
      ? null
      : `Stopped after ${pages} result pages (max_pages). More rows remain — this is a LOWER BOUND, not a ` +
        'count. Re-invoke with the same job_id and a higher max_pages; results stay retrievable for 7 days.',
    currency_note:
      'Bulk returns Amount in each record\'s own currency plus CurrencyIsoCode. Report-API figures convert to ' +
      'the report\'s currency at current or dated rates, and convertCurrency() does not apply to the report API. ' +
      'These are different numbers; do not add them together.',
    compound_field_note:
      'Bulk API 2.0 query does not support compound fields (Address, geolocation). Request the components ' +
      '(BillingStreet, BillingCity, …) individually.',
    provenance: provenance(client, 'salesforce_bulk_api_2', {
      rowCount: info.numberRecordsProcessed ?? null,
      capHit: !locatorExhausted,
    }),
  };
}

/**
 * The Sforce-Locator loop. The header is passed back as the `locator` parameter
 * until it is absent or the literal string "null" — which is what Salesforce
 * sends on the final page, and which a naive truthiness check treats as a valid
 * locator, producing an infinite loop.
 */
async function fetchAllPages(client: SalesforceClient, jobId: string, maxPages: number) {
  let locator: string | undefined;
  let pages = 0;
  const chunks: string[] = [];

  while (pages < maxPages) {
    const { data, headers } = await client.request<string>(`jobs/query/${jobId}/results`, {
      raw: true,
      query: { locator, maxRecords: '50000' },
    });
    pages++;
    chunks.push(pages === 1 ? data : stripHeaderRow(data));

    const next = headers.get('Sforce-Locator');
    if (!next || next === 'null') return { csv: chunks.join(''), pages, locatorExhausted: true };
    locator = next;
  }
  return { csv: chunks.join(''), pages, locatorExhausted: false };
}

function stripHeaderRow(csv: string): string {
  const i = csv.indexOf('\n');
  return i === -1 ? '' : csv.slice(i + 1);
}

export async function describeOrgLimits(client: SalesforceClient, _args: Args) {
  let limits: Record<string, any> = {};
  let limitsError: string | null = null;
  try {
    const { data } = await client.request<Record<string, any>>('limits');
    limits = data;
  } catch (e) {
    // /limits needs "View Setup and Configuration". Its absence must not hide the
    // documented analytics ceilings, which are what the agent actually throttles on.
    limitsError = e instanceof SalesforceApiError ? `${e.status}: ${e.message}` : String(e);
  }

  return {
    org_limits: limits,
    org_limits_error: limitsError,
    // These are documented platform ceilings, not values read from this org.
    analytics_limits_documented: {
      report_detail_rows: { value: 2000, note: 'per run, no pagination; aggregates still cover the full result set' },
      report_columns_processed: 100,
      custom_field_filters_per_run: 20,
      synchronous_report_runs: { per_org_per_hour: 500, concurrent: 20 },
      asynchronous_requests: { per_org_per_hour: 1200, concurrent_result_reads: 200 },
      async_instance_retention: '24-hour rolling window, up to 2,000 listable instances',
      dashboard_refreshes: { per_org_per_hour: 200 },
      sync_run_timeout: '2 minutes (the platform API timeout); async runs are not subject to it',
      bulk_query_jobs: { per_rolling_24h: 10000, max_file_size: '1 GB', results_retained_days: 7 },
    },
    client_budget_remaining: {
      sync_runs_this_hour: client.budget.remaining('sync_run'),
      async_requests_this_hour: client.budget.remaining('async_request'),
    },
    note:
      'analytics_limits_documented are platform ceilings from Salesforce documentation, not values read from ' +
      'this org — the API does not expose the analytics limits in /limits. client_budget_remaining is this ' +
      'server\'s own conservative counter, which is deliberately below the org ceiling because the ceiling is ' +
      'shared with scheduled jobs and other integrations.',
    provenance: provenance(client, 'salesforce_report_api'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
