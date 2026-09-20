# Klaviyo rate budget, and the query shape it forces

Klaviyo's tier table describes the account's general limits. **The reporting endpoints sit
far below the table and carry a daily cap the table does not mention.** Plan against the
per-endpoint limits in the API reference, not against the tier.

## The limits that bind

| Bucket | Burst | Steady | Daily |
|---|---|---|---|
| Account tier XS (general) | 1/s | 15/min | — |
| Account tier XL (general) | 350/s | 3,500/min | — |
| **`/api/campaign-values-reports/`** | **1/s** | **2/min** | **225/day** |

Two simultaneous fixed windows apply — a one-second burst window and a one-minute steady
window — so a burst that fits the second may still breach the minute.

**225 per day means a report call costs roughly 0.44% of the day's reporting budget.** A
loop over 40 campaigns costs 18%. Four such loops and the account is done for the day,
including for the humans and other integrations sharing a private-key quota.

## The additive query-parameter buckets

This is the counter-intuitive one. **`include=` and `additional-fields[...]` consume
separate, additive, *global* budgets.**

Klaviyo's own example shows a single request costing **three** calls against **three**
buckets — the endpoint bucket, the `include` bucket and the `additional-fields` bucket —
and **those buckets are global across endpoints**, not scoped to the endpoint you called.

So the usual LLM instinct is exactly wrong here:

| Instinct | Cost | Better |
|---|---|---|
| "Fetch the campaign and include its tags and template in one call to be efficient" | 3 buckets | Fetch the campaign lean; fetch tags once for all campaigns; join locally |

**Fetch lean, join locally.** Always.

## OAuth versus private key is a capacity decision

**OAuth apps get their own rate-limit quota per installed app instance. Private-key
integrations all share one quota per account.**

On an account that already runs a reverse-ETL sync, an ecommerce integration and a
consultant's script, a new private-key agent is competing with all of them for one bucket.
On such an account, OAuth is not a distribution nicety — it is the difference between a
working agent and a starved one. Raise it at auth setup, not after the first 429.

## The one-wide-query pattern

**Wrong — 40 calls, 18% of the daily budget, and it takes 20 minutes at 2/min:**

```
POST /api/campaign-values-reports/  (filter: campaign_id == A)
POST /api/campaign-values-reports/  (filter: campaign_id == B)
...
```

**Right — 1 call:**

```json
{
  "data": {
    "type": "campaign-values-report",
    "attributes": {
      "timeframe": {"key": "last_30_days"},
      "conversion_metric_id": "<resolved metric id>",
      "statistics": ["recipients", "delivered", "open_rate", "click_rate",
                     "conversions", "conversion_value"],
      "group_by": ["send_channel"]
    }
  }
}
```

The values report returns per-campaign rows for the timeframe. Filter and rank **locally**.
`group_by` exists so that one call answers a question that looks like it needs many.

## Rate-limit headers, and when they abandon you

`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` come back on **non-429**
responses and describe the **steady** window. **On a 429 they are replaced by
`Retry-After`.**

So you can see your budget right up until the moment you need to see it. Track consumption
client-side against the published per-endpoint numbers; do not rely on discovering the
ceiling from a failure.

## Caching policy

| Data | Cache for |
|---|---|
| Campaign values, closed period | the session or longer |
| Campaign values, current period | 2–4 hours |
| Flow values | 2–4 hours |
| Metric catalogue (for conversion metric resolution) | the session |

Re-running the same values report twice in one conversation is a budget error.

## There is no bulk export

**There is no async or bulk export API.** Bulk extraction means paginating `/api/events`
and `/api/profiles` under these limits, which on a large account is slow enough to be
impractical.

Say this at planning time: **for raw event history, the honest answer is a warehouse or a
reverse-ETL integration, not the Klaviyo API.** Klaviyo's bulk profile *import* is an
ingest path and does not help. An agent that starts paging events for a large account and
discovers this six hours in has failed a planning step, not an engineering one.
