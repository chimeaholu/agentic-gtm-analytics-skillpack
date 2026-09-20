import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';

import { loadConfig } from '../src/config.ts';
import { buildJwtAssertion, explainAuthFailure } from '../src/auth.ts';
import { RateBudget, backoffMs } from '../src/client.ts';
import { readRunResponse, REPORT_ROW_CAP } from '../src/factmap.ts';
import {
  assertNoCredentialArguments,
  validateReportMetadataOverride,
  MAX_CUSTOM_FILTERS,
  refuseMixedSources,
  HARD_REFUSALS,
} from '../src/guards.ts';
import { Refusal, SalesforceApiError } from '../src/errors.ts';
import { truncatedRun } from './fake-salesforce.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

/* ----------------------------- config ----------------------------- */

test('the write gate is off unless the value is exactly "true"', () => {
  const base = { SF_AUTH_FLOW: 'client_credentials', SF_CLIENT_ID: 'x', SF_CLIENT_SECRET: 'y' };
  for (const v of [undefined, '', '1', 'yes', 'TRUE', 'True', 'true ']) {
    const cfg = loadConfig({ ...base, SF_ENABLE_REPORT_WRITES: v } as NodeJS.ProcessEnv);
    assert.equal(cfg.enableWrites, false, `"${v}" must not enable writes`);
  }
  assert.equal(
    loadConfig({ ...base, SF_ENABLE_REPORT_WRITES: 'true' } as NodeJS.ProcessEnv).enableWrites,
    true,
  );
});

test('a private key that is not base64 PEM fails at startup with an actionable message', () => {
  assert.throws(
    () => loadConfig({
      SF_AUTH_FLOW: 'jwt', SF_CLIENT_ID: 'x', SF_USERNAME: 'u@e.com',
      // the classic failure: the PEM pasted raw, with literal \n, then not encoded
      SF_PRIVATE_KEY_B64: Buffer.from('-----BEGIN PRIV').toString('base64').slice(0, 4),
    } as NodeJS.ProcessEnv),
    /did not decode to a PEM private key/,
  );
});

test('the login host is normalised and never used as the API host', () => {
  const cfg = loadConfig({
    SF_AUTH_FLOW: 'client_credentials', SF_CLIENT_ID: 'x', SF_CLIENT_SECRET: 'y',
    SF_LOGIN_URL: 'https://test.salesforce.com///',
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.loginUrl, 'https://test.salesforce.com');
});

/* ------------------------------ auth ------------------------------ */

test('the JWT assertion is RS256, verifies against the public key, and audiences the LOGIN host', () => {
  const cfg = {
    clientId: 'CONSUMER_KEY',
    username: 'integration.user@example.com',
    loginUrl: 'https://test.salesforce.com',
    privateKeyPem: PEM,
  } as any;

  const jwt = buildJwtAssertion(cfg, 1_700_000_000_000);
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });

  const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
  assert.equal(claims.iss, 'CONSUMER_KEY');
  assert.equal(claims.sub, 'integration.user@example.com');
  // aud is the login host, NOT the instance host. Getting this wrong yields a
  // bare invalid_grant with no further detail.
  assert.equal(claims.aud, 'https://test.salesforce.com');
  assert.equal(claims.exp, 1_700_000_180);

  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).end()
    .verify(publicKey, Buffer.from(s!, 'base64url'));
  assert.ok(ok, 'signature must verify against the public key uploaded to the connected app');
});

test('invalid_grant is explained with the three things it actually is', () => {
  const msg = explainAuthFailure(
    { authFlow: 'jwt', username: 'u@e.com', loginUrl: 'https://test.salesforce.com' } as any,
    'invalid_grant',
  );
  assert.match(msg, /certificate is not uploaded/);
  assert.match(msg, /pre-authorized/);
  assert.match(msg, /test\.salesforce\.com/);
});

/* --------------------------- rate budget --------------------------- */

test('the hourly budget refuses rather than throttling silently, and ages out', () => {
  const b = new RateBudget({ sync_run: 2 });
  const t = 1_700_000_000_000;
  b.consume('sync_run', t);
  b.consume('sync_run', t + 1000);
  assert.equal(b.remaining('sync_run', t + 2000), 0);

  try {
    b.consume('sync_run', t + 2000);
    assert.fail('should have refused');
  } catch (e) {
    assert.ok(e instanceof Refusal);
    assert.equal(e.code, 'RATE_BUDGET_EXHAUSTED');
    assert.match(e.supportedRoute!, /run_report_async|bulk_query/);
  }

  // Each event ages out an hour after its own timestamp, not an hour after the first.
  assert.equal(b.remaining('sync_run', t + 3_600_001), 1, 'the first call ages out on its own clock');
  assert.equal(b.remaining('sync_run', t + 1000 + 3_600_001), 2, 'the rolling hour must fully age out');
});

test('an unbudgeted call class is unlimited rather than blocked', () => {
  const b = new RateBudget({ sync_run: 1 });
  assert.equal(b.remaining('anything_else'), Infinity);
  b.consume('anything_else');
});

test('back-off never fires before Retry-After and grows with the attempt', () => {
  assert.ok(backoffMs(1, '30') >= 30_000, 'Retry-After is a floor, not a suggestion');
  assert.ok(backoffMs(3, null) > backoffMs(1, null));
  assert.notEqual(backoffMs(1, null), backoffMs(1, null)); // jittered
});

/* ----------------------------- factMap ----------------------------- */

test('allData false yields exact aggregates and rows labelled a truncated extract', () => {
  const r = readRunResponse(truncatedRun());
  assert.equal(r.allData, false);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.grand_total, [{ label: '$4,200,000', value: 4200000 }]);
  assert.equal(r.detail_row_count, 2);
  assert.match(r.truncation_note!, new RegExp(String(REPORT_ROW_CAP)));
  assert.match(r.truncation_note!, /PARENTGROUPVAL/, 'must say summary formulas cannot be reproduced outside a report');
});

test('a missing allData is not treated as truncation, and a true one clears the note', () => {
  assert.equal(readRunResponse({ factMap: {} }).allData, true);
  assert.equal(readRunResponse({ allData: true, factMap: {} }).truncation_note, null);
});

test('cells expose value for arithmetic and label for display, never only the label', () => {
  const r = readRunResponse(truncatedRun());
  const row = r.detail_rows[0]!;
  assert.equal(row.AMOUNT, 1000, 'value must be the raw number');
  assert.equal(row.AMOUNT__label, '$1,000.00', 'label is locale-formatted and for display only');
  assert.equal(typeof row.AMOUNT, 'number');
});

test('grouping totals are read from the <key>!T factMap entries', () => {
  const r = readRunResponse(truncatedRun());
  assert.deepEqual(r.groupings, [
    { key: '0', label: 'Closed Won', aggregates: [{ label: '$2,500,000', value: 2500000 }] },
  ]);
});

test('an empty report is not an error', () => {
  const r = readRunResponse({ allData: true, hasDetailRows: false, factMap: { 'T!T': { aggregates: [] } } });
  assert.equal(r.detail_row_count, 0);
  assert.deepEqual(r.grand_total, []);
  assert.equal(r.truncated, false);
});

/* ----------------------------- guards ----------------------------- */

test('credential-shaped argument names are refused across their spellings', () => {
  for (const key of ['access_token', 'token', 'clientSecret', 'client_secret', 'password',
                     'privateKey', 'private_key', 'sessionId', 'bearer', 'credential']) {
    assert.throws(() => assertNoCredentialArguments({ [key]: 'x' }), /CREDENTIAL|Credential-shaped/);
  }
  assertNoCredentialArguments({ report_id: '00O', soql: 'SELECT Id FROM Opportunity' });
});

test('exactly the filter limit passes; one more is refused', () => {
  const mk = (n: number) => ({ reportFilters: Array.from({ length: n }, () => ({ column: 'C' })) });
  validateReportMetadataOverride(mk(MAX_CUSTOM_FILTERS));
  assert.throws(() => validateReportMetadataOverride(mk(MAX_CUSTOM_FILTERS + 1)), /FILTER_LIMIT_EXCEEDED|at most 20/);
});

test('a null or absent unsupported-filter key is not a refusal', () => {
  validateReportMetadataOverride({ crossFilters: null, standardFilters: undefined, reportFilters: [] });
});

test('every hard refusal names a supported route instead of dead-ending', () => {
  for (const [name, refusal] of Object.entries(HARD_REFUSALS)) {
    assert.ok(refusal.supportedRoute, `${name} must name what to do instead`);
    assert.ok(refusal.message.length > 40, `${name} must explain why, not just refuse`);
  }
  assert.match(HARD_REFUSALS.csvExportUrl!.supportedRoute!, /Bulk API 2\.0/);
  assert.match(HARD_REFUSALS.dashboardAuthoring!.message, /clone-only/i);
});

test('report and bulk figures are kept apart, with the currency reason stated', () => {
  const r = refuseMixedSources();
  assert.equal(r.code, 'MIXED_SOURCE_RESULT');
  assert.match(r.message, /convertCurrency\(\) does not apply to the report API/);
  assert.match(r.message, /CurrencyIsoCode/);
});

/* ----------------------------- errors ----------------------------- */

test('a 401 is explained as a wrong-host token, which is what it usually is', () => {
  const p = new SalesforceApiError(401, 'INVALID_SESSION_ID', 'Session expired', '/services/data/v60.0/analytics/reports').toPayload();
  assert.match(p.hint!, /instance_url/);
  assert.match(p.hint!, /test\.salesforce\.com/);
});

test('a 404 is explained as possibly a sharing-rule invisibility, not only a missing id', () => {
  const p = new SalesforceApiError(404, 'NOT_FOUND', 'not found', '/x').toPayload();
  assert.match(p.hint!, /sharing rules/);
});

test('an org rate-limit 403 points at the hourly ceilings', () => {
  const p = new SalesforceApiError(403, 'REQUEST_LIMIT_EXCEEDED', 'limit', '/x').toPayload();
  assert.match(p.hint!, /500 synchronous report runs\/hour/);
  assert.match(p.hint!, /1,200 asynchronous/);
});
