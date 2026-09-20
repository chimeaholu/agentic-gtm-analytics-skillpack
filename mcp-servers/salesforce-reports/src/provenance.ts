import type { SalesforceClient } from './client.ts';

/**
 * Attached to every tool result. Two report runs by two identities can
 * legitimately return different numbers, and a figure whose running user and
 * timezone are unrecorded is not reproducible.
 */
export interface Provenance {
  source: 'salesforce_report_api' | 'salesforce_soql' | 'salesforce_bulk_api_2';
  instance_url: string;
  api_version: string;
  running_user: { id: string; username: string; name: string };
  /** Date groupings and relative filters (THIS_MONTH, LAST_N_DAYS:7) evaluate here. */
  running_user_timezone: string;
  running_user_locale: string;
  retrieved_at: string;
  row_count: number | null;
  /** null where the concept does not apply (SOQL, Bulk); never omitted on a report run. */
  all_data: boolean | null;
  cap_hit: boolean;
  scope_note: string;
  budget_remaining: { sync_runs_this_hour: number; async_requests_this_hour: number };
}

const SCOPE_NOTE =
  'Report output is scoped to the running user\'s sharing rules, role hierarchy and field-level security. ' +
  'A field absent from the response is an FLS omission, not a null, and an inaccessible record is ' +
  'indistinguishable from a non-existent one over this API.';

export function provenance(
  client: SalesforceClient,
  source: Provenance['source'],
  opts: { rowCount?: number | null; allData?: boolean | null; capHit?: boolean; note?: string } = {},
): Provenance {
  const u = client.user;
  return {
    source,
    instance_url: client.instanceUrl,
    api_version: client.config.apiVersion,
    running_user: { id: u.id, username: u.username, name: u.name },
    running_user_timezone: u.timeZone,
    running_user_locale: u.locale,
    retrieved_at: new Date().toISOString(),
    row_count: opts.rowCount ?? null,
    all_data: opts.allData ?? null,
    cap_hit: opts.capHit ?? false,
    scope_note: opts.note ? `${SCOPE_NOTE} ${opts.note}` : SCOPE_NOTE,
    budget_remaining: {
      sync_runs_this_hour: client.budget.remaining('sync_run'),
      async_requests_this_hour: client.budget.remaining('async_request'),
    },
  };
}
