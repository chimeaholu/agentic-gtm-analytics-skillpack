# Dialect register

Static content, deliberately. A model's SQL priors are Postgres-shaped, and the
four dialects a GTM agent meets are not Postgres. Every entry here is a case
where the wrong version **parses and returns rows** — that is the selection
criterion for being in this file.

---

## 1. The portable subset

If a transformation can be written inside this subset, write it here and it
runs everywhere:

- `SELECT`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`
- `INNER`/`LEFT`/`RIGHT JOIN`, `UNION ALL`
- `CASE WHEN`, `COALESCE`, `CAST`
- `SUM`, `COUNT`, `COUNT(DISTINCT …)`, `MIN`, `MAX`, `AVG`
- Window functions with explicit `PARTITION BY … ORDER BY …`
- Date comparison against an explicit literal: `event_date >= DATE '2026-07-01'`

Everything outside it — date truncation, JSON access, arrays, interval
arithmetic, string functions, approximate counters — is dialect-specific and
needs a lookup below.

---

## 2. HogQL (PostHog) — ClickHouse under the hood

### Date and time

| Intent | HogQL |
|---|---|
| start of day / week / month | `toStartOfDay(ts)`, `toStartOfWeek(ts)`, `toStartOfMonth(ts)` |
| difference | `dateDiff('day', start, end)` — **unit first**. `dateDiff(start, end, 'day')` is a different function signature in other dialects and reversing start/end returns a negative with no error |
| add / subtract | `dateAdd(ts, INTERVAL 7 DAY)`, `dateSub(...)` |
| timezone | `toTimeZone(ts, 'America/New_York')` — **HogQL results and Insight results legitimately differ on day boundaries** because insights use the project timezone setting |
| format | `formatDateTime(ts, '%Y-%m-%d')` |

`toStartOfWeek` takes an optional mode argument controlling whether the week
starts Sunday or Monday. Different from BigQuery's default. State it.

### JSON and properties

```sql
-- event properties
JSONExtractString(properties, 'utm_source')
JSONExtractInt(properties, 'order_value')
JSONExtractRaw(properties, 'items')          -- keep as JSON for further extraction

-- the shorthand HogQL adds on top of ClickHouse
properties.utm_source
person.properties.plan
```

**`person.properties.X` is the latest value, not the value at event time.** A
cohort analysis that filters on `person.properties.plan` is filtering on
today's plan applied to last year's events. Use an event property captured at
the time, or a person-properties snapshot.

### Arrays, joins, pagination

- `arrayJoin(arr)` replaces `unnest`.
- `FULL OUTER JOIN` is unsupported on older versions — restructure as two
  `LEFT JOIN`s unioned, or aggregate both sides to a common key and `UNION ALL`.
- **`OFFSET` is rejected with HTTP 400.** Paginate on a stable sort key with a
  cursor predicate (`WHERE (ts, id) < (last_ts, last_id)`), never on offset.
- `uniq(x)` is an approximate distinct (HyperLogLog, error typically well under
  1%); `COUNT(DISTINCT x)` is exact and much more expensive. Pick deliberately
  and **say which you used** — a reconciliation needs the exact one.

### Soft deletes

Deleted persons are soft-deleted and **their event rows persist**. A query
against events can surface activity for a person who no longer exists in the
persons table. Filter deliberately and state the choice.

---

## 3. BigQuery

### Week boundaries — the most common silent disagreement

```sql
DATE_TRUNC(event_date, WEEK)          -- starts SUNDAY
DATE_TRUNC(event_date, WEEK(MONDAY))  -- starts Monday
DATE_TRUNC(event_date, ISOWEEK)       -- ISO week, starts Monday
```

Three functions, three answers, all valid. Put the convention in
`config.dim_date` and join to it so the decision is taken once.

### Timestamps

| Type | Semantics | Trap |
|---|---|---|
| `TIMESTAMP` | absolute instant, UTC | printing it in a local zone requires an explicit conversion |
| `DATETIME` | wall clock, **no zone** | comparing a `DATETIME` to a `TIMESTAMP` forces an implicit UTC assumption |
| `DATE` | calendar date | which zone it was derived in is not stored — derive it once, at the boundary |

```sql
CURRENT_DATE()                       -- UTC
CURRENT_DATE('America/New_York')     -- what the sales team means by "today"
DATE(event_timestamp, 'America/New_York')
```

### Money and division

```sql
CAST(amount AS NUMERIC)              -- NUMERIC/BIGNUMERIC for money, never FLOAT64
SAFE_DIVIDE(conversions, sessions)   -- NULL on a zero denominator, not an error
```

A NULL from `SAFE_DIVIDE` is `unavailable` under `answer-contract`, not zero.
Rendering it as 0% is a lie about a tracking gap.

### Nested exports

```sql
SELECT
  event_date,
  (SELECT value.string_value FROM UNNEST(event_params)
    WHERE key = 'page_location') AS page_location
FROM `project.analytics_123456.events_*`
WHERE _TABLE_SUFFIX BETWEEN '20260701' AND '20260731'
```

- `SELECT *` on these tables is expensive and returns unusable nested JSON.
- **`_TABLE_SUFFIX` wildcards silently include tables you did not mean**,
  including backups and intraday tables. Bound the suffix explicitly, and
  decide whether `events_intraday_*` belongs in the range (it is incomplete).
- `_PARTITIONTIME` / `_PARTITIONDATE` do not appear in
  `INFORMATION_SCHEMA.COLUMNS`. Read `INFORMATION_SCHEMA.PARTITIONS` to learn
  how a table is partitioned.

### Approximation

`APPROX_COUNT_DISTINCT(x)` is cheap and wrong by a small percentage.
Acceptable for a trend line, never for a reconciliation or a control total.

---

## 4. Snowflake

### Identifier case — the first error everyone hits

```sql
SELECT customer_id   FROM marts.fact_order;    -- resolves to CUSTOMER_ID, fine
SELECT "customer_id" FROM marts.fact_order;    -- invalid identifier, if stored as CUSTOMER_ID
```

Unquoted identifiers are folded to upper case. Quoted ones are literal. Pick one
convention — unquoted everywhere is the usual right answer — and apply it in
the generator, not case by case.

### The SQL API returns strings

Everything in the JSON result is a string. Cast using the `rowType` metadata;
timestamps arrive as epoch strings, numbers as decimal strings. Numbers lose no
precision but **look** wrong, and a naive parse turns `"1.0E2"` into a string
comparison.

### Timezones

```sql
ALTER SESSION SET TIMEZONE = 'UTC';                     -- do this, explicitly
SELECT CONVERT_TIMEZONE('UTC', 'America/New_York', ts); -- when you need local
```

- `TIMESTAMP_NTZ` has no zone and is the default for many loads.
- `TIMESTAMP_LTZ` renders in the **session's** timezone, which defaults to
  `America/Los_Angeles` on many accounts. The same stored value shows a
  different date to your agent than to a BI tool with a different session.
- `CURRENT_DATE()` follows the session timezone, so "today" is ambiguous until
  you set it.
- `WEEK_START` and `WEEK_OF_YEAR_POLICY` are **account-level** parameters that
  change what week 1 means for everyone.

### Semantic views are not tables

```sql
-- WRONG: parses as a table reference, fails
SELECT stage, SUM(amount) FROM marts.sv_pipeline GROUP BY stage;

-- RIGHT: the SEMANTIC_VIEW construct
SELECT * FROM SEMANTIC_VIEW(
  marts.sv_pipeline
  METRICS total_pipeline
  DIMENSIONS stage
);
```

A model writing "normal" SQL against a semantic view fails outright — which is
the good case. The bad case is a same-named regular view sitting beside it with
different logic.

### Metadata

- `ACCOUNT_USAGE` lags 45 minutes to 3 hours; `INFORMATION_SCHEMA` is current
  but covers a shorter horizon and less detail.
- `ACCOUNT_USAGE.TABLES` lists dropped tables — filter `DELETED IS NULL` or you
  inventory ghosts.
- Zero-copy clones mean identical data under several names; lineage from
  `ACCESS_HISTORY` shows the clone, not the origin.
- A query can succeed and return nothing because the role lacks a grant on a
  newly created object. Future grants and managed-access schemas are where
  agent access silently degrades over months.

---

## 5. Cross-dialect equivalence table

| Intent | BigQuery | Snowflake | HogQL / ClickHouse |
|---|---|---|---|
| start of month | `DATE_TRUNC(d, MONTH)` | `DATE_TRUNC('MONTH', d)` | `toStartOfMonth(d)` |
| ISO week | `DATE_TRUNC(d, ISOWEEK)` | `DATE_TRUNC('WEEK', d)` with `WEEK_START=1` | `toStartOfWeek(d, 1)` |
| days between | `DATE_DIFF(b, a, DAY)` | `DATEDIFF('day', a, b)` | `dateDiff('day', a, b)` |
| safe divide | `SAFE_DIVIDE(a, b)` | `DIV0NULL(a, b)` / `a / NULLIF(b,0)` | `a / nullIf(b, 0)` |
| JSON string field | `JSON_VALUE(col, '$.k')` | `col:k::STRING` | `JSONExtractString(col, 'k')` |
| explode array | `UNNEST(arr)` | `LATERAL FLATTEN(input => arr)` | `arrayJoin(arr)` |
| approx distinct | `APPROX_COUNT_DISTINCT(x)` | `APPROX_COUNT_DISTINCT(x)` | `uniq(x)` |
| string concat | `CONCAT(a, b)` / `a \|\| b` | `a \|\| b` | `concat(a, b)` |

Note the argument-order reversal between `DATE_DIFF(b, a, DAY)` in BigQuery and
`DATEDIFF('day', a, b)` in Snowflake. **Both return a number, and the wrong one
returns the negative.** This is the single most common cross-dialect defect in
generated SQL, and it never errors.
