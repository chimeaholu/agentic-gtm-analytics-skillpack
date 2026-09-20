# `conversion_metric_id` — the input that redefines every revenue number

This is the highest-consequence parameter in the Klaviyo reporting API and the one most
likely to produce two contradictory, confident, unreconcilable answers from two agents
looking at the same campaign.

## What it is

`conversion_metric_id` is **required** on the values and series reporting endpoints. It is
**not a filter.** It is the definition of the word "converted" for the entire response.

Every one of these statistics is computed *relative to it*:

- `conversions`
- `conversion_value`
- `conversion_rate`
- `revenue_per_recipient`
- `average_order_value`

Change the metric and all of them change. Nothing in the response says which metric
produced them.

## Why it produces contradictory answers

| `conversion_metric_id` points at | What "conversion value" means |
|---|---|
| **Placed Order** | revenue from completed orders attributed to the message |
| **Checkout Started** | value of carts that reached checkout, most of which never paid |
| **Started Checkout** on a different integration | a different population again |
| a custom metric | whatever the account defined |

All four are valid. All four look identical in the response shape. A campaign reported at
one figure by one agent and a much larger figure by another is usually this, not a bug.

## The discipline, in three steps

**1. Resolve the metric ID explicitly at the start of any reporting work.**

```bash
curl -s "https://a.klaviyo.com/api/metrics/" \
  -H "Authorization: Klaviyo-API-Key $KLAVIYO_PRIVATE_KEY" \
  -H "revision: 2026-07-15" \
  -H "accept: application/vnd.api+json"
```

Find the metric whose `attributes.name` matches what the business means by a conversion —
usually "Placed Order" for ecommerce. Take its `id`.

**2. Log it alongside the report request.** The pair (report, metric id, metric name) is
the unit of reproducibility.

**3. Print it in the output.** Every answer that quotes Klaviyo revenue names the
conversion metric that produced it:

> "Campaign revenue over the last 30 days was X, attributed on the **Placed Order** metric.
> On **Checkout Started** the same campaign shows a different, larger figure, because that
> metric counts carts rather than paid orders."

That sentence prevents the entire class of dispute.

## Ask, do not guess

When the business meaning is ambiguous — a subscription product with a trial, a marketplace
with two order events, an account with three near-identical custom metrics — **ask which
one counts.** This is a question that unblocks progress, so it is worth asking rather than
defaulting.

If the user cannot answer immediately, run the report on the most conservative metric
(usually the one closest to money actually received), state that choice, and offer the
alternative.

## The retroactive twist

**Revenue attribution is governed by the account's attribution settings, and those settings
are retroactive.** If someone changes the attribution window, **every historical report
changes** — a number published last month will not reproduce, and the conversion metric was
not what changed.

Two consequences:

- **Snapshot report outputs** when reproducibility matters. The API is not a stable archive
  of what you reported.
- When a past number will not reproduce, check the attribution settings before checking
  anything else.

## Blank is not zero

A well-formed response with empty `data` occurs when:

- the filter matched nothing
- **the conversion metric does not apply to that campaign**
- the timeframe predates the campaign

**There is no "0 rows because X" signal.** Validate that the campaign or flow ID exists,
and that the metric applies, before reporting zero performance. A campaign reported as
having converted nobody, when the real cause was a mismatched conversion metric, is the
worst available outcome here.
