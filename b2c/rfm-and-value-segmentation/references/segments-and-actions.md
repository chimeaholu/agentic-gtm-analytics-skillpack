# Segments, actions and migration

## 1. Segment definitions and the action each implies

A label that does not change what anyone does is a decorative name for a score.
Each row below carries the action, because that is the test of whether the
segment earns its place.

| Segment | Score pattern | What it means | Action it implies |
|---|---|---|---|
| **Champions** | high R, high F, high M | recent, frequent, profitable | early access, referral ask, advocacy — **not discounts**, which subsidise behaviour you already have |
| **Loyal** | mid-high R, high F | consistent | cross-sell, replenishment timing, loyalty tier |
| **Potential** | high R, low F | recent but unproven | second-purchase nudge timed to the p50 interpurchase interval |
| **New** | high R, F = 1 | one recent order | onboarding flow; **time-to-second-order is the metric that matters** |
| **Promising** | mid R, low F, low M | early and light | low-cost nurture; do not over-invest |
| **Needs attention** | mid R, mid F, mid M | drifting | reactivation before the recency window closes |
| **At Risk** | low R, high F, high M | was valuable, has gone quiet | **the highest-value win-back list**; personal outreach justifies the cost |
| **Can't Lose** | lowest R, highest F and M | the expensive ones to lose | manual, individual, not a campaign |
| **Hibernating** | low R, low F, low M | disengaged | low-cost broad reactivation, then suppression |
| **Lost** | beyond the window, low F | gone | suppress; keeping them inflates list size and damages deliverability (`email-lifecycle-analytics`) |

**"At Risk" is relative to the category window.** In a category with a nine-month
cycle, a customer at five months is mid-cycle, not at risk. The label is
meaningless without the window printed next to it.

**Champions and discounts.** The most common misapplication of RFM is targeting
the top segment with the deepest offers. They were going to buy. Discounting
them converts margin into nothing.

## 2. The migration matrix

```sql
select p.segment as from_segment,
       c.segment as to_segment,
       count(*)  as customers,
       sum(c.trailing_gross_profit) as profit_moved
from rfm_segments c
join rfm_segments p
  on c.customer_id = p.customer_id and p.as_of = :prev_as_of
where c.as_of = :as_of
group by 1, 2
order by 1, 2;
```

Derived figures that get acted on:

```
Downgrade rate(segment) = customers moving to a lower-value segment
                          ÷ segment size at t−1
Recovery rate(segment)  = customers moving up from At Risk or Hibernating
                          ÷ segment size at t−1
Value at risk           = Σ trailing gross profit of customers who moved from a
                          high-value segment to At Risk this period
Value recovered         = the same for upward movement
```

**Value at risk is the number executives act on**, because it is denominated in
profit rather than customer counts. "1,840 customers moved from Loyal to At Risk,
carrying 214K of trailing gross profit" lands in a way that "downgrade rate rose
to 9%" does not.

**Three rules for reading a migration matrix:**

1. **Both periods must use identical windows and cut points**, or the matrix
   measures the methodology change. This is the most common defect here.
2. **Some migration is mechanical.** With a 90-day window and a quarterly
   snapshot cadence, customers drift downward between purchases by construction.
   Compare migration rates to the base rate for a stable period, not to zero.
3. **Quintile cut points make the marginal totals fixed.** Each segment is
   always the same share of the base, so the matrix shows churn *between*
   segments and can never show the base as a whole getting worse. Fixed
   thresholds are required for that question.

## 3. Sizing and refusal

| Segment size | Treatment |
|---|---|
| ≥ 500 | behavioural generalisations and rate comparisons |
| 100–499 | rates with intervals; generalisations flagged as indicative |
| 30–99 | the customer list, plus raw counts; no rate claims |
| < 30 | **the list only.** A list of 14 high-value customers is genuinely useful; a strategy derived from their behaviour is not |

Segment × category × period cuts thin out immediately. **List the refused cells
rather than leaving holes in the table.**

## 4. Targeting hygiene

Before a segment becomes a campaign audience:

- [ ] the active window is printed and derived, not borrowed
- [ ] the cut-point method is named and the boundaries printed
- [ ] monetary is gross profit, and returns are netted against the original order
- [ ] segment stability is reported; below 60% overall the segmentation is not a
      targeting basis
- [ ] boundary cases are excluded, or hysteresis is applied, and the excluded
      share is reported
- [ ] the identity match rate is reported, with the direction of its effect
- [ ] suppression rules are applied — unsubscribed, bounced, complained,
      recently contacted
- [ ] the unscored population (no qualifying order in the window) is reported
      rather than dropped
- [ ] the action for each targeted segment is stated, and it is not "discount
      the Champions"

## 5. What RFM does not do

| Question | RFM's answer | Where to go |
|---|---|---|
| Who will churn? | **it does not predict** | `churn-prediction-models`; RFM features are good inputs |
| Who will respond to this offer? | no | `supervised-propensity-models` |
| What is this customer worth going forward? | no — M is historical | predictive LTV in `cohort-and-ltv`, labelled modelled |
| What natural groups exist in our base? | no — the groups are imposed | `clustering-and-persona-discovery` |
| Did the campaign cause the recovery? | no | `incrementality-testing` |
| Who are our recent, frequent, profitable customers, and which valuable ones went quiet? | **yes, and clearly** | here |

**RFM's strength is explainability.** A marketer can read the rule, disagree
with a boundary, and act the same day. A propensity model is more accurate and
less arguable; use it where accuracy pays for the loss of transparency, and keep
RFM where the decision is a list someone has to trust.
