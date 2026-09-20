---
name: rfm-and-value-segmentation
description: Use for customer value segmentation — RFM scoring, high-value and at-risk identification, active-base definition, or segment-level targeting recommendations. Sets the recency window from the category's purchase cycle rather than a default, uses gross profit for the monetary dimension, and states segment sizes and their stability over time. Prevents an "active customer" definition borrowed from a different category, which produces a confidently wrong conclusion about base health.
---

# RFM and value segmentation

RFM is three simple measurements and four decisions that determine the answer.
The measurements are easy. The decisions — **the recency window, the cut
points, the monetary basis and the segment labels** — are where the analysis
goes wrong, and none of them has a default that travels across categories.

## The three dimensions

```
Recency   = days since the customer's last qualifying purchase
Frequency = qualifying purchases within the lookback window
Monetary  = gross profit from those purchases        ← not revenue
```

- **Grain:** customer.
- **Recency is the strongest single predictor of near-term purchase** in most
  transactional categories, which is why the window choice dominates everything.
- **Frequency needs a stated lookback.** "Orders ever" makes frequency a proxy
  for tenure, so long-standing customers score high on age rather than on
  behaviour. Use a fixed window — typically one to three purchase cycles.
- **Monetary uses gross profit, not revenue**, consistent with
  `cohort-and-ltv`. Revenue-based monetary scores rank discount-driven,
  high-return customers as valuable, which is the population you least want to
  target with more discounts.
- **All three are computed as of a stated date.** RFM is a snapshot; a segment
  membership without an as-of date cannot be reproduced.

## The recency window is a category decision

**"Active" requires a defined lookback that suits the category, and the wrong
window produces a confidently wrong conclusion about base health.**

| Category shape | Typical repurchase cycle | Reasonable "active" window |
|---|---|---|
| Consumables, replenishment | weeks | ~90 days |
| Apparel, beauty | seasonal | 6–12 months |
| Durables, furniture | years | 12–24 months |
| Subscription | continuous | active subscription status, not recency |

**Do not borrow the window.** Derive it from the data:

```
p50 / p75 interpurchase interval = median / 75th percentile of days between
                                   consecutive orders, among customers with ≥2 orders
active window ≈ p75 interpurchase interval (a defensible default)
```

- Customers with one order are excluded from the interval calculation by
  construction — which means **the estimate is survivorship-biased short**,
  because people who never came back are not in it. State that, and cross-check
  against the cumulative repurchase curve: the day by which 75–80% of eventual
  second orders have happened is the more honest window.
- **Declare the window in every output.** "42% of the base is active" means
  nothing without it, and it will be compared to a figure computed on a
  different window within the week.
- **Category mix matters inside one business.** A retailer selling both
  consumables and durables needs either per-category windows or an explicit
  statement that one blended window under-counts active durables buyers.

## Cut points are a choice

Three methods, three sets of segment sizes on identical data.

| Method | How | Property |
|---|---|---|
| **Quintiles** | rank customers, split into 5 equal groups per dimension | segment sizes are fixed by construction, so they cannot show base deterioration; comparable across periods only in rank terms |
| **Fixed thresholds** | business-defined boundaries (e.g. ≥4 orders, ≥300 profit) | segment sizes move with the business, which is the point; requires someone to set them and revisit them |
| **Distribution-based** | natural breaks, or a clustering result | fits the data; boundaries move between periods, which makes period comparison hard |

- **Quintiles are the common default and they hide the thing you most want to
  see.** The top quintile is always 20% of the base. If the business is
  deteriorating, quintile membership is unchanged and only the underlying values
  fall.
- **Fixed thresholds are the right choice for tracking base health over time**,
  and they need the distribution shown alongside so the reader can see where the
  boundaries sit.
- **Whichever you use, declare the method, print the boundaries, and show the
  distribution.** A segment table without the underlying distribution invites
  the reader to assume quintiles.
- **Frequency rarely supports five levels** in low-frequency categories: if 70%
  of customers have exactly one order, a 1–5 frequency score is really a 1–2
  score with three empty levels. Collapse it and say so.

## Segment labels are hypotheses, not facts

The familiar labels — Champions, Loyal, At Risk, Hibernating, Lost — are
shorthand for score combinations, not diagnoses.

```
Champions      high R, high F, high M       recent, frequent, profitable
Loyal          mid-high R, high F           consistent
Potential      high R, low F                recent but unproven
New            high R, F = 1                one order, recent
At Risk        low R, high F, high M        was valuable, has gone quiet
Can't Lose     lowest R, highest F and M    the expensive ones to lose
Hibernating    low R, low F, low M          — 
Lost           lowest R, lowest F           beyond the window
```

- **"At Risk" is a score pattern, not a churn prediction.** In a category with
  a 9-month cycle, a customer at 5 months is not at risk; they are mid-cycle.
  **The label is only meaningful relative to the category window.**
- **Map labels to actions before publishing them.** A label that does not change
  what anyone does is a decorative name for a number.
- **Segment sizes are reported with every label**, because a recommendation
  about a 400-customer segment and one about a 40,000-customer segment are
  different conversations.

## Migration is the actionable view

The static distribution is a snapshot. **Who moved is the finding.**

```
Migration matrix: customers by (segment at t−1) × (segment at t)
Downgrade rate(segment) = customers moving to a lower-value segment ÷ segment size at t−1
Recovery rate(segment)  = customers moving up from At Risk or Hibernating ÷ segment size at t−1
Value at risk           = Σ trailing gross profit of customers who moved from a
                          high-value segment to At Risk this period
```

- **Grain:** customer × period pair.
- **Both periods must use the same windows and the same cut points**, or the
  matrix measures the methodology change. This is the single most common defect
  in migration analysis.
- **Value at risk is the number executives act on**, because it is denominated
  in profit rather than customer counts.
- **Some migration is mechanical.** With a 90-day recency window and a monthly
  cadence, customers drift downward by construction between purchases. Compare
  migration rates to the base rate for a stable business, not to zero.

## Stability must be checked before targeting

**A segmentation that reshuffles every month is measuring noise.**

```
Stability = customers in the same segment at t and t−1 ÷ customers present in both
```

- Compute it per segment and overall. **Below roughly 60% overall stability, the
  segmentation is not a reliable targeting basis** and the honest move is to
  widen the windows or coarsen the cut points and say why.
- Instability concentrates at boundaries: customers just either side of a cut
  point flip on one order. Where a targeting decision is expensive, exclude a
  narrow band around each boundary or apply hysteresis — require two consecutive
  periods in a segment before acting.
- Low-frequency categories are structurally less stable on the F dimension.
  Weight R more heavily there, and say that is what you did.

## RFM is descriptive, not predictive

It describes what a customer has done. It does not estimate what they will do,
and it carries no uncertainty.

- **Where prediction is the requirement — who will churn, who will respond —
  route to `supervised-propensity-models` or `churn-prediction-models`** and say
  why. RFM features are excellent *inputs* to those models and a poor substitute
  for them.
- **Where forward-looking value is the requirement**, route to predictive LTV
  (`cohort-and-ltv`), which produces an expectation with stated assumptions.
- **Where the segmentation should be discovered rather than imposed**, route to
  `clustering-and-persona-discovery` — and note that a clustering result has the
  same stability obligation as RFM, plus the additional burden of explaining
  what the clusters mean.

**RFM's real strength is that it is explainable.** A marketer can read the rule,
argue with it, and act on it the same day. Do not trade that away for a marginal
accuracy gain unless the decision justifies it.

## Small segments get a refusal, not a recommendation

A 14-customer "Can't Lose" segment supports a list, not a strategy.

- **State a minimum segment size for a recommendation** and apply it. Below it,
  give the customer list — which is genuinely useful — and withhold the
  behavioural generalisation.
- **Rates computed on small segments need intervals**, not point estimates
  (Wilson, per `funnel-conversion-analysis`).
- **Segment × category × period cuts go thin immediately.** List the refused
  cells rather than leaving holes.

## Answering

> **41% of the base is active, on a 120-day window derived from this category's
> p75 interpurchase interval rather than a borrowed 90-day default.**
>
> On a 90-day window the same base reads 33%, which is the figure in the
> previous deck. Neither is wrong; the 120-day window is the one this category's
> repurchase curve supports, and the difference is 8 points of apparent base
> health.
>
> Cut points are fixed thresholds, printed below with the distribution, not
> quintiles — quintiles would hold every segment at 20% of the base and hide
> exactly the deterioration you are asking about.
>
> Monetary is gross profit. On revenue, the top segment would include about 600
> customers whose return rate exceeds 40%, and targeting them with more
> discount-led offers is the opposite of the intended action.
>
> The actionable number is migration: 1,840 customers moved from Loyal to At
> Risk this quarter, carrying 214K of trailing gross profit. That is the
> win-back list, and it is worth more than the Champions list.
>
> One caution before you target: overall segment stability is 64%, which is
> workable but thin. I would exclude the customers sitting within one order of a
> boundary, about 9% of the base, or require two consecutive periods in a
> segment before acting.
>
> RFM is descriptive. It does not predict who will churn — if that is the
> question, these scores are good features for a propensity model, not a
> substitute for one.

## Honest limits

- **The active window is derived from a survivorship-biased interval** and is
  cross-checked against the repurchase curve. It is a defensible choice, not a
  measurement.
- **Segment sizes under quintile cut points cannot show base deterioration**, by
  construction.
- **Migration matrices across a methodology change measure the change.**
- **RFM carries no uncertainty and makes no prediction.** Any forward-looking
  statement built on it is an extrapolation and must be labelled.
- **Identity resolution bounds everything.** Customers who cannot be linked
  across purchases appear as multiple one-time buyers, which understates
  frequency and monetary and inflates the Lost and New segments. Report the
  match rate.
- **A customer who appears in no segment is not a customer with no value** —
  they may simply be outside the window. Report the excluded population.

## Core contracts this skill calls

- `answer-contract` — the window and cut-point method stated with every segment
  figure, refusal with the customer list where segments are too small, and both
  window variants where the choice is material
- `provenance-block` — the as-of date (RFM is a snapshot), currency and FX on
  monetary scores, and the source of the margin used
- `comparability-rules` — before segment sizes from two periods computed under
  different windows or cut points are compared
- `warning-field-reader` — identity match rates, and analytics-sourced customer
  counts subject to thresholding
- `pagination-patterns` — full customer transaction history is a bulk extraction
- `rate-limit-governor` — scoring the whole base repeatedly across candidate
  windows; extract once and recompute locally

## References

- `references/scoring-method.md` — window derivation, cut-point methods, score
  construction and the stability check, with worked SQL
- `references/segments-and-actions.md` — the segment definitions, the action
  each implies, the migration matrix and value-at-risk

## Related skills

- `cohort-and-ltv` for the value basis and the repurchase curve this uses
- `ecommerce-analytics` for the order and margin data at the right grain
- `identity-resolution` — the match rate bounds every figure here
- `gtm-metric-dictionary` §6.6 for repeat purchase rate and its denominator trap
- `clustering-and-persona-discovery` where a data-driven segmentation is preferred
- `supervised-propensity-models` and `churn-prediction-models` where the question
  is prediction rather than description
