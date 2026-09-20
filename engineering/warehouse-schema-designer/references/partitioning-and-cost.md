# Partitioning, clustering and cost control, per warehouse

Loaded on demand. The rules live in `SKILL.md`; this is the runnable detail.

---

## 1. BigQuery

### Partition types and when each applies

| Type | Syntax | Use for | Limit |
|---|---|---|---|
| Time-unit column | `PARTITION BY event_date` (DATE) or `PARTITION BY DATE(event_ts)` | almost every GTM fact | 10,000 partitions per table |
| Ingestion time | `PARTITION BY _PARTITIONDATE` | raw landings where the source has no reliable date | `_PARTITIONTIME` / `_PARTITIONDATE` **do not appear in `INFORMATION_SCHEMA.COLUMNS`** |
| Integer range | `PARTITION BY RANGE_BUCKET(bucket_id, GENERATE_ARRAY(0, 4000, 1))` | rare in GTM | the 10,000-partition cap bites fast |

Daily is the default granularity. Hourly partitioning on a table with two years
of history exceeds the partition cap; monthly partitioning on a table queried
by day prunes almost nothing.

### The guardrails, as job configuration

```python
job_config = bigquery.QueryJobConfig(
    dry_run=False,
    use_query_cache=False,            # extraction and verification queries only
    maximum_bytes_billed=50 * 1024**3,  # 50 GiB. Over this the job fails, unbilled.
    labels={"agent": "gtm-pack", "purpose": "extract"},
)
```

Dry run first, always:

```python
dry = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
job = client.query(sql, job_config=dry)
estimated = job.total_bytes_processed   # no charge, no execution
```

`estimated == 0` means one of three things, and they are not interchangeable:

1. the query touches no data (an empty or fully-pruned table),
2. the result is served from cache (only if you left `use_query_cache=True`),
3. **the target table has row-level security**, and BigQuery deliberately
   returns 0 to prevent the dry run being used as a side channel.

Check for RLS before treating 0 as free. If you cannot rule it out, report the
estimate as unavailable and rely on `maximum_bytes_billed` as the bound.

### Quotas worth configuring for an agent credential

- **Query usage per day, per user** in Cloud Quotas, bound to the agent's own
  service account. Exceeding returns `usageQuotaExceeded`.
- **Daily quotas reset at midnight US Pacific.** Not UTC.
- Concurrent interactive queries default to roughly 100 per project on-demand;
  beyond that, queries queue rather than fail.
- `jobs.getQueryResults` / `tabledata.list` paginate on `pageToken` with a
  response ceiling around 10 MB. **For volume, use the Storage Read API**, not
  paginated row listing.

### Reading your own cost back

```sql
SELECT
  job_id,
  user_email,
  TIMESTAMP_TRUNC(creation_time, DAY) AS day,
  total_bytes_billed,
  total_bytes_billed / POW(1024, 4) AS tib_billed,
  labels
FROM `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND job_type = 'QUERY'
ORDER BY total_bytes_billed DESC
LIMIT 50;
```

`INFORMATION_SCHEMA` is **region-scoped**. `region-us` is not `region-eu`, and
the wrong one returns an empty result rather than an error.

### Profiling without scanning

`INFORMATION_SCHEMA.PARTITIONS` and `INFORMATION_SCHEMA.TABLE_STORAGE` give row
counts, byte sizes and last-modified times **without scanning the table**. This
is how you size a table before deciding what a query over it will cost.

```sql
SELECT table_name, partition_id, total_rows, total_logical_bytes, last_modified_time
FROM `project.dataset.INFORMATION_SCHEMA.PARTITIONS`
WHERE table_name = 'fact_touchpoint'
ORDER BY partition_id DESC
LIMIT 10;
```

Caveat: rows still in the **streaming buffer** may not be counted here.

---

## 2. Snowflake

There is no partitioning statement. Micro-partitions are created automatically
on load order, which means **load order is your de-facto partitioning** — data
landed in date order prunes well on date without any clustering key at all.

### When to add a clustering key

All three must hold:

1. the table is large (roughly a terabyte or more, or hundreds of millions of
   rows),
2. it is queried far more often than it is written,
3. queries filter consistently on the proposed key.

Automatic clustering consumes credits continuously in the background. On a
small or write-heavy table it costs more than it saves. Check before and after:

```sql
SELECT SYSTEM$CLUSTERING_INFORMATION('MARTS.FACT_TOUCHPOINT', '(EVENT_DATE, CAMPAIGN_ID)');
```

### The guardrails, as account configuration

```sql
-- a dedicated, small, fast-suspending warehouse for the agent
CREATE WAREHOUSE IF NOT EXISTS WH_GTM_AGENT
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;

-- statement bounds on the role, not on each query
ALTER WAREHOUSE WH_GTM_AGENT SET STATEMENT_TIMEOUT_IN_SECONDS = 300;
ALTER WAREHOUSE WH_GTM_AGENT SET STATEMENT_QUEUED_TIMEOUT_IN_SECONDS = 60;

-- the spend ceiling: SUSPEND, not just NOTIFY
CREATE RESOURCE MONITOR IF NOT EXISTS RM_GTM_AGENT
  WITH CREDIT_QUOTA = 50
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 75 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND
    ON 110 PERCENT DO SUSPEND_IMMEDIATE;

ALTER WAREHOUSE WH_GTM_AGENT SET RESOURCE_MONITOR = RM_GTM_AGENT;

-- session settings the agent must set every session
ALTER SESSION SET TIMEZONE = 'UTC';
ALTER SESSION SET USE_CACHED_RESULT = FALSE;   -- extraction/verification only
ALTER SESSION SET WEEK_START = 1;              -- Monday, stated rather than inherited
```

`SUSPEND` lets running queries finish; `SUSPEND_IMMEDIATE` kills them. Set both
triggers — the first is the ceiling, the second is the fuse.

### Reading your own cost back

```sql
SELECT
  DATE_TRUNC('day', START_TIME) AS day,
  WAREHOUSE_NAME,
  SUM(CREDITS_USED) AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE START_TIME >= DATEADD('day', -7, CURRENT_TIMESTAMP())
GROUP BY 1, 2
ORDER BY 1 DESC;
```

`ACCOUNT_USAGE` views lag (commonly 45 minutes to 3 hours). `INFORMATION_SCHEMA`
is current but shorter-horizon. An agent reporting "today's spend" from
`ACCOUNT_USAGE` is reporting a lagging figure — say which view you read.

### The inventory trap

```sql
SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, ROW_COUNT, BYTES
FROM SNOWFLAKE.ACCOUNT_USAGE.TABLES
WHERE DELETED IS NULL;      -- without this you inventory dropped tables
```

Time Travel means a dropped table is recoverable and still listed. `UNDROP
TABLE` works within the retention window; the object is not gone when the
`DROP` returns.

---

## 3. The cost estimate, worked

A daily channel-performance dashboard over a touchpoint fact table.

**Inputs you can measure without guessing:**

| Input | Where it comes from |
|---|---|
| `avg_partition_bytes` | `INFORMATION_SCHEMA.PARTITIONS.total_logical_bytes`, averaged |
| `partitions_touched` | the date range of the dashboard's default filter |
| column fraction | bytes of the selected columns over bytes of all columns, from `PARTITIONS` plus column types |
| `queries_per_day` | refresh cadence × number of tiles × (1 + drill-down factor) |

**The arithmetic:**

```
bytes_per_query  = partitions_touched × avg_partition_bytes × column_fraction
bytes_per_month  = bytes_per_query × queries_per_day × 30
cost_per_month   = (bytes_per_month / 1 TiB) × price_per_TiB
```

**The three things that make this estimate wrong, and their direction:**

1. **Drill-downs multiply query count** — the estimate is a floor unless you
   counted them. Direction: understates.
2. **Clustering prunes further than the partition estimate assumes** —
   direction: overstates, sometimes by a lot.
3. **A dashboard tool may cache** — direction: overstates.

So the honest statement is a range with the dominant term named: *"roughly N
per month at the current list rate, most of it from the hourly refresh of the
unaggregated tile; materialising that tile removes about 80% of the scan."*
That is an answer. "It depends" is not.
