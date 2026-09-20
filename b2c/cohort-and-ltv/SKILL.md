---
name: cohort-and-ltv
description: Use for cohort retention, cohort LTV, payback-by-cohort or "are our newer customers better" analysis. Computes cohort curves with truncation marked, uses gross profit rather than revenue, compares cohorts only at the same maturity horizon, and labels predictive LTV models as modelled rather than observed. Prevents the two errors that make almost every LTV chart wrong: revenue LTV instead of margin LTV, and an 18-month-old cohort compared to a 3-month-old one.
---

# Cohorts and LTV

Two errors make most LTV charts wrong, and they are both structural rather than
arithmetic. **Revenue is used where gross profit belongs**, which flatters
every business by exactly `1 ÷ gross margin`. And **cohorts of different ages
are compared to each other**, which measures cohort age and calls it cohort
quality.

Everything below follows from fixing those two.

## The cohort curve

```
Retention(cohort c, period t) = customers from c active in period t
                                ÷ customers in cohort c

Cumulative value(c, t)        = Σ over periods 0..t of
                                (revenue from c in that period × gross margin)
                                ÷ customers in cohort c
```

- **Grain:** acquisition cohort × periods since acquisition.
- **Denominator:** the cohort's original size, held constant. Dividing by
  *surviving* customers produces a conditional retention rate, which is a
  different and often more useful number — but it is not the retention curve,
  and the two are constantly conflated.
- **Cohort definition:** acquisition date, and optionally channel, product or
  offer. **Declare the cohort period** (day, week, month); a monthly cohort
  smooths a promotional spike that a weekly one reveals.

**Two retention curves, both valid, never confused:**

```
Unconditional (the curve)  = active in period t ÷ original cohort size
Conditional (period-over-period) = active in t ÷ active in t−1
```

The first declines monotonically in a business with no reactivation. The second
**rises with tenure in almost every business**, which is the flattening effect
that breaks the closed-form LTV formula below.

## Compare cohorts only at the same horizon

**An 18-month-old cohort will always show more cumulative value than a
3-month-old one.** A chart that puts them side by side at their terminal points
is measuring how long each has been alive.

```
horizon = min over compared cohorts of (periods elapsed)
compare each cohort's value at exactly `horizon`
```

- Pick the horizon from the business question: 90-day value for a paid-media
  payback decision, 12-month for annual planning, 24 or 36 for a valuation
  conversation.
- **State the horizon in the label.** "LTV" with no horizon is not a number.
  A 36-month LTV and a 24-month LTV are not comparable, and neither is
  comparable to a closed-form estimate.
- **Mark truncated cohorts.** The last points on every curve are incomplete, not
  a decline. A cohort at `maturity < 1` produces a **lower bound** on cumulative
  value and a **ceiling** on retention.

## LTV uses gross profit, not revenue

```
LTV (observed, horizon H) = Σ over t = 0..H of
                            (revenue from cohort in t − variable cost in t)
                            ÷ cohort size
```

- **Revenue LTV overstates by `1 ÷ gross margin`.** At 60% margin it is 1.67×
  the real figure, and the ratio it feeds into — LTV:CAC — inherits the whole
  error.
- **Which costs are variable is a choice.** COGS only, or COGS plus fulfilment,
  shipping, payment processing and returns. **Use the same CM level as the rest
  of the analysis** (`ecommerce-analytics`) and state it.
- **Returns belong in the cost side**, and in high-return categories they are
  the largest correction. A cohort's gross revenue curve and its
  returns-adjusted curve diverge materially and the divergence widens with
  horizon.
- **Margin is not constant across cohorts.** A cohort acquired on a discount
  offer carries a lower margin on its first order and often on subsequent ones.
  Compute margin per cohort where the data allows, rather than applying a
  company-wide rate.

## The `1 ÷ churn` closed form and where it breaks

```
LTV (closed form) = (ARPA × gross margin) ÷ churn rate
```

Three honest limits, in increasing severity:

1. **It assumes constant churn forever.** Real churn declines with tenure, so
   the closed form **understates good businesses and overstates bad ones**.
2. **It is undefined without a stated churn convention.** Monthly or annual,
   customer or revenue, start-of-period or average base — four choices, four
   answers (`subscription-analytics`).
3. **For high-NRR businesses it is simply invalid.** Where net revenue
   retention exceeds 100%, the denominator goes to zero or negative and LTV
   approaches infinity. **Do not report a very large number; report that the
   closed form does not apply** and give the bounded-horizon figure instead.

**Default to the bounded-horizon observed figure.** 24- or 36-month cumulative
gross profit per cohort, computed from the actual curve, with the horizon named.
Use the closed form only as a cross-check, and only when churn is roughly flat
across tenure.

## Cohorts must be sized

A 4-customer cohort's 75% retention is three customers.

- **State a minimum cohort size and refuse below it**, offering an interval
  instead of a point estimate (Wilson, as in `funnel-conversion-analysis`).
- **Weekly cohorts on a small base are mostly noise.** Move to monthly and say
  why, rather than charting the noise.
- **Channel × month cohorts go thin fast.** Report the cells that support a
  number and list the ones that do not.

## Predictive LTV is a different object

Observed cohort LTV is a measurement. Predictive LTV is a model output. They
must never sit in one column without labels.

- **BG/NBD + Gamma-Gamma** (as implemented in `lifetimes` / PyMC-Marketing) is
  the standard non-contractual approach: BG/NBD models purchase frequency and
  dropout, Gamma-Gamma models monetary value conditional on frequency.
- **Its assumptions, which are where it breaks:** purchases follow a Poisson
  process while active; dropout is a memoryless probability after each purchase;
  **monetary value is independent of purchase frequency** (check this — in many
  DTC businesses frequent buyers spend differently per order, and the
  Gamma-Gamma assumption fails); customers act independently.
- **It is built for non-contractual settings** — ecommerce, where you cannot
  observe churn. For subscriptions, churn is observable and a survival model or
  the observed curve is the better tool.
- **Label the series modelled at the point of display**, state the assumptions,
  and show the observed curve underneath it so the extrapolation is visible.
- Declare the library dependency explicitly. Analysis modules that import
  statistical libraries absent from the project's declared dependencies work on
  one machine and fail in a clean container.

## B2C repeat metrics must be cohorted

```
Repeat purchase rate (cohort) = customers in cohort with ≥2 orders within N days
                                ÷ customers in cohort
```

**All-time RPR — customers with ≥2 orders ever ÷ all customers — mechanically
rises as the business ages and falls when acquisition accelerates.** It measures
business age and growth rate, not product love. This is the single most common
B2C denominator trap.

- **Read it by 60- or 90-day acquisition cohort** with a fixed window, and state
  the window.
- **A competing definition exists and is a different number entirely:**
  orders from repeat customers ÷ total orders. It is an order-share metric, not
  a customer-behaviour metric. Say which one you computed.

**Time to second order and purchase frequency are the strongest early LTV
predictors in DTC and are badly under-used.**

```
Time to second order = median days from first to second order,
                       among cohort members who made a second order
Second-order rate    = cohort members with ≥2 orders within N days ÷ cohort
```

Report them as a pair. The median alone is survivorship-biased — it describes
only the people who came back — and the rate alone loses the timing signal that
makes it a leading indicator.

## Answering

> **The 12-month cohort LTV is 148 in gross profit, against a blended CAC of
> 71, so payback lands around month 7.**
>
> That is cumulative gross profit per acquired customer at a fixed 12-month
> horizon, net of returns and payment costs, computed per cohort rather than
> with a company-wide margin — the discount cohorts carry about four points less
> margin.
>
> On revenue rather than gross profit the same figure would read 247, which is
> the number in the old deck. It is not wrong arithmetic; it is the wrong
> quantity for a payback decision.
>
> The 2026 cohorts look better than the 2025 ones at every horizon they both
> reach, so the improvement is real and not cohort age — at month 6 they are at
> 94 against 81. The three most recent cohorts are truncated and shown as lower
> bounds.
>
> The closed-form `1 ÷ churn` figure would be 310, and it should not be used
> here: conditional retention rises with tenure in this data, so the constant-
> churn assumption fails in the direction that overstates. Use the bounded
> horizon.
>
> Does not claim the newer cohorts are better because of anything we changed —
> channel mix also shifted, and the cohorts differ in more than their date.

## Honest limits

- **Truncated cohorts give a lower bound on value and a ceiling on retention.**
- **LTV without a stated horizon is not a number**, and horizons are not
  comparable to each other.
- **The closed form is invalid at NRR above 100%** and is not reported as a
  large number there.
- **Predictive LTV is modelled**, labelled as such, with its assumptions stated
  and the observed curve shown underneath.
- **Cohort comparisons are not causal.** Cohorts differ in channel mix, offer,
  season and product alongside their date.
- **Identity resolution bounds everything here.** Customers who cannot be linked
  across purchases appear as multiple one-time buyers, which depresses repeat
  rates and LTV. Report the match rate (`identity-resolution`).

## Core contracts this skill calls

- `answer-contract` — `lower_bound` on truncated cohorts, `unavailable` for the
  closed form at NRR above 100%, and the horizon stated with every LTV figure
- `provenance-block` — currency and FX across cohorts spanning a rate move, the
  measured-versus-modelled label on any predictive series, and cohort as-of date
- `comparability-rules` — before cohorts from different channels, offers or
  identity-resolution regimes are compared
- `warning-field-reader` — analytics-sourced cohort counts subject to sampling
  or thresholding; identity-resolution match rates
- `pagination-patterns` — full order history per customer is a bulk extraction
- `rate-limit-governor` — cohort × horizon grids re-read history; extract once
  and compute locally

## References

- `references/cohort-mechanics.md` — curve construction, horizon alignment,
  truncation marking and cohort sizing, with worked SQL
- `references/ltv-methods.md` — observed, closed-form and predictive LTV
  compared, with assumptions, failure modes and when each applies

## Related skills

- `subscription-analytics` for churn definitions and the survival curves this
  builds on
- `ecommerce-analytics` for the order and margin data at the right grain
- `gtm-metric-dictionary` §5.3 and §6.6 for LTV and repeat purchase rate
- `identity-resolution` — the match rate bounds every cohort figure here
- `rfm-and-value-segmentation` for the segmentation built on these values
- `paid-media-analytics` for the CAC side of payback
