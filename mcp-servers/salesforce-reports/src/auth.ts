import { createSign } from 'node:crypto';
import type { Config } from './config.ts';

export interface Session {
  accessToken: string;
  /** ALWAYS from the token response. Never hard-coded, never derived from the login host. */
  instanceUrl: string;
  identityUrl: string;
  issuedAt: number;
}

export interface RunningUser {
  id: string;
  username: string;
  name: string;
  /** Report date groupings and relative filters evaluate in THIS timezone. */
  timeZone: string;
  locale: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * RS256 JWT bearer assertion.
 *
 * `aud` is the LOGIN host (login.salesforce.com, or test.salesforce.com for a
 * sandbox) — not the instance host. Getting this wrong produces `invalid_grant`
 * with no further detail, and it is the most common JWT setup failure.
 */
export function buildJwtAssertion(cfg: Config, now: number = Date.now()): string {
  if (!cfg.privateKeyPem) throw new Error('JWT flow requires SF_PRIVATE_KEY_B64');
  if (!cfg.username) throw new Error('JWT flow requires SF_USERNAME');

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: cfg.clientId,
    sub: cfg.username,
    aud: cfg.loginUrl,
    exp: Math.floor(now / 1000) + 180, // Salesforce rejects anything beyond ~3 minutes
  }));
  const signingInput = `${header}.${claims}`;
  const sig = createSign('RSA-SHA256').update(signingInput).end().sign(cfg.privateKeyPem);
  return `${signingInput}.${b64url(sig)}`;
}

type Fetch = typeof fetch;

export async function authenticate(cfg: Config, fetchImpl: Fetch = fetch): Promise<Session> {
  const body = new URLSearchParams();

  switch (cfg.authFlow) {
    case 'jwt':
      body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      body.set('assertion', buildJwtAssertion(cfg));
      break;
    case 'client_credentials':
      // NOTE: Salesforce serves this flow from the org's My Domain token endpoint,
      // not from login.salesforce.com. Set SF_LOGIN_URL to the My Domain URL.
      body.set('grant_type', 'client_credentials');
      body.set('client_id', cfg.clientId);
      body.set('client_secret', required(cfg.clientSecret, 'SF_CLIENT_SECRET'));
      break;
    case 'refresh_token':
      body.set('grant_type', 'refresh_token');
      body.set('client_id', cfg.clientId);
      body.set('client_secret', required(cfg.clientSecret, 'SF_CLIENT_SECRET'));
      body.set('refresh_token', required(cfg.refreshToken, 'SF_REFRESH_TOKEN'));
      break;
  }

  const res = await fetchImpl(`${cfg.loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await res.json()) as Record<string, string>;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Salesforce auth failed (${res.status} ${json.error ?? ''}): ${json.error_description ?? 'no detail'}. ` +
      explainAuthFailure(cfg, json.error),
    );
  }
  if (!json.instance_url) {
    throw new Error('Token response carried no instance_url. Refusing to guess the API host.');
  }

  return {
    accessToken: json.access_token,
    instanceUrl: json.instance_url.replace(/\/+$/, ''),
    identityUrl: json.id ?? '',
    issuedAt: Number(json.issued_at ?? Date.now()),
  };
}

function required(v: string | undefined, name: string): string {
  if (!v) throw new Error(`${name} is required for this auth flow`);
  return v;
}

export function explainAuthFailure(cfg: Config, error?: string): string {
  switch (error) {
    case 'invalid_grant':
      return cfg.authFlow === 'jwt'
        ? 'For JWT this is almost always one of: the certificate is not uploaded to the connected app; ' +
          `the user "${cfg.username}" is not pre-authorized (profile/permission set on the app); ` +
          `or aud does not match the login host in use (${cfg.loginUrl} — use test.salesforce.com for a sandbox).`
        : 'Check the client secret and, for refresh_token, that the token has not been revoked.';
    case 'invalid_client_id':
      return 'SF_CLIENT_ID is not a consumer key in this org. Sandboxes have their own connected apps.';
    case 'inactive_user':
      return 'The integration user is inactive or frozen.';
    default:
      return 'Verify the connected app, the login host, and that the integration user has API Enabled.';
  }
}

/**
 * The running user's identity and timezone, read once at startup and echoed in
 * every tool result. Report output is scoped to this user's sharing rules, role
 * hierarchy and field-level security, and every date grouping and relative
 * filter evaluates in this user's timezone — so two identities can legitimately
 * return different numbers for the same report.
 */
export async function fetchRunningUser(
  session: Session,
  apiVersion: string,
  fetchImpl: Fetch = fetch,
): Promise<RunningUser> {
  const userId = session.identityUrl.split('/').pop() ?? '';
  const soql = `SELECT Id, Username, Name, TimeZoneSidKey, LocaleSidKey FROM User WHERE Id = '${userId}'`;
  const url = `${session.instanceUrl}/services/data/${apiVersion}/query?q=${encodeURIComponent(soql)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!res.ok) {
    throw new Error(
      `Could not read the running user record (${res.status}). The integration user needs read access ` +
      'to the User object; without it, timezone and identity cannot be reported and every date-grouped ' +
      'figure would be unreproducible.',
    );
  }
  const json = (await res.json()) as { records?: Array<Record<string, string>> };
  const r = json.records?.[0];
  if (!r) throw new Error(`User record ${userId} not found via the identity URL.`);
  return {
    id: r.Id ?? userId,
    username: r.Username ?? '',
    name: r.Name ?? '',
    timeZone: r.TimeZoneSidKey ?? 'unknown',
    locale: r.LocaleSidKey ?? 'unknown',
  };
}
