# Churn, retention and trials

## 1. Churn definitions and denominators

```
Customer churn (start-of-period)
  = customers active at start who are not active at end ÷ customers active at start

Customer churn (average base)
  = churned customers ÷ ((start count + end count) ÷ 2)

Gross revenue churn
  = churned MRR ÷ starting MRR

Net revenue churn
  = (churned MRR + contraction − expansion) ÷ starting MRR
  ── can be negative, which is the point of it
```

| Convention | Property | When to use |
|---|---|---|
| Start-of-period | the default; most benchmarks use it | almost always |
| Average base | lower in a growing business, because the denominator includes customers who could not have churned yet | fast-growing bases, **and only when labelled** |
| Customer count | treats a small and a large customer identically | consumer subscriptions with uniform pricing |
| Revenue-weighted | what the business feels | anywhere pricing varies |

**In-period new customers are excluded from the start-of-period denominator.**
Including them dilutes churn by customers who joined after the window opened,
and the dilution grows with acquisition rate — so churn appears to improve
whenever marketing spends more.

**Customer churn and revenue churn diverge** whenever churn correlates with
customer size, which it usually does. Report both where they differ materially
and say which direction the difference runs.

## 2. Compounding

```
annual churn    = 1 − (1 − monthly churn)^12
monthly churn   = 1 − (1 − annual churn)^(1/12)
annual retention = (1 − monthly churn)^12
```

| Monthly churn | Annual churn (compounded) | Annual churn (×12, wrong) |
|---|---|---|
| 1% | 11.4% | 12% |
| 2% | 21.5% | 24% |
| 3% | 30.6% | 36% |
| 5% | 46.0% | 60% |
| 8% | 63.2% | 96% |

The error grows with the rate and is always in the same direction: **×12
overstates annual churn**. At 8% monthly it produces a figure above 100%, which
is the clearest possible signal that the formula is wrong.

Going the other way: **30% annual is 2.9% monthly, not 2.5%.**

## 3. Voluntary versus involuntary

```
Involuntary = churn where the terminating cause was a payment failure
Voluntary   = churn where the customer cancelled
```

**The signals that support the split**, in descending reliability:

1. An explicit `reason_code` or termination-cause field from the billing system.
2. A `payment_failed` event within the dunning window immediately preceding the
   effective termination, with no `cancel_scheduled` event.
3. Subscription status transitioning through a billing-system state such as
   past-due or unpaid before termination.

**Where none of these exists, the split is `unavailable`.** Do not infer
involuntary from the absence of a cancellation request — a passive lapse in a
manual-renewal model looks identical.

**Recovered failures are not churn.** A payment that fails and succeeds on retry
never leaves the base. Count only effective terminations, or the involuntary
figure is inflated by the dunning funnel's own throughput.

**Allocation of unknowns.** Where some terminations have no cause signal, state
the share and the allocation rule. Allocating unknowns to voluntary makes the
involuntary figure a **floor**; say which direction you chose and why.

Why the split matters commercially: dunning, retry schedules, card-updater
services and pre-expiry notifications address involuntary churn and do nothing
for voluntary. A blended churn number hides which lever applies, and involuntary
is frequently the largest single addressable slice in consumer subscriptions.

## 4. Trials

```
Trial→paid = trials converting to paid within N days of trial start
             ÷ trials starting in the cohort
```

- **Grain:** trial cohort (by start date).
- **N must exceed trial length plus any grace period**, and must be stated.
- **Trials are excluded from the subscriber base and from churn.** Including
  trial expiries makes month-1 cohort retention look catastrophic and ties the
  churn series to trial volume, which is a marketing input.
- **Free trial, paid trial and freemium are three populations.** A freemium user
  who never converts is not a churned subscriber. Declare which population the
  base contains.
- **Card-required and no-card trials convert at very different rates.** Blending
  them makes the conversion rate move when the trial design changes. Split.
- **Immature trial cohorts are lower bounds**, exactly as with any cohort.

## 5. Cohort survival

```
Retention(cohort c, month t) = customers from cohort c active in month t
                               ÷ customers in cohort c
```

- **Grain:** acquisition cohort × months since acquisition.
- **Compare cohorts at the same t**, never at their terminal points — an
  18-month-old cohort will always show more cumulative churn than a 3-month-old
  one.
- **Mark incomplete cohorts.** Recent cohorts have not had time to churn, so
  their retention is a ceiling.
- **Size the cohorts.** A 4-customer cohort's 75% retention is three customers;
  refuse below a stated minimum and give an interval instead.
- **Real churn curves flatten.** Early months churn hardest and the surviving
  base is progressively more durable. This is why the constant-churn closed form
  understates good businesses (`cohort-and-ltv`).

## 6. Pauses

Pauses break every naive churn computation because MRR goes to zero and returns.

| Policy | Definition | Consequence |
|---|---|---|
| Exclude from base and churn | paused customers are in neither numerator nor denominator | cleanest; churn measures active-base behaviour; base size shrinks |
| Churn after N months paused | a pause beyond N months is churn effective at month N | matches intuition; churn moves whenever N or the pause policy changes |
| Treat as churn immediately, resume as reactivation | pause = churn, resume = reactivation | inflates both churn and reactivation; not recommended, but must be declared if used |

**Whichever policy, apply it identically in the state table and in the waterfall
components**, or the waterfall will not reconcile and the residual will be
exactly the size of the paused base.

## 7. What these numbers do not claim

- A churn improvement following a product or pricing change is coincidence in
  time unless something was controlled.
- Churn rates on different denominators are not comparable to each other or to
  a benchmark whose convention is unstated.
- Cohort retention curves are descriptive; projecting them forward is a model
  and must be labelled one.
- The voluntary/involuntary split is only as good as the terminating-cause
  signal, and the unknown share belongs in the output.
