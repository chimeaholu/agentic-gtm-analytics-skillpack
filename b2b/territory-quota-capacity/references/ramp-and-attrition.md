# Ramp, attrition and the capacity arithmetic

## 1. Deriving the ramp curve from the org's own history

Do not assume a curve if two years of hires exist.

```sql
-- shape only; adapt names to the warehouse model
with tenure as (
  select r.rep_id,
         date_diff('month', r.start_date, b.booking_month) + 1 as tenure_month,
         b.bookings
  from dim_rep r
  join fact_bookings_by_rep_month b using (rep_id)
  where r.start_date >= current_date - interval '24 months'
),
tenured_baseline as (
  select median(bookings) as baseline
  from tenure where tenure_month >= 13
)
select tenure_month,
       median(bookings) as median_bookings,
       median(bookings) / (select baseline from tenured_baseline) as ramp_factor,
       count(distinct rep_id) as reps_observed
from tenure
group by tenure_month
order by tenure_month;
```

Reading and cleaning the result:

- **Use the median, not the mean.** Bookings by tenure month are right-skewed
  and one early big deal distorts the curve.
- **Report `reps_observed` per month.** A ramp factor computed from three reps
  is noise; below a stated minimum, smooth from adjacent months and say so.
- **Cap at 1.0 and enforce monotonicity** only if the raw curve is noisy, and
  say you did. A genuine dip at month 7 is more likely small-n than a real
  phenomenon.
- **The curve is segment-specific.** Enterprise and SMB ramps differ, usually
  by more than the difference between two orgs in the same segment.

### The floor nobody can argue with

```
minimum ramp months ≥ median sales cycle months
                      + time to create first pipeline (typically 1–2 months)
```

A rep cannot close faster than the cycle allows. A 9-month cycle cannot have a
3-month ramp regardless of onboarding quality. This is the one part of the
ramp conversation that is arithmetic rather than opinion.

### When history is too thin

Use an assumed curve, **label it assumed**, and lead with sensitivity. A
defensible default for a 4-month-cycle motion is the table in the SKILL, and the
honest statement is: *"The plan is 14 reps on a six-month ramp and 11 on a
four-month ramp. We do not have enough hiring history to measure which is right,
so the onboarding question is worth three heads."*

## 2. The capacity arithmetic, worked

Ten reps, 1M annual quota, hired one per month starting in month 1, six-month
ramp from the SKILL table, twelve-month horizon.

Monthly capacity contribution for a rep in tenure month t is
`ramp_factor(t) × 1,000,000 ÷ 12 = ramp_factor(t) × 83,333`.

A rep hired in month h contributes across tenure months 1..(13−h).

```
Cumulative ramp_factor by months elapsed:
  1 month  : 0.00
  2 months : 0.05
  3 months : 0.20
  4 months : 0.55
  5 months : 1.15
  6 months : 2.00
  7 months : 3.00
  8 months : 4.00
  9 months : 5.00
 10 months : 6.00
 11 months : 7.00
 12 months : 8.00

Rep hired month 1  → 12 tenure months → 8.00 quota-months
       month 2  → 11 → 7.00
       month 3  → 10 → 6.00
       month 4  →  9 → 5.00
       month 5  →  8 → 4.00
       month 6  →  7 → 3.00
       month 7  →  6 → 2.00
       month 8  →  5 → 1.15
       month 9  →  4 → 0.55
       month 10 →  3 → 0.20
                          ------
                total    36.90 quota-months

Year-one capacity = 36.90 × 83,333 ≈ 3.08M
Naive arithmetic  = 10 × 1M        = 10.0M
```

(Hiring all ten in month 1 instead gives 10 × 8.00 = 80 quota-months ≈ 6.7M —
still far from 10M, and the difference between the two hiring patterns is
itself a planning lever worth showing.)

**Always present both numbers.** The naive figure is the one in the
spreadsheet the plan came from; the adjusted one is the answer.

## 3. Attrition

```
monthly attrition   = 1 − (1 − annual attrition)^(1/12)
expected survivors  = starting heads × (1 − monthly)^m
```

At 18% annual: monthly = 1 − 0.82^(1/12) = 1.63%. **Not 1.5%** (18 ÷ 12), and
the gap compounds over a planning horizon.

### The real cost of a departure

```
cost = remaining productive months of the leaver
     + backfill time (open territory, zero capacity)
     + full ramp of the replacement
```

A rep who leaves in month 7 of a 12-month plan, with a 2-month backfill and a
6-month ramp, costs the plan roughly:

```
lost tenured months        : 5 × 1.00 = 5.00 quota-months
backfill gap               : 2 × 0.00 = 0.00
replacement partial ramp   : months 10-12 of the plan at 0.00, 0.05, 0.15
                                      = 0.20 quota-months recovered
net loss vs no departure   ≈ 4.8 quota-months ≈ 0.40M at a 1M quota
```

**Model the replacement as a new hire, never as continuity.** The most common
planning error after ignoring ramp is assuming a backfill is a wash.

### Tenure-dependent hazard

First-year attrition is usually higher than the tenured rate. A plan built on
heavy hiring therefore inherits a worse blended rate than the historical
average implies. Where the data supports it:

```
attrition(tenure_band) : 0-12 months, 13-24 months, 25+ months
```

and apply the band-specific rate to each cohort in the plan. Where it does not,
use the blended rate and note that heavy hiring biases it upward.

## 4. Sensitivity, and the correlations that matter

Run the model across the plausible ranges and publish the grid, not one cell.

| Parameter | Range | Typical effect |
|---|---|---|
| Ramp length | 4–9 months | largest single term in year one |
| Annual attrition | 10–30% | large; compounds with ramp via replacement |
| Attainment rate | historical ±15 points | large |
| Hiring start dates | ±1 month per hire | moderate, and directly controllable |
| Quota per rep | ±20% | moves required headcount roughly inversely |

**Do not move these independently.** Attrition and attainment are correlated: a
team missing quota loses people, and a team losing people misses quota. Moving
attrition to 30% while holding attainment at the historical median produces a
scenario that has never happened. Where the correlation cannot be estimated,
move them together in the pessimistic direction and say the pair was moved as
one.

**The most decision-useful output is the marginal statement**, not the grid:
*"each month of ramp reduction is worth about 0.6M of year-one capacity, which
makes onboarding investment directly comparable to a hire."*
