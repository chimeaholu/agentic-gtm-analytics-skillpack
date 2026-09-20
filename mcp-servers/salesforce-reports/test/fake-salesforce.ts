/**
 * A fake Salesforce transport. It answers the exact endpoints this server calls,
 * with response shapes taken from the Reports and Dashboards REST API and Bulk
 * API 2.0 documentation — including the two that matter most: allData: false on a
 * truncated run, and the Sforce-Locator header ending with the literal "null".
 */

export interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

export const INSTANCE = 'https://example-instance.my.salesforce.com';
export const USER_ID = '005000000000001AAA';

export function makeFakeSalesforce(overrides: Record<string, (url: URL, init: RequestInit) => Response> = {}) {
  const calls: Call[] = [];

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>),
    );
    calls.push({
      method: init.method ?? 'GET',
      url: url.toString(),
      body: parseBody(init.body),
      headers,
    });

    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (matches(pattern, key)) return handler(url, init);
    }
    return route(url, init);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** Token requests are form-encoded; everything else this server sends is JSON. */
function parseBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined;
  const text = String(body);
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

function matches(pattern: string, key: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*') + '$');
  return re.test(key);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function route(url: URL, init: RequestInit): Response {
  const p = url.pathname;
  const method = init.method ?? 'GET';

  if (p === '/services/oauth2/token') {
    return json({
      access_token: 'ACCESS_TOKEN',
      instance_url: INSTANCE,
      id: `https://login.salesforce.com/id/00D000000000001EAA/${USER_ID}`,
      issued_at: '1700000000000',
      token_type: 'Bearer',
    });
  }

  if (p.endsWith('/query')) {
    const q = url.searchParams.get('q') ?? '';
    if (q.includes('FROM User')) {
      return json({
        totalSize: 1,
        done: true,
        records: [{
          Id: USER_ID,
          Username: 'integration.user@example.com',
          Name: 'Integration User',
          TimeZoneSidKey: 'America/Los_Angeles',
          LocaleSidKey: 'en_US',
        }],
      });
    }
    if (q.includes('FROM Report')) {
      return json({
        totalSize: 2,
        done: true,
        records: [
          { Id: '00O000000000001AAA', Name: 'Pipeline by stage', DeveloperName: 'Pipeline_by_stage',
            FolderName: 'GTM Reports', Format: 'SUMMARY', LastRunDate: '2026-09-19T10:00:00.000+0000' },
          { Id: '00O000000000002AAA', Name: 'Closed won by owner', DeveloperName: 'Closed_won_by_owner',
            FolderName: 'GTM Reports', Format: 'MATRIX', LastRunDate: null },
        ],
      });
    }
    return json({ totalSize: 0, done: true, records: [] });
  }

  if (p.endsWith('/describe')) {
    return json({
      reportMetadata: { id: '00O000000000001AAA', name: 'Pipeline by stage', reportFormat: 'SUMMARY' },
      reportExtendedMetadata: { detailColumnInfo: { AMOUNT: { label: 'Amount', dataType: 'currency' } } },
      reportTypeMetadata: {
        categories: [{ label: 'Opportunity', columns: { AMOUNT: { label: 'Amount', filterable: true } } }],
      },
    });
  }

  if (/\/analytics\/reports\/[^/]+\/instances\/[^/]+$/.test(p)) {
    return json({ ...truncatedRun(), status: 'Success' });
  }
  if (/\/analytics\/reports\/[^/]+\/instances$/.test(p) && method === 'POST') {
    return json({ id: '0LG000000000001AAA', status: 'New' });
  }

  if (p === '/services/data/v60.0/analytics/reports' && method === 'POST') {
    const cloneId = url.searchParams.get('cloneId');
    const body = JSON.parse(String(init.body)) as { reportMetadata: Record<string, unknown> };
    return json({
      reportMetadata: {
        id: cloneId ? '00O000000000009AAA' : '00O000000000008AAA',
        name: body.reportMetadata.name,
        folderId: body.reportMetadata.folderId ?? null,
      },
    }, 201);
  }

  if (/\/analytics\/reports\/[^/]+$/.test(p)) {
    if (method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { reportMetadata: Record<string, unknown> };
      return json({ reportMetadata: { id: p.split('/').pop(), ...body.reportMetadata } });
    }
    return json(truncatedRun());
  }

  if (p.endsWith('/analytics/dashboards') && method === 'POST') {
    return json({ id: '01Z000000000001AAA' }, 201);
  }
  if (p.endsWith('/analytics/dashboards')) {
    return json({ dashboards: [{ id: '01Z000000000001AAA', name: 'GTM overview' }] });
  }
  if (/\/analytics\/dashboards\/[^/]+\/results$/.test(p)) {
    return json({ dashboardMetadata: { id: '01Z000000000001AAA' }, componentData: [], refreshDate: '2026-09-18T06:00:00Z' });
  }

  if (p.endsWith('/jobs/query') && method === 'POST') {
    return json({ id: '750000000000001AAA', state: 'UploadComplete', operation: 'query' }, 201);
  }
  if (/\/jobs\/query\/[^/]+\/results$/.test(p)) {
    const locator = url.searchParams.get('locator');
    if (!locator) {
      return new Response('Id,Amount\n006A,1000\n006B,2000\n', {
        status: 200,
        headers: { 'content-type': 'text/csv', 'Sforce-Locator': 'LOCATOR_PAGE_2' },
      });
    }
    // Salesforce sends the literal string "null" on the final page. A truthiness
    // check on this header is an infinite loop.
    return new Response('Id,Amount\n006C,3000\n', {
      status: 200,
      headers: { 'content-type': 'text/csv', 'Sforce-Locator': 'null' },
    });
  }
  if (/\/jobs\/query\/[^/]+$/.test(p)) {
    return json({ id: '750000000000001AAA', state: 'JobComplete', numberRecordsProcessed: 3 });
  }

  if (p.endsWith('/limits')) {
    return json({ DailyApiRequests: { Max: 100000, Remaining: 99000 } });
  }

  return json([{ errorCode: 'NOT_FOUND', message: `fake has no route for ${method} ${p}` }], 404);
}

/** A run response with allData: false — the platform's defining trap. */
export function truncatedRun() {
  return {
    allData: false,
    hasDetailRows: true,
    reportMetadata: {
      id: '00O000000000001AAA',
      reportFilters: [{ column: 'STAGE_NAME', operator: 'notEqual', value: 'Closed Lost' }],
    },
    reportExtendedMetadata: {
      detailColumnInfo: { AMOUNT: { label: 'Amount', dataType: 'currency' } },
      aggregateColumnInfo: { 's!AMOUNT': { label: 'Sum of Amount', dataType: 'currency' } },
    },
    groupingsDown: { groupings: [{ key: '0', label: 'Closed Won', value: 'Closed Won' }] },
    factMap: {
      'T!T': {
        aggregates: [{ label: '$4,200,000', value: 4200000 }],
        rows: [
          { dataCells: [{ label: '$1,000.00', value: 1000 }] },
          { dataCells: [{ label: '$2,000.00', value: 2000 }] },
        ],
      },
      '0!T': { aggregates: [{ label: '$2,500,000', value: 2500000 }] },
    },
  };
}

export const ENV = {
  SF_AUTH_FLOW: 'client_credentials',
  SF_LOGIN_URL: 'https://login.salesforce.com',
  SF_API_VERSION: 'v60.0',
  SF_CLIENT_ID: 'CLIENT_ID',
  SF_CLIENT_SECRET: 'CLIENT_SECRET',
  SF_ENABLE_REPORT_WRITES: 'false',
} as NodeJS.ProcessEnv;
