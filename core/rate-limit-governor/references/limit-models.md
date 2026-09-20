# Limit models, platform by platform

Every number here is a checkpoint against the documentation at the time of the
underlying research, not a constant. Vendors move these. Re-verify against the
current reference for your API revision before designing a large extraction
around any of them. The **model** is the durable part.

---

## Token / complexity-based

### GA4 Data API

| Bucket | Standard property | Analytics 360 |
|---|---|---|
| Core tokens / property / day | 200,000 | 2,000,000 |
| Core tokens / property / hour | 40,000 | 400,000 |
| Core tokens / project / property / hour | 14,000 | 140,000 |
| Concurrent requests | 10 | 50 |
| Server errors / hour | 10 | 50 |
| **Potentially thresholded requests / hour** | **120** | **120** |

Realtime and Funnel have separate buckets of the same shape.

Planning:

```
1. Set returnPropertyQuota: true. Always. No exceptions.
2. Issue the narrowest representative request first.
3. Read PropertyQuota.tokensPerHour.consumed from the response.
4. Remaining budget / observed consumption = how many more of that shape fit.
5. A wider request costs more. Do not extrapolate a wide report from a narrow probe.
```

The thresholded bucket does not scale with the licence tier. Demographic and
interest breakdowns count against it whether or not any row was actually
suppressed, which is why it is "potentially thresholded". A loop over age
brackets exhausts it in an hour on any property.

---

## Cost-model

### Amplitude

```
cost = days × conditions × query_type_cost
conditions = segments + filters

query_type_cost:
  retention  = 8
  funnel     = 2 × (number of events) + 4 per group-by
  sessions   = 4
```

| Bucket | Limit |
|---|---|
| Concurrent requests | 5 (10 for User Activity / User Search) |
| **Concurrent cost** | **1,000 per 5-minute window** |
| Hourly cost | 108,000 |
| User Activity / User Search | 360 queries per hour, separate bucket |

Worked:

```
90-day retention, 3 segments  = 90 × 3 × 8  = 2,160   → exceeds the 1,000 window alone
30-day retention, 3 segments  = 30 × 3 × 8  =   720   → fits, 72% of the window
30-day funnel, 4 events, 1 group-by, 2 segments
                              = 30 × 2 × (2×4 + 4) = 720  → fits
```

The rewrite for the first case is three 30-day queries issued in series, stitched
locally, at 720 each. Retention stitched across split windows is not identical to
retention computed over the whole window, so say which was done.

Export API is separate: 365-day maximum period, hard 4 GB response, 400 over the
size limit and 504 on very large pulls. The window keys on `server_upload_time`,
not event time, so an export for yesterday includes late events uploaded
yesterday and excludes yesterday's events that arrived today. That is a
reconciliation trap, not a rate limit, but it lands in the same plan.

---

## Hard and unraisable

### Mixpanel

| API | Limit |
|---|---|
| **Query API** | **5 concurrent, 60 queries per hour** |
| Raw Data Export | 100 concurrent, 60 per hour, 3 per second |
| Lexicon Schemas | 5 per minute |

**Mixpanel states these cannot be raised.** Sixty per hour is one per minute,
averaged over the hour, shared with everything else using that project's
credentials.

Mixpanel's own guidance is to consolidate several filtered queries into one
segmentation query. An exploratory conversation ("check that segment, now break
it by platform, now by plan") burns the hour in minutes. For repeated analysis,
export once to a warehouse rather than re-querying.

JQL is retired. Any tutorial or MCP offering a JQL tool is out of date.

### Klaviyo

| Endpoint class | Burst | Steady | Daily |
|---|---|---|---|
| Campaign values report | 1/s | **2/min** | **225/day** |
| Most CRUD endpoints | varies | varies | — |

225 per day is the account's budget, not the session's. Forty campaigns queried
individually is 40 of 225, and the customer's other integrations are drawing on
the same pool.

`RateLimit-*` headers are **replaced by `Retry-After` on a 429**, so visibility
disappears exactly when it matters. Track the steady window client-side.

There is **no bulk export API**. Paginate under the limits or use a warehouse
connector.

### Iterable

`/api/campaigns/metrics`: **10 per minute per project**, and it is the only
campaign-performance endpoint that exists. No alternative surface.

**No rate-limit headers at all.** The only signal is the 429. Model the limit
client-side from the documentation; this is mandatory.

The endpoint accepts **multiple campaign IDs per call**. One call for forty
campaigns instead of forty calls is the difference between four minutes and
working.

---

## Shared-instance

### Marketo

| Bucket | Limit |
|---|---|
| Rate | **100 calls per 20 seconds, across all integrations on the instance** |
| Daily | 50,000, resetting at **midnight CST** |
| Concurrent | 10 |

Errors 606 (rate limit) and 607 (daily quota) are shared-fate. **Expect 606s you
did not cause**, and do not treat one as evidence of a bug in your own client.

Before a large extraction, tell the user: the daily quota is shared with their
ETL, CRM sync and enrichment tools, and exhausting it breaks those silently.
This is a political problem as much as a technical one.

### Pardot / MCAE

Concurrency above 5 returns **error 66**. Serialize.

The Export API is **queued and executed sequentially per account**, so
parallelism gains nothing. Maximum 150 fields, collection fields cannot be
exported at all, data expires after 7 days, and record order across files is not
guaranteed.

---

## Per-account request buckets

### HubSpot

| Tier | Per 10 seconds | Per day |
|---|---|---|
| Free / Starter | 100 per app | 250,000 per account |
| Professional | 190 per app | 625,000 per account |
| Enterprise | 190 per app | 1,000,000 per account |
| With API Limit Increase add-on | 200–250 per app | +1,000,000 per increase, maximum 2 |

- **Keep error responses under 5% of daily requests.** HubSpot treats a high
  error ratio as abuse, independently of the rate.
- **CRM Search is rate-limited separately** from the general bucket, with a
  practical ceiling around 4 to 5 requests per second per account. Build a
  dedicated throttle for search rather than sharing the general one.

### Salesforce

| Bucket | Limit |
|---|---|
| Synchronous report runs | **500 per org per hour**, 20 concurrent |
| Asynchronous report requests | **1,200 per org per hour**, 200 concurrent result fetches |
| Async result retention | 24-hour rolling window |
| Dashboard refreshes | 200 per hour per org |
| Bulk API 2.0 query jobs | 10,000 per rolling 24 hours, ~15 GB per job, results retrievable 7 days |

Sync report runs are subject to the 2-minute overall API timeout; async runs
escape it. A heavy report simply times out synchronously, which reads as a
failure rather than as a size signal.

Org-wide daily API allocations apply on top of all of the above.

### PostHog

| Bucket | Limit |
|---|---|
| Analytics endpoints | 240 per minute, 1,200 per hour |
| **Query endpoint** | **2,400 per hour**, plus a monthly data-read cap on free plans |
| CRUD | 480 per minute, 4,800 per hour |
| Feature flag local evaluation | 600 per minute |

**Limits apply organization-wide across all team members.** Surface that before
a wide scan.

PostHog's own documentation says "the burden of performance falls onto you":
HogQL is not query-planned for you. Bound every generated query on `timestamp`
and prefer materialised views where the project has them. Use `refresh: async`
for anything non-trivial, or the HTTP layer times out before the query finishes.

### Braze

`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, **lowercase
under HTTP/2**. Resets **on the clock hour**, not on a rolling window, so budget
is restored at the top of the hour rather than gradually.

`data_series` endpoints take `length` between 1 and 100, which is a **100-day
hard window per call**, `ending_at` inclusive.

### Segment

`X-RateLimit-Consumed`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Ordinary,
readable, and there is **no bulk event export via the Public API** regardless.

### RudderStack

Aggregated server-side and cheap. Numeric limits are **not published in the
detail other vendors provide**, so model conservatively rather than assuming
generosity. No bulk event export by design; the warehouse is the export.

---

## Cost-is-the-rate-limit

BigQuery and Snowflake have no useful request throttle. The limit is money and
it arrives monthly. See `cost-guardrails.md`.

---

## The planning checklist

```
1. What is this platform's limit MODEL? (token / cost / hard / shared / money)
2. How many calls does the plan need? If it scales with entity count, rewrite it.
3. What fraction of the budget is that, over the relevant period?
4. Is the budget shared with anyone? (org-wide, instance-wide, account-wide)
5. Are there headers? Read them. No headers? Model client-side.
6. What is the back-off policy and the stop condition?
7. If it does not fit: what narrowing WOULD fit? Offer that, do not just refuse.
```
