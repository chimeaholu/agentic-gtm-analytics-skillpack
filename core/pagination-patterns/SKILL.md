---
name: pagination-patterns
description: Use whenever a GTM platform result might exceed one page, one response or a row cap — any extraction, any list, any report over a few hundred rows. Encodes the exact pagination or bulk pattern per platform: PostHog keyset-on-timestamp (OFFSET is rejected with HTTP 400), LinkedIn's no-pagination 15,000-element cap, Meta cursors, GA4 offset, Salesforce's 2,000-row hard ceiling with no pagination at all, Snowflake partitions, HubSpot's 10,000-result shard. Prevents the agent improvising a pattern, silently truncating, and reporting a capped extract as a complete total.
---

# Pagination patterns

There are four fundamentally incompatible schemes in this stack, plus variants,
and **the model will improvise them wrong**. The improvisation is not obviously
wrong: it returns rows, the rows are real, and the total is short by an unknown
amount.

## The four that matter most

| Platform | Scheme | The trap |
|---|---|---|
| **PostHog** | **keyset on `timestamp`. `OFFSET` is rejected with HTTP 400 for personal API keys** | the 400 reads as "the query failed" and the agent reports a failure instead of paginating |
| **LinkedIn** | **none. `adAnalytics` does not support pagination**, and there is a **15,000-element cap** | there is no page 2 to fetch. Slice by date or facet in application code, or lose the tail |
| **Meta** | **cursors** (`paging.cursors.after`), not offsets, no random access | you cannot jump to page N, and a cursor from a previous run is not resumable after the data shifts |
| **GA4** | **offset + limit**, row 0-indexed | each page is a **full re-query** and is token-expensive; the cheapest page is the only page |
| **Salesforce reports** | **none. 2,000 rows, no pagination** | aggregates are exact while rows are truncated, in the same response, flagged only by `allData` |

If you remember nothing else: **`OFFSET` is not portable**, and on two of these
platforms there is nothing to paginate with at all.

## The per-platform register

| Platform | Pattern | Cap | Bulk escape hatch |
|---|---|---|---|
| GA4 | `offset` + `limit`, row 0-indexed; `rowCount` gives the total | **250,000 rows/request max**, 10,000 default; offset paging re-queries and is token-expensive | **BigQuery Export** — no sampling, no thresholding, no `(other)`. `reportTasks` exists but is **v1alpha** |
| Google Ads | `next_page_token`; **paginated follow-ups do not count against daily quota** | gRPC response cap **64 MB** | `SearchStream` (one operation regardless of batches); BigQuery Data Transfer Service for history |
| Meta | cursor (`paging.cursors.after`) — not offsets, no random access | no published row cap; rejects with **error 100 / subcode 1487534** | **async is the default path**: `POST /insights` → `report_run_id` → poll `async_status` / `async_percent_completion` → `GET`. Run ID expires after 30 days |
| LinkedIn | **none. `adAnalytics` does not support pagination.** | **15,000 elements**; throttle is 45M metric values per 5 min; 414 URI-too-long is a real error (use query tunnelling) | **none** — no async, no CSV export. Slice by date/facet in loops |
| Amplitude | Export is a zipped archive, one event per line | **365-day max period, hard 4 GB response**; over it → 400, very large → 504 | S3 export (Amplitude's own answer for volume) |
| Mixpanel | `engage` uses `session_id`+`page`; analytics endpoints are not paginated — constrain by date/breakdown | — | Raw Export NDJSON streaming GET (no job/poll); Data Pipelines (paid) for real volume |
| PostHog | **keyset on `timestamp`. `OFFSET` returns HTTP 400 for personal API keys.** | default 100 rows; **50,000 max with explicit `LIMIT`** | `/batch_exports` to S3/BigQuery/Snowflake/Redshift/Postgres. Use `refresh: async` for non-trivial HogQL |
| Salesforce (reports) | **none. 2,000 rows, no pagination.** Check `allData` | 2,000 rows; 100 columns; 20 custom filters | **abandon the report API** — Bulk API 2.0 `query`/`queryAll` against the objects, `Sforce-Locator` header loop, 15 GB/job, results retrievable 7 days |
| HubSpot | `after` cursor on lists; search caps at **10,000 total results regardless of paging** | 100 default / 200 max page size | shard: sort ascending on `hs_lastmodifieddate` or `hs_object_id`, take the last value of each ≤10k page as a `GT` filter. Exports API for bulk |
| Marketo | `nextPageToken`; activities need a paging token minted from a datetime; tokens expire | 300 lead IDs per GET filter | **Bulk Extract is the only viable path above tens of thousands of rows** — create → enqueue → poll → file. Activity extracts capped at **31 days per job** |
| Pardot/MCAE | `nextPageToken` / `nextPageUrl` | concurrency 5 | Export API — **queued and executed sequentially per account**; max 150 fields; **collection fields cannot be exported at all**; data expires after 7 days; **record order across files is not guaranteed** |
| Braze | no cursor on `data_series` | **`length` 1–100 — a 100-day hard window per call**, `ending_at` inclusive | `/users/export/segment` writes to **your own** S3/Azure/GCS bucket (not an HTTP body); Currents for event streams |
| Iterable | `startAfter` on export files | 10 MB per file, 100 GB per job | `POST /api/export/start` → poll → `get_export_files`. **Files arrive progressively — a complete-looking mid-job response is not the full list** |
| Klaviyo | cursor paging on `/events`, `/profiles` | — | **none.** No bulk export API. Paginate under the rate limits or use a warehouse connector |
| Looker | pagination is **query-level** (`limit`/`offset` in the query body), not transport-level; metadata lists support `limit`/`offset` | download capped by the admin "max rows to download" setting | `create_query_task` async, or a scheduled plan writing to GCS/S3 |
| Tableau | REST `pageSize` (max 1000) + `pageNumber`; Metadata API max page 1,000 with a **20,000-node limit returning partial results** | post-2026.1 VDS **streams and the 1 GB cap is removed** — an unbounded query can flood the agent | always set `rowLimit`; or read the warehouse directly using the lineage |
| Power BI | most REST list endpoints return everything unpaged; Admin scanner uses `continuationToken` | `executeQueries`: **100,000 rows / 1,000,000 values**, not tunable | Arrow DAX endpoint (Premium/Fabric only, binary Arrow streams); or read the Lakehouse directly |
| Snowflake | **result partitions** — first response carries partition 0 plus `resultSetMetaData.partitionInfo[]`; fetch `?partition=N`. Partitions are **~fixed-size chunks, not fixed row counts** | none | `async=true` → handle → poll; `COPY INTO <stage>` for very large pulls |
| BigQuery | `pageToken` + `maxResults`; **max ~10 MB per response** | 10 GB compressed result without a destination table | **Storage Read API** (gRPC, Arrow/Avro, parallel sessions) for millions of rows; `EXPORT DATA` to GCS |
| Cube | `limit` / `offset`, default limit 10,000 | — | SQL API or a pre-aggregation export |
| Segment | cursor (`pagination.next`), `pagination.count` capped per endpoint | — | **no bulk event export via the Public API** — the warehouse connector or Data Lakes |
| RudderStack | aggregated server-side, cheap | — | **no bulk event export by design** — the warehouse *is* the export |

## The cap-hit rule

**Where a cap was hit, the figure is a `lower_bound`, never a count.**

This is not a stylistic preference. "2,000 opportunities" and "at least 2,000
opportunities" lead to different decisions, and the first one is false.

Record on every extraction:

```json
"row_coverage": { "returned": 2000, "total_if_known": null, "capped": true }
```

`total_if_known` is populated where the platform tells you: GA4's `rowCount`,
HubSpot's `total` up to its ceiling, Snowflake's partition metadata. Where it is
null and `capped` is true, the answer is a lower bound and `answer-contract`
types it as such.

## Unrolling discipline

When an agent paginates, it must do so in a bounded, visible way.

1. **A fixed, visible number of stages.** Decide the page cap before starting:
   "up to 20 pages of 1,000". Not "until done", which on a cursor API with a
   moving dataset can be never.
2. **Dedupe by resource ID.** Cursor pagination over a live dataset can return
   the same record twice when rows shift between pages. Deduplication is not
   optional on any cursor-based extraction.
3. **Cap exhaustion is a reportable state, not an error.** Reaching stage 20 of
   20 ends the extraction and produces a `lower_bound`. It does not produce a
   failure and it does not trigger a retry.
4. **Never resume a stale cursor across runs.** Meta run IDs expire after 30
   days; other cursors silently point into a dataset that has changed. Restart or
   use keyset on a stable ordered key.
5. **Sort on a stable key with a tiebreaker.** Sorting on a timestamp alone
   loops forever when many records share a timestamp. Add an ID as a secondary
   key.

## Choosing the bulk path instead

Paginating is often the wrong answer. Switch to bulk when:

| Signal | Switch to |
|---|---|
| more than a few thousand rows on a token-costed API | the vendor's export or warehouse path |
| the report API caps below what you need | the object API or the bulk API |
| the extraction repeats on a schedule | a scheduled export or a warehouse connector |
| you need event-level rather than aggregate data | the event export, which usually has no sampling or thresholding |
| pagination would exhaust the rate budget | see `rate-limit-governor`; the budget makes the decision |

The specific escape hatches are in the register above. Two are worth stating
outright because the API route is a dead end rather than a slow one:

- **Salesforce reports over 2,000 rows: abandon the report API.** Query the
  objects through the bulk API. There is no pagination to add.
- **LinkedIn `adAnalytics` over 15,000 elements: there is no bulk path at all.**
  Slice the request by date range or facet in your own loop and stitch locally.
  No async, no CSV export, nothing.

## Calls

- Called by every platform module
- Feeds `provenance-block` with `row_coverage`
- Feeds `answer-contract` with the `lower_bound` type when a cap was hit
- Works with `rate-limit-governor`, which prices the page count before it runs
- Works with `warning-field-reader`, which detects the cap flags in the response

## References

- `references/per-platform.md` — the register expanded with request shapes and loop skeletons
- `references/bulk-paths.md` — when to abandon pagination, and the export path per platform
