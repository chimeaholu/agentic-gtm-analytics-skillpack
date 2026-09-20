---
name: ecommerce-analytics
description: Use for ecommerce and DTC performance analysis — revenue, orders, AOV, conversion rate, basket composition, cart and checkout abandonment, product and category performance. States which of the five defensible AOV definitions it used, treats returns and discounts as first-class terms rather than omissions, and handles the fact that conversion rate is session-denominated while sessions are a constructed concept. Prevents a site-wide conversion rate moving because the new/returning mix shifted rather than because anything improved.
---

# Ecommerce analytics

Three structural facts govern almost every wrong number in DTC reporting.
**AOV has five defensible definitions** that differ by a quarter on the same
data. **Conversion rate divides by sessions, and a session is something the
analytics tool invented.** And **returns and discounts are omitted by default**
from the numbers that decide whether the business is profitable.

## The five AOVs

```
1. Gross AOV            = gross order value ÷ orders
2. Net of discounts     = (gross − discounts) ÷ orders
3. Net of returns       = (gross − discounts − refunds) ÷ orders
4. ± shipping revenue   = any of the above, including or excluding shipping charged
5. ± tax                = any of the above, including or excluding tax collected
```

- **Grain:** order. Not line item — see the grain section below.
- **Denominator:** orders in the window. Which orders is itself a choice:
  placed, paid, fulfilled, or net of cancellations.
- **These differ by 25% or more on the same data**, and discounts and returns
  are the usual omissions.
- **Mean AOV misleads on a skewed basket distribution. Report the median
  alongside**, and where the two diverge sharply, say so — a mean pulled up by
  a handful of large orders is not the typical basket.

**Say which one you used, every time.** An AOV with no definition attached
cannot be compared to last quarter's AOV, to a benchmark, or to the number in
someone else's deck.

Tax deserves a separate note: whether tax is in revenue at all is an accounting
decision the platform made, and it varies by region and by platform
configuration. Check before comparing across markets.

## Conversion rate, and what a session is

```
Conversion rate = orders ÷ sessions
```

- **Grain:** session.
- **Denominator:** sessions in the window, **as the analytics tool constructs
  them** — which is a rules decision, not an observation.

Four consequences:

1. **The rate changes when sessionization changes.** Timeout length, the
   campaign-change rule that starts a new session, and how the tool handles
   midnight boundaries all move the denominator with no change in behaviour.
2. **Bot traffic sits in the denominator.** Filtered imperfectly, and the
   filtering changes over time.
3. **Site-wide CR blends new and returning visitors, which differ several-fold**
   (commonly 3–5× in DTC). **A mix shift looks exactly like a performance
   change.** Split the rate, always, and decompose before narrating.
4. **The order side and the session side usually come from different systems.**
   Orders from the commerce platform, sessions from the analytics tool, with
   different timezones, different day boundaries and different definitions of a
   completed order. The ratio inherits both.

**Decompose before narrating**, using the mix/rate arithmetic from
`funnel-conversion-analysis`:

```
mix effect  = Σ_s (w_s1 − w_s0) · r_s0
rate effect = Σ_s w_s0 · (r_s1 − r_s0)
interaction = Σ_s (w_s1 − w_s0) · (r_s1 − r_s0)
```

over new/returning first, then device, then channel.

## Cart and checkout abandonment

```
Cart abandonment     = 1 − (orders ÷ carts created)
Checkout abandonment = 1 − (orders ÷ checkouts initiated)
```

- **Grain:** session or cart, depending on the tool.
- **Every platform defines "cart created" and "checkout initiated"
  differently.** Adding an item, viewing the cart page, a cart object being
  written server-side, or a client-side event firing — these are four different
  denominators and they produce four different abandonment rates.
- **The number is therefore not comparable across tools** without normalising
  the event definition first. Two tools reporting 68% and 79% abandonment on
  the same store are usually both right about different denominators.
- **Report the event definition with the number.** A funnel from cart → checkout
  → payment → order, with each step's event named, is more useful than a single
  abandonment percentage.

## Returns, refunds and contribution margin

**Returns run 10–30% in some categories and are the single most commonly
omitted term in DTC margin.**

```
Gross revenue        = order value as placed
Net revenue          = gross − discounts − refunds − cancellations
CM1                  = net revenue − COGS
CM2                  = CM1 − fulfilment − shipping cost − payment processing
CM3                  = CM2 − variable marketing
```

- **State the CM level.** The boundary is contested: CM2 stops before ad spend,
  CM3 includes it. A margin quoted without its level cannot be used for a
  break-even calculation.
- **Report gross and returns-adjusted side by side.** Gross is what the revenue
  report says; returns-adjusted is what the business earned.
- **Returns lag.** A return window of 30–90 days means the current period's
  return rate is understated and will rise. Treat recent-period return rates as
  **lower bounds**, and compute the return rate on a **cohort of orders aged
  past the return window** when you need the real figure.

```
Return rate (cohort) = refunded value from orders placed in cohort
                       ÷ gross value of orders placed in cohort
                       — computed only on cohorts aged past the return window
```

The naive version — refunds issued this month ÷ orders placed this month — is a
ratio of two unrelated populations and is wrong in a direction that depends on
growth: in a growing business it understates returns, in a shrinking one it
overstates them.

## Grain: a line-item table is not an order table

This is where double counting starts.

| Question | Correct grain | What goes wrong at the other grain |
|---|---|---|
| Orders, AOV | order | summing line items counts one order many times |
| Units, product mix | line item | counting orders undercounts units |
| Revenue | either, **consistently** | mixing them inflates or deflates by the average basket size |
| Discounts | order **and** line item exist separately | order-level discounts allocated to lines by a rule you must declare |
| Returns | line item, usually | a partial return is not a cancelled order |

**Joining an order table to a line-item table fans out.** Any aggregate computed
after that join double-counts order-level values (shipping, order discount,
order-level tax) once per line. Aggregate each grain separately and join the
aggregates (`calculation-integrity-audit` §3).

**Product and category analysis needs the catalogue joined at the line-item
grain**, and a product that changed category mid-window belongs to two
categories over the period. Declare whether the category is as-of-order or
as-of-today — the two give different category rankings.

## Incomplete periods, always marked

**The last bar on every trend is short.** Plus two ecommerce-specific settling
effects:

- **Returns settle over the return window**, so recent periods' net revenue is
  overstated.
- **Payment capture and fraud review** move orders between statuses for days,
  so very recent order counts move.

Mark the incomplete period; do not drop it.

## Answering

> **AOV was 78.40 last quarter, net of discounts and excluding shipping and
> tax.**
>
> Gross AOV — before discounts — is 89.10, and net of returns it is 71.20. Which
> one matters depends on the question: for a promotional decision use the
> discounted figure, for margin use the returns-adjusted one. The median basket
> is 61, well below the mean, so a minority of large orders is pulling the
> average up and the typical customer's experience is closer to 61.
>
> Returns are the weak number here. The quarter's return rate reads 9.4%, but
> the return window is 60 days and half the quarter's orders are still inside
> it, so 9.4% is a floor. On the last fully-aged cohort the rate was 14.1%,
> which is the figure to plan on.
>
> Site conversion rate moved from 2.31% to 2.09%. Decomposed, that is almost
> entirely mix: returning-visitor share fell from 34% to 27% after the retention
> email pause, and returning visitors convert at roughly four times new. Within
> each group the rate is flat. So conversion did not deteriorate; the traffic
> composition changed.
>
> Does not claim causality: nothing here was controlled, and the email pause
> coincided with a seasonal traffic shift.

## Honest limits

- **Return rates on unaged cohorts are lower bounds**, never final.
- **Abandonment rates are not comparable across tools** without the event
  definitions normalised; state the definition or the comparison is void.
- **Conversion rate inherits the sessionization rules**, which are a vendor
  decision and change without notice.
- **Cross-system order and session counts will not tie out.** Different
  timezones, different day boundaries, different completed-order definitions.
  Reconcile deliberately or label the ratio as approximate.
- **CM without a stated level is not usable for break-even.**
- **Attribution of revenue to a channel is not this skill's job** — see
  `paid-media-analytics` and the attribution tier. Revenue here is the
  business's own books.

## Core contracts this skill calls

- `answer-contract` — the AOV definition and CM level stated with every figure,
  `lower_bound` on unaged return rates, the numerator/denominator statement on
  every rate
- `provenance-block` — currency (per-store, and the platform may have converted
  already), timezone (the store's, which differs from the analytics tool's),
  freshness on orders still in payment or fraud review
- `comparability-rules` — before orders from the commerce platform sit in a
  ratio with sessions from the analytics tool, and before any cross-tool
  abandonment comparison
- `warning-field-reader` — GA4 sampling, thresholding and the `(other)` row on
  high-cardinality product dimensions; `currencyCode` and `timeZone` in
  `ResponseMetaData`
- `pagination-patterns` — order and line-item extraction is a bulk job; GA4's
  250,000-row per-request ceiling and offset repagination cost
- `rate-limit-governor` — GA4's token-based quota, where a wide product report
  burns far more than a narrow one; set `returnPropertyQuota` and read it back

## References

- `references/metric-definitions.md` — every ecommerce metric with formula,
  grain, denominator and miscomputation
- `references/grain-and-returns.md` — order versus line-item grain, the fan-out
  rules, and cohort-based return computation

## Related skills

- `gtm-metric-dictionary` Part 6 for AOV, contribution margin and repeat
  purchase rate
- `funnel-model-designer` for the cart→checkout→order funnel and its events
- `cohort-and-ltv` for customer-level value, which this skill's order data feeds
- `rfm-and-value-segmentation` for the customer segmentation built on it
- `paid-media-analytics` for spend efficiency against this revenue
- `calculation-integrity-audit` for the fan-out and average-of-averages checks
