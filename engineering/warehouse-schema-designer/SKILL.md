---
name: warehouse-schema-designer
description: Use when creating or reviewing the physical warehouse layout for GTM data — datasets, partitioning, clustering, incremental strategies, retention and the cost controls that stop an agent generating a four-figure invoice. Covers BigQuery, Snowflake and the layered dataset model with a strict direction of flow. Use after `data-model-designer` has settled the grains; this skill decides how those tables are physically built and how much they cost to query.
---

# Warehouse Schema Designer

`data-model-designer` decides what the tables are and what one row means. This
skill decides how those tables are physically built, how a query against them
is prevented from scanning a terabyte, and what history the warehouse must hold
because the source platform will delete it.

Three things here cannot be fixed later: the partition column, the decision to
snapshot, and the retention you did not take. Everything else is a migration.

---

## 1. Five layers, one direction of flow

```
raw       landed exactly as received. Never edited, never backfilled in place.
config    governed dimensions and mapping rules. Human-owned, versioned, small.
staging   typed, renamed, canonicalised. 1:1 with raw. No business logic.
marts     the only objects a consumer or BI tool may read.
quality   readiness and test results, exposed as queryable views.
```

Rules that make this a contract rather than a naming convention:

- **The direction is strict.** `marts` reads `staging` and `config`. `staging`
  reads `raw`. Nothing reads backwards, and nothing skips a layer to reach
  `raw` from a dashboard. A mart that reads `raw` is how an undocumented
  transformation gets into production.
- **`raw` is append-only and immutable.** A corrected re-export lands as a new
  version alongside the old one (see `source-ingestion-mapper` §1), it does not
  overwrite. Re-deriving `staging` from `raw` must be possible at any time.
- **`config` is where a human's decisions live** — channel groupings, account
  hierarchies, test-account denylists, FX rates, fiscal calendars. Kept as
  tables so they are joinable and versioned, not as `CASE WHEN` blocks in ten
  models.
- **`quality` is queryable, not a log file.** `quality.mart_readiness` with one
  row per mart, its last successful load, its last attempted load, and its
  test status, is what a dashboard header reads. See `data-quality-harness`.
- **Consumers are granted on `marts` and `quality` only.** Layering enforced by
  documentation drifts; layering enforced by grants does not.

**Migrations are numbered files applied in order** — `001_create_raw.sql`,
`002_create_staging_crm.sql` — each idempotent, each committed. There is no dbt
dependency anywhere in this pack; `sql-transformation-builder` owns the
migration runner and the idempotency rules.

---

## 2. Partition on the filter column, cluster on the group column

This is the highest-leverage decision in the whole skill. Get it right and a
typical GTM query scans 2–10% of the table.

| Decision | Rule |
|---|---|
| **Partition on** | the column that appears in the `WHERE` date filter of almost every query: `event_date`, `snapshot_date`, `close_date`, `date_day` |
| **Cluster on** | the high-cardinality columns queries filter or group by after the date: `campaign_id`, `account_id`, `user_pseudo_id`, `canonical_person_id` |
| **Never partition on** | a high-cardinality non-date key. BigQuery caps a table at 10,000 partitions; an integer-range partition on `account_id` hits that and fails |
| **Cluster order matters** | BigQuery prunes on a prefix of the clustering columns. Order them most-filtered first; `(campaign_id, account_id)` does not prune a query that filters only on `account_id` |

**The single best guardrail is `require_partition_filter = true`** on every
large table. A query with no date filter then fails loudly instead of scanning
the whole table and succeeding.

```sql
-- BigQuery
CREATE TABLE IF NOT EXISTS marts.fact_touchpoint
(
  touchpoint_id      STRING NOT NULL,
  canonical_person_id STRING,
  canonical_account_id STRING,
  event_ts           TIMESTAMP NOT NULL,   -- absolute UTC
  event_date         DATE      NOT NULL,   -- the partition key, property timezone
  channel            STRING,
  campaign_id        STRING,
  amount_original    NUMERIC,              -- never FLOAT64 for money
  currency_original  STRING
)
PARTITION BY event_date
CLUSTER BY campaign_id, canonical_account_id
OPTIONS (
  require_partition_filter = TRUE,
  partition_expiration_days = NULL,        -- set deliberately, see §6
  description = "One row per marketing touch. Always filter on event_date."
);
```

```sql
-- Snowflake: no partition syntax. Micro-partitions are automatic;
-- a clustering key is the equivalent lever and it costs credits to maintain.
CREATE TABLE IF NOT EXISTS MARTS.FACT_TOUCHPOINT (
  TOUCHPOINT_ID        VARCHAR NOT NULL,
  CANONICAL_PERSON_ID  VARCHAR,
  EVENT_TS             TIMESTAMP_NTZ NOT NULL,  -- see §5 on NTZ vs LTZ
  EVENT_DATE           DATE NOT NULL,
  CHANNEL              VARCHAR,
  CAMPAIGN_ID          VARCHAR,
  AMOUNT_ORIGINAL      NUMBER(38,6),
  CURRENCY_ORIGINAL    VARCHAR
)
CLUSTER BY (EVENT_DATE, CAMPAIGN_ID)
COMMENT = 'One row per marketing touch. Always filter on EVENT_DATE.';
```

**Snowflake caveat worth stating plainly:** clustering keys are only worth it
above roughly a terabyte and on tables queried far more often than they are
written. Automatic clustering bills credits continuously in the background. On
a small GTM table it costs more than it saves — say so rather than adding one
by reflex.

**Write the partition column into the table description**, because the agent
that will query this table six months from now reads the description, not this
file.

---

## 3. Incremental strategy follows the shape of the data

| Data shape | Strategy | Key | Why |
|---|---|---|---|
| Event / touchpoint streams | **overwrite whole date partitions** | `event_date` | reprocessing a window is idempotent; no merge key needed |
| CRM entities (opportunity, contact, account) | **merge on a unique key** | `opportunity_id` | records update in place and must not duplicate |
| Daily snapshots | **insert, skip known `snapshot_date`** | `(entity_id, snapshot_date)` | a snapshot for a past day is immutable by definition |
| Ad spend | **overwrite by `(platform, date)`** | | platforms restate; see §4 |
| Governed logs / config | **upsert on the natural key** | | small, human-owned |

### The late-arriving window is the correctness decision

**Late-arriving data is the reason naive incremental models are wrong, and the
error is invisible.** An append-only model reports yesterday and never revisits
it. The platform then revises yesterday and your warehouse keeps the first
answer forever.

Set the reprocessing window from the source's own settlement behaviour, not
from a habit:

| Source | Reprocess a trailing window of | Because |
|---|---|---|
| GA4 (API or export) | 3 days minimum | standard properties take 24–48h to finish processing |
| Meta | 28 days | conversions settle over a 28-day window |
| Google Ads | up to 90 days | conversions back-fill to the click date for up to 90 days |
| LinkedIn | 7 days | conversion-date reporting with a short settle |
| CRM | 7 days | backdated records, reopened deals, ownership changes |

The runnable rule:

```
reprocess_from = current_date - GREATEST(source_settlement_days, 3)
```

Then the load overwrites every partition from `reprocess_from` forward. A model
whose incremental predicate is `WHERE event_date > (SELECT MAX(event_date) FROM
{this})` has no late-arriving window and is **worse than a full refresh**,
because a full refresh is merely expensive and this is quietly wrong.

**Publish the window.** A figure inside the reprocessing window is provisional
and `provenance-block` must carry that. Google Ads' 90-day back-fill means a
"final" paid number is roughly a quarter old — that is a real fact about the
business, not a technical footnote.

---

## 4. Cost is a design decision, not a cleanup task

The standard GTM cost disaster has a fixed shape: **an hourly-refreshed
dashboard querying an unpartitioned view over a nested event export.** Each
refresh is a full scan, and nobody notices until the invoice.

The fix is structural, in this order:

1. **Materialise the aggregate.** A dashboard should read a table with tens of
   thousands of rows, not scan hundreds of millions. Build
   `marts.agg_channel_day` and point the dashboard at it.
2. **Bound the query before running it.** Dry run, byte cap, partition filter,
   `LIMIT` on anything exploratory.
3. **Give the agent its own credential** so per-user quotas and resource
   monitors actually bind it, and its own billing label so its spend is
   attributable.
4. **Schedule the refresh at the cadence of the data, not the dashboard.** GA4
   finishes processing daily; refreshing its aggregate hourly buys nothing and
   costs twelve extra scans.

### The guardrails, per warehouse

| | BigQuery | Snowflake |
|---|---|---|
| Pre-flight estimate | `dryRun: true` on the job config — returns `totalBytesProcessed`, no charge, no execution | no true dry run; use `EXPLAIN` and `SAMPLE` for shape, and a statement timeout as the real bound |
| Hard stop | **`maximumBytesBilled`** on every job — over the estimate, the query fails with no charge | `STATEMENT_TIMEOUT_IN_SECONDS` and `STATEMENT_QUEUED_TIMEOUT_IN_SECONDS` on the agent's warehouse and role |
| Spend ceiling | custom quotas, per-project and **per-service-account**, in Cloud Quotas | **resource monitor with a hard `SUSPEND`** trigger, not just `NOTIFY` |
| Idle cost | none — on-demand is per-byte | dedicated small warehouse, `AUTO_SUSPEND = 60` |
| Attribution | job labels; `INFORMATION_SCHEMA.JOBS` for bytes billed per label | `QUERY_HISTORY` and `WAREHOUSE_METERING_HISTORY` |

**Two traps that make a cost estimate lie:**

- **A BigQuery dry run returns 0 bytes on a table with row-level security.**
  This is deliberate, to close a side channel. **Zero is not free** — it means
  the estimate is unavailable. Fall back to `maximumBytesBilled` as the bound
  and say the estimate could not be obtained.
- **BigQuery daily custom quotas reset at midnight US Pacific**, not UTC and
  not local. An agent budgeting a daily allowance against UTC midnight will
  find its budget already spent.

### Estimating before you build

You can compute this, so compute it:

```
bytes_scanned_per_query ≈ partitions_touched × avg_partition_bytes × (bytes_of_columns_selected / bytes_of_all_columns)

monthly_cost ≈ bytes_scanned_per_query × queries_per_day × 30 × price_per_byte
```

BigQuery bills **per TiB scanned on the columns you select**, with a small
per-table minimum, so column pruning is as real a lever as partition pruning —
`SELECT *` on a wide export table is the whole row every time. Snowflake bills
credits per warehouse-second instead, so the same equation is
`warehouse_size_credits_per_hour × seconds_running / 3600`, and the lever is
query duration and idle time rather than bytes.

Check the current list price before quoting money; the shape of the estimate
does not change but the rate does. **Give the estimate with the rate you used
stated** — a costed answer with a named rate is auditable, a refusal to
estimate is not.

---

## 5. Physical traps that silently change numbers

- **Disable the result cache on extraction queries.** BigQuery
  `useQueryCache: false`; Snowflake `ALTER SESSION SET USE_CACHED_RESULT =
  FALSE`. A cached result is correct for the query text and wrong for the world
  after a view definition changed underneath it. Snowflake's cache holds for 24
  hours on unchanged data, which is exactly long enough to mislead a daily job.
  For stable, repeated reporting queries the cache is a feature — the rule is
  to disable it where you are extracting to compare or to verify a change.
- **Money is `NUMERIC` / `NUMBER(38,6)`, never `FLOAT64`.** And it always has a
  `currency_original` column beside it, because no warehouse has a currency
  type and the unit cannot be recovered later.
- **`TIMESTAMP` versus `DATETIME` (BigQuery), `TIMESTAMP_NTZ` versus
  `TIMESTAMP_LTZ` (Snowflake).** Store the absolute instant, derive the local
  date once, at the boundary, into an explicit `event_date` column. Snowflake's
  `TIMESTAMP_LTZ` renders in the **session's** timezone, which defaults to
  `America/Los_Angeles` on many accounts, so the same column shows different
  dates to your agent than to a BI tool. Set the session timezone explicitly.
- **Week boundaries are a schema decision.** BigQuery `DATE_TRUNC(x, WEEK)`
  starts **Sunday**; `WEEK(MONDAY)` is a different answer. Snowflake has
  `WEEK_START` and `WEEK_OF_YEAR_POLICY` account parameters. Put the week
  convention in `config.dim_date` and join to it, so it is decided once.
- **Streaming-buffer rows are invisible to some operations** in BigQuery:
  recently streamed rows cannot be updated or deleted immediately and may not
  appear in `TABLE_STORAGE` row counts. A "the metadata disagrees with the
  query" mystery.
- **Deleted is not deleted.** Snowflake `ACCOUNT_USAGE.TABLES` lists dropped
  tables with a `DELETED` timestamp — an inventory that does not filter
  `DELETED IS NULL` reports ghosts. BigQuery `_TABLE_SUFFIX` wildcard queries
  silently include backup tables you did not mean.
- **`INFORMATION_SCHEMA` is region-scoped in BigQuery.** Querying the wrong
  region returns an empty result, not an error.
- **Views run with the caller's permissions** unless they are authorized views,
  so a consumer can see a view and get "permission denied" on its underlying
  table. Authorized views (BigQuery) and managed-access schemas (Snowflake) are
  how the `marts`-only grant model in §1 is actually implemented.

---

## 6. Retention: what the platform will not keep, the warehouse must

**This is the decision that cannot be taken retroactively.** By the time
someone asks for a two-year trend, the source has already dropped the data.

| Source | Known limit | Consequence if you did not land it |
|---|---|---|
| Marketo activity data | roughly 25 months, contract-dependent | activity-based analysis simply ends at the horizon |
| LinkedIn demographic reporting | 2 years | no demographic history beyond it |
| LinkedIn daily granularity | 6 months | older data available only at coarser granularity |
| Meta unique counts (reach, unique clicks) | 13 months | year-over-year unique comparisons become impossible |
| Meta frequency metrics | 6 months | |
| GA4 event-level retention | a property setting (commonly 2 or 14 months) — **check the property, do not assume** | explorations and the BigQuery export diverge in how far back they reach |

The design consequences:

1. **Land the daily extract from day one, even if nobody has asked for the
   trend yet.** Storage is the cheapest line on the invoice; history is the
   only thing on it you cannot buy later.
2. **Set `partition_expiration_days` deliberately, and usually to null on
   facts.** A default expiration silently deletes the history you were keeping
   precisely because the platform would not.
3. **Snapshot tables need a retention statement, not a default** — the daily
   opportunity snapshot is the table people most often prune to save money and
   most regret pruning.
4. Where a source's history is already gone, that is `unavailable` for the
   period before your first landing, with the exact first-landing date named.

---

## 7. The output: a physical design specification

```
layers[]:            name, purpose, reads_from[], granted_to[]
tables[]:
  name, layer, grain_sentence,
  partition_by, partition_type, require_partition_filter,
  cluster_by[], clustering_justification,
  incremental_strategy, unique_key, late_arriving_window_days,
  retention_days, retention_rationale,
  money_columns[] (with currency column), timestamp_columns[] (with type)
cost_controls:
  per_job_byte_cap, per_credential_daily_quota, resource_monitor,
  dry_run_required, cache_policy
estimates[]:
  query_pattern, bytes_or_seconds, rate_used, monthly_cost, assumptions
cannot_answer[]:     periods and grains the physical design cannot serve
```

---

## 8. Answering

**Answer first.** "What will this cost?" gets a number: dry-run the
representative query, multiply by frequency, state the rate you used and the
assumption about query mix. Then name the direction of the error — an estimate
from a dry run is an upper bound on scan for that exact query and an
underestimate of the month if the dashboard fans out into drill-downs.

"Will this query be expensive?" gets a yes or no before it gets a lecture:
check the partition filter and the selected columns, and say which of the two
is the problem.

**Withhold only** where the estimate genuinely cannot be computed: a dry run
returning 0 bytes under row-level security, or a Snowflake query whose cost
depends on a warehouse size not yet chosen. In both cases give the bound you
*can* set (`maximumBytesBilled`, a statement timeout) and name the input that
would produce a real estimate.

---

## Core contracts called

- `rate-limit-governor` — the cost guardrails and the budget planned before the
  first job is issued.
- `write-gate` — every DDL statement, every migration application, every
  retention or expiration change. A `partition_expiration_days` edit deletes
  data on a timer.
- `provenance-block` — the late-arriving window and the freshness state of each
  table are provenance fields, emitted with every number derived from them.
- `answer-contract` — cost estimates and retention limits are answers under the
  contract, including the `unavailable` cases in §8.

## References

- `references/partitioning-and-cost.md` — per-warehouse DDL, the guardrail
  configuration, and the dry-run and estimate procedures
- `references/retention-register.md` — the platform retention table with what
  to land, at what cadence, to survive each limit

## Related skills

- `data-model-designer` runs first and settles the grains.
- `sql-transformation-builder` owns the numbered migrations and the runner.
- `source-ingestion-mapper` lands into `raw` under the naming contract.
- `data-quality-harness` builds the `quality` layer this design exposes.
