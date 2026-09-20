# Windows, stitching, timezones and the rate-bucket asymmetry

## The 100-day cap is a window, not a page size

**`length` on `/campaigns/data_series` must be 1 to 100 inclusive.** There is **no
cursor**. Year-over-year analysis means **eight or more stitched calls**, and the stitching
is where the bug lives.

**`ending_at` is inclusive.** Naive chunking therefore double-counts one day at every seam.

```python
from datetime import timedelta

def data_series_windows(start, end, max_len=100):
    """ending_at is INCLUSIVE — advance by max_len days, not max_len - 1, to avoid
    double-counting a day at each seam."""
    cur = start
    while cur <= end:
        window_end = min(cur + timedelta(days=max_len - 1), end)
        yield {"ending_at": window_end.isoformat(),          # with offset — see below
               "length": (window_end - cur).days + 1}
        cur = window_end + timedelta(days=1)                  # step PAST the inclusive end
```

The check that catches the off-by-one: **the sum of `length` across all windows must equal
the number of days in the range.** If it exceeds it, you are double-counting seams.

## `ending_at` needs an offset

**`data_series` days bucket in the *workspace's* configured timezone**, and **`ending_at`
accepts an ISO-8601 datetime with offset.**

**Passing a naive UTC timestamp silently shifts every bucket.** Not one bucket — every
bucket, by the workspace's offset. The series looks entirely plausible and every day is
wrong.

```python
# Wrong — silently shifts every bucket on a non-UTC workspace
params = {"ending_at": "2026-09-20T23:59:59Z", "length": 30}

# Right — the workspace's offset, explicitly
params = {"ending_at": "2026-09-20T23:59:59-04:00", "length": 30}
```

**Get the workspace timezone from the dashboard configuration and record it in the
provenance block.** It is not derivable from the response.

## Multi-workspace orgs cannot be naively summed

**Workspaces are independent, with their own keys and their own timezone settings.**

So two workspaces' `data_series` results for "the same 30 days" may cover different
30-day spans in absolute time. **Summing them produces a total that corresponds to no real
period.**

Handling: query each workspace separately, record each one's timezone, and either
(a) report them separately, or (b) align them explicitly by requesting offset-adjusted
windows and saying that you did.

## The rate-bucket asymmetry — shape the analysis around it

| Endpoint | Bucket |
|---|---|
| **`/campaigns/data_series`** | **50,000 per minute — its own bucket** |
| Shared pool: `/canvas/data_series`, `/canvas/data_summary`, `/segments/data_series`, `/events/data_series`, `/sessions/data_series`, all `/kpi/*`, `/sends/data_series`, list and details endpoints, template and content-block endpoints, `/users/export/segment` | **250,000 per hour, shared** |
| `/events/list` and `/purchases/product_list` | **1,000 per hour combined** |
| `/users/export/ids` | **250/min (onboarded on or after 2024-08-22) or 2,500/min (before)** |
| `/sends/id/create` | 100 per day |

**Campaign data series is cheap. Canvas data series shares the common pool.** An analysis
that can be expressed at campaign level rather than Canvas level costs materially less.

**The 1,000/hour on `/events/list` and `/purchases/product_list` is the one that surprises
people** — enumerating a large product catalogue or a long custom-event list burns through
it fast. Cache those aggressively; they change rarely.

**The `/users/export/ids` two-tier split is invisible from the API.** Code written against
an older workspace rate-limits **ten times sooner** on a newer one, with no signal other
than 429s. Check the workspace onboarding date rather than inferring the limit from
observed behaviour.

## Read the headers rather than modelling the budget

**Every response carries `x-ratelimit-limit`, `x-ratelimit-remaining` and
`x-ratelimit-reset` — lowercase under HTTP/2 — and Braze explicitly designed them for
real-time backoff.**

```python
def remaining(response):
    h = response.headers
    return (int(h.get("x-ratelimit-remaining", 0)),
            int(h.get("x-ratelimit-reset", 0)))
```

**Limits reset on the clock hour, not a rolling window.** You can burn the full allowance
at 10:59 and get a fresh one at 11:00 — which is occasionally useful and frequently
misleading, because an agent that hit a limit at 10:58 and concluded the budget was
exhausted was two minutes from a full reset.

## The 5-minute consistency window

**Braze recommends a 5-minute delay between dependent consecutive endpoint calls.** Normal
eventual consistency is 10 to 100 milliseconds, but they explicitly advise five minutes
when one call depends on another having been processed.

Write-then-read patterns fail intermittently without it — and "intermittently" is the worst
shape, because it passes in testing.

## `/users/export/segment` writes to your bucket, not to the response

**It does not return data to you.** It writes files into **your own S3, Azure or GCS
bucket**, and **the bucket credentials must be configured in Braze in advance.**

An agent expecting an HTTP response body receives a job acknowledgement and concludes the
export was empty. Check the bucket, not the response.

## Bulk means Currents, not REST

For raw event history, **Braze Currents** — a separately-priced real-time event stream to
S3, Snowflake, Redshift, BigQuery or Segment — **is the answer.** Snowflake Data Sharing is
also offered.

Say this at planning time. Reconstructing event-level history by paging `data_series`
endpoints is not possible: they return aggregates, not events.
