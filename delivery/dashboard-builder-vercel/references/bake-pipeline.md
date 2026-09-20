# The bake pipeline, end to end

Everything here runs at build time in Node. Nothing here runs in the browser and
nothing here runs in the request path.

## 1. The snapshot declaration

One declarative list drives the whole bake. Adding a tile means adding an entry,
not editing the script.

```ts
// snapshots.ts
export type Snapshot = {
  name: string
  sql: string
  params?: Record<string, unknown>
  format: 'parquet' | 'json'
  dateColumn: string            // the BUSINESS date column, for the freshness assertion
  maxStalenessHours: number
  rowCap: number                // the extraction cap, for the truncation flag
  sourceTimezone: string        // confirmed, not assumed — see temporal-integrity-audit
  tenantColumn?: string         // present => this snapshot is tenant-scoped
}

export const SNAPSHOTS: Snapshot[] = [
  {
    name: 'pipeline_by_stage',
    sql: `
      select stage, close_month, count(*) as opp_count, sum(amount_usd) as amount_usd,
             max(close_date) as latest_close_date
      from   \`${'${DATASET}'}\`.fct_opportunity
      where  close_date >= date_sub(current_date('UTC'), interval 24 month)
      group  by stage, close_month
    `,
    format: 'json',
    dateColumn: 'latest_close_date',
    maxStalenessHours: 30,
    rowCap: 100_000,
    sourceTimezone: 'UTC',
  },
  {
    name: 'opportunity_rows',
    sql: `select opportunity_id, account_name, stage, amount_usd, close_date, owner_id
          from \`${'${DATASET}'}\`.fct_opportunity
          where close_date >= date_sub(current_date('UTC'), interval 12 month)`,
    format: 'parquet',       // drill-down target, row-level, columnar read
    dateColumn: 'close_date',
    maxStalenessHours: 30,
    rowCap: 5_000_000,
    sourceTimezone: 'UTC',
  },
]
```

**`maxStalenessHours` is per snapshot, not global.** A CRM extract that lands
hourly and an ad-platform extract that lands daily have different thresholds, and
a single global value means either the first is unmonitored or the second fails
the build every morning.

## 2. Running the query with the guardrails on

```ts
import { BigQuery } from '@google-cloud/bigquery'

const MAX_BYTES = Number(process.env.BAKE_MAX_BYTES ?? 50 * 1024 ** 3)

export async function runQuery(sql: string, params?: Record<string, unknown>) {
  const bq = await client()                       // auth mode resolved in §5 of SKILL.md

  // 1. dry run: costs nothing, executes nothing, returns the estimate
  const [dry] = await bq.createQueryJob({ query: sql, params, dryRun: true })
  const bytes = Number(dry.metadata.statistics.totalBytesProcessed)
  if (bytes > MAX_BYTES) {
    throw new Error(
      `estimated ${(bytes / 1024 ** 3).toFixed(1)} GiB exceeds the ${(MAX_BYTES / 1024 ** 3).toFixed(0)} GiB bake ceiling. ` +
      `Narrow the window, add a partition filter, or raise BAKE_MAX_BYTES deliberately.`)
  }

  // 2. real run: cache off, hard byte ceiling as a second line of defence
  const [job] = await bq.createQueryJob({
    query: sql, params,
    useQueryCache: false,
    maximumBytesBilled: String(MAX_BYTES),
    labels: { app: 'gtm-dashboard', stage: 'bake' },   // billing attribution
  })
  const [rows] = await job.getQueryResults({ maxResults: 100_000 })
  return rows
}
```

Three things worth their own line:

- **The dry run is free and does not execute.** There is no reason to skip it.
- **`maximumBytesBilled` fails the job with no charge** if the pre-execution
  estimate exceeds it. The dry run is the readable error; this is the backstop
  for the case where the estimate moves between the two calls.
- **`useQueryCache: false`** because a cached result is correct for the query
  text and wrong for the world after a view changes underneath it.

## 3. Writing parquet

```ts
import { parquetWriteFile } from 'hyparquet-writer'

function toColumns(rows: Record<string, unknown>[]) {
  if (!rows.length) return []
  return Object.keys(rows[0]).map(name => ({
    name,
    data: rows.map(r => coerce(r[name])),
  }))
}

// BigQuery returns DATE/TIMESTAMP as wrapper objects and NUMERIC as a Big.
// Coerce once, here, so every auth mode and every format emits the same shape.
function coerce(v: unknown) {
  if (v == null) return null
  if (typeof v === 'object' && 'value' in (v as object)) return String((v as { value: unknown }).value)
  if (typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    return (v as { toNumber(): number }).toNumber()
  }
  return v
}
```

**Coerce in exactly one place.** The wrapper-object problem is the one that
produces `{"value":"2026-09-01"}` rendered as `[object Object]` in a tile, and it
appears differently depending on which client the auth mode selected — which is
why the SKILL.md requires every mode to emit an identical row shape.

## 4. Reading parquet in a server route

```ts
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet'
import path from 'node:path'

export const runtime = 'nodejs'          // parquet reading is Node, not Edge

const cache = new Map<string, unknown[]>()   // per-instance; lambda-local, not shared

export async function readSnapshot(name: string, columns?: string[]) {
  const key = `${name}:${columns?.join(',') ?? '*'}`
  if (cache.has(key)) return cache.get(key)!
  const file = await asyncBufferFromFile(path.join(process.cwd(), 'data', `${name}.parquet`))
  const rows = await parquetReadObjects({ file, columns })   // column projection
  cache.set(key, rows)
  return rows
}
```

**Pass `columns`.** A tile that needs two columns should not deserialise forty;
column projection is the reason the artefact is parquet rather than JSON.

The in-process `Map` is a per-instance cache that dies with the lambda. That is
fine and intentional — the artefact is immutable for the life of the deployment,
so there is no invalidation problem. Do not reach for a shared cache; a new
deployment is the invalidation.

## 5. File tracing, which is where this goes wrong in production

`data/*.parquet` is read by a runtime path string. Next.js's file tracer cannot
see a runtime path, so it does not bundle the file, so the route 404s in
production while working perfectly locally.

```js
// next.config.mjs
export default {
  outputFileTracingIncludes: {
    '/api/**': ['./data/**'],
    '/dashboard/**': ['./data/**'],
  },
}
```

Verify rather than assume, because the failure mode is deploy-time silent:

```bash
npx next build && ls -la .next/standalone/data/ 2>/dev/null \
  || echo "TRACING FAILED: the artefacts are not in the bundle"
```

Two further limits:

- **The serverless function bundle has a 250 MB uncompressed ceiling**, and that
  includes `node_modules`. A bake that grows past it fails at deploy. If you are
  near it, the artefact belongs in object storage read by the bake-adjacent
  route, not in the bundle — at which cost you have reintroduced a credential in
  the serving environment, so make that trade deliberately.
- **`public/` is served by the CDN to anyone with the URL.** Only aggregates that
  are safe to publish go there. Row-level and tenant-scoped artefacts never do.

## 6. The per-tenant bake

Where tenants are few (tens, not thousands), bake per tenant. A cross-tenant leak
then requires reading the wrong file rather than passing the wrong parameter,
which is a much harder mistake to make and a much easier one to test for.

```ts
for (const tenant of TENANTS) {
  for (const snapshot of SNAPSHOTS.filter(s => s.tenantColumn)) {
    const rows = await runQuery(snapshot.sql, { ...snapshot.params, tenant_id: tenant.id })
    write(`${OUT}/${tenant.id}/${snapshot.name}`, rows, snapshot.format)
  }
}
```

```ts
// the read path takes the tenant from the session and nowhere else
const session = await requireSession(req)
const rows = await readSnapshot(path.join(session.tenantId, name))
```

**The tenant id must be validated against the session's allowlist before it
reaches `path.join`.** A tenant id taken from anywhere user-influenced and joined
into a path is a directory-traversal read. Derive it from the session, and assert
it matches `/^[a-z0-9-]+$/` anyway.

Above a few dozen tenants the bake time and the bundle size stop being viable.
Then it is one artefact with a server-side filter, and the middleware-plus-route
double guard in §8 of the SKILL.md becomes load-bearing rather than belt-and-braces.

## 7. What the metadata file must carry

```json
{
  "bake_started_at": "2026-09-20T06:11:02.113Z",
  "bake_completed_at": "2026-09-20T06:12:47.901Z",
  "auth_mode": "workload_identity",
  "warehouse_api_version": "v2",
  "datasets": {
    "pipeline_by_stage": {
      "row_count": 1840,
      "coverage_start": "2024-09-01",
      "coverage_end": "2026-09-19",
      "source_timezone": "UTC",
      "timezone_status": "confirmed",
      "truncated": false,
      "extraction_warnings": [],
      "bytes_processed": 412839201
    }
  },
  "failures": []
}
```

This file is the dashboard's `provenance-block`. It is written unconditionally,
including on a failed bake, and the page reads its three clocks from it:

| Clock | Source |
|---|---|
| deployment time | the platform's build metadata / deployment id |
| bake time | `bake_completed_at` |
| source data freshness | `datasets[*].coverage_end`, per dataset, in `source_timezone` |

**Per dataset, not one global freshness number.** A single "last updated" stamp on
a page whose tiles come from four sources with different landing times is the
most confidently wrong element on the whole dashboard.
