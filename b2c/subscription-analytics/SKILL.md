---
name: subscription-analytics
description: Use for consumer or B2B subscription analysis — MRR and ARR movement, new, expansion, contraction and churned revenue, trial-to-paid conversion, voluntary versus involuntary churn, and subscriber cohort survival. Splits involuntary (failed payment) churn from voluntary churn because dunning fixes one and not the other, and uses the compounding formula rather than dividing annual churn by twelve. Prevents a retention story that hides a solvable billing problem.
---

# Subscription analytics

The MRR movement waterfall is the spine of this domain. It either reconciles or
the model is wrong, and there is no third option. Everything else here —
churn splits, trial handling, ARR conventions — exists to keep the waterfall
honest.

## The MRR movement waterfall

```
Ending MRR = Starting MRR
           + New MRR
           + Expansion MRR
           − Contraction MRR
           − Churned MRR
           + Reactivation MRR
```

- **Grain:** month × (customer or subscription — declare which).
- **This must reconcile exactly.** Not approximately, not within tolerance
  beyond floating-point and proration rounding. **If it does not reconcile, the
  components are wrong and must not be presented.** A waterfall that does not
  close is five plausible numbers arranged to look like an explanation.
- The check:

```
residual = Ending MRR − (Starting + New + Expansion − Contraction − Churned + Reactivation)
pass if |residual| ÷ Ending MRR < 0.001
```

### The six components, defined so they partition

Every MRR delta between month `m−1` and month `m` belongs to **exactly one**
bucket. Overlap or gap is what breaks the reconciliation.

| Component | Definition | Grain | Common miscomputation |
|---|---|---|---|
| **New** | MRR from customers with no active subscription in `m−1` **and no prior active history** | customer | including returning customers, which belongs in reactivation and inflates new |
| **Expansion** | increase in MRR for customers active in **both** months | customer | counting a price increase applied by you as expansion — defensible, but declare it |
| **Contraction** | decrease in MRR for customers active in **both** months, not reaching zero | customer | including downgrades to zero, which are churn |
| **Churned** | MRR of customers active in `m−1` and **not active** in `m` | customer | including pauses, which are not churn |
| **Reactivation** | MRR from customers **not active** in `m−1` who **were** active at some earlier point | customer | bucketed as new, which overstates acquisition and understates the value of win-back |
| **Starting / Ending** | Σ MRR of active subscriptions on the first / last day of the month | customer | a mid-month snapshot, or a sum of subscription-months rather than a point-in-time state |

**Two rules make the partition hold:**

1. **Compute at the customer grain, not the subscription grain**, unless the
   business genuinely sells independent subscriptions to the same customer. At
   subscription grain, a customer who swaps plan A for plan B generates a churn
   and a new, when the truth is a contraction or an expansion of zero.
2. **Net within customer within month.** A customer who upgrades and downgrades
   in the same month contributes their **net** delta to one bucket, not a gross
   amount to two. Gross-in-both is the second most common cause of a
   non-reconciling waterfall.

### Where the events come from

The waterfall is built from a subscription-event stream, not from a current
state table:

```
fact_subscription_event
  customer_id, subscription_id, event_at, event_type, mrr_before, mrr_after,
  currency, plan_id, quantity, reason_code

event_type ∈ {start, upgrade, downgrade, quantity_change, price_change,
              pause, resume, cancel_scheduled, cancel_effective,
              payment_failed, payment_recovered, reactivate}
```

Build the monthly state by replaying events, then diff consecutive months. A
state table alone loses the ordering, and ordering is what distinguishes
"downgraded then cancelled" from "cancelled".

**Cancellation has two dates.** The date the customer clicked cancel and the
date the subscription actually ended are usually different, often by a month.
**Churn is dated on the effective end**, not the request. Dating it on the
request pulls churn forward and makes the current month look worse than it is.

## Voluntary and involuntary churn must be split

```
Involuntary churn = churned MRR where the terminating cause was a failed
                    payment or expired card
Voluntary churn   = churned MRR where the customer cancelled
```

- **Dunning, card-updater and retry logic fix involuntary churn and do nothing
  for voluntary.** Blending them hides a solvable billing problem inside a
  product narrative.
- **Involuntary is frequently 20–40% of gross churn in consumer subscriptions**
  and is the cheapest retention win available. Do not assume it is small; measure
  it.
- The split needs a terminating-cause signal: a `reason_code`, a
  payment-failure event within the dunning window before the cancellation, or a
  billing-system status. **Where no such signal exists, the split is
  `unavailable`** — do not infer it from the absence of a cancellation request,
  which also describes a passive lapse.
- **Recovered failures are not churn at all.** A payment that fails and succeeds
  on retry three days later never leaves the base. Counting failed payments as
  churn overstates it; counting only *effective* terminations is correct.

## Monthly churn is not annual churn ÷ 12

```
annual churn  = 1 − (1 − monthly churn)^12
monthly churn = 1 − (1 − annual churn)^(1/12)
```

At 5% monthly, annual churn is **46%, not 60%**. At 30% annual, monthly is
**2.9%, not 2.5%**. Getting this wrong materially misstates the annual number
and every LTV built on it.

The same compounding applies to retention: annual retention is the product of
twelve monthly retention rates, not the mean of them.

## Denominator choice changes the churn number

```
Customer churn (start-of-period) = churned customers ÷ customers at period start
Customer churn (average base)    = churned customers ÷ ((start + end) ÷ 2)
Revenue churn                    = churned MRR ÷ starting MRR
```

- **Start-of-period is the default** and is the convention most benchmarks use.
- **Average base gives a lower number** in a growing business, because the
  denominator includes customers who could not yet have churned. It is
  defensible for a fast-growing base; it is not comparable to a start-of-period
  figure.
- **Customer churn and revenue churn are different numbers**, and in a business
  where small customers churn more they differ a lot. Say which.
- **In-period new customers must be excluded from the denominator** under the
  start-of-period convention, or churn is diluted by customers who joined after
  the window opened.

## Trial-to-paid must be separated out

```
Trial→paid = trials converting to paid within N days of trial start
             ÷ trials starting in the cohort
```

- **Grain:** trial cohort.
- **Trials are not subscribers.** Including trial expiries in churn makes month-1
  cohort retention look catastrophic and makes the churn series depend on trial
  volume, which is a marketing input.
- **The conversion window `N` must be stated** and must exceed the trial length
  plus any grace period.
- Free-trial, paid-trial and freemium are three different objects. A freemium
  user who never pays is not a churned subscriber; they are a free user. Declare
  which population is in the base.

## Pauses, downgrades and reactivations are distinct states

| State | Not | Why it matters |
|---|---|---|
| **Pause** | churn | MRR goes to zero temporarily and returns; counting it as churn plus reactivation inflates both and distorts cohort survival |
| **Downgrade** | churn | contraction, unless it reaches zero |
| **Reactivation** | new | win-back has different economics and different acquisition cost; folding it into new overstates acquisition efficiency |
| **Cancel scheduled** | churn yet | the subscription is still active and still billing until the effective date |
| **Payment failed** | churn yet | most recover; only the effective termination is churn |

**Pauses need an explicit policy.** Either exclude paused customers from both
the base and churn (and say so), or treat a pause beyond N months as churn (and
say what N is). Silent handling produces a churn series that moves when the
pause policy changes.

## ARR is a run-rate, not revenue

- **ARR = annualised value of the recurring subscriptions active at a point in
  time.** It excludes one-time services. It is a **snapshot**, so "ARR for Q3"
  is ambiguous until you name the day.
- **ARR is not ASC 606 revenue.** A three-year prepaid deal is one booking, one
  billing, thirty-six months of recognised revenue and one cash event
  (`gtm-metric-dictionary` §4.1).
- **Usage-based and consumption revenue has no agreed ARR treatment.** The
  common approach — annualise a trailing 3 months — is a **choice, not a
  standard**, and trailing-1-month, trailing-12-month and
  committed-contract-value approaches all exist and give different numbers.
  **State the convention with the figure.** Where usage is seasonal, the
  trailing window choice dominates the answer.

## GRR is capped at 100%

```
GRR = (Starting ARR − churned ARR − downgrade ARR) ÷ Starting ARR
NRR = (Starting ARR − churn − downgrades + expansion) ÷ Starting ARR
```

**A GRR above 100% is a formula bug**, and the bug is nearly always expansion
leaking into the numerator. Treat it as a failing assertion, not a finding.

NRR carries five convention choices — cohort definition, in-period new logos,
FX treatment, chained-monthly versus point-to-point, and ARR- versus
count-weighted — each of which moves the number. Emit the convention alongside
(`gtm-metric-dictionary` §4.3).

## Answering

> **MRR grew from 412K to 438K last month. The waterfall reconciles to within
> 0.02%.**
>
> New 31K, expansion 14K, reactivation 3K, against contraction 9K and churn
> 13K. The headline growth is healthy, but the churn line is the story: 5.8K of
> the 13K was involuntary — failed payments and expired cards — which is 45% of
> gross churn and is the cheapest thing on this page to fix. Dunning and a
> card-updater address that 5.8K and do nothing for the other 7.2K.
>
> Gross revenue churn is 3.2% monthly on the start-of-period base. Annualised
> by compounding that is 32%, not the 38% you get from multiplying by twelve.
>
> Trial expiries are excluded from churn throughout; including them would put
> month-1 cohort retention near 40% and would make the churn series track trial
> volume rather than retention.
>
> One caveat on the split: 11% of cancellations have no terminating-cause code,
> and they are allocated to voluntary, so the involuntary figure is a floor.

## Honest limits

- **A waterfall that does not reconcile is not reported.** The residual is
  reported instead, with the diagnosis.
- **No terminating-cause signal: the voluntary/involuntary split is
  `unavailable`.** It is not inferred from the absence of a cancellation
  request, which also describes a passive lapse.
- **ARR on usage-based revenue is a stated convention, not a measurement.**
- **Churn rates computed on different denominators are not comparable**, and
  neither is a churn rate compared to a benchmark whose convention is unstated.
- **Cohort survival curves are truncated at the right.** Recent cohorts have
  not had time to churn and their retention is a ceiling, not a rate
  (`cohort-and-ltv`).
- **Nothing here is causal.** A churn improvement following a product change is
  a coincidence in time unless something was controlled.

## Core contracts this skill calls

- `answer-contract` — the reconciliation residual as a number, `unavailable`
  for the churn split without a cause signal, the denominator statement on every
  churn rate
- `provenance-block` — currency and FX on MRR (a multi-currency book's MRR moves
  on FX with no customer behaviour), the billing system's timezone for month
  boundaries, and the as-of date for every ARR snapshot
- `comparability-rules` — before churn or NRR is compared to any external
  benchmark, and before billing-system and warehouse figures are combined
- `warning-field-reader` — billing exports that exclude deleted customers,
  platform figures that have already converted currency
- `pagination-patterns` — subscription-event extraction is a bulk job spanning
  the full history, not a report call
- `rate-limit-governor` — replaying events across many months re-reads large
  ranges; extract once and compute locally

## References

- `references/mrr-waterfall.md` — the component definitions as executable
  logic, the reconciliation check, and the residual-diagnosis table
- `references/churn-and-retention.md` — churn denominators, the compounding
  formulas, the voluntary/involuntary split, and trial handling

## Related skills

- `cohort-and-ltv` for survival curves and LTV built on these events
- `gtm-metric-dictionary` §4 for ARR, GRR and NRR conventions
- `data-model-designer` for `fact_subscription_event`
- `ecommerce-analytics` where the business has both subscription and one-time
  revenue and the two must not be blended
- `rfm-and-value-segmentation` for value segments on the subscriber base
