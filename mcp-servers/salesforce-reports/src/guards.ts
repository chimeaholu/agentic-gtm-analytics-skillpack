import type { Config } from './config.ts';
import { Refusal } from './errors.ts';

/* ------------------------------------------------------------------ *
 * Hard refusals. No configuration flag enables any of these.
 * ------------------------------------------------------------------ */

export const HARD_REFUSALS: Record<string, Refusal> = {
  dml: new Refusal(
    'DML_NOT_SUPPORTED',
    'This server exposes reporting and extraction only. It performs no create, update, delete, upsert ' +
      'or merge against Accounts, Contacts, Leads, Opportunities or any other business record.',
    'Use a CRM-write integration with its own approval path. Report objects are the only things this server writes, ' +
      'and only when SF_ENABLE_REPORT_WRITES is on.',
  ),
  apex: new Refusal(
    'APEX_NOT_SUPPORTED',
    'No anonymous Apex, no Apex REST invocation and no Tooling API execution path is exposed.',
    'If the calculation only exists in Apex, reproduce it in SOQL via bulk_query, or surface it as a report formula.',
  ),
  csvExportUrl: new Refusal(
    'CSV_EXPORT_URL_NOT_SUPPORTED',
    'The ?export=1&enc=UTF-8&xf=csv report export URL is an undocumented UI endpoint. It requires ' +
      'session-cookie authentication rather than OAuth and it breaks across releases, so it is not implemented.',
    'bulk_query — Bulk API 2.0 against the underlying objects, which is the supported extraction path and has no 2,000-row ceiling.',
  ),
  metadataDeploy: new Refusal(
    'METADATA_DEPLOY_NOT_SUPPORTED',
    'Authoring a dashboard from nothing requires the Metadata API, which is an org-changing deployment path ' +
      'and is out of scope for a reporting server.',
    'clone_dashboard from an existing dashboard, or have an admin deploy the dashboard metadata through the normal release process.',
  ),
  dashboardAuthoring: new Refusal(
    'DASHBOARD_AUTHORING_NOT_SUPPORTED',
    'The Reports and Dashboards REST API cannot create a dashboard from a specification. Dashboards over this ' +
      'API are clone-only. This is an API limitation, not a configuration choice.',
    'clone_dashboard, then a human edits the clone in Salesforce; or the Metadata API, which this server does not wrap.',
  ),
};

/* ------------------------------------------------------------------ *
 * Credentials are configured at startup. No tool accepts one.
 * ------------------------------------------------------------------ */

const CREDENTIAL_KEY = /(token|secret|password|passwd|private_?key|client_?id|client_?secret|session_?id|credential|bearer)/i;

export function assertNoCredentialArguments(args: Record<string, unknown>): void {
  const found = Object.keys(args).filter(k => CREDENTIAL_KEY.test(k));
  if (found.length) {
    throw new Refusal(
      'CREDENTIAL_IN_ARGUMENT',
      `Credential-shaped argument(s) rejected: ${found.join(', ')}. Authentication is configured at server ` +
        'startup from the environment; no tool accepts a token, key or password as a parameter.',
      'Configure SF_* environment variables and restart the server.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * The write gate
 * ------------------------------------------------------------------ */

export const WRITE_TOOLS = ['create_report', 'update_report', 'clone_report', 'clone_dashboard'] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];

export function assertWritesEnabled(cfg: Config, tool: string): void {
  if (!cfg.enableWrites) {
    throw new Refusal(
      'WRITES_DISABLED',
      `${tool} is a write and SF_ENABLE_REPORT_WRITES is not "true". Writes are off by default and are ` +
        'enabled per stored credential, never inferred from a prompt.',
      'An operator sets SF_ENABLE_REPORT_WRITES=true and restarts the server. With writes off these tools ' +
        'are not advertised at all.',
    );
  }
}

/**
 * An approved capability still gets a bounded blast radius. The allowlist accepts
 * folder ids or developer names; both are compared verbatim.
 */
export function assertFolderAllowed(cfg: Config, folderId: string | undefined): void {
  if (!cfg.writeFolderAllowlist) return;
  if (!folderId) {
    throw new Refusal(
      'FOLDER_NOT_ALLOWED',
      'A write folder allowlist is configured, so folderId is required. Omitting it would place the report ' +
        'in the running user\'s private folder, where the requester probably cannot see it.',
      `Pass one of: ${cfg.writeFolderAllowlist.join(', ')}`,
    );
  }
  if (!cfg.writeFolderAllowlist.includes(folderId)) {
    throw new Refusal(
      'FOLDER_NOT_ALLOWED',
      `Folder "${folderId}" is not in SF_WRITE_FOLDER_ALLOWLIST.`,
      `Allowed folders: ${cfg.writeFolderAllowlist.join(', ')}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Filter validation for run_report_with_filters
 * ------------------------------------------------------------------ */

/** Filter types the API cannot apply when filtering a report run. */
const UNSUPPORTED_FILTER_KEYS: Array<{ key: string; label: string }> = [
  { key: 'crossFilters', label: 'cross filters' },
  { key: 'standardFilters', label: 'standard report filters' },
  { key: 'topRows', label: 'row-limit (top N) filters' },
];

export const MAX_CUSTOM_FILTERS = 20;

export function validateReportMetadataOverride(md: Record<string, unknown>): void {
  for (const { key, label } of UNSUPPORTED_FILTER_KEYS) {
    if (md[key] !== undefined && md[key] !== null) {
      throw new Refusal(
        'FILTER_TYPE_NOT_SUPPORTED',
        `${label} cannot be applied when filtering a report through the API, even though the report may use ` +
          'them in the Salesforce UI. Sending them yields a run that does not reflect the filters you asked for.',
        'Run the report unfiltered and post-filter the rows, or have the report saved with the filter built in, ' +
          'or extract the underlying objects with bulk_query and apply the logic yourself.',
      );
    }
  }

  const filters = md.reportFilters;
  if (Array.isArray(filters) && filters.length > MAX_CUSTOM_FILTERS) {
    throw new Refusal(
      'FILTER_LIMIT_EXCEEDED',
      `${filters.length} custom field filters requested; the API applies at most ${MAX_CUSTOM_FILTERS} per run. ` +
        'Salesforce does not error on the excess — it silently ignores it, so the result would look correct and be wrong.',
      'Reduce to 20 filters, pre-filter in a saved report, or use bulk_query with the full predicate in SOQL.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Large extracts
 * ------------------------------------------------------------------ */

export function assertLargeExtractConfirmed(
  cfg: Config,
  estimatedRows: number | undefined,
  confirmed: boolean | undefined,
): void {
  if (estimatedRows !== undefined && estimatedRows > cfg.largeExtractRows && !confirmed) {
    throw new Refusal(
      'LARGE_EXTRACT_UNCONFIRMED',
      `The estimate is ${estimatedRows.toLocaleString()} rows, above the ${cfg.largeExtractRows.toLocaleString()} ` +
        'row threshold. Large bulk jobs consume the org\'s daily query-job allocation (10,000 per rolling 24 hours) ' +
        'and can run for a long time.',
      'Re-issue with confirm_large_extract: true, or narrow the SOQL predicate.',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Results from different surfaces are never merged
 * ------------------------------------------------------------------ */

export function refuseMixedSources(): Refusal {
  return new Refusal(
    'MIXED_SOURCE_RESULT',
    'Report-API figures and Bulk-extracted figures are not combined in one result. They use different currency ' +
      'conversion paths: report amounts convert at current or dated rates into the report\'s currency, ' +
      'convertCurrency() does not apply to the report API, and Bulk returns Amount in the record currency plus ' +
      'CurrencyIsoCode. Adding them produces a number in no currency at all.',
    'Take both results separately, each with its own provenance, and normalise deliberately if you need one figure.',
  );
}
