---
name: dashboard-builder-vercel
description: Use when building a custom, branded, client-facing analytics dashboard or a hosted report on Next.js and Vercel over a warehouse. Defaults to static or incrementally-regenerated rendering because it costs one query per rebuild rather than one per viewer, keeps the warehouse client strictly server-side, bakes data at build time with a freshness assertion that fails the build, and gates the deploy on a known-answer anchor harness. Prevents an uncached server-rendered dashboard on an unpartitioned table, which is the failure mode an unsupervised agent produces by default.
---

# Dashboard Builder (Next.js on Vercel)

An unsupervised agent asked for "a dashboard over the warehouse" produces a
server-rendered page that runs a full-scan query on every request. It looks
correct in review and it is correct — until an exec leaves the tab open on a
refresh timer. The architecture below exists to make that outcome structurally
impossible rather than a thing you remember to avoid.

**Core contracts this skill must call:** `write-gate` (a deploy is a write, and
its blast radius is "everyone with the URL"), `provenance-block` (the dashboard
carries provenance in the page, not just in the answer), `answer-contract` (every
tile is a number reaching a human), `comparability-rules` (before any tile sums
or compares across sources), `rate-limit-governor` (the bake is a query budget),
`warning-field-reader` (extraction warnings must survive into the artefact
metadata, not be discarded at bake time), `pagination-patterns` (a truncated
extract baked into a static artefact is a lie with a CDN in front of it).

---

## 1. The rule everything else follows from: the warehouse client never runs in the browser

A service-account key shipped to the client is a full data-warehouse breach, not
a configuration mistake. `NEXT_PUBLIC_` is the specific hazard: any variable with
that prefix is inlined into the client bundle at build time, permanently, and is
recoverable from the deployed JavaScript forever.

Three legitimate places for warehouse access, in preference order:

| Where | Runs | Use for |
|---|---|---|
| **The bake script** (`scripts/bake.ts`, build-time Node) | once per build | everything that can be pre-computed |
| **Route Handler / Server Component / Server Action** | per request, server | genuinely interactive filtering the bake cannot enumerate |
| **Nowhere else** | | |

The bake path is strictly better than the other two, because a credential that
only exists in the build environment cannot be exfiltrated from the serving
environment. **Prefer an architecture where the deployed application holds no
warehouse credential at all.**

Assert it mechanically rather than by review:

```js
// next.config.mjs
const banned = Object.keys(process.env).filter(
  k => k.startsWith('NEXT_PUBLIC_') && /KEY|SECRET|TOKEN|CREDENTIAL|PASSWORD|PRIVATE/i.test(k)
)
if (banned.length) throw new Error(`Secret-shaped NEXT_PUBLIC_ vars would ship to the browser: ${banned.join(', ')}`)
```

---

## 2. Rendering choice, with the cost consequence attached

| Mode | Query cost | When it is right |
|---|---|---|
| **Static, baked at build (SSG)** | **one query per build** | the default for GTM reporting. Numbers change daily at best. |
| **ISR (`export const revalidate = 3600`)** | one query per revalidation interval, shared across all viewers | the same thing with a freshness floor |
| **Route handler + client fetch, cached** | one query per cache miss | filters whose combinations you cannot enumerate |
| **Server-rendered on request, uncached** | **one full scan per view** | almost never |

**Static is chronically under-used and it is the right default.** The cost
argument is arithmetic, not taste: one exec refreshing forty times is forty full
scans on the uncached path and zero additional queries on the baked path.

**Pre-aggregating to a small store — the baked artefact, Postgres, or KV — is the
single most effective cost control available here**, and it decouples dashboard
latency from warehouse latency entirely. A dashboard reading a 4 MB parquet file
from the function bundle answers in milliseconds regardless of what the warehouse
is doing.

Runtime pin, because it bites: **the Node warehouse SDKs do not run on Vercel's
Edge runtime.** Either pin Node explicitly or call the warehouse REST API with a
fetch-based token exchange.

```ts
export const runtime = 'nodejs'   // required wherever a warehouse SDK is imported
export const revalidate = 3600    // ISR; omit for pure build-time bake
```

---

## 3. Bake at build, serve static at request

The build queries the warehouse, transforms, and writes compact artefacts into
the deployment bundle. The runtime reads only those artefacts: no source call, no
source parse in the request path, no timeout exposure, and **no data credential in
the serving environment.**

**Parquet for anything row-level, JSON for the KPI tiles.** Parquet earns its
place above roughly fifty thousand rows or where the dashboard offers drill-down:
columnar, compressed, and readable with a column projection so a tile that needs
two columns does not deserialise forty. Below that, a JSON file is smaller once
gzipped and has no read dependency. Do not reach for parquet on a nine-tile KPI
page; do not ship 400 MB of JSON because parquet looked like a dependency.

```ts
// scripts/bake.ts — run from the build command, before `next build`
import { parquetWriteFile } from 'hyparquet-writer'
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = 'data'                       // traced into the bundle, see §4
mkdirSync(OUT, { recursive: true })

const failures: string[] = []
const meta: Record<string, unknown> = { bake_started_at: new Date().toISOString(), datasets: {} }

for (const snapshot of SNAPSHOTS) {
  try {
    const rows = await runQuery(snapshot.sql, snapshot.params)   // §5
    if (snapshot.format === 'parquet') {
      parquetWriteFile({ filename: `${OUT}/${snapshot.name}.parquet`, columnData: toColumns(rows) })
    } else {
      writeFileSync(`${OUT}/${snapshot.name}.json`, JSON.stringify(rows))
    }
    meta.datasets[snapshot.name] = {
      row_count: rows.length,
      coverage_start: minDate(rows, snapshot.dateColumn),
      coverage_end:   maxDate(rows, snapshot.dateColumn),
      source_timezone: snapshot.sourceTimezone,       // provenance-block
      truncated: rows.length >= snapshot.rowCap,      // pagination-patterns
      extraction_warnings: snapshot.warnings ?? [],   // warning-field-reader
    }
  } catch (e) {
    // collect, do not abort: one run must report every failure
    failures.push(`${snapshot.name}: ${(e as Error).message}`)
  }
}

meta.bake_completed_at = new Date().toISOString()
meta.failures = failures
writeFileSync(`${OUT}/_metadata.json`, JSON.stringify(meta, null, 2))   // ALWAYS written

if (failures.length) {
  console.error(`bake failed for ${failures.length} snapshot(s):\n${failures.join('\n')}`)
  process.exit(1)
}
```

Three things in that script are the whole point:

1. **Failures are collected, not thrown on first occurrence**, so one build run
   reports every broken snapshot instead of the first one.
2. **`_metadata.json` is written unconditionally**, including on failure, so the
   post-mortem does not depend on the thing that failed.
3. **The process exits non-zero**, which fails the build, which means the bad
   artefact is never promoted.

**State the ceiling honestly: this is not an atomic multi-file transaction.** A
partially-written `data/` directory exists on disk at the moment of failure. The
protection is that the deployment is never promoted, not that the write was
transactional. **Only a complete, validated bake may be promoted** — which is why
publication stays manual (§9).

---

## 4. Getting the baked files into the deployment

Two different destinations, and confusing them produces a file that exists
locally and 404s in production.

| Destination | How | Served by |
|---|---|---|
| `public/data/*.json` | automatic | the CDN, publicly, to anyone with the URL |
| `data/*.parquet` read by server code | `outputFileTracingIncludes` | your server code only |

Anything with row-level or tenant-scoped data goes in the **second** row. A
parquet file in `public/` is an unauthenticated data export.

```js
// next.config.mjs
export default {
  outputFileTracingIncludes: { '/api/**': ['./data/**'], '/dashboard/**': ['./data/**'] },
}
```

Next.js's file tracer only bundles files it can see being imported. A path built
at runtime (`path.join(process.cwd(), 'data', name)`) is invisible to it, which
is exactly why the explicit include is required. Keep the bundle under Vercel's
serverless function size limit (250 MB uncompressed, including dependencies); a
bake that grows past it fails at deploy, not at runtime.

---

## 5. Warehouse auth: keyless first, key as documented quick-start

**Preferred: workload identity federation.** The build platform mints a
short-lived OIDC token, which is exchanged for a scoped, read-only, impersonated
identity. **No key material exists anywhere** — not in the repo, not in the
environment, not in a secret manager.

The GCP shape (the pattern is the same on other clouds; the endpoints differ):

```ts
import { getVercelOidcToken } from '@vercel/functions/oidc'

async function accessToken(): Promise<string> {
  const oidc = await getVercelOidcToken()                 // VERCEL_OIDC_TOKEN
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: `//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}`,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectToken: oidc,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
    }),
  }).then(r => r.json())

  // impersonate the read-only service account
  const imp = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${READONLY_SA}:generateAccessToken`,
    { method: 'POST',
      headers: { authorization: `Bearer ${sts.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' }) },
  ).then(r => r.json())

  return imp.accessToken
}
```

Bind the pool provider to your specific project and environment in the attribute
condition, or any deployment on the platform can assume the identity.

**Quick-start fallback: a service-account key. Base64-encode it.** Newlines in
the PEM private key are the classic breakage — a key pasted into an environment
variable arrives with `\n` as two literal characters and the JWT signature fails
with an error that names neither newlines nor the variable.

```ts
const creds = JSON.parse(Buffer.from(process.env.GCP_SA_KEY_B64!, 'base64').toString('utf8'))
```

**Declare the fallback chain and log which mode was selected.** Every mode must
emit an identical row shape, so downstream coercion is mode-independent and a
quick-start bake and a federated bake produce byte-identical artefacts.

```
auth_mode: workload_identity | sa_key | local_adc     ← logged on every bake
```

**Disable the result cache on every extraction query.** A cached result is
correct for the query text and wrong for the world after a view definition
changes underneath it.

```ts
const [job] = await bq.createQueryJob({
  query, useQueryCache: false, dryRun: false,
  maximumBytesBilled: String(50 * 1024 ** 3),   // fails with no charge if exceeded
})
```

Dry-run first (`dryRun: true` returns `totalBytesProcessed` with no charge and no
execution) and refuse above the threshold, per `rate-limit-governor`.

---

## 6. The freshness assertion fails the build

Assert the **maximum business date** in the extract against a staleness
threshold, during the bake. Exceeded means the build throws.

```ts
const maxDate = maxBusinessDate(rows)                       // NOT the load timestamp
const ageHours = (Date.now() - maxDate.getTime()) / 3.6e6
if (ageHours > snapshot.maxStalenessHours && process.env.ALLOW_STALE_BAKE !== '1') {
  throw new Error(
    `${snapshot.name}: latest business date ${maxDate.toISOString()} is ${ageHours.toFixed(1)}h old, ` +
    `threshold ${snapshot.maxStalenessHours}h. Upstream load has probably stopped.`)
}
```

**Business date, not load timestamp.** A model that ran successfully at 06:00
against a source that stopped delivering at midnight has a fresh bake time and
stale data, and the pipeline reports success. This is the whole reason the
assertion exists.

`ALLOW_STALE_BAKE` is documented for local development against a stale sandbox
extract. **It must never be set in the deployment environment.** Say that in the
README and in the error message, because an override that exists without a stated
prohibition will eventually be set in production by someone unblocking a deploy
at 18:00 on a Friday.

---

## 7. The anchor harness gates the deploy

Known-answer tests with declared tolerances, run **against the baked artefact**,
not against a mock. A mock proves the code compiles; the artefact is what ships.

```json
// anchors.json
{
  "anchors": [
    { "id": "closed_won_prior_quarter", "dataset": "revenue_by_quarter",
      "expr": "sum(amount) where quarter = '<prior>' and stage = 'Closed Won'",
      "expected": 0, "tolerance_pct": 0.0, "class": "STABLE",
      "note": "a closed quarter must not move; any drift is a definition or restatement event" },
    { "id": "row_count_opportunities", "dataset": "opportunities",
      "expr": "count(*)", "expected": 0, "tolerance_pct": 5.0, "class": "DRIFT_PRONE",
      "note": "grows with the business; the check is order of magnitude, not exactness" }
  ]
}
```

**Separate STABLE from DRIFT-PRONE and treat them differently.** A closed prior
quarter is STABLE: zero tolerance, and a failure means a definition changed or a
source restated, which is a thing a human must look at before it reaches a
stakeholder. Current-period row counts are DRIFT-PRONE: a percentage band, and
the check is that the number is the right order of magnitude.

The harness exits non-zero. Wire it into the build so it cannot be skipped:

```json
{ "scripts": { "build": "tsx scripts/bake.ts && tsx scripts/anchors.ts && next build" } }
```

A STABLE anchor that fails **once** is a finding, not noise. Re-baseline it only
with a written reason recorded next to the new expected value — an anchor
silently re-baselined to whatever the pipeline now produces is not a test.

---

## 8. Human auth, tenancy, and the row-level-security problem

**Workspace SSO restricted to a domain is the pragmatic default** and covers most
client-facing reporting. Vercel's own deployment protection covers preview URLs;
it is not an application-level authorisation model.

**Row-level security is your problem, not the platform's.** If two tenants share
a deployment, the tenant filter is derived **server-side from the session** and
never from a client-supplied parameter.

```ts
// WRONG — a client-supplied tenant id is a cross-tenant read waiting to happen
const tenant = req.nextUrl.searchParams.get('tenant')

// RIGHT — derived from the verified session, on every data route
const session = await requireSession(req)          // throws 401
const rows = readParquet(dataset, { filter: r => r.tenant_id === session.tenantId })
```

Two structural requirements:

1. **Middleware is not sufficient on its own.** A matcher typo, a route added
   outside the matched prefix, or a framework routing change silently removes the
   guard. Call an access helper inside **every** data route so the request-level
   check survives independently of the middleware decision.
2. **Make public access an explicit switch handled in one place.** `PUBLIC_MODE=1`
   read in a single module, not `if (!session)` scattered across nine routes.

Best structural answer where tenants are few: **bake per tenant.** Separate
artefacts, separate paths, no shared file to filter. A cross-tenant leak then
requires reading the wrong file rather than passing the wrong parameter.

---

## 9. Two cost meters, and they multiply

**Function execution time × bytes scanned.** Reducing one does not protect you
from the other, and an uncached SSR dashboard on an unpartitioned table maximises
both simultaneously: every view is a long function invocation *and* a full scan.

Controls, in order of effect:

1. **Bake.** One query per build regardless of audience size.
2. **Partition and cluster the source tables**, and set `require_partition_filter`
   so an unfiltered scan errors rather than bills.
3. **`maximumBytesBilled` on every job.** The query fails with no charge if the
   pre-execution estimate exceeds it. This is the single most important guardrail
   for an unsupervised agent.
4. **Cache route handlers aggressively** where interactivity forces a live path.
5. **Per-service-account custom quotas**, so a runaway build cannot consume the
   org's budget. Note that daily quota resets follow the cloud's billing timezone,
   not UTC and not yours.

**Keep ingestion automatic and publication manual, with the anchor harness as the
gate.** Auto-deploying on ingest is how an unvalidated number reaches a
stakeholder before anyone has seen it.

---

## 10. Every dashboard carries its provenance surface

The tile is a number reaching a human, so `answer-contract` applies to it exactly
as it applies to a chat answer. What that means concretely on a page:

- **Three clocks, shown separately and labelled**: deployment time, bake time,
  source data freshness. They are independent, and bake time is not source
  freshness.
- **Incomplete periods marked or excluded.** The last bar is always short. Render
  it in a distinct style with a label, or drop it. Never silently include it.
- **One owned definition per metric**, visible on hover or in a footnote, matching
  the semantic layer rather than paraphrasing it.
- **Drill-down to row level**, so a disputed number gets settled in the meeting
  instead of becoming an action item. This is the strongest argument for the
  parquet artefact.
- **A hard tile-count limit.** Past roughly a dozen tiles nobody reads any of
  them, and every tile is a maintenance liability forever.
- **Extraction warnings survive into the page.** A snapshot with `truncated: true`
  in `_metadata.json` renders its tiles with a lower-bound marker, not silently.

```ts
// app/dashboard/_components/Provenance.tsx — collapsed by default, present always
const m = JSON.parse(readFileSync('data/_metadata.json', 'utf8'))
// deployed: process.env.VERCEL_DEPLOYMENT_ID / build time
// baked:    m.bake_completed_at
// fresh to: m.datasets[name].coverage_end  (+ source_timezone)
```

---

## 11. Name the honest alternatives, because most requests do not need this

**Streamlit, Evidence.dev, Rill, Metabase, Superset and Looker Studio exist, and
for an internal analyst who needs a chart by Thursday one of them is the right
answer.** They cost hours, not days, and nobody maintains a Next.js app.

This path is for **branded, client-facing, custom-interaction** dashboards: your
visual identity, your interaction model, an external audience, a URL you control.
Pushing it where a BI tool fits produces a bespoke application that someone must
own for years to render nine numbers.

**The routing question, asked before any code:** is this a one-off question, a
recurring report, or a surface people will return to and interact with? A
dashboard is the most expensive possible answer to a one-off question and then
has to be maintained forever. A recurring report is `report-generator`. Only the
third case earns this skill.

---

## 12. Answering

**Answer first.** Ship the dashboard with its numbers and name the limits in
plain sentences underneath, on the page:

> Baked 06:12 UTC today; the CRM extract runs to yesterday and the ad-platform
> extract runs to two days ago, so the cross-channel tile compares windows of
> different maturity and understates the most recent day. The current month tile
> is marked incomplete. Spend is converted at the month-end rate, so monthly
> tiles will not sum exactly to the quarter tile.

**Withhold only what cannot honestly be computed.** A tile whose snapshot failed
at bake renders as `unavailable` with the reason and the date of the last good
value — never as zero, and never as a blank that reads as zero. A tile whose
extract was truncated renders the aggregate and labels the row-level breakdown a
lower bound.

The state table, because collapsing these is how a dashboard lies with no formula
error anywhere:

| State | Renders as |
|---|---|
| observed zero | `0` |
| no source row for the period | blank or "no data", excluded from averages |
| snapshot failed at bake | `unavailable`, with the reason and last good date |
| truncated extract | the figure with a lower-bound marker |

---

## Files

- `references/bake-pipeline.md` — the full bake script, the parquet read path,
  file tracing, and the per-tenant bake variant
- `references/anchor-harness.md` — anchor selection, the runnable harness, and
  re-baselining discipline
- `evals/cases.json` — behavioural cases including the honest-limit cases

## Related skills

- `report-generator` when the deliverable is a file, not a surface
- `kpi-tree-builder` for which tiles belong on the page at all
- `data-quality-harness` for the assertions the bake runs
- `warehouse-schema-designer` for the partitioning that makes the bake cheap
- `executive-narrative-builder` for the commentary next to the chart
- `anomaly-detection` for alerting, which is the correct answer to most requests
  for a dashboard somebody checks daily
