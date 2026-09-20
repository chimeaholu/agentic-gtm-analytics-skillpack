---
name: rate-limit-governor
description: Use before issuing any sequence of GTM platform queries, and whenever an analysis might require more than two or three calls to one platform. Computes the query budget against the platform's actual limit model — token-based (GA4), cost-based (Amplitude), fixed-hourly-and-uncontestable (Mixpanel 60/hr, Klaviyo 2/min + 225/day, Iterable 10/min), shared-across-all-integrations (Marketo), concurrency-capped (Pardot 5) — and rewrites an iterate-per-entity plan into one batched query. Prevents an exploratory agent exhausting an account's daily budget in one conversation, and prevents tripping limits that break other teams' integrations.
---

# Rate limit governor

Plan the budget before the first call. An exploratory agent that discovers the
limit by hitting it has already spent someone else's day.

Output is one of: an approved plan with an estimated cost, a rewritten batched
plan, or a refusal naming the narrowing that would fit. Plus a runtime back-off
policy.

## The five limit models

Learn the **models**, not the numbers. The numbers move between revisions; the
models do not. Every number below is a checkpoint to verify against the current
documentation for your API revision, not a constant.

### 1. Token / complexity-based — GA4

A wide report burns far more than a narrow one, so **"requests per day" is not a
usable planning number**. Dimensions, date ranges and row counts all multiply
the cost of a single request.

- Set **`returnPropertyQuota: true` on every request** and read the
  `PropertyQuota` object back. This is the only reliable self-throttling signal
  the platform offers. Make it non-optional in the client.
- Standard property buckets: 200,000 core tokens per property per day, 40,000
  per hour, 14,000 per project per property per hour, 10 concurrent requests,
  10 server errors per hour, and **120 potentially-thresholded requests per
  hour**. Analytics 360 is roughly ten times each, except thresholded requests,
  which stay at 120. Realtime and Funnel have separate buckets of the same shape.
- **The thresholded bucket is the one that bites.** An agent looping demographic
  or interest breakdowns exhausts 120 an hour long before it touches the token
  ceiling, and the failure arrives as a quota error on a query that looks cheap.

Planning rule: issue one probe request, read the consumption, extrapolate.
Do not estimate from request count.

### 2. Cost-model — Amplitude

The cost of a query is computed from its shape:

```
cost = days × conditions × query_type_cost

query_type_cost:  retention 8 · funnel (2 × events) + (4 per group-by) · sessions 4
```

Limits: concurrent cost 1,000 per 5 minutes; hourly 108,000.

**The worked example every agent needs before it plans:**

```
90-day retention query with 3 segments
  = 90 days × 3 conditions × 8 (retention)
  = 2,160
```

2,160 against a 1,000 concurrent limit. **That single query exceeds the
five-minute budget on its own.** It must be split by date range, or the segment
count reduced, or both. An agent that issues three of these in parallel is not
slow, it is blocked.

Planning rule: compute the cost before issuing. If a single query exceeds the
concurrent limit, splitting is not an optimisation, it is the only way the query
runs.

### 3. Hard and unraisable

No negotiation, no tier upgrade, no support ticket.

| Platform | Limit | Consequence |
|---|---|---|
| **Mixpanel Query API** | 5 concurrent, **60 queries per hour, cannot be raised** | an exploratory agent exhausts an hour in minutes. One query per minute, average, for the whole hour |
| **Klaviyo campaign-values report** | burst 1/s, steady **2/min**, **225/day** | 225 reports a day total, for everyone using that account. Forty campaigns queried individually is 40 of them |
| **Iterable `/api/campaigns/metrics`** | **10/min per project**, and **it is the only campaign-performance endpoint there is** | there is no alternative surface to fall back to |

Planning rule: for these three, compute total calls before starting and compare
against the whole-period budget, not the per-minute one. If the plan needs 40
calls from a 225-per-day budget shared with production integrations, say so
before spending it.

### 4. Shared-instance — Marketo

100 calls per 20 seconds **across all integrations on the instance**. 50,000 per
day, resetting at **midnight CST**. 10 concurrent.

- Your agent shares this budget with the customer's ETL, their CRM sync, their
  enrichment vendor and every other tool connected to that instance.
- **Expect 606 errors you did not cause.** A 606 is not evidence your code is
  wrong.
- Throttle to well under the ceiling, not to it.
- **This is a political problem as much as a technical one.** Exhausting the
  daily quota breaks other teams' integrations, and they will not know it was
  you. Surface that to the user before a large extraction, not after.

### 5. Cost-is-the-rate-limit — BigQuery, Snowflake

No useful request throttle. **The failure mode is an invoice**, and it arrives at
the end of the month with no error in between. See the cost guardrails section.

## Batch, don't iterate

A hard design rule, not an optimisation. One wide query with a `group_by` beats
forty narrow ones, on every platform, without exception.

| Platform | The iterate-per-entity trap | The batched rewrite |
|---|---|---|
| Klaviyo | one values-report per campaign | one report grouped by campaign. Forty calls become one |
| Iterable | one metrics call per campaign | **multiple campaign IDs per call**, which the endpoint accepts |
| Mixpanel | several filtered segmentation queries | one segmentation query with the filters as breakdowns. This is Mixpanel's own documented guidance |
| Google Ads | a per-campaign loop | one wide `SELECT` in one GAQL statement with the segment in the select list |
| GA4 | one report per dimension value | one report with the dimension included |
| Warehouse | one query per entity | one query with a `GROUP BY`. If this needs saying, the agent is treating SQL like an API |

The shape to recognise: **any plan whose call count scales with entity count is
the wrong plan.** Rewrite it so the call count scales with query count, which is
usually one.

## Read the header where the header exists

| Platform | Headers | Notes |
|---|---|---|
| Braze | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` | **lowercase under HTTP/2.** Resets on the clock hour, not a rolling window, so a burst at :59 and another at :01 both succeed |
| Klaviyo | `RateLimit-*` | **replaced by `Retry-After` on a 429** — you lose visibility exactly when you need it. Track the steady window proactively |
| Segment | `X-RateLimit-Consumed`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` | straightforward |
| Meta | `x-fb-ads-insights-throttle` with `app_id_util_pct`, `acc_id_util_pct`, `ads_api_access_tier` | utilisation percentages. Back off approaching 100 |
| GA4 | `PropertyQuota` in the body, not a header | requires `returnPropertyQuota: true` |
| Google Ads | none useful | **paginated follow-ups do not count against the daily operation quota**, which changes the arithmetic of a large extract |

**Where the platform returns no headers at all — Iterable, Snowflake — model the
limit client-side from the documentation. This is mandatory, not optional.** The
only signal Iterable gives is the 429 itself, which arrives after the damage.

## Cost guardrails for warehouses

Mandatory pre-flight. Not advice.

### BigQuery

1. **Dry-run every generated query.** `dryRun: true` returns
   `totalBytesProcessed` and is free.
2. **Set `maximumBytesBilled` on every job.** If the estimate exceeds it, the
   query fails **with no charge**. This is the single most effective guardrail
   available.
3. **Give the agent its own service account**, so per-user custom quotas bind it
   rather than binding the whole project. Daily custom quotas reset at midnight
   **US Pacific**.
4. Prefer partitioned and clustered tables, and `require_partition_filter` on
   large tables so an unfiltered scan errors instead of billing.
5. **Caveat: a dry run returns 0 bytes on row-level-security-protected tables,
   deliberately, to block a side channel. 0 is not "safe".** Do not size a query
   from a 0 estimate on an RLS table.

### Snowflake

1. A **dedicated small warehouse** for the agent, with `AUTO_SUSPEND = 60`.
2. `STATEMENT_TIMEOUT_IN_SECONDS` set on the agent's role or warehouse.
3. A **resource monitor with a hard `SUSPEND` trigger**, not just a notify
   trigger. A notification does not stop a runaway query.
4. Always `LIMIT` exploratory queries.
5. `SAMPLE` for profiling rather than full scans.

## Org-wide blast radius

Some limits are not yours to spend.

- **PostHog limits apply organization-wide across all team members.** An agent
  hammering the API degrades the experience of the humans using the product.
  Surface this to the user before a wide scan.
- PostHog free plans also carry a **monthly data-read cap** distinct from rate
  limits. Warn before a wide historical scan; the cap is monthly and unforgiving.
- **Marketo's quota is shared across every integration on the instance.** See
  model 4.
- Klaviyo's 225-per-day report budget is the account's, not the session's.

The disclosure sentence to use: "This extraction will use roughly N of the
account's daily budget of M, which is shared with your other integrations.
Proceed?"

## Back-off discipline

1. **Exponential with jitter.** Without jitter, parallel workers retry in
   lockstep and re-trip the limit together.
2. **Never retry before `Retry-After` elapses.** Retrying early on a 429 extends
   the penalty on several platforms.
3. **Distinguish retryable load-shedding from your own fault.** Meta's error 4 /
   subcode 1504022 is platform-side load shedding: retry it. Meta's 100 / 1487534
   is a request that is too large: **split it and retry differently**, because
   retrying it unchanged will fail identically forever.
4. **One-retry gates with explicit stop conditions.** Never retry the same
   unchanged request indefinitely. Three failed attempts at the same fact ends
   that leg as `unavailable` per `answer-contract`.
5. **A budget-limited result is `partial`, not an error.** Return what was
   retrieved, name what was not, and state the direction of the gap.

## The plan output

```json
{
  "platform": "…",
  "call_count": 3,
  "estimated_cost": {"unit": "amplitude_cost_units", "value": 720},
  "budget_share": "72% of the 5-minute concurrent limit",
  "verdict": "approved | rewritten | refused",
  "rewrite_note": "split 90-day retention into 3 × 30-day, costs 720 each",
  "backoff": {"base_ms": 1000, "max_attempts": 4, "jitter": true, "honour_retry_after": true},
  "blast_radius_note": "organization-wide limit; other users share it"
}
```

## Calls

- Called by every platform module **before execution**
- Feeds `answer-contract`: a budget-limited partial is a `partial` result, not a
  failure
- Works with `pagination-patterns`, which determines how many calls a full
  extraction needs in the first place

## References

- `references/limit-models.md` — every platform's limit model with the planning arithmetic
- `references/cost-guardrails.md` — the warehouse guardrail setup, in full
