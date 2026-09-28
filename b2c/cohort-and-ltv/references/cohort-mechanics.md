# Cohort mechanics

## 1. Building the curve

```sql
with cohorts as (
  select customer_id,
         date_trunc('month', min(order_date)) as cohort_month,
         min(order_date)                       as first_order_date
  from orders
  where status in ('paid','fulfilled')
  group by 1
),
activity as (
  select c.cohort_month,
         c.customer_id,
         date_diff('month', c.cohort_month,
                   date_trunc('month', o.order_date)) as period_index,
         sum(o.net_revenue)                            as revenue,
         sum(o.gross_profit)                           as gross_profit
  from orders o
  join cohorts c using (customer_id)
  where o.status in ('paid','fulfilled')
  group by 1,2,3
),
sizes as (
  select cohort_month, count(*) as cohort_size from cohorts group by 1
)
select a.cohort_month,
       a.period_index,
       s.cohort_size,
       count(distinct a.customer_id)                        as active_customers,
       count(distinct a.customer_id)::float / s.cohort_size as retention,
       sum(a.gross_profit) / s.cohort_size                  as gp_per_acquired,
       sum(sum(a.gross_profit)) over (
         partition by a.cohort_month order by a.period_index
       ) / s.cohort_size                                    as cumulative_gp_per_acquired
from activity a
join sizes s using (cohort_month)
group by 1,2,3
order by 1,2;
```

Load-bearing details:

- **`cohort_size` is the denominator throughout**, held constant. Dividing by
  surviving customers gives a different (conditional) metric.
- **`gross_profit`, not revenue**, in the value columns.
- **`period_index` is periods since acquisition**, not calendar date. This is
  what makes cohorts comparable.
- Customers with no activity in a period produce **no row**, which is correct —
  but the chart must render those as zero for that period while keeping the
  cohort denominator unchanged. A missing row rendered as a gap breaks the
  cumulative column.

## 2. Two retention curves

```
Unconditional retention(t)  = active in t ÷ cohort size
Conditional retention(t)    = active in t ÷ active in t−1
```

| | Shape | Use |
|---|---|---|
| Unconditional | declines monotonically absent reactivation | the retention curve; LTV integrates under it |
| Conditional | **rises with tenure in almost every business** | shows the flattening; it is the evidence that constant-churn LTV is wrong |

Reporting the conditional curve alongside the unconditional one is the cheapest
way to demonstrate why the closed-form LTV figure is not the right one. If
conditional retention at month 12 is materially above conditional retention at
month 1, constant-churn assumptions overstate churn for the surviving base.

## 3. Horizon alignment

```
horizon = min over compared cohorts of (periods elapsed)

value_at_horizon(c) = cumulative_gp_per_acquired
                      where period_index = horizon
```

- **Every cohort comparison happens at one horizon.** Terminal-point comparisons
  measure cohort age.
- **Name the horizon in every label.** `LTV_12m`, not `LTV`.
- Choose the horizon from the decision: 90-day for paid-media payback, 12-month
  for planning, 24–36 for valuation. A horizon chosen to make a number look good
  is a horizon that will be chosen differently next quarter.

**Maturity and truncation:**

```
maturity(cohort) = periods elapsed ÷ target horizon

maturity ≥ 1  →  final
maturity < 1  →  cumulative value is a LOWER BOUND
                 retention is a CEILING
```

Show truncated cohorts, marked. Dropping them removes the most recent data,
which is what the reader came for.

## 4. Cohort sizing and refusal

| Cohort size | Treatment |
|---|---|
| ≥ 100 | report point estimates |
| 30–99 | report with an interval |
| < 30 | refuse the point estimate; give the interval and the raw counts |

- **Weekly cohorts on a small base are noise.** Move to monthly and say why.
- **Channel × month cohorts thin out fast.** Report the cells that support a
  number and list the refused ones rather than leaving holes.
- Wilson intervals for retention proportions (see
  `funnel-conversion-analysis/references/decomposition.md`).

## 5. Cohort definition choices

Each changes the picture and must be declared.

| Choice | Options | Effect |
|---|---|---|
| Cohort period | day / week / month | monthly smooths a promotional spike a weekly cohort reveals |
| Cohort key | first order date / signup date / first paid date | signup-date cohorts include people who never purchased, which is a different denominator |
| Cohort dimension | date only / date × channel / date × offer | channel cohorts are the ones that answer acquisition questions, and they thin fastest |
| Activity definition | any order / order above a threshold / any engagement | engagement-based retention is not purchase retention |
| Reactivation | counted as active on return / cohort exit is permanent | changes the shape of the tail materially |

**Channel cohorts require the acquisition channel to be assigned**, which is an
attribution decision, not a fact. State the attribution rule (first touch,
last touch, platform-reported) and note that the cohort comparison inherits it.

## 6. Identity resolution bounds everything

A customer who cannot be linked across purchases appears as several one-time
buyers. The effect on every metric here is in one direction:

- repeat rate **understated**
- retention **understated**
- cohort size **overstated** (duplicates inflate it)
- LTV per acquired customer **understated**
- CAC **understated** (duplicate identities inflate the new-customer denominator,
  lowering spend per apparent customer; the net effect on payback depends on
  the mix)

**Report the identity match rate with every cohort analysis.** Guest checkout,
multiple email addresses, cross-device behaviour and tracking restrictions all
degrade it, and it degrades over time as tracking restrictions tighten — which
means a multi-year cohort comparison is partly a comparison of identity
resolution quality. Say so (`identity-resolution`).

## 7. Validation

1. **Period 0 retention must be 1.0** by construction. If it is not, the cohort
   assignment and the activity join disagree — usually a timezone boundary or a
   status filter mismatch.
2. **Cohort sizes should sum to total customers.** If they exceed it, a customer
   is in two cohorts; if they fall short, some customers have no qualifying
   first order.
3. **Cumulative value must be monotonically non-decreasing** unless refunds
   exceed revenue in a period, which is possible and worth flagging when it
   happens.
4. **Spot-check one cohort by hand.** Pick a small cohort, list its customers
   and orders, and verify the curve. One manual check catches join errors no
   aggregate test will.
