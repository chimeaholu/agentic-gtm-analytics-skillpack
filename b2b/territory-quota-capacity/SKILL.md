---
name: territory-quota-capacity
description: Use for territory design, quota setting, capacity planning or headcount modelling — how many reps we need, whether quotas are achievable, or whether territory coverage matches opportunity. Models productive capacity with explicit ramp time and attrition, derives quota from historical attainment distributions rather than top-down division, and checks territory balance against actual account potential. Prevents a capacity plan that assumes new hires are productive on day one, which is the most-omitted and most-consequential parameter in GTM planning.
---

# Territory, quota and capacity

Three planning questions with one shared failure mode: they get answered with
headcount arithmetic. Headcount × quota = target is not a capacity model. It
assumes every rep is productive from their start date, that nobody leaves, and
that the attainment distribution will oblige.

This skill models capacity as a **curve**, derives quota from **the attainment
distribution**, and sets pipeline coverage from **the win rate** rather than a
blanket benchmark.

## Capacity is a curve, not a headcount

```
Productive capacity(month m) =
    Σ over reps r active in month m
      ramp_factor(tenure_months(r, m)) × (annual quota ÷ 12)
```

- **Grain:** rep × month.
- **`ramp_factor`** rises from near zero at hire to 1.0 at full productivity.
- **Tenure is measured from start date**, not from the plan date, and a
  replacement hire **restarts at zero**.

A worked ramp for a motion with a 6-month ramp and a 4-month median cycle:

| Tenure month | ramp_factor | Why |
|---|---|---|
| 1 | 0.00 | onboarding; no pipeline created yet |
| 2 | 0.05 | first pipeline created, nothing can have closed |
| 3 | 0.15 | early pipeline maturing |
| 4 | 0.35 | first deals reachable at the median cycle |
| 5 | 0.60 | — |
| 6 | 0.85 | — |
| 7+ | 1.00 | full |

**Take the shape from the org's own history**, not from this table: plot median
bookings by tenure month for reps hired in the last two years, normalise to the
tenured median, and use that curve. Where history is too thin, use an assumed
curve, **say it is assumed**, and run the sensitivity (below) — ramp assumptions
move the answer more than almost anything else in the model.

**The ramp length is bounded below by the sales cycle.** A rep cannot close
faster than the median cycle allows, so a 9-month cycle cannot have a 3-month
ramp however good the onboarding is. If someone proposes one, that is the
sentence to say.

### The arithmetic that makes this matter

Ten reps hired evenly through a year, 1M annual quota each, 6-month ramp:

```
Naive plan:        10 reps × 1M                      = 10.0M of capacity
Ramp-adjusted:     Σ months of ramp_factor × 1M/12   ≈  4.1M in year one
```

The gap is not a rounding error, and it is the most-omitted parameter in GTM
planning. State both numbers, always, and say which the plan is built on.

## Attrition is modelled, never assumed to be zero

```
Expected active reps(m) = starting reps × (1 − monthly attrition)^m
                          + hires ramped in, each subject to the same hazard
Replacement lag         = days from departure to a productive replacement
                        = time to backfill + full ramp period
```

- **Monthly attrition from annual: `1 − (1 − annual)^(1/12)`.** Dividing annual
  attrition by twelve is the same error as dividing annual churn by twelve, in
  the same direction (see `gtm-metric-dictionary` §6.7).
- **A departure costs more than a headcount.** It costs the departing rep's
  remaining productive months, the open territory, and a full new ramp.
  Model the replacement as a new hire, not as continuity.
- Attrition is usually **higher in the first year**, so a plan built on heavy
  hiring inherits a worse hazard rate than the tenured average. Where the data
  supports it, use a tenure-dependent rate.

## Quota is read from the attainment distribution

Top-down division — target ÷ headcount — produces a number with no relationship
to what people have ever achieved.

```
Attainment(rep, period) = bookings ÷ quota
Quota achievability     = share of reps historically at or above 100%
Required attainment     = plan target ÷ (heads × quota)
```

- **Grain:** rep × period.
- **If 40% of reps historically hit quota, a plan requiring 80% attainment is a
  plan to miss.** Say that in those terms, with both numbers.
- **Report the distribution, not the mean.** Attainment is right-skewed: a few
  reps at 180% pull the mean above the median, and the mean then implies a
  broad-based achievement that did not happen. Give median, the share at or
  above 100%, and the share below 50%.
- **Exclude partial-tenure reps from the distribution** or normalise them by
  ramp, or the distribution measures hiring pace rather than achievability.
- **A quota raise changes the distribution.** Last year's 40% attainment rate
  was against last year's quota; raising quota 20% does not hold attainment
  constant. Model the plan target against the *historical bookings*
  distribution, not against attainment percentages.

## Pipeline coverage comes from the win rate

```
Required coverage = 1 ÷ win rate
```

| Win rate | Correct coverage target |
|---|---|
| 33% | 3.0× |
| 25% | 4.0× |
| 20% | 5.0× |
| 15% | 6.7× |

**Quoting a blanket 3× to a 20%-win-rate team tells them they are funded when
they are short by a third.** Three further constraints:

1. **Coverage counts pipeline that can close in the period**, filtered on close
   date in period, not all open pipeline.
2. **Net of stale.** Deals pushed three or more times, or sitting past their
   p90 stage duration, are carried at full value in almost every CRM report.
   Apply the staleness treatment from `pipeline-forecast`.
3. **Coverage falls mechanically through a period** as deals close. Compare day
   30 to day 30, which needs `fact_opportunity_snapshot`.

**The win rate used must be the one whose denominator matches the question**
(`win-loss-analysis`). Coverage derived from a close-date win rate inherits its
bias.

## Territory balance is measured against potential

Equal account counts are not equal territories. Balance against **potential**,
and state where the potential estimate came from.

```
Territory potential   = Σ over accounts in the territory of estimated potential
Balance index(t)      = potential(t) ÷ mean potential across territories
Coverage gap(t)       = potential(t) ÷ productive capacity(t)
```

- **Grain:** territory.
- Potential sources, in descending reliability: existing spend with you,
  observed deal sizes for comparable accounts, firmographic size bands, vendor
  intent or propensity scores. **Say which**, and carry the uncertainty — a
  potential estimate from a firmographic band is a wide interval, not a number.
- **A balance index outside roughly 0.8–1.2 is a design problem**, not a
  performance problem, and rep attainment differences across unbalanced
  territories are not evidence about reps.
- **Disruption has a cost.** Rebalancing resets relationships and pipeline;
  count the in-flight pipeline in any moved account as at-risk, and say so.

## Composites must come from one cohort

```
Pipeline velocity = (opportunities × win rate × avg deal value) ÷ cycle length
Reps required     = target ÷ (quota × expected attainment × ramp adjustment)
```

**All inputs to a composite come from the same cohort and the same segment.**
Enterprise deal value with SMB cycle length describes no team that exists. This
is the single most common way a capacity model produces a confident number
nobody can act on.

## Sensitivity is the output that gets used

Planning answers are dominated by two or three assumptions. Show them.

| Parameter | Plausible range | Effect on year-one capacity |
|---|---|---|
| Ramp length | 4–9 months | large — usually the largest single term |
| Annual attrition | 10–30% | large, and compounds with ramp through replacement |
| Attainment rate | historical ±15 points | large |
| Hiring start dates | ±1 month each | moderate, and it is the one thing leadership directly controls |
| Win rate (via coverage) | historical ±5 points | moderate on the pipeline requirement |

**Move correlated assumptions together.** Attrition and attainment are not
independent — a team missing quota loses people. Moving them independently
produces scenarios that cannot happen.

## Answering

> **The plan needs 14 quota-carrying reps to reach the target, not the 10 in
> the current headcount plan.**
>
> Ten reps hired evenly through the year with a six-month ramp deliver about
> 4.1M of productive capacity in year one, against 10M on the naive
> headcount × quota arithmetic. The ramp curve is this org's own: median
> bookings by tenure month over the last two years of hires.
>
> Two things make 14 a floor rather than a point estimate. At 18% annual
> attrition, roughly two of the fourteen will leave and their replacements
> restart the ramp, which costs about 0.9M. And the plan requires 71% of reps
> at quota, where the historical distribution has 43% at or above 100% — so
> either the quota comes down or the headcount goes up further.
>
> On coverage: at the current 21% created-cohort win rate, the requirement is
> 4.8× and not the 3× in the plan. That is the largest single gap in the
> document.
>
> For a board conversation the 14 is the number. For the hiring plan, the
> sensitivity table matters more: every month of ramp reduction is worth about
> 0.6M of year-one capacity, which makes onboarding investment directly
> comparable to a hire.
>
> Does not claim any of this is causal, and it assumes the motion that produced
> the ramp curve and the attainment distribution still holds.

## Honest limits

- **No hire-date history: no measured ramp curve.** Use an assumed curve, label
  it assumed, and lead with the sensitivity rather than the point estimate.
- **Attainment distributions on fewer than ~20 rep-periods are indicative
  only.** Give the distribution, not a percentage claim.
- **Potential estimates carry their source's uncertainty.** A firmographic band
  is an interval. Territory balance computed from point estimates of potential
  is more precise-looking than it is.
- **A capacity model is not a forecast.** It says what the team can carry, not
  what will close. Route the bookings question to `pipeline-forecast`.
- **New segments and new motions have no comparable history**, so ramp,
  attainment and win rate are all borrowed. Say from where.

## Core contracts this skill calls

- `answer-contract` — the range and its assumptions, `unavailable` where ramp
  or attainment history does not exist, and the naive-versus-adjusted pair
- `provenance-block` — currency on quota and bookings, the as-of date of the
  headcount roster, and the modelled label on every capacity projection
- `comparability-rules` — before attainment is compared across periods with
  different quotas, or territories with different definitions
- `warning-field-reader` — HR and CRM rosters disagree constantly; a missing
  termination date reads as an active rep
- `pagination-patterns` — full bookings-by-rep history exceeds report row caps
- `rate-limit-governor` — sensitivity grids re-run the model many times; compute
  locally from one extraction rather than re-querying per scenario

## References

- `references/ramp-and-attrition.md` — deriving the ramp curve from history, the
  attrition hazard, replacement cost, and the worked capacity arithmetic
- `references/quota-and-coverage.md` — attainment distributions, quota
  achievability, coverage from win rate, and territory potential

## Related skills

- `pipeline-forecast` for the forecast itself and the shared staleness treatment
- `win-loss-analysis` for the win rate whose denominator the coverage target
  depends on
- `gtm-metric-dictionary` §2.1 for pipeline coverage and §3 for win rate
- `account-based-analytics` for account potential at the territory grain
- `kpi-tree-builder` to hang capacity under the revenue tree with its formulas
