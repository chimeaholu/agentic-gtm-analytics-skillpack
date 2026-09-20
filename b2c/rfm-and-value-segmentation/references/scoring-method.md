# Scoring method

## 1. Deriving the active window

Do not borrow a window. Derive it, then cross-check it.

```sql
-- interpurchase intervals, among customers with 2+ orders
with ordered as (
  select customer_id,
         order_date,
         lag(order_date) over (partition by customer_id order by order_date) as prev_order
  from orders
  where status in ('paid','fulfilled')
),
gaps as (
  select customer_id,
         date_diff('day', prev_order, order_date) as gap_days
  from ordered
  where prev_order is not null
)
select
  percentile_cont(0.50) within group (order by gap_days) as p50_gap,
  percentile_cont(0.75) within group (order by gap_days) as p75_gap,
  percentile_cont(0.90) within group (order by gap_days) as p90_gap,
  count(*) as intervals_observed
from gaps;
```

**The bias to state:** this only sees customers who came back, so it is
**survivorship-biased short**. The cross-check:

```sql
-- cumulative share of eventual second orders by day since first order
with firsts as (
  select customer_id, min(order_date) as first_order from orders group by 1
),
seconds as (
  select o.customer_id,
         min(o.order_date) as second_order
  from orders o join firsts f using (customer_id)
  where o.order_date > f.first_order
  group by 1
)
select date_diff('day', f.first_order, s.second_order) as days_to_second,
       count(*) as n,
       sum(count(*)) over (order by date_diff('day', f.first_order, s.second_order))
         / sum(count(*)) over () as cumulative_share
from firsts f join seconds s using (customer_id)
where f.first_order < current_date - interval '24 months'   -- aged cohorts only
group by 1 order by 1;
```

**The day by which 75–80% of eventual second orders have happened is the more
honest active window**, because it is computed over a matured cohort rather than
over survivors of an arbitrary period.

Where the two disagree, take the larger and say which you used.

**Per-category windows.** A business selling both consumables and durables needs
either category-specific windows or an explicit statement that one blended
window under-counts durables buyers as inactive.

## 2. Computing the three dimensions

```sql
with base as (
  select o.customer_id,
         max(o.order_date)                     as last_order,
         count(*)                              as orders_in_window,
         sum(o.gross_profit)                   as profit_in_window
  from orders o
  where o.status in ('paid','fulfilled')
    and o.order_date >= :as_of - (:lookback_days || ' days')::interval
    and o.order_date <  :as_of
  group by 1
)
select customer_id,
       date_diff('day', last_order, :as_of) as recency_days,
       orders_in_window                     as frequency,
       profit_in_window                     as monetary
from base;
```

Decisions embedded here that must be declared:

| Decision | Options | Effect |
|---|---|---|
| Qualifying order | paid / fulfilled / any status | including cancelled orders inflates frequency |
| Lookback for F and M | 1 / 2 / 3 purchase cycles, or all time | all-time makes frequency a proxy for tenure |
| Monetary basis | **gross profit** / net revenue / gross revenue | revenue ranks discount-driven, high-return customers as valuable |
| Returns | netted against the order / ignored | ignoring them is how a high-return customer scores as a champion |
| As-of date | any | RFM is a snapshot; without it the result cannot be reproduced |

**Refunds belong against the original order**, not the refund date, exactly as
in `ecommerce-analytics`.

## 3. Cut points

### Quintiles

```sql
select customer_id,
       6 - ntile(5) over (order by recency_days)  as r_score,  -- lower days = higher score
       ntile(5) over (order by frequency)         as f_score,
       ntile(5) over (order by monetary)          as m_score
from rfm_base;
```

**Note the reversal on recency** — fewer days is better, and getting this
backwards is a common and completely silent error. Sanity-check that the highest
R score has the lowest median recency.

**The structural limitation:** quintile segment sizes are fixed by construction,
so they can never show base deterioration. Use them for ranking, not for
tracking health over time.

### Fixed thresholds

```
r_score: 5 if recency ≤ 0.25×window, 4 if ≤ 0.5×, 3 if ≤ 0.75×, 2 if ≤ window, 1 beyond
f_score: business-set boundaries, e.g. 1, 2, 3, 4-6, 7+
m_score: business-set profit boundaries
```

**The right choice for tracking base health**, because segment sizes move with
the business. Requires someone to set the boundaries and revisit them — annually
is usually enough, and the revisit date belongs in the documentation, since a
boundary change breaks period comparability.

### Ties and degenerate distributions

- **`ntile` splits ties arbitrarily.** In low-frequency categories where 70% of
  customers have exactly one order, quintiles on F assign identical customers to
  different scores. **Collapse the dimension** — a 1–2 or 1–3 frequency score —
  and say you did.
- **Where a dimension has no spread, drop it** and score on the remaining two.
  A 1–5 score with three empty levels is a rhetorical device.

## 4. Stability

```sql
with paired as (
  select c.customer_id,
         p.segment as segment_prev,
         c.segment as segment_curr
  from rfm_segments c
  join rfm_segments p
    on c.customer_id = p.customer_id
   and p.as_of = :prev_as_of
  where c.as_of = :as_of
)
select
  count(*) filter (where segment_prev = segment_curr)::float / count(*) as stability_overall,
  segment_prev,
  count(*) filter (where segment_prev = segment_curr)::float
    / count(*)                                                          as stability_segment
from paired
group by rollup (segment_prev);
```

| Overall stability | Reading |
|---|---|
| > 75% | reliable targeting basis |
| 60–75% | workable; exclude boundary cases or require two consecutive periods |
| < 60% | **the segmentation is measuring noise** — widen the windows or coarsen the cut points, and say why |

**Instability concentrates at boundaries.** Customers within one order or a few
days of a cut point flip constantly. Two mitigations, both declarable:

- **Boundary exclusion:** drop customers within a narrow band of each cut point
  from targeting, and report the excluded share.
- **Hysteresis:** require two consecutive periods in a segment before acting.
  Slower to react, far more stable, and it is what most operators actually want.

**Both periods must use identical windows and cut points.** Comparing a
120-day-window segmentation to a 90-day one measures the methodology.

## 5. Validation before publishing

1. **R score direction.** Highest R score must have the lowest median recency.
2. **Segment sizes sum to the scored population**, and the unscored population
   (customers with no qualifying order in the window) is reported separately
   rather than dropped.
3. **Monetary is profit, not revenue.** Check by comparing the top monetary
   segment's return rate against the base — if it is materially higher, revenue
   leaked in.
4. **Identity match rate reported.** Unlinked repeat purchasers appear as
   multiple one-time buyers, which understates F and M and inflates the New and
   Lost segments.
5. **Spot-check five customers by hand** across different segments. One manual
   check catches window and join errors that no aggregate test will.
