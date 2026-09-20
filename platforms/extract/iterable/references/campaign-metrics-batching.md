# 10 per minute, no headers — the architecture that follows

**`GET /api/campaigns/metrics` is capped at 10 requests per minute per project, and it is
the only campaign-performance endpoint there is.** Everything about how you build against
Iterable follows from that one number.

## Batch the IDs — that is the design

The endpoint **accepts multiple campaign IDs per call.** This is not an optimisation; it is
the intended usage.

**Wrong — 50 campaigns, 5 minutes of wall clock, and the whole minute budget gone
repeatedly:**

```
GET /api/campaigns/metrics?campaignId=1&startDateTime=...&endDateTime=...
GET /api/campaigns/metrics?campaignId=2&...
...
```

**Right — 1 call:**

```
GET /api/campaigns/metrics?campaignId=1&campaignId=2&campaignId=3&...&campaignId=50
   &startDateTime=2026-09-01&endDateTime=2026-09-30
```

The response is **CSV, one row per campaign**, carrying `bounces`, `clicks`, `conversions`,
`opens`, `purchases`, `pushBounces`, `pushOpens`, `pushSent`, `pushUninstalls`, `revenue`,
`sent`, `smsBounces`, `smsReceived`, `smsSent`, `spams`, `totalClicks`, `totalOpens`,
`totalPushOpens` and `unsubs`.

Filter, rank and aggregate **locally**.

## Narrow the date window

**The endpoint requires a date range, and Iterable's own documentation warns to always use
the narrowest window possible.** The MCP's tool description carries the same warning.

Treat it as a cost instruction. A query for "this month" over fifty campaigns is
substantially cheaper than a query for "this year" over the same fifty, and most questions
only need the former.

## Model the budget client-side — there are no headers

**Iterable returns no `X-RateLimit-*` or RFC 9238 `RateLimit-*` headers at all.** You
cannot read remaining budget. **You discover the limit by receiving a 429 with
`Retry-After`.**

So client-side rate modelling from the published numbers is **mandatory, not optional**:

```python
class ProjectRateBudget:
    """No rate-limit headers exist. Model the published limit locally."""
    def __init__(self, per_minute=10):
        self.per_minute = per_minute
        self.calls = deque()

    def acquire(self):
        now = time.monotonic()
        while self.calls and now - self.calls[0] > 60:
            self.calls.popleft()
        if len(self.calls) >= self.per_minute:
            sleep_for = 60 - (now - self.calls[0]) + 0.1
            time.sleep(sleep_for)
            return self.acquire()
        self.calls.append(time.monotonic())
```

And still handle 429 with `Retry-After`, because the model can be wrong — a second
integration on the same project consumes the same budget.

## Scope, which is easy to misread

**Each endpoint declares whether its limit is counted per project, per API key or per
organization, inside the operation description in the Swagger contract. There is no single
global number, and there is no one limits page.**

| Endpoint | Limit | Scope |
|---|---|---|
| **`GET /api/campaigns/metrics`** | **10/minute** | **per project** |
| `GET /api/campaigns` | 100/second | per project |
| `/api/export/data.csv` / `.json` | 4/minute | per project |
| **`POST /api/export/start`** | **1/second** | **per organization** |
| `DELETE /api/export/{jobId}` | 1/second | per project |
| `/api/users/getFields`, `/api/lists/getUsers` | 3/second | per project |
| `POST /api/campaigns/archive` | 5/second | per API key |

**Three different blast radii in one API.** The per-organization one is the dangerous
entry: **a second team's export job consumes your budget**, and nothing you control fixes
it.

## Cache hard

Campaign metrics for a closed period do not change meaningfully.

| Window | Cache for |
|---|---|
| Current day | 15–30 minutes, labelled provisional |
| Yesterday | a few hours |
| Closed weeks and months | the session, or longer |
| Campaign metadata (`/api/campaigns`) | the session — it is 100/second, but there is no reason to re-fetch |

Re-requesting the same campaign metrics twice in one conversation costs 20% of a minute's
budget for nothing.

## Experiments: email only

**`/api/experiments/metrics` supports email experiments only.** Push, SMS and in-app A/B
tests **have no metrics endpoint at all.**

For a multichannel programme, say that plainly rather than implying parity. The honest
answer to "how did the push test do" is that Iterable exposes no experiment metrics for
push — not a zero, and not a silence.

## The query-string deadline, which degrades rather than breaks

**From 2025-11-10, API calls passing the key in the query string or request body are
subject to stricter rate limiting.**

Inherited code doing `?api_key=` **keeps working, just slower and less predictably**, which
makes it much harder to diagnose than an outright rejection. On any inherited integration
showing unexplained throttling, **grep for `api_key=` before investigating anything else**
and migrate it to the `Api-Key` header.
