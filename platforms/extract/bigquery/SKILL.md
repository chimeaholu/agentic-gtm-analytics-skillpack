---
name: bigquery
description: Use for any BigQuery request — running SQL over GTM data, reading INFORMATION_SCHEMA, creating views, materialized views or scheduled queries, or working with the GA4 or Google Ads exports. BigQuery is the easiest platform to run queries against and the hardest to get wrong operationally, because its failure mode is not a 429, it is an invoice. Dry-run every generated query and set maximumBytesBilled on every job. BigQuery has no native metric or semantic layer: if a customer's metrics live only here, they live in SQL text and any metric the agent produces is reinvention.
---

# BigQuery

**Capability class: extract-only, warehouse backend. BigQuery has no report object.**

What an agent **can** create: tables, **views**, **materialized views**, table functions,
**scheduled queries**, BQML models, and a results table a BI tool reads. **In a GTM
skillpack, "create a report" on BigQuery means create a view plus a scheduled query that
materialises it, and point a delivery surface at that.** Say it in those terms so nobody
expects a dashboard.

**BigQuery is the easiest platform here to run queries against and the hardest to get wrong
operationally, because its failure mode is not a 429 — it is an invoice.** An agent can run
a technically valid query that scans an enormous volume. **Dry-run every generated query
and set `maximumBytesBilled` on every job.** Both are mandatory in this module.

**And BigQuery has no native metric or semantic layer.** If a customer's metrics live only
here, **they live in SQL text, and any metric the agent produces is reinvention.** Metric
adoption on BigQuery means reading the layer above it — LookML, dbt's manifest, or a
Dataplex glossary. **Say "inferred", not "discovered", when joins come from view SQL rather
than declared constraints.**

**Core contracts this module must call, every time:** `provenance-block` (billing project,
data project, job id, bytes billed, region, week convention, timezone used),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor`,
`pagination-patterns`, `mcp-detect-fallback`, `write-gate` before creating a view,
materialized view, scheduled query or any DDL, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** BigQuery answers anything the data supports.
Run it, give the number, then state the two conventions that decide what it means: **which
timezone `CURRENT_DATE()` used, and which day your week starts on.** Withhold only where a
permission genuinely blocks it — and note that **a dry run returning 0 bytes on an
RLS-protected table is deliberate, not free.**

---

## (a) Auth setup

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

1. **A GCP project with the BigQuery API enabled and billing enabled. BigQuery will not run
   without billing, even in the free tier.**
2. **A service account** with minimally **`roles/bigquery.jobUser`** (to run jobs, billed
   to the project) plus **`roles/bigquery.dataViewer`** on the datasets. `dataEditor` for
   writes. **Scheduled queries additionally need `roles/iam.serviceAccountTokenCreator`**
   and Data Transfer permissions.
3. **Auth via ADC (`GOOGLE_APPLICATION_CREDENTIALS`), Workload Identity Federation (no key
   file — the right answer), or user OAuth.**
4. **Be explicit about the billing project versus data project split. This is the step
   everyone misses.** **Jobs are billed to the project in the API path, while the data can
   live elsewhere.** An agent pointed at the wrong billing project either fails with a
   permission error or — worse — bills the wrong cost centre silently.
5. **Give the agent its own service account and its own billing label.** Per-user custom
   quotas only bind an identity, so a shared service account means no enforceable ceiling,
   and a billing label is the only way to answer "what did the agent cost".

---

## (b) Correct query construction

**Everything is a job.** `POST /bigquery/v2/projects/{projectId}/jobs` with a
`JobConfigurationQuery`. `jobs.query` is the synchronous shortcut with `timeoutMs`;
`jobs.insert` is the async job, polled with `jobs.get` and fetched with
`jobs.getQueryResults` or `tabledata.list`. **Async is the default mental model.**

**What an agent can create, and how to frame it:**

| Object | Note |
|---|---|
| Table | |
| **View** | the metric definition, as SQL |
| **Materialized view** | the pre-computed version |
| Table function | parameterised logic |
| **Scheduled query** | BigQuery Data Transfer Service: `projects.locations.transferConfigs.create` with `data_source_id: "scheduled_query"`, `schedule`, `params.query`, `destination_dataset_id`, `params.write_disposition` |
| BQML model | |

**Run scheduled queries as a service account, otherwise the schedule dies when the creating
human leaves.** That is a real and common failure, and it surfaces months later as a
silently stale table.

**BI Engine is a performance and cost knob provisioned through the Reservation API, and it
is transparent to the query API — an agent cannot "use BI Engine" explicitly, only observe
acceleration in `INFORMATION_SCHEMA.JOBS.bi_engine_statistics`.**

**Dry-run first, always:**

```bash
bq query --dry_run --use_legacy_sql=false 'SELECT ... FROM ...'
# or: jobs.insert with dryRun: true -> totalBytesProcessed, no charge, no execution
```

---

## (c) Pagination, bulk and cost

| Limit | Value |
|---|---|
| Concurrent interactive queries per project | ~100 on-demand (1,000 on some editions), queued beyond |
| Query text | 1 MB resolved |
| Result size without a destination table | 10 GB compressed; unlimited with one |
| `tabledata.list` / `jobs.getQueryResults` page | **max ~10 MB per response** |
| API quota | ~100 `jobs.insert`-class requests/second/user; ~1,500 table-modifying ops/table/day |

Quota breaches return **403 `rateLimitExceeded` or `quotaExceeded`**.

**For volume, switch to the Storage Read API** — gRPC, Arrow or Avro, parallel read
sessions. Paging 10 MB at a time through `getQueryResults` is the wrong tool.

**Bulk export:** `EXPORT DATA OPTIONS(...)` to GCS, or an `extract` job producing Avro,
Parquet or CSV in GCS.

**Cost control is the section that matters, and it is mandatory:**

- **Always dry-run first.** `dryRun: true` returns **`totalBytesProcessed`** with **no
  charge and no execution**. Refuse or escalate above a threshold.
- **Set `maximumBytesBilled` on every job. If the pre-execution estimate exceeds it, the
  query fails with no charge. This is the single most important guardrail for an agent.**
- **Use project-level and per-service-account custom quotas in Cloud Quotas.** Exceeding
  gives **`usageQuotaExceeded`**, and **daily quotas reset at midnight US Pacific Time, not
  UTC.**
- **Prefer partitioned and clustered tables with `require_partition_filter`**, which turns
  a forgotten filter into an error rather than a bill.
- **Reservation or capacity pricing converts cost risk into a fixed slot pool**, which is a
  much better shape for autonomous agents than on-demand billing.

---

## (d) Preferred MCP server and fallback

**Two official options, so there is no reason to use a community server.**

**(1) The fully managed remote server at `https://bigquery.googleapis.com/mcp`.**
**Preview**, announced 2026-01-07. Google OAuth 2.0 with scope
`https://www.googleapis.com/auth/bigquery`. Tools cover dataset enumeration, table schema
inspection, query execution and analysis. **No infrastructure to run — the lowest-friction
MCP server in the entire pack; preview status is the caveat.**

**(2) MCP Toolbox for Databases (`googleapis/genai-toolbox`)**, self-hosted, the same repo
as the Looker server. Tools: `bigquery-execute-sql`, **`bigquery-sql` (templated,
parameterised — the safe pattern)**, `bigquery-list-dataset-ids`,
`bigquery-list-table-ids`, `bigquery-get-dataset-info`, `bigquery-get-table-info`,
`bigquery-forecast`, `bigquery-conversational-analytics`.

**Same caveat as the Looker toolbox: provided as-is, not a supported Google Cloud
product.**

**Prefer `bigquery-sql` over `bigquery-execute-sql` for anything customer-facing.
Arbitrary SQL from an LLM against a billed warehouse is the cost incident waiting to
happen**, and a parameterised template is the difference between a bounded query and an
open one.

**Whichever path you take, the cost guardrails in (c) still apply.** An MCP tool that does
not let you set `maximumBytesBilled` is a tool you use for schema inspection, not for
execution — and you should say so.

**Fallback: the BigQuery API directly, which is complete.**

---

## (e) Gotchas, and the specific field that reveals each one

- **Cost, not rate limits, is the failure mode.** An agent can run a technically valid
  query that scans an enormous volume. Nothing throttles it.
- **A dry run returns 0 bytes on RLS-protected tables, deliberately, to block a side
  channel. Do not interpret 0 as free.** On any table that might carry row-level security,
  a zero estimate is an unknown estimate.
- **Daily custom quotas reset at midnight US Pacific, not UTC.** A "start of day" job
  scheduled on a UTC clock lands mid-window.
- **Timezone: everything is UTC unless told otherwise.** `CURRENT_DATE()` is UTC;
  **`CURRENT_DATE("America/New_York")` is what the sales team means.** **`TIMESTAMP` is
  absolute UTC while `DATETIME` is wall-clock with no zone, and mixing them silently shifts
  numbers.** **`DATE_TRUNC(x, WEEK)` starts Sunday by default; `WEEK(MONDAY)` is a
  different answer — a GTM agent reporting "this week's pipeline" must state its week
  convention.**
- **No currency type.** Use **`NUMERIC`/`BIGNUMERIC` for exact decimal money — `FLOAT64`
  money is a real bug source** — but the unit is convention only.
- **Streaming buffer rows are invisible to some operations.** Recently streamed rows cannot
  be updated or deleted immediately and **may not appear in `TABLE_STORAGE` counts**, so a
  row count and a query result can legitimately disagree.
- **Soft deletes exist:** time travel plus fail-safe, `UNDROP TABLE`,
  `FOR SYSTEM_TIME AS OF`. **Deleted tables can still appear in some metadata surfaces.**
  And **`_TABLE_SUFFIX` wildcard queries silently include tables you did not mean,
  including backups** — a `*_backup_20260901` table joins the wildcard without comment.
- **`INFORMATION_SCHEMA` is region-scoped.** Query `region-us.INFORMATION_SCHEMA.JOBS`, not
  a global view. **The wrong region returns an empty result, not an error.**
- **`_PARTITIONTIME` and `_PARTITIONDATE` pseudo-columns are not in
  `INFORMATION_SCHEMA.COLUMNS`.** An agent reading only `COLUMNS` **will not know how to
  filter a partitioned table cheaply and will then be billed for a full scan.**
- **Views execute with the *caller's* permissions unless they are authorized views**, so an
  agent can get "permission denied on underlying table" for a view it can see.
- **`SELECT *` on nested GA4 or Ads export tables is both expensive and produces unusable
  deeply-nested JSON. Always unnest explicitly.**
- **BI Engine acceleration is invisible and partial** — latency varies run to run for no
  visible reason, which explains a speed change, never a correctness one.
- **No native metric semantics.** `revenue_usd` versus `revenue` versus `amount` — **nothing
  tells the agent which one the CFO means, and there are no additivity rules or
  non-summable markers.** **Metric adoption on BigQuery means reading the layer above it —
  LookML, dbt's manifest, or a Dataplex glossary. Say "inferred", not "discovered", when
  joins come from view SQL rather than declared constraints.**

---

## Files

- `references/cost-guardrails.md` — the dry-run and `maximumBytesBilled` pattern, custom
  quotas, partition filters, and the RLS zero-bytes exception.
- `references/metric-inference.md` — why BigQuery has no metric layer, where to read one
  from, and the discipline of saying "inferred".
- `evals/cases.json` — behavioural cases including the honest-limit cases.
