# Cost guardrails — the two that are mandatory, and the ones that back them up

**BigQuery's failure mode is not a 429, it is an invoice.** Nothing throttles a technically
valid query that scans an enormous volume. These controls are part of every job this module
issues, not an optimisation to add later.

## 1. Dry-run first, every time

```python
def estimate_bytes(client, sql):
    """dryRun returns totalBytesProcessed with no charge and no execution."""
    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
    job = client.query(sql, job_config=job_config)
    return job.total_bytes_processed
```

Then gate on it:

```python
THRESHOLD_BYTES = 50 * 1024**3   # 50 GiB — tune per engagement

bytes_est = estimate_bytes(client, sql)
if bytes_est > THRESHOLD_BYTES:
    raise CostEscalation(
        f"query would scan ~{bytes_est / 1024**4:.2f} TiB; narrow it or confirm"
    )
```

**The RLS exception, which matters: a dry run returns 0 bytes on RLS-protected tables,
deliberately, to block a side channel. Do not interpret 0 as free.** On any table that
might carry row-level security, treat a zero estimate as **unknown**, not as cheap, and
rely on `maximumBytesBilled` instead.

## 2. `maximumBytesBilled` on every job

**If the pre-execution estimate exceeds it, the query fails with no charge. This is the
single most important guardrail for an agent.**

```python
job_config = bigquery.QueryJobConfig(
    maximum_bytes_billed=50 * 1024**3,
    labels={"agent": "gtm-skillpack", "workload": "analysis"},
)
client.query(sql, job_config=job_config)
```

It is a hard stop that does not depend on the agent remembering to check an estimate —
which is exactly why it is the primary control and the dry run is the secondary one.

**The label matters too.** Billing labels are the only way to answer "what did the agent
cost" after the fact.

## 3. Custom quotas, per service account

Project-level and **per-service-account** custom quotas in Cloud Quotas bound the damage
across a day rather than per query.

- Exceeding returns **`usageQuotaExceeded`**.
- **Daily quotas reset at midnight US Pacific, not UTC.** A "start of day" job scheduled on
  a UTC clock lands mid-window with a partially-consumed quota.

**Per-user custom quotas bind an identity.** A shared service account therefore has no
enforceable ceiling for the agent specifically — **give the agent its own service
account.**

## 4. Partition filters that fail loudly

**Prefer partitioned and clustered tables with `require_partition_filter`.** It turns a
forgotten `WHERE` clause into an **error** rather than a full-table bill.

And note the metadata trap that undermines this:

**`_PARTITIONTIME` and `_PARTITIONDATE` pseudo-columns are not in
`INFORMATION_SCHEMA.COLUMNS`.** An agent that builds its query from `COLUMNS` alone **does
not know the table is partitioned**, writes no partition filter, and is billed for a full
scan.

**Read `INFORMATION_SCHEMA.PARTITIONS` or `TABLES` (`time_partitioning`,
`clustering_fields`) before generating SQL against an unfamiliar table.**

## 5. Reservations change the shape of the risk

**Reservation or capacity pricing converts cost risk into a fixed slot pool**, which is a
much better shape for autonomous agents than on-demand billing: a runaway query becomes
slow rather than expensive.

If the engagement involves an agent querying regularly, this is worth raising with the
customer as an architectural recommendation, not just a billing preference.

## Two more habits that cut cost without cutting capability

- **`SELECT *` on nested GA4 or Ads export tables is both expensive and produces unusable
  deeply-nested JSON. Always unnest explicitly** and name the columns.
- **`_TABLE_SUFFIX` wildcard queries silently include tables you did not mean, including
  backups.** A `events_backup_20260901` table joins `events_*` without comment. Bound the
  suffix range explicitly:

```sql
WHERE _TABLE_SUFFIX BETWEEN '20260801' AND '20260831'
```

## Quotas and paging, for completeness

| Limit | Value |
|---|---|
| Concurrent interactive queries per project | ~100 on-demand (1,000 on some editions), queued beyond |
| Query text | 1 MB resolved |
| Result size without a destination table | 10 GB compressed; unlimited with one |
| `tabledata.list` / `jobs.getQueryResults` | **max ~10 MB per response** |
| API quota | ~100 `jobs.insert`-class requests/second/user; ~1,500 table-modifying ops/table/day |

Breaches return **403 `rateLimitExceeded`** or **`quotaExceeded`**.

**For volume, use the Storage Read API** — gRPC, Arrow or Avro, parallel read sessions.
Paging 10 MB at a time through `getQueryResults` is the wrong tool for a large extraction.
**For export, `EXPORT DATA OPTIONS(...)` to GCS or an `extract` job.**

## Scheduled queries: run them as a service account

`projects.locations.transferConfigs.create` with `data_source_id: "scheduled_query"`.

**Run them as a service account, otherwise the schedule dies when the creating human
leaves.** The failure surfaces months later as a silently stale table that everyone still
trusts — which is worse than an outage.

Scheduled queries additionally need **`roles/iam.serviceAccountTokenCreator`** and Data
Transfer permissions.
