# Churn definition and the voluntary/involuntary split

---

## 1. The definition decision tree

```
Is there a contract or subscription with a status field?
├─ YES → contractual
│   ├─ Which date? cancellation request | end of paid term | last access
│   ├─ Does a downgrade count?  none | contraction > X% | any contraction
│   ├─ Does a pause count?      churn | suspended | excluded
│   ├─ Winback = new customer or returning?
│   └─ Grain: logo | seat | revenue   (pick one; report the others separately)
└─ NO  → non-contractual
    ├─ Derive the lapse window from return-gap percentiles (§2)
    ├─ Segment the window: monthly and annual buyers cannot share one
    └─ Consider P(alive) instead of a threshold, where volume supports it
```

**Every branch is a business decision with a number attached.** Record the choice
and the number it implies — "contraction above 50% counts as churn, which moves
41 accounts from retained to churned last year" is the sentence that makes the
decision reviewable.

---

## 2. Deriving the lapse window

```sql
with gaps as (
  select customer_id,
         date_diff('day',
           lag(purchased_at) over (partition by customer_id order by purchased_at),
           purchased_at) as gap_days,
         segment
  from purchases join customers using (customer_id)
)
select segment,
       count(*) as observed_gaps,
       percentile_cont(0.50) within group (order by gap_days) as p50,
       percentile_cont(0.80) within group (order by gap_days) as p80,
       percentile_cont(0.90) within group (order by gap_days) as p90,
       percentile_cont(0.95) within group (order by gap_days) as p95
from   gaps where gap_days is not null
group by 1;
```

**Reading it:** a window at p90 means roughly 10% of customers you declare
churned will return. That is the **expected false-churn rate**, and it belongs in
the label definition as a stated number rather than as an unexamined property.

| Window | False-churn rate | Detection lag |
|---|---|---|
| p80 | ~20% return | Short — you flag quickly and are often wrong |
| p90 | ~10% return | The usual compromise |
| p95 | ~5% return | Long — you are confident and late |

**The trade-off is real and it is a business choice**: a shorter window catches
churn early enough to act and wastes effort on customers who were coming back
anyway; a longer window is accurate and too late to intervene. Present both
numbers and let the owner choose.

**The survivorship trap:** this distribution is computed over customers who
*did* return, so it says nothing about those who never did. It is the right
input to the decision and it is biased short. Name that.

---

## 3. Classifying voluntary versus involuntary

```sql
select case
         when cancelled_by_user then 'voluntary'
         when last_payment_status in ('declined', 'expired_card',
                                      'insufficient_funds', 'do_not_honor')
              and retry_attempts >= :max_retries then 'involuntary'
         when subscription_ended_at is not null
              and cancelled_by_user is null       then 'unclassified'
         else 'unclassified'
       end as churn_type,
       count(*)                as n,
       sum(mrr)                as mrr,
       avg(tenure_months)      as mean_tenure
from   churned_subscriptions
group by 1;
```

### Fields that carry the signal

| Class | Fields to look for |
|---|---|
| Involuntary | Payment status, decline codes, retry count and outcomes, card expiry date, payment method type, dunning-email engagement, issuer country |
| Voluntary | Cancellation reason, in-app cancel event, auto-renew flag change, downgrade sequence, support ticket topics, NPS trajectory |

### When the split cannot be made

Common: the billing system is separate, or the status field collapses both into
"expired". Then:

1. **Say the split is unavailable**, and give the combined figure.
2. Give the **proxy**: churn preceded within 14 days by a failed payment with no
   user-initiated cancel event is *probably* involuntary. State it as a proxy.
3. Name the direction of error: without the split, **voluntary churn is
   overstated**, because involuntary churn is silently attributed to the customer
   deciding to leave.
4. Name the fix: expose the payment status field in the extract.

**Never model the combined outcome and call the result a voluntary-churn model.**
The involuntary signal dominates, and the resulting model sends the CSM team to
call people whose card expired.

---

## 4. Grain: logo, seat and revenue churn

```sql
-- the three rates, same period, same cohort
select
  count(*) filter (where churned)::float / count(*)                 as logo_churn,
  sum(seats_lost)::float / nullif(sum(seats_at_start), 0)           as seat_churn,
  sum(mrr_lost)::float / nullif(sum(mrr_at_start), 0)               as revenue_churn,
  (sum(mrr_lost) - sum(mrr_expansion))::float
    / nullif(sum(mrr_at_start), 0)                                  as net_revenue_churn
from cohort_period;
```

**These move independently, and in bad cases in opposite directions.** A business
losing many small accounts while expanding large ones has high logo churn and
negative net revenue churn. Both are true; neither alone is the answer.

**Report the grain in every churn number.** "Churn was 4.2%" is not a statement
until the grain is attached, and `comparability-rules` forbids comparing across
grains.

---

## 5. Common definitional traps

| Trap | What happens |
|---|---|
| **Denominator drift** | Churn rate computed against end-of-period customers instead of start-of-period. Makes growth look like retention |
| **Mid-period joiners** | Customers who joined and churned inside the period. Include them or exclude them, consistently, and say which |
| **Annual contracts on a monthly rate** | An annual contract can only churn in one month of twelve; a monthly churn rate over a mixed base is meaningless without segmenting by term |
| **Migration artefacts** | A billing-system migration closes and reopens every subscription. Every account churns on one day. Exclude the window and mark it |
| **Winbacks as new** | Inflates both new-customer counts and churn rates. Pick a treatment and state it |
| **Trials counted as customers** | A free trial that ends is not churn unless trials are in the denominator throughout |

Each of these has produced a real churn number that a real board has seen. The
check is cheap: **reconcile the model's churn count against the finance or
subscription-metrics number, and explain any gap before shipping.**
