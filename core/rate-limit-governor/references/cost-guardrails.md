# Warehouse cost guardrails

On BigQuery and Snowflake there is no rate limit worth planning against. The
failure mode is an invoice, and unlike a 429 it does not arrive until the month
closes. These guardrails are pre-flight, not advice.

---

## BigQuery

### 1. Dry-run every generated query

```
jobs.query with { "dryRun": true } → statistics.totalBytesProcessed
```

Free. Run it on every query the agent generates, before execution. Convert bytes
to a cost estimate at the project's rate and surface it when it is material.

### 2. Set `maximumBytesBilled` on every job

The single most effective guardrail available. If the query would exceed the
limit, **it fails with no charge**. Not a warning, not a truncation: it does not
run and it does not bill.

```json
{ "query": "...", "maximumBytesBilled": "10737418240" }
```

Set it from the dry-run estimate plus headroom, or from a fixed policy ceiling.

### 3. Give the agent its own service account

Per-user custom quotas then bind the agent specifically, rather than binding the
whole project and blocking human analysts when the agent misbehaves. **Daily
custom quotas reset at midnight US Pacific**, which is worth knowing when a
quota is exhausted mid-afternoon in Europe.

### 4. Table design that fails loudly

- Partition large tables on the column analysis actually filters on.
- Cluster on the high-cardinality columns used in predicates.
- **Set `require_partition_filter` on large tables.** An unfiltered scan then
  errors instead of billing. This converts a cost problem into an error message,
  which is the trade you want.

### 5. The dry-run caveat

**A dry run returns 0 bytes on row-level-security-protected tables,
deliberately.** Returning a real estimate would leak information about how many
rows the RLS policy filters, so the API returns 0 instead.

**0 is not "safe".** Detect RLS on the referenced tables before trusting a 0
estimate, and set `maximumBytesBilled` regardless. The byte cap is the guardrail
that still works when the estimate does not.

---

## Snowflake

### 1. A dedicated warehouse

Small, and owned by the agent's role. `AUTO_SUSPEND = 60` so an idle warehouse
stops billing after a minute rather than after the default.

```sql
create warehouse agent_wh
  warehouse_size = 'xsmall'
  auto_suspend = 60
  auto_resume = true
  initially_suspended = true;
```

### 2. Statement timeout

```sql
alter warehouse agent_wh set statement_timeout_in_seconds = 300;
-- or on the role, which is harder to bypass
alter user agent_user set statement_timeout_in_seconds = 300;
```

A runaway query then stops on its own.

### 3. A resource monitor with a SUSPEND trigger

```sql
create resource monitor agent_monitor
  with credit_quota = 50
  frequency = monthly
  start_timestamp = immediately
  triggers
    on 75 percent do notify
    on 100 percent do suspend
    on 110 percent do suspend_immediate;

alter warehouse agent_wh set resource_monitor = agent_monitor;
```

**A notify trigger does not stop anything.** The `suspend` trigger is the
guardrail; the notify is the warning. Ship both.

### 4. Query discipline

- `LIMIT` on every exploratory query, without exception.
- `SAMPLE` for profiling rather than full scans:
  `select * from events sample (1) ` reads roughly 1%.
- Read `resultSetMetaData.rowType` and cast deliberately. Everything arrives as
  a string, and a `NUMBER` with a scale is not the number the string looks like.

### 5. Masking

Masked reads **succeed**. Check `POLICY_REFERENCES` before reporting on a column
that might carry a masking policy, or the number is confidently wrong rather
than absent.

---

## The disclosure

When an extraction is material, say so before running it, in the units the user
cares about:

> This scan reads about 2.1 TB, roughly 10 USD at standard on-demand pricing.
> Partitioning the source on event date would cut it to about 40 GB. Run it as
> is, or narrow first?

Not:

> This query may be expensive.

The first is a decision. The second is a shrug.
