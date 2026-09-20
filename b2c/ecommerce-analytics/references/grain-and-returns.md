# Grain, fan-out and cohort-based returns

## 1. The two tables

```
orders        one row per order
              order_id, customer_id, placed_at, status, currency,
              gross_value, order_discount, shipping_charged, tax,
              shipping_cost, payment_fee

order_lines   one row per order line
              order_id, line_id, product_id, quantity, unit_price,
              line_discount, cogs_unit
```

Order-level values (shipping, order discount, order tax, payment fee) exist
**once per order**. Line-level values exist once per line.

## 2. Fan-out: the failure and the fix

```sql
-- WRONG: order-level values repeat once per line
select sum(o.gross_value) as revenue,      -- multiplied by lines per order
       sum(o.shipping_charged) as shipping -- same
from orders o
join order_lines l using (order_id);
```

The error scales with average basket size: a store averaging 2.4 lines per
order reports 2.4× its revenue and nobody notices immediately, because the
shape of the trend is unchanged.

```sql
-- RIGHT: aggregate each grain separately, then join the aggregates
with order_agg as (
  select date_trunc('day', placed_at) as day,
         count(*)                     as orders,
         sum(gross_value)             as gross_revenue,
         sum(order_discount)          as order_discounts,
         sum(shipping_charged)        as shipping_revenue
  from orders
  where status in ('paid','fulfilled')
  group by 1
),
line_agg as (
  select date_trunc('day', o.placed_at) as day,
         sum(l.quantity)                as units,
         sum(l.line_discount)           as line_discounts,
         sum(l.quantity * l.cogs_unit)  as cogs
  from order_lines l
  join orders o using (order_id)
  where o.status in ('paid','fulfilled')
  group by 1
)
select * from order_agg join line_agg using (day);
```

**The check that catches fan-out in one line:** compare
`count(distinct order_id)` before and after every join. If it is unchanged but
`count(*)` grew, any `sum()` of an order-level column is now wrong.

## 3. Allocating order-level values to lines

Sometimes required — product-level margin needs the order discount spread
across lines. The rule is a choice and must be declared.

| Rule | Allocation | Suits |
|---|---|---|
| Pro-rata by line value | `order_discount × (line_value ÷ order_value)` | percentage-style promotions |
| Pro-rata by quantity | `order_discount × (line_qty ÷ order_qty)` | per-item promotions |
| Targeted | assign to the lines the promotion applied to | code-specific promotions, where the platform records the target |

Whichever is used, **the allocated values must sum back to the order-level
total**. That is a reconciliation check, and it belongs in the pipeline.

## 4. Status: which orders count

Platforms carry many statuses, and every downstream figure depends on which are
included.

| Status family | Include in revenue? | Note |
|---|---|---|
| Draft / abandoned checkout stored as an order object | no | including these is a common and large error |
| Pending payment | usually no | moves within hours to days; it is why very recent order counts drift |
| Paid | yes | the usual default |
| Fulfilled / shipped | yes | fulfilment-date reporting is a different time basis from order date |
| Partially refunded | yes, net of the refund | the refund belongs to the original order's cohort |
| Fully refunded | yes, netting to zero | dropping the order entirely changes order counts and AOV |
| Cancelled | no | but cancellation is not a return; keep them separate |
| Fraud-review / on hold | flag | resolves in days; treat recent counts as provisional |

**Declare the status filter with every figure.** Two analysts using the same
platform and different status filters will produce different revenue and both
will be defensible.

**Order date versus fulfilment date versus payment date** are three time bases
that produce three different monthly revenue figures. State which one, and do
not mix them across a comparison.

## 5. Cohort-based returns

```sql
with cohort as (
  select date_trunc('month', o.placed_at) as cohort_month,
         o.order_id,
         o.gross_value
  from orders o
  where o.placed_at < current_date - interval '60 days'   -- aged past the window
),
refunds as (
  select r.order_id, sum(r.refund_value) as refunded
  from order_refunds r
  group by 1
)
select cohort_month,
       sum(c.gross_value)                     as cohort_gross,
       sum(coalesce(f.refunded, 0))           as cohort_refunded,
       sum(coalesce(f.refunded, 0)) / sum(c.gross_value) as return_rate
from cohort c
left join refunds f using (order_id)
group by 1
order by 1;
```

Points that matter:

- **The refund is attributed to the cohort of the original order**, not to the
  month the refund was issued. That is the whole difference between this and the
  naive rate.
- **The cohort filter excludes unaged orders.** Include them and the recent
  cohorts read artificially low, producing an apparent improvement in returns
  that is purely maturity.
- **For recent cohorts, report a lower bound**, and where the return curve is
  known, project the remainder and label the projection modelled.
- **The return curve itself is worth computing**: cumulative refund share by
  days since order. It tells you how long the window really is, which is often
  shorter than the stated policy.

## 6. Reconciling to the platform's own reports

The commerce platform's revenue report and your warehouse figure will differ.
Usual causes, in order of frequency:

1. **Status filter** — the platform's report includes or excludes a status
   yours does not.
2. **Time basis** — order date versus payment date versus fulfilment date.
3. **Timezone** — the store's configured timezone versus the warehouse's UTC
   day boundary. This moves revenue between days and therefore between months.
4. **Tax and shipping treatment** in the revenue definition.
5. **Refunds netted in-period versus against the original order's period.**
6. **Multi-currency** — the platform presents in the store's currency, already
   converted at its own rate on its own date.
7. **Test and staff orders** excluded by one and not the other.

Reconcile on one day first, not one month. A single day isolates the timezone
and status causes quickly, and most of the rest follow.
