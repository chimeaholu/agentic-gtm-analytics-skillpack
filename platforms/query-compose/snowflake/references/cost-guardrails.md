# Cost guardrails — mandatory, not advisory

Snowflake publishes no request-rate thresholds and exposes no rate-limit headers. The
failure mode is not a 429 you back off from; it is a line on an invoice. Treat every item
here as part of setup, not as an optimisation to add later.

## The five controls, in setup order

**1. A dedicated warehouse for the agent.**

```sql
CREATE WAREHOUSE agent_wh
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;
```

`AUTO_SUSPEND = 60` means an idle agent costs nothing a minute later. A dedicated warehouse
also makes the agent's spend **separately attributable**, which is the only way to answer
"what is this costing us".

**2. Statement timeouts on the warehouse and the role.**

```sql
ALTER WAREHOUSE agent_wh SET STATEMENT_TIMEOUT_IN_SECONDS = 300;
ALTER WAREHOUSE agent_wh SET STATEMENT_QUEUED_TIMEOUT_IN_SECONDS = 120;
ALTER ROLE agent_role   SET STATEMENT_TIMEOUT_IN_SECONDS = 300;
```

The account default is 172,800 seconds. A runaway query at the default runs for two days.

**3. A resource monitor with a hard suspend trigger.**

```sql
CREATE RESOURCE MONITOR agent_monitor
  WITH CREDIT_QUOTA = <n>
  FREQUENCY = MONTHLY
  START_TIMESTAMP = IMMEDIATELY
  TRIGGERS
    ON 75 PERCENT DO NOTIFY
    ON 90 PERCENT DO NOTIFY
    ON 100 PERCENT DO SUSPEND;

ALTER WAREHOUSE agent_wh SET RESOURCE_MONITOR = agent_monitor;
```

**A notify-only monitor does not stop anything.** The `SUSPEND` trigger is the control; the
notifications are the warning.

**4. A least-privilege role.** Everything visible to the agent is determined by the role.
Grant read on the specific schemas the work needs, nothing else. Note the corollary in the
gotcha list: **a query can succeed and return nothing because the role lacks grants on a
new object**, so an empty result is a grant question until ruled out.

**5. Query discipline in the agent itself.**

- `LIMIT` on every exploratory query
- `SAMPLE` for profiling rather than full scans
- filter on the clustering or partition key before anything else
- one well-shaped query rather than five exploratory ones

## Estimating before spending

Snowflake has no dry-run that returns bytes-to-be-scanned the way BigQuery does. The
equivalent discipline is:

- **`EXPLAIN`** the statement to see the plan and the estimated partitions scanned
- run against **`SAMPLE`** first when profiling an unfamiliar table
- check table size from `INFORMATION_SCHEMA.TABLES` (`BYTES`, `ROW_COUNT`) before a full
  scan
- **rely on the result cache deliberately**: an identical query within 24 hours against
  unchanged data is free. *Identical* means byte-for-byte, so an agent that regenerates
  SQL with slightly different whitespace each time never hits the cache. Stable SQL text is
  a real cost optimisation.

## Attributing what was spent

```sql
SELECT warehouse_name, SUM(credits_used) AS credits
FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
WHERE start_time >= DATEADD(day, -7, CURRENT_TIMESTAMP())
GROUP BY 1 ORDER BY 2 DESC;

SELECT query_id, user_name, warehouse_name, total_elapsed_time/1000 AS secs,
       bytes_scanned, credits_used_cloud_services
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time >= DATEADD(day, -1, CURRENT_TIMESTAMP())
  AND warehouse_name = 'AGENT_WH'
ORDER BY bytes_scanned DESC
LIMIT 20;
```

**`ACCOUNT_USAGE` views carry 45 minutes to 3 hours of latency.** Yesterday's spend is
reliable; the last hour's is not yet there. Do not report "the agent has cost nothing
today" from a view that has not caught up.

## Two operational notes that get misread as failures

- **A suspended warehouse means the first query is slow, not failed.** An agent with a
  short client timeout reports an error after an idle period when it is really watching a
  resume. Distinguish before escalating.
- **Snowflake may return HTTP 429 with no rate-limit headers.** Exponential backoff is
  required; there is no budget to read.

## Async and partitions

Use `async=true` for anything over roughly 45 seconds, then poll
`GET /api/v2/statements/{handle}`.

Results come back partitioned. **`resultSetMetaData.partitionInfo[]` is the list to
iterate; partitions are approximately fixed-size chunks, not fixed row counts.** Never
compute a page count from a row total — read the partition list and fetch `?partition=N`
until it is exhausted.

For genuine bulk, `COPY INTO <stage>` and read the files. Paging millions of rows through
the SQL API is slow and expensive on both sides.
