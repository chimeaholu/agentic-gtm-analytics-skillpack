# Per-platform pagination, with loop skeletons

Skeletons are illustrative pseudocode. The value is in the control flow and the
stop conditions, which is where improvisation goes wrong.

---

## PostHog — keyset on `timestamp`

**`OFFSET` is rejected with HTTP 400 for personal API keys.** An agent that
writes `LIMIT 1000 OFFSET 1000` gets a 400 and, if it is not handling that
specific case, reports "the query failed" rather than paginating. This is the
single most misread error in the register.

```
last_ts = window_start
last_id = null
rows = []
for stage in 1..MAX_STAGES:            # fixed, visible cap
    q = f"""
      select id, timestamp, event, properties
      from events
      where timestamp >= '{last_ts}'
        and timestamp <  '{window_end}'
        and (timestamp > '{last_ts}' or id > '{last_id}')   -- tiebreaker
      order by timestamp asc, id asc
      limit 10000
    """
    page = post("/api/projects/:id/query/", {"query": q, "refresh": "async"})
    if page.query_status:              # async handle, not a result
        page = poll("/api/projects/:id/query/" + page.query_status.id)
    if not page.results: break
    rows += page.results
    last_ts, last_id = page.results[-1].timestamp, page.results[-1].id
    if len(page.results) < 10000: break
else:
    capped = True                      # stages exhausted → lower_bound
```

- Default limit 100 rows. Maximum 50,000 with an explicit `LIMIT`.
- Use `refresh: async` for non-trivial HogQL or the HTTP layer times out first.
- The tiebreaker on `id` matters: many events share a millisecond, and keyset on
  timestamp alone either loops or skips.
- For real volume use `/batch_exports` to S3, BigQuery, Snowflake, Redshift or
  Postgres rather than paginating at all.

---

## LinkedIn — there is no pagination

`adAnalytics` does not support pagination. The cap is **15,000 elements**. There
is no async job, no CSV export, no bulk endpoint.

The only strategy is to slice the request yourself:

```
results = []
for slice in date_slices(window, granularity="week"):   # or by campaign facet
    r = get_analytics(dateRange=slice, fields=EXPLICIT_FIELD_LIST, ...)
    if len(r.elements) >= 15000:
        # the slice itself hit the cap: split it further
        results += fetch_recursively(slice)
    else:
        results += r.elements
```

Three adjacent traps that belong to the same request:

- **Always name `fields` explicitly.** Omit it and you get `impressions` and
  `clicks` only, with no error. Maximum 20 fields per request.
- **414 URI too long is a real error** on wide requests. Use query tunnelling
  (POST with the method override) rather than dropping fields.
- **`timeGranularity=ALL` outside the trailing 6-month daily window silently
  rounds dates to month boundaries** and includes whole months. Detect the
  boundary before issuing and either refuse or restate the window.

Throttle: 45 million metric values per 5 minutes.

---

## Meta — cursors and the async path

```
after = null
for stage in 1..MAX_STAGES:
    r = get("/insights", {..., "after": after, "limit": 500})
    rows += r.data
    after = r.paging?.cursors?.after
    if not after: break
```

- Cursors only. **No random access, no page numbers, no resumable offset.**
- **Async is the default path for anything substantial**, not an optimisation:

```
run = post("/insights", {...})            # returns report_run_id
while True:
    s = get(f"/{run.report_run_id}")      # async_status, async_percent_completion
    if s.async_status == "Job Completed": break
    if s.async_status in ("Job Failed", "Job Skipped"): handle
    backoff()
rows = get(f"/{run.report_run_id}/insights")
```

- **Run IDs expire after 30 days.** A stored run ID is not a durable handle.
- Error 100 / subcode 1487534 means too much data: **split by date range or
  object level and retry**. Retrying unchanged fails identically forever.
- Error 4 / subcode 1504022 is platform load shedding: retry with back-off.

---

## GA4 — offset, and every page is a full re-query

```
offset, limit = 0, 100000
while True:
    r = runReport({..., "offset": offset, "limit": limit, "returnPropertyQuota": True})
    rows += r.rows
    total = r.rowCount                 # total matching rows, so you know when to stop
    offset += limit
    if offset >= total: break
    check_quota(r.propertyQuota)       # each page costs tokens
```

- Row 0-indexed. `limit` default 10,000, **maximum 250,000 per request** "no
  matter how many you ask for".
- `rowCount` gives the total, which makes the stop condition exact.
- **Offset paging re-queries from the start each time and is token-expensive.**
  Prefer one large request over many small ones, the opposite of the usual
  advice.
- For genuine bulk the Data API is the wrong surface entirely: use the
  **BigQuery Export**, which has no sampling, no thresholding and no `(other)`
  row. `reportTasks` exists as a long-running-operation path but is **v1alpha**
  and should not carry a critical path without a fallback.

---

## Salesforce reports — no pagination, and a two-truth response

```
r = get(f"/analytics/reports/{id}")
exact_totals = r.factMap["T!T"].aggregates      # computed over the FULL result set
rows         = r.factMap["T!T"].rows            # first 2,000 only
if r.allData == False:
    rows_are_a_lower_bound = True
```

- **2,000 rows. No pagination. 100 columns. 20 custom filters.**
- `allData: false` is the flag. Read it on every report response.
- The aggregates and the rows have **different truthfulness in the same
  object**. The total is exact; the rows are not.
- Per-row analysis over a truncated response is over an unspecified subset. It
  is not a sample and cannot be weighted.

**Above 2,000 rows, abandon the report API:**

```
job = post("/jobs/query", {"operation": "query", "query": "select ... from Opportunity"})
poll until job.state == "JobComplete"
locator = null
while True:
    r = get(f"/jobs/query/{job.id}/results", headers={"Sforce-Locator": locator})
    rows += parse_csv(r.body)
    locator = r.headers["Sforce-Locator"]
    if not locator or locator == "null": break
```

Bulk API 2.0: ~15 GB per job, 10,000 query jobs per rolling 24 hours, results
retrievable for 7 days. Use `queryAll` to include soft-deleted records.

---

## HubSpot — cursor on lists, shard around search

Search caps at **10,000 total results regardless of paging**. Paging past
`after=10000` simply stops returning data, with no error.

```
last_key = 0
while True:
    page_batch = []
    after = null
    while True:                                   # inner: up to 10k
        r = search({"filterGroups": [{"filters": [
                        {"propertyName": "hs_object_id", "operator": "GT", "value": last_key}]}],
                    "sorts": [{"propertyName": "hs_object_id", "direction": "ASCENDING"}],
                    "limit": 200, "after": after})
        page_batch += r.results
        after = r.paging?.next?.after
        if not after: break
    if not page_batch: break
    rows += page_batch
    last_key = page_batch[-1].id                  # shard forward
```

- Sort ascending on `hs_object_id` or `hs_lastmodifieddate`, take the last value
  of each ≤10k window as a `GT` filter for the next.
- `hs_object_id` is the safer shard key: `hs_lastmodifieddate` has ties, and ties
  on the shard key cause skipped or repeated records.
- Page size 100 default, 200 maximum.
- **Archived records are excluded from lists by default and never returned by
  search.** Pass `?archived=true` on list endpoints; on search, state the gap.
- Search is rate-limited separately from the general bucket, around 4 to 5
  requests per second per account.
- The **Exports API** is the async bulk path: create, poll, fetch a short-lived
  signed URL. The export reflects the *view's* columns.

---

## Snowflake — result partitions

The first response carries partition 0 plus metadata describing the rest.

```
r0 = post("/api/v2/statements", {"statement": sql})
rows = r0.data
for i in 1..len(r0.resultSetMetaData.partitionInfo) - 1:
    rows += get(f"/api/v2/statements/{r0.statementHandle}?partition={i}").data
```

- **Partitions are roughly fixed-size chunks, not fixed row counts.** Partition 3
  and partition 4 hold different numbers of rows. Any logic assuming a constant
  page size is wrong.
- Everything in `data` is a string; cast from `resultSetMetaData.rowType`.
- `async=true` returns a handle to poll for long statements.
- `COPY INTO <stage>` for very large pulls.

---

## BigQuery

```
pageToken = null
while True:
    r = jobs.getQueryResults(jobId, {"maxResults": 10000, "pageToken": pageToken})
    rows += r.rows
    pageToken = r.pageToken
    if not pageToken: break
```

- Response maximum roughly **10 MB**, so `maxResults` is advisory; the response
  truncates on size first.
- 10 GB compressed result limit without a destination table.
- For millions of rows use the **Storage Read API** (gRPC, Arrow or Avro,
  parallel read sessions) or `EXPORT DATA` to GCS. Paging `getQueryResults` for
  bulk is the slow wrong answer.

---

## Braze — a window, not a cursor

`data_series` endpoints have no cursor. `length` is 1 to 100, which is a **100-day
hard window per call**, and `ending_at` is inclusive.

```
for window in chunk_days(start, end, size=100):
    r = get("/…/data_series", {"length": len(window), "ending_at": window.end})
    rows += r.data
```

Off-by-one on the inclusive `ending_at` double-counts a day at every boundary,
which produces a total that is slightly and consistently high.

User export writes to **your own** S3, Azure or GCS bucket rather than returning
an HTTP body.

---

## Iterable — progressive files

```
job = post("/api/export/start", {...})
while True:
    s = get_export_files(job.id)
    if s.status == "complete": break
    backoff()
files = s.files            # only complete once status says so
```

**Files arrive progressively.** A mid-job response that looks like a complete
file list is not one. Reading the list before the job reports complete produces
a partial extract that looks whole. 10 MB per file, 100 GB per job. `startAfter`
paginates within the file list.

---

## Marketo — tokens that expire

```
token = mint_paging_token(since_datetime)     # activities require this
while True:
    r = get("/rest/v1/activities.json", {"nextPageToken": token, ...})
    rows += r.result
    if not r.moreResult: break
    token = r.nextPageToken
```

- **Paging tokens expire.** A long extraction can outlive its own token.
- 300 lead IDs maximum per GET filter.
- Above tens of thousands of rows, **Bulk Extract is the only viable path**:
  create, enqueue, poll, download a file. **Activity extracts are capped at 31
  days per job**, so a year of activities is 12 or more jobs.

---

## Pardot / MCAE

`nextPageToken` or `nextPageUrl`, concurrency 5 (error 66 above it).

The Export API is **queued and executed sequentially per account**, so
parallelism buys nothing. Maximum 150 fields. **Collection fields cannot be
exported at all.** Data expires after 7 days. **Record order across files is not
guaranteed**, so any logic depending on file order is wrong.

---

## Looker, Tableau, Power BI, Cube, Segment, RudderStack, Klaviyo, Mixpanel, Amplitude

| Platform | Pattern | Notes |
|---|---|---|
| Looker | pagination is **query-level**: `limit` and `offset` inside the query body, not transport-level | downloads are capped by the admin "max rows to download" setting, which the API user cannot see. `create_query_task` for async |
| Tableau | REST `pageSize` max 1000 plus `pageNumber`; Metadata API max page 1,000 with a **20,000-node limit that returns partial results plus an errors block** | post-2026.1 VDS **streams and the 1 GB cap is removed**, so an unbounded query can flood the agent. Always set `rowLimit` |
| Power BI | most REST list endpoints return everything unpaged; the Admin scanner uses `continuationToken` | `executeQueries` caps at **1,000,000 values**, so rows = 1,000,000 / column count. Not tunable |
| Cube | `limit` / `offset`, default limit 10,000 | watch for `{"error": "Continue wait"}` on a 200, which is an async idiom, not a page |
| Segment | cursor `pagination.next`, `pagination.count` capped per endpoint | **no bulk event export via the Public API.** Warehouse connector or Data Lakes |
| RudderStack | aggregated server-side, cheap | **no bulk event export by design.** The warehouse is the export |
| Klaviyo | cursor paging on `/events` and `/profiles` | **no bulk export API at all.** Paginate under the rate limits or use a warehouse connector |
| Mixpanel | `engage` uses `session_id` + `page`; analytics endpoints are not paginated, constrain by date and breakdown instead | Raw Export is a streaming NDJSON GET with no job or poll. Data Pipelines (paid) for volume |
| Amplitude | Export returns a zipped archive, one event per line | **365-day maximum period, hard 4 GB response.** Over it, 400; very large, 504. S3 export is Amplitude's own answer for volume |
