# The async job path, the required retry, and reading the throttle headers

## Use async by default

Meta's async insights path is well built and should be the default for anything beyond a
trivial slice.

```
POST /v{version}/{object-id}/insights          → {"report_run_id": "..."}
GET  /v{version}/{report_run_id}               → async_status, async_percent_completion
GET  /v{version}/{report_run_id}/insights      → rows, with cursor pagination
```

**`async_status` values:** Not Started, Job Started, Job Running, **Job Completed**, Job
Failed, **Job Skipped**.

Two of these are easy to mishandle:

- **Job Skipped** is a terminal state, not a pause. Do not poll it forever.
- **Job Failed** needs the error read before retrying; a blind retry of a query that
  exceeded the row ceiling fails identically.

**An `AdReportRun` is an ephemeral job handle that expires after 30 days.** It is not a
report artifact and nothing about it appears in Ads Manager.

## The required retry: error 100, subcode 1487534

**There is no published hard row cap.** Meta rejects based on the number of response rows
**and** the data points needed to compute totals, returning **error code 100, subcode
1487534**.

**Auto-splitting on that specific error is a required retry strategy, not an optional
one.**

```python
def fetch_insights(client, obj_id, params, depth=0):
    """Split the request on error 100 / subcode 1487534 rather than reporting failure."""
    try:
        return client.async_insights(obj_id, params)
    except MetaAPIError as e:
        if not (e.code == 100 and e.subcode == 1487534) or depth > 4:
            raise
        # 1) halve the date range; 2) if already narrow, drop to a finer object level
        halves = split_time_range(params["time_range"])
        if halves:
            return [r for h in halves
                    for r in fetch_insights(client, obj_id, {**params, "time_range": h},
                                            depth + 1)]
        return fetch_by_child_objects(client, obj_id, params, depth + 1)
```

An agent that reports "the query failed" on subcode 1487534 has skipped documented
handling, not hit a platform limit.

## Distinguish your throttling from Meta's

Two different error shapes, two different responses:

| Signal | Meaning | What to do |
|---|---|---|
| **`x-fb-ads-insights-throttle`** approaching 100% | **your** utilisation | slow down, narrow queries |
| **error code 4, subcode 1504022** | **Meta's global load shedding** | **retryable, not your fault** — back off and retry; do not redesign the query |

Confusing the second for the first leads to an agent rewriting a perfectly good query in
response to a platform-side event.

## Reading the throttle header

**`x-fb-ads-insights-throttle`** is a JSON object carrying:

- **`app_id_util_pct`** — utilisation attributed to your app
- **`acc_id_util_pct`** — utilisation attributed to this ad account
- **`ads_api_access_tier`** — which tier governs your ceiling

```python
import json

def read_throttle(response):
    raw = response.headers.get("x-fb-ads-insights-throttle")
    if not raw:
        return None
    t = json.loads(raw)
    return {
        "app_pct": t.get("app_id_util_pct"),
        "acct_pct": t.get("acc_id_util_pct"),
        "tier": t.get("ads_api_access_tier"),
    }
```

**Throttling is utilisation-based, not a request count**, so counting your own requests
tells you nothing useful. Read the header on every response and back off as either
percentage approaches 100.

**Non-insights Marketing API calls carry a different header —
`X-Business-Use-Case-Usage`.** If you are mixing entity reads with insights reads, you are
consuming two budgets and must watch both.

## Cursor pagination has no random access

Paging is `paging.cursors.after` and `paging.next`. There is **no offset and no random
access**, so:

- you cannot skip to page 10
- you cannot resume a partially-consumed result set from a stored page number — store the
  **cursor**, not an index
- a long extraction that dies mid-way restarts from its last cursor, or from the beginning

## Retention, which decides whether the query is possible at all

Check before promising a long time series:

| Data | Retention |
|---|---|
| Unique-count fields (`unique_actions`, `cost_per_unique_action_type`) | **13 months** |
| `hourly_stats_aggregated_by_advertiser_time_zone` | **13 months** |
| `breakdowns=frequency_value` | **6 months** |
| Plain aggregate totals | up to 37 months |
| MMM breakdowns | **async-only**; synchronous access removed |

Announced 2025-10-13, effective 2026-01-12. **The research flagged medium confidence here —
verify against Meta's changelog before committing to a multi-year plan.** A year-over-year
frequency analysis is impossible at 6 months of retention, and that is a planning
conversation, not a query error.
