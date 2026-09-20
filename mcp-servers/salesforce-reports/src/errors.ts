/**
 * Typed refusals. Every refusal names what was asked, why the API cannot do it,
 * and the supported route — so the agent stops instead of retrying a call that
 * will never succeed.
 */

export type RefusalCode =
  | 'DML_NOT_SUPPORTED'
  | 'APEX_NOT_SUPPORTED'
  | 'CSV_EXPORT_URL_NOT_SUPPORTED'
  | 'METADATA_DEPLOY_NOT_SUPPORTED'
  | 'DASHBOARD_AUTHORING_NOT_SUPPORTED'
  | 'WRITES_DISABLED'
  | 'FOLDER_NOT_ALLOWED'
  | 'FILTER_TYPE_NOT_SUPPORTED'
  | 'FILTER_LIMIT_EXCEEDED'
  | 'CREDENTIAL_IN_ARGUMENT'
  | 'LARGE_EXTRACT_UNCONFIRMED'
  | 'MIXED_SOURCE_RESULT'
  | 'RATE_BUDGET_EXHAUSTED';

export class Refusal extends Error {
  code: RefusalCode;
  supportedRoute?: string;

  constructor(code: RefusalCode, message: string, supportedRoute?: string) {
    super(message);
    this.name = 'Refusal';
    this.code = code;
    this.supportedRoute = supportedRoute;
  }

  toPayload() {
    return {
      refused: true,
      code: this.code,
      reason: this.message,
      ...(this.supportedRoute ? { supported_route: this.supportedRoute } : {}),
    };
  }
}

export class SalesforceApiError extends Error {
  status: number;
  errorCode: string | undefined;
  requestPath: string;

  constructor(status: number, errorCode: string | undefined, message: string, requestPath: string) {
    super(message);
    this.name = 'SalesforceApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.requestPath = requestPath;
  }

  toPayload() {
    return {
      error: true,
      status: this.status,
      error_code: this.errorCode ?? null,
      message: this.message,
      request_path: this.requestPath,
      hint: hintFor(this.status, this.errorCode) ?? null,
    };
  }
}

function hintFor(status: number, code?: string): string | undefined {
  if (status === 401) {
    return 'Usually the token was minted against the wrong host. The API host must come from ' +
      'instance_url in the token response, and a sandbox authenticates against test.salesforce.com.';
  }
  if (status === 403 && code === 'REQUEST_LIMIT_EXCEEDED') {
    return 'The org hourly analytics budget is exhausted (500 synchronous report runs/hour, ' +
      '1,200 asynchronous requests/hour). Wait for the rolling window or switch to bulk_query.';
  }
  if (status === 404) {
    return 'The id may be valid but invisible to the running user: report output is scoped to the ' +
      "running user's sharing rules and folder access, and an inaccessible report is indistinguishable " +
      'from a missing one over this API.';
  }
  if (status === 400 && code === 'INVALID_FIELD') {
    return 'Column API names are report-type and org specific. Call describe_report on an existing ' +
      'report of the same reportType and copy the names from reportTypeMetadata.';
  }
  return undefined;
}
