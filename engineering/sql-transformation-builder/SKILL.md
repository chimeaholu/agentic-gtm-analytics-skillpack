---
name: sql-transformation-builder
description: Use when writing or reviewing SQL transformations over GTM data — staging models, intermediate joins, marts, numbered migrations, or an ad-hoc analytical query an agent generated. Applies a deterministic repair pass for the recurring defects in model-written SQL, enforces read-only by code rather than by instruction, and encodes the dialect differences that make a Postgres-trained model write subtly wrong HogQL, ClickHouse, BigQuery or Snowflake SQL. Prevents a technically valid query that scans a terabyte or returns a plausible wrong answer.
---

# SQL Transformation Builder

Two jobs. Build the transformation layer as **numbered, idempotent migrations
that run with nothing installed but a database driver**, and make every
generated query safe, correct and cheap before it executes.

**No dbt dependency anywhere.** dbt is excellent and if the user has it, use
it. But a public pack that requires a dbt project excludes most of the people
who need it, so everything here runs as plain SQL files and a fifty-line
runner. Where dbt-specific artefacts appear below, it is because you will
*encounter* them in someone's warehouse, not because you need them.

---

## 1. Numbered idempotent migrations

```
migrations/
  001_create_schemas.sql
  002_create_raw_load_ledger.sql
  003_create_config_dim_channel.sql
  004_create_staging_crm_opportunity.sql
  005_create_marts_fact_opportunity_snapshot.sql
  006_add_currency_to_fact_ad_spend.sql
```

Five rules, and each one exists because of a specific way this goes wrong.

1. **Numbered, zero-padded, applied in ascending order.** Order is the
   dependency graph. A migration never depends on a higher number.
2. **Idempotent.** `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`,
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Re-running the whole directory on
   a live warehouse must be a no-op. This is what makes the runner safe to
   invoke from a cron job, a CI step and a laptop without coordination.
3. **Never edited after they have been applied anywhere.** A change is a new
   migration. The runner enforces this with a checksum (§2).
4. **Forward-only, with the destructive ones separated.** `007_drop_*.sql` and
   anything that deletes or rewrites data lives in a `destructive/`
   subdirectory, is never auto-applied, and goes through `write-gate` with its
   row counts stated.
5. **Each file carries a header comment** naming what it creates, which layer,
   and what it depends on. This is the only documentation that stays true.

```sql
-- 005_create_marts_fact_opportunity_snapshot.sql
-- layer: marts
-- grain: one row per opportunity per snapshot_date
-- depends on: 004 (staging.stg_crm__opportunity)
-- MANDATORY FILTER: always filter to one snapshot_date, or exactly two for a
-- comparison. Without a date filter you will get duplicates.

CREATE TABLE IF NOT EXISTS marts.fact_opportunity_snapshot (
  opportunity_id    STRING  NOT NULL,
  snapshot_date     DATE    NOT NULL,
  stage             STRING,
  amount_original   NUMERIC,
  currency_original STRING,
  close_date        DATE,
  owner_id          STRING,
  forecast_category STRING,
  tracked_field_hash STRING,
  _loaded_at        TIMESTAMP
)
PARTITION BY snapshot_date
CLUSTER BY opportunity_id
OPTIONS (require_partition_filter = TRUE,
         description = "One row per opportunity per snapshot_date. Always filter on snapshot_date.");
```

---

## 2. The runner, in full

Nothing to install beyond a driver. This is the whole thing.

```python
import hashlib, pathlib, re, sys

MIGRATIONS = pathlib.Path("migrations")
LEDGER_DDL = """
CREATE TABLE IF NOT EXISTS meta.schema_migrations (
  version      STRING    NOT NULL,
  filename     STRING    NOT NULL,
  checksum     STRING    NOT NULL,
  applied_at   TIMESTAMP NOT NULL,
  applied_by   STRING    NOT NULL,
  duration_ms  INT64
)"""

def migrate(conn, dry_run=True):
    conn.execute("CREATE SCHEMA IF NOT EXISTS meta")
    conn.execute(LEDGER_DDL)
    applied = {r.version: r.checksum for r in conn.query(
        "SELECT version, checksum FROM meta.schema_migrations")}

    pending = []
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        version = path.name[:3]
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        if version in applied:
            if applied[version] != checksum:
                # an applied migration was edited: refuse, do not "fix it up"
                sys.exit(f"FATAL: {path.name} changed after being applied. "
                         f"Write a new migration instead.")
            continue
        pending.append((version, path, checksum))

    if dry_run:
        for version, path, _ in pending:
            print(f"WOULD APPLY {version} {path.name}")
        return [p.name for _, p, _ in pending]

    for version, path, checksum in pending:
        with conn.transaction():            # where the warehouse supports DDL in a transaction
            conn.execute(path.read_text())
            conn.execute(
                "INSERT INTO meta.schema_migrations "
                "(version, filename, checksum, applied_at, applied_by) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP(), ?)",
                [version, path.name, checksum, conn.identity])
        print(f"APPLIED {version} {path.name}")
    return [p.name for _, p, _ in pending]
```

Behaviours that matter:

- **Dry run is the default.** `migrate(conn)` tells you what would happen;
  applying takes an explicit flag and a `write-gate` approval.
- **A checksum mismatch is fatal, not a warning.** An edited applied migration
  means two environments have different schemas under the same version number,
  and every subsequent diagnosis is wrong.
- **BigQuery does not support multi-statement DDL transactions the way Postgres
  does.** Keep each migration to one logical change so a partial failure leaves
  an obvious state; Snowflake DDL is auto-committed per statement, same
  constraint.
- **`applied_by` is the credential, not a person's name** — it is what makes
  "who changed prod" answerable.

---

## 3. Read-only enforced in code, not in the prompt

**The model cannot be talked out of a regex.** An instruction can be
overridden by a campaign name, a column comment or a chart title; a pattern
match cannot. This is failure mode F42: the read-only promise living in the
prompt.

```python
FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|"
    r"COPY|UNLOAD|CALL|EXECUTE|BEGIN|COMMIT|ROLLBACK)\b", re.I)
SYSTEM_SCHEMAS = re.compile(
    r"\b(INFORMATION_SCHEMA|ACCOUNT_USAGE|PG_CATALOG|SNOWFLAKE\.|SYS\.)", re.I)

def assert_read_only(sql: str, allowed_objects: set[str]):
    stripped = strip_comments(sql)                  # /* */ and -- , including nested
    if ";" in stripped.rstrip().rstrip(";"):
        raise Unsafe("stacked statements")
    if FORBIDDEN.search(stripped):
        raise Unsafe("write or DDL keyword")
    if SYSTEM_SCHEMAS.search(stripped) and not allow_metadata:
        raise Unsafe("system schema")
    for obj in referenced_objects(stripped):
        if obj not in allowed_objects:
            raise Unsafe(f"object not in allowlist: {obj}")
    return True
```

Four details that are load-bearing:

1. **Strip comments before matching.** `SELECT 1 /* DELETE */` is fine;
   `SELECT 1; --\nDELETE FROM x` is not, and a naive matcher gets both backwards.
2. **Reject stacked statements** rather than trying to parse them.
3. **Allowlist the readable objects**, don't denylist the dangerous ones. A
   denylist is a list of the attacks you thought of.
4. **The regex is a second line, not the first.** The first is a database role
   with `SELECT` only, granted on `marts` and `quality`. Enforcement in code is
   what catches the case where someone runs the agent with the wrong
   credential.

---

## 4. The deterministic repair pass

Between generation and execution, run a fixed, closed list of repairs and
**return the list of corrections applied** with the result. Deterministic
repair beats re-prompting: it is faster, reproducible, and auditable.

| # | Defect | Repair |
|---|---|---|
| 1 | Aggregating a string-typed numeric column | wrap in an explicit cast: `SUM(CAST(amount AS NUMERIC))` |
| 2 | Comparing a string-typed date column to a date literal | cast the column, not the literal: `CAST(date_str AS DATE) >= DATE '2026-07-01'` |
| 3 | A known value typo in a filter | apply the value-typo map from `config` (`'Closed - Won'` → `'Closed Won'`); unmapped values pass through untouched |
| 4 | No row limit on an exploratory query | append a **mandatory** `LIMIT` at the configured cap |
| 5 | Unqualified table names | qualify to `project.dataset.table` / `DB.SCHEMA.TABLE` from the allowlist |
| 6 | Missing partition filter on a `require_partition_filter` table | fail — **do not invent a date range**; ask for the window or use the default declared in the schema context |
| 7 | Snapshot-grained table with no snapshot filter | fail with the mandatory-filter sentence from the table description |

Repairs 1–5 are silent-but-reported. Repairs 6 and 7 **fail rather than
guess**, because inventing a date range changes the answer without changing the
question.

```json
{"corrections": [
  {"rule": "cast_aggregate", "from": "SUM(amount)", "to": "SUM(CAST(amount AS NUMERIC))"},
  {"rule": "row_cap", "added": "LIMIT 10000"}
], "blocked": []}
```

**The generated SQL is surfaced to the user as provenance**, corrections
included. A number whose query nobody can see is a number nobody can check.

---

## 5. Prefer a compiler over free-form generation against production

Where the target is a live production system, expose fixed templates rather
than arbitrary SQL:

```python
compile_query(
    object="fact_opportunity_snapshot",
    select=["stage", "SUM(amount_usd)"],          # from a fixed field register
    filters=[("snapshot_date", "=", "2026-09-19"), # operators from a closed set
             ("segment", "IN", ["enterprise"])],
    group_by=["stage"],
    limit=1000,                                    # hard cap, not a default
)
```

Properties: select-only by construction, mandatory date bounds, a hard cap on
the primary result **and on any drill-down**, and the compiled SQL returned
alongside the result. Free-form generation is for exploration in a sandbox;
compiled queries are for anything a customer sees.

---

## 6. Dialect register — the model's SQL priors are Postgres and they are wrong

Ship this as static content. A model that has learned Postgres writes HogQL
that parses and returns the wrong rows.

### HogQL (PostHog) — it is ClickHouse SQL

| Postgres habit | ClickHouse / HogQL |
|---|---|
| `FULL OUTER JOIN` | not supported on older versions — restructure with `UNION ALL` plus aggregation |
| `date_trunc('week', ts)` | `toStartOfWeek(ts)` — and its default week start differs from BigQuery's |
| `AGE(a, b)` / `b - a` | `dateDiff('day', a, b)` — **unit first, then start, then end**; reversing the arguments silently returns a negative |
| `data->>'key'` | `JSONExtractString(properties, 'key')` |
| `unnest(arr)` | `arrayJoin(arr)` |
| `OFFSET n` | **PostHog rejects `OFFSET` with HTTP 400** — paginate by a sort key and a cursor, see `pagination-patterns` |
| `COUNT(DISTINCT x)` | exact, but `uniq(x)` is approximate and much cheaper — **know which one you asked for** |

### BigQuery

- `DATE_TRUNC(x, WEEK)` starts **Sunday**; `DATE_TRUNC(x, WEEK(MONDAY))` is a
  different answer. State the convention.
- `TIMESTAMP` is absolute UTC; `DATETIME` is wall-clock with no zone. Mixing
  them shifts numbers silently. `CURRENT_DATE()` is UTC —
  `CURRENT_DATE("America/New_York")` is what the sales team means.
- Money is `NUMERIC` / `BIGNUMERIC`. `FLOAT64` money is a real bug source.
- Nested exports need explicit `UNNEST`. `SELECT *` on a GA4 export table is
  both expensive and unusable.
- `_PARTITIONTIME` / `_PARTITIONDATE` **do not appear in
  `INFORMATION_SCHEMA.COLUMNS`** — an agent that reads only `COLUMNS` will not
  know how to filter the partition and will be billed for the full scan.
- `SAFE_DIVIDE(a, b)` returns NULL on a zero denominator. Use it, then decide
  what NULL means — see §8.

### Snowflake

- **Unquoted identifiers upper-case; quoted ones are case-sensitive.**
  `"customer_id"` against a column stored as `CUSTOMER_ID` is an invalid
  identifier. Normalise deliberately, one way, everywhere.
- **The SQL API returns everything as strings.** Cast from `rowType`;
  timestamps arrive as epoch strings.
- `TIMESTAMP_NTZ` has no zone and is the default for many loads;
  `TIMESTAMP_LTZ` renders in the **session's** timezone, which defaults to
  `America/Los_Angeles` on many accounts. The same column shows different dates
  to your agent than to a BI tool. Set `TIMEZONE` explicitly or
  `CONVERT_TIMEZONE` everywhere.
- `WEEK_START` and `WEEK_OF_YEAR_POLICY` change what week 1 means, account-wide.
- **`SEMANTIC_VIEW()` is not ordinary SQL.** You cannot `SELECT col FROM
  semantic_view`. A model writing normal SQL against one fails.
- `ACCOUNT_USAGE` views lag (commonly 45 minutes to 3 hours);
  `INFORMATION_SCHEMA` is current but shorter-horizon.

---

## 7. Cost pre-flight is mandatory

Never execute a generated query without it:

1. **Dry run** (BigQuery `dryRun: true`) and read `totalBytesProcessed`. A
   result of 0 under row-level security means *unavailable*, not free.
2. **`maximumBytesBilled`** on every job. Over the estimate, the query fails
   with no charge.
3. **Partition filter present** — assert it, do not hope for it.
4. **`LIMIT` on anything exploratory**, applied by repair 4 above.
5. On Snowflake, where there is no dry run: a statement timeout on the role, a
   small dedicated warehouse, and `SAMPLE` for profiling instead of full scans.

**Query budget as an explicit target.** One query returning a breakdown beats
ten returning scalars — state the target call count for a typical question and
hold to it. Ten `SELECT COUNT(*) WHERE stage = …` queries is nine more scans
than `GROUP BY stage`.

---

## 8. The correctness rules that outrank style

- **Snapshot filters are mandatory on snapshot-grained tables.** State it in
  the table description in exactly these words: *"Always filter to one snapshot
  date, or join across exactly two for a comparison. Without a date filter you
  will get duplicates."* The agent reads the description, not the wiki.
- **A dbt snapshot table queried without `dbt_valid_to IS NULL`
  double-counts every changed record.** Every stage change on an opportunity
  becomes another row, revenue multiplies, nothing errors. You will meet these
  tables in customers' warehouses whether or not you use dbt — recognise the
  `dbt_valid_from` / `dbt_valid_to` / `dbt_scd_id` column triple and add the
  filter. The same shape applies to any SCD Type 2 table: filter to the current
  row or to a point in time, always.
- **Deleted-in-source rows simply stop appearing** in an incremental load
  unless deletes are handled. CRM records deleted upstream linger in the
  warehouse forever. Check the strategy before trusting a count.
- **Fan-out before aggregate.** Joining a fact to a many-side table multiplies
  its measures into a number that is larger, plausible, and never errors.
  Aggregate the many side first, or designate a primary row with a stated rule.
  See `data-model-designer` §5.
- **`SAFE_DIVIDE` / `NULLIF` on every rate**, then decide what the NULL means:
  a rate with a zero denominator is `unavailable`, not zero and not infinity.
- **`COUNT(DISTINCT …)` versus an approximate counter** — `APPROX_COUNT_DISTINCT`
  and `uniq()` are cheap and wrong by a percent or two. Fine for a trend line,
  not for a reconciliation. Say which you used.
- **Left join facts onto `dim_date`**, so a zero-activity period shows zero
  instead of vanishing from the chart.

---

## 9. Answering

**Answer first.** When asked to review a query, lead with whether the number it
produces is right, then with what it costs, then with style. Those are in
descending order of what the user is actually exposed to.

When asked to write one, write it, run the repair pass, dry-run it, and return
the SQL with the corrections list and the byte estimate. **Show the SQL every
time** — it is the provenance for every number that comes out of it.

**Withhold only** where the query cannot be made safe: a required partition
filter whose window you would have to invent, a snapshot table with no date to
filter on, or an object outside the allowlist. Name the exact missing input;
each of those is one question, not a menu.

---

## Core contracts called

- `write-gate` — every migration application, every `destructive/` file, every
  `CREATE OR REPLACE` over an object a consumer reads.
- `rate-limit-governor` — the query budget, the byte cap, the dry-run
  requirement and the retry ceiling.
- `provenance-block` — the generated SQL, the corrections applied and the
  estimated bytes travel with the number.
- `answer-contract` — blocked queries return `unavailable` with the missing
  input named; capped result sets return `lower_bound`.
- `comparability-rules` — before a query unions or sums across source
  boundaries.

## References

- `references/dialect-register.md` — the full cheat-sheets for HogQL,
  BigQuery, Snowflake and the portable subset, with the traps worked
- `references/migrations-and-safety.md` — the migration layout, the runner's
  failure modes, and the read-only guard in full

## Related skills

- `data-model-designer` for the grains and the join graph.
- `relationship-discovery` for the join path and its match rate.
- `warehouse-schema-designer` for partitioning, clustering and the cost controls.
- `data-quality-harness` for the tests these transformations must pass.
- `calculation-integrity-audit` for the assertions that catch fan-out after the fact.
