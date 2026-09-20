# Quota achievability, coverage and territory potential

## 1. The attainment distribution

```
Attainment(rep, period) = bookings(rep, period) ÷ quota(rep, period)
```

Report the distribution, never the mean alone:

```
median attainment
share at or above 100%          ← "achievability"
share at or above 80%
share below 50%
p90 attainment
n (rep-periods)
```

**Attainment is right-skewed.** A few reps at 180% pull the mean above the
median and imply a broad-based achievement that did not occur. A team with a
mean attainment of 102% can easily have 40% of reps at quota.

Cleaning rules:

- **Exclude or ramp-normalise partial-tenure reps.** Otherwise the distribution
  measures hiring pace. Either drop reps below full tenure, or divide their
  bookings by the cumulative ramp factor for their tenure and say which.
- **Exclude reps with mid-period quota or territory changes**, or attribute
  proportionally and flag them.
- **n below ~20 rep-periods is indicative only.** Give the distribution and say
  it cannot support a percentage claim.

## 2. Quota achievability

```
Required attainment = plan target ÷ (heads × quota)
Achievability       = historical share of reps at or above 100%
```

The sentence to produce:

> The plan requires 71% of reps to hit quota. Over the last six quarters, 43%
> of reps hit quota. Either the quota comes down, the headcount goes up, or the
> plan is a plan to miss — and those are the only three levers.

**A quota raise does not hold attainment constant.** Last year's 43% was against
last year's quota. To test a raised quota properly, model the plan target
against the **historical bookings distribution** rather than against attainment
percentages:

```
implied achievability(new quota)
  = share of historical rep-periods whose BOOKINGS ≥ new quota
```

That comparison is quota-invariant and is the honest way to answer "can they
carry 1.2M each?"

## 3. Coverage from the win rate

```
Required coverage = 1 ÷ win rate
Actual coverage   = qualifying open pipeline ÷ quota for the period
Gap               = (required − actual) × quota
```

| Win rate | Required coverage | Shortfall if funded at 3× |
|---|---|---|
| 33% | 3.0× | none |
| 25% | 4.0× | 25% of the quota unfunded |
| 20% | 5.0× | 40% unfunded |
| 15% | 6.7× | 55% unfunded |

Three qualifiers on "qualifying open pipeline":

1. **Close date in period.** A deal closing next quarter is not coverage for
   this one.
2. **Net of stale.** Apply the staleness treatment from `pipeline-forecast`:
   deals past their p90 stage duration, or with a close date already in the
   past and no stage movement, are not full-value coverage.
3. **Same-day comparison.** Coverage falls mechanically through a period as
   deals close, so a mid-quarter figure compared to a start-of-quarter
   benchmark always looks bad. Compare day 30 to day 30, which requires
   `fact_opportunity_snapshot`.

**Which win rate?** The one whose denominator matches the question
(`win-loss-analysis`). Coverage from a close-date win rate inherits the
close-date bias; the created-cohort rate is the better input where the cohort
has matured.

**Coverage is segment-specific.** One blended coverage target across enterprise
and SMB underfunds one of them, because their win rates differ. Compute per
segment and roll up the requirement, not the ratio.

## 4. Territory potential and balance

```
Territory potential = Σ over accounts in territory of estimated potential
Balance index(t)    = potential(t) ÷ mean potential across territories
Load index(t)       = potential(t) ÷ productive capacity(t)
```

| Potential source | Reliability | What to carry with it |
|---|---|---|
| Existing spend with you | highest, for expansion territories | says nothing about greenfield |
| Observed deal sizes for comparable won accounts | good | comparability of the match must be stated |
| Firmographic size bands (employees, revenue) | moderate | a band is an interval; propagate it |
| Vendor intent or propensity scores | variable | vendor model, opaque; record vendor and version |
| Account count | not a potential estimate | equal counts are not equal territories |

**A balance index outside roughly 0.8–1.2 is a design problem.** Attainment
differences across unbalanced territories are not evidence about reps, and
should never be used in a performance conversation without the balance index
next to them.

**Rebalancing has a cost.** Count in-flight pipeline in moved accounts as
at-risk, note the relationship reset, and give the disruption estimate
alongside the balance improvement. A perfectly balanced map that torches a
quarter of in-flight pipeline is not an improvement.

## 5. Composites: one cohort, one segment

```
Pipeline velocity = (opportunities × win rate × avg deal value) ÷ cycle length
Reps required     = target ÷ (quota × expected attainment × ramp adjustment)
```

Every input to a composite comes from the same cohort and the same segment.
Enterprise deal value with SMB cycle length describes no team that exists, and
the resulting number is confidently wrong in an unknowable direction.

Checklist before publishing any composite:

- [ ] all inputs from the same segment
- [ ] all inputs from the same cohort period
- [ ] cycle length is a median, not a mean
- [ ] win rate's denominator is named
- [ ] deal value's currency and conversion are stated
- [ ] the composite's units are stated (velocity is revenue per unit time, not
      a duration)

## 6. What the capacity model does not claim

- It is not a forecast. It says what the team can carry, not what will close.
- It assumes the motion that produced the ramp curve, the attainment
  distribution and the win rate still holds.
- Territory potential estimates carry their source's uncertainty; balance
  computed from point estimates looks more precise than it is.
- Nothing here is causal: an attainment difference across territories is not
  evidence about the people in them.
