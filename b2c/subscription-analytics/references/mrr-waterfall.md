# The MRR movement waterfall, as executable logic

## 1. Monthly customer state

Build the state by replaying events; do not read a current-state table.

```sql
-- one row per customer per month, MRR as of the last day of the month
with months as (
  select generate_series(date '2024-01-01', current_date, interval '1 month')::date as m
),
state as (
  select m.m as month,
         e.customer_id,
         sum(e.mrr_after_latest) as mrr
  from months m
  join lateral (
        -- latest event per subscription on or before month end
        select distinct on (s.subscription_id)
               s.customer_id, s.mrr_after as mrr_after_latest, s.event_type
        from fact_subscription_event s
        where s.event_at < (m.m + interval '1 month')
        order by s.subscription_id, s.event_at desc
  ) e on true
  where e.event_type not in ('cancel_effective', 'pause')
  group by 1, 2
)
select * from state;
```

Shape only — adapt to the warehouse. The load-bearing parts are: **latest event
per subscription as of month end**, **excluding terminated and paused states**,
and **summing to the customer**.

## 2. The six components

```sql
with paired as (
  select coalesce(c.customer_id, p.customer_id) as customer_id,
         coalesce(p.mrr, 0) as mrr_prev,
         coalesce(c.mrr, 0) as mrr_curr
  from state c
  full outer join state p
    on c.customer_id = p.customer_id
   and p.month = c.month - interval '1 month'
  where coalesce(c.month, p.month + interval '1 month') = :month
),
history as (
  select customer_id, min(month) as first_active_month
  from state group by 1
)
select
  sum(case when mrr_prev = 0 and mrr_curr > 0
            and h.first_active_month = :month           then mrr_curr end) as new_mrr,
  sum(case when mrr_prev = 0 and mrr_curr > 0
            and h.first_active_month < :month           then mrr_curr end) as reactivation_mrr,
  sum(case when mrr_prev > 0 and mrr_curr > mrr_prev    then mrr_curr - mrr_prev end) as expansion_mrr,
  sum(case when mrr_prev > 0 and mrr_curr < mrr_prev
            and mrr_curr > 0                            then mrr_prev - mrr_curr end) as contraction_mrr,
  sum(case when mrr_prev > 0 and mrr_curr = 0           then mrr_prev end) as churned_mrr
from paired p
join history h using (customer_id);
```

Note what this structure enforces:

- **Customer grain.** A plan swap nets inside the customer instead of producing
  a spurious churn-plus-new pair.
- **Net within month.** `mrr_curr − mrr_prev` is a single net delta, so an
  upgrade-then-downgrade lands in one bucket.
- **New versus reactivation is decided by prior history**, not by whether the
  customer was active last month.
- **Every customer-month falls into exactly one branch**, which is why the
  waterfall closes.

## 3. The reconciliation check

```
expected_ending = starting + new + expansion − contraction − churned + reactivation
residual        = ending − expected_ending
relative        = residual ÷ ending

pass if |relative| < 0.001
```

Run it on every period, every refresh, and **report the residual as a number**.
A waterfall presented without its residual is an assertion.

## 4. Residual diagnosis

| Residual pattern | Cause | Confirm by |
|---|---|---|
| Positive, roughly the size of one segment | a component missing entirely — often reactivation, folded into new or dropped | check whether any customer-month falls into no branch |
| Small and persistent | proration rounding, or currency conversion applied at different rates per component | compare each component computed in source currency versus converted |
| Large, appears the month a plan changed | subscription-grain computation producing churn-plus-new on plan swaps | recompute at customer grain and compare |
| Doubles when upgrades are frequent | gross rather than net within customer-month | check for customers appearing in both expansion and contraction in one month |
| Appears only for annual plans | MRR derived from an annual price without dividing, or divided at the wrong point | inspect MRR for a known annual subscription |
| Off by exactly the paused base | pause handled inconsistently between state and components | apply one pause policy in both places |
| Mid-month snapshot | starting or ending taken on a day other than the boundary | check the snapshot dates |
| Churn dated on request not effect | cancellations pulled into the wrong month | compare `cancel_scheduled` and `cancel_effective` timestamps |

## 5. Definitional choices to declare

Each is defensible. Each changes the components. Emit them with the waterfall.

| Choice | Options | Effect |
|---|---|---|
| Grain | customer / subscription | subscription grain inflates both churn and new on plan changes |
| Price increases you initiate | expansion / neither | including them makes expansion partly a pricing decision |
| Quantity/seat changes | expansion-contraction / separate seat bucket | a separate bucket is more informative in B2B |
| Pauses | excluded from base / churn after N months | changes churn whenever the pause policy changes |
| Annual plans | MRR = annual ÷ 12 / recognised at billing | the first is standard for MRR; the second is not MRR |
| Discounts | net MRR / list MRR | net is standard; list overstates the base and understates expansion when a discount rolls off |
| One-time fees, setup, services | excluded | including them makes MRR not recurring |
| Currency | fixed rate / period rate | at period rates, a multi-currency book's MRR moves on FX with no customer behaviour |

**FX deserves a line of its own.** In a multi-currency book, converting at each
period's rate mixes customer behaviour with currency movement in every
component. Compute the waterfall at a **fixed rate** for the movement analysis,
report the as-reported figure separately, and name the difference.

## 6. Presentation

The waterfall is a chart, and it obeys the same discipline as the arithmetic:

- **Components in the canonical order**: starting, new, expansion,
  reactivation, contraction, churn, ending.
- **Contraction and churn as negatives**, not as positive bars labelled as
  losses.
- **The residual visible** if non-zero, rather than absorbed into the ending bar.
- **Incomplete current month marked.** Mid-month, churn is understated because
  the month's cancellations have not all landed.
- **Net new MRR** (`new + expansion + reactivation − contraction − churn`) is
  worth stating as a single figure, because it is the number most people are
  actually asking for.
