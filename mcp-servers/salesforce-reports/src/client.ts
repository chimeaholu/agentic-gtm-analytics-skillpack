import type { Config } from './config.ts';
import { authenticate, fetchRunningUser, type RunningUser, type Session } from './auth.ts';
import { Refusal, SalesforceApiError } from './errors.ts';

type Fetch = typeof fetch;

/**
 * A rolling-hour counter per limit class. Salesforce's analytics budget is
 * shared org-wide, so an agent that burns it degrades scheduled jobs and other
 * integrations. Self-throttling is therefore not politeness, it is correctness
 * for everyone else in the org.
 */
export class RateBudget {
  private events = new Map<string, number[]>();
  private ceilings: Record<string, number>;

  constructor(ceilings: Record<string, number>) {
    this.ceilings = ceilings;
  }

  private prune(kind: string, now: number): number[] {
    const cutoff = now - 3_600_000;
    const kept = (this.events.get(kind) ?? []).filter(t => t > cutoff);
    this.events.set(kind, kept);
    return kept;
  }

  remaining(kind: string, now: number = Date.now()): number {
    const ceiling = this.ceilings[kind];
    if (ceiling === undefined) return Infinity;
    return ceiling - this.prune(kind, now).length;
  }

  /** Records one use, or refuses. Refusing is a reportable state, not an error. */
  consume(kind: string, now: number = Date.now()): void {
    const ceiling = this.ceilings[kind];
    if (ceiling === undefined) return;
    const used = this.prune(kind, now);
    if (used.length >= ceiling) {
      const oldest = used[0] ?? now;
      const waitMin = Math.ceil((oldest + 3_600_000 - now) / 60_000);
      throw new Refusal(
        'RATE_BUDGET_EXHAUSTED',
        `The client-side ${kind} budget (${ceiling}/hour) is exhausted. The org limit is shared with ` +
          `scheduled jobs and other integrations. The oldest call ages out in about ${waitMin} minute(s).`,
        kind === 'sync_run'
          ? 'Use run_report_async (a separate 1,200/hour budget), or bulk_query for row-level extraction.'
          : 'Wait for the rolling window, or narrow the work.',
      );
    }
    used.push(now);
    this.events.set(kind, used);
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Which hourly budget this call draws on, if any. */
  budget?: 'sync_run' | 'async_request';
  /** Raw text instead of JSON — Bulk API results are CSV. */
  raw?: boolean;
  headers?: Record<string, string>;
  query?: Record<string, string | undefined>;
}

const MAX_ATTEMPTS = 3;

export class SalesforceClient {
  config: Config;
  private fetchImpl: Fetch;
  private session: Session | null = null;
  private runningUser: RunningUser | null = null;
  budget: RateBudget;

  constructor(config: Config, fetchImpl: Fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.budget = new RateBudget({
      sync_run: config.maxSyncRunsPerHour,
      async_request: config.maxAsyncRequestsPerHour,
    });
  }

  async connect(): Promise<RunningUser> {
    this.session = await authenticate(this.config, this.fetchImpl);
    this.runningUser = await fetchRunningUser(this.session, this.config.apiVersion, this.fetchImpl);
    return this.runningUser;
  }

  get user(): RunningUser {
    if (!this.runningUser) throw new Error('connect() has not completed');
    return this.runningUser;
  }

  get instanceUrl(): string {
    if (!this.session) throw new Error('connect() has not completed');
    return this.session.instanceUrl;
  }

  /** Absolute URL for a path relative to /services/data/{version}/. */
  url(path: string, query?: Record<string, string | undefined>): string {
    const base = path.startsWith('http')
      ? path
      : `${this.instanceUrl}/services/data/${this.config.apiVersion}/${path.replace(/^\/+/, '')}`;
    if (!query) return base;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, v);
    const s = qs.toString();
    return s ? `${base}${base.includes('?') ? '&' : '?'}${s}` : base;
  }

  async request<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; headers: Headers }> {
    if (opts.budget) this.budget.consume(opts.budget);
    const url = this.url(path, opts.query);

    let lastError: SalesforceApiError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await this.fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.session!.accessToken}`,
          // Mandatory on POST run bodies: omitting it returns silently unexpected
          // results rather than an error.
          'Content-Type': 'application/json',
          Accept: opts.raw ? 'text/csv' : 'application/json',
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });

      if (res.ok) {
        const data = (opts.raw ? await res.text() : await res.json()) as T;
        return { data, headers: res.headers };
      }

      const err = await this.toError(res, url);

      // An expired session is re-minted once, then the call is retried. Nothing
      // else about the request changes.
      if (res.status === 401 && attempt === 1) {
        this.session = await authenticate(this.config, this.fetchImpl);
        continue;
      }

      // A hard org-limit refusal is terminal: retrying spends budget that is
      // already gone, and the same call will fail identically.
      if (res.status === 403 && err.errorCode === 'REQUEST_LIMIT_EXCEEDED') throw err;

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, res.headers.get('Retry-After')));
        lastError = err;
        continue;
      }

      throw err;
    }
    throw lastError ?? new Error('request failed with no error recorded');
  }

  private async toError(res: Response, url: string): Promise<SalesforceApiError> {
    let code: string | undefined;
    let message = res.statusText;
    try {
      const body = await res.json();
      const first = Array.isArray(body) ? body[0] : body;
      code = first?.errorCode ?? first?.error;
      message = first?.message ?? first?.error_description ?? message;
    } catch {
      /* non-JSON error body; the status line is all there is */
    }
    return new SalesforceApiError(res.status, code, message, new URL(url).pathname);
  }
}

/** Never retry before Retry-After elapses; jitter so concurrent clients do not resynchronise. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const floor = retryAfter ? Number(retryAfter) * 1000 : 0;
  const exponential = 2 ** attempt * 500;
  return Math.max(floor, exponential) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
