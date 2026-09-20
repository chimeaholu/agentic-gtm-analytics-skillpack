# Decomposition, the voluntary split, and driver analysis

---

## 1. Mix, rate and interaction

```
R              = Σ_s  w_s · r_s                    # weights sum to 1
ΔR_mix         = Σ_s (w_s¹ − w_s⁰) · r_s⁰
ΔR_rate        = Σ_s  w_s⁰ · (r_s¹ − r_s⁰)
ΔR_interaction = Σ_s (w_s¹ − w_s⁰) · (r_s¹ − r_s⁰)
ΔR             = ΔR_mix + ΔR_rate + ΔR_interaction
```

**The identity is exact.** If your three components do not sum to the observed
change, the weights do not sum to one, a segment appeared or disappeared between
periods, or a segment definition changed. Find it; do not force it.

### Worked: retention "improves" while every segment declines

| Segment | w⁰ | r⁰ | w¹ | r¹ |
|---|---|---|---|---|
| SMB | 0.60 | 0.70 | 0.45 | 0.68 |
| Enterprise | 0.40 | 0.92 | 0.55 | 0.91 |

```
R⁰ = 0.60(0.70) + 0.40(0.92) = 0.7880
R¹ = 0.45(0.68) + 0.55(0.91) = 0.8065
ΔR = +0.0185 = +1.85pp

mix          = (−0.15)(0.70) + (+0.15)(0.92)  = −0.1050 + 0.1380 = +3.30pp
rate         = (0.60)(−0.02) + (0.40)(−0.01)  = −0.0120 − 0.0040 = −1.60pp
interaction  = (−0.15)(−0.02) + (0.15)(−0.01) = +0.0030 − 0.0015 = +0.15pp
                                                        total    = +1.85pp ✓
```

**Reading:** the business improved its blended retention by 1.85 points while
getting worse at retaining both kinds of customer. All of the gain, and more, is
the shift in acquisition mix toward enterprise.

**Say that explicitly.** "Retention improved 1.9 points" is not a false
statement and it is a misleading one, and the corrected version is one sentence
longer.

### Order dependence

Computing rate first and mix second assigns the interaction to the other term.
Neither order is correct in principle.

- **Declare the order.** "Mix computed at base-period rates, rate computed at
  base-period weights, interaction shown separately."
- **Show the interaction as its own line** rather than folding it into either.
  When it is small, this costs a row. When it is large, folding it is how a
  decomposition becomes an argument.

`revenue-waterfall` applies the identical discipline to revenue; use the same
declared order across both so the two reconcile.

---

## 2. The voluntary / involuntary split

### Evidence, in order of reliability

| Rank | Signal | Indicates |
|---|---|---|
| 1 | Subscription cancelled by the billing system after a failed final invoice | **involuntary** |
| 2 | Status was `past_due` or `unpaid` immediately before cancellation | **involuntary** |
| 3 | Cancellation initiated by an authenticated user in the UI | **voluntary** |
| 4 | Cancellation recorded by a CSM or rep with a reason | **voluntary** |
| 5 | No source recorded | **unknown — leave it unknown** |

```sql
select
  case
    when final_invoice_status in ('failed','uncollectible') then 'involuntary'
    when status_before_cancel in ('past_due','unpaid')      then 'involuntary'
    when cancel_source = 'user_ui'                          then 'voluntary'
    when cancel_source in ('csm','rep')                     then 'voluntary'
    else 'unknown'
  end as churn_type,
  count(*) as accounts,
  sum(mrr) as mrr
from cancellations
where cancel_ts between :start and :end
group by 1;
```

**Never default the unknown bucket to voluntary.** That is the direction that
makes the product look worse and the billing configuration look fine, and it is
the default nearly every report takes by accident. Report the unknown share as a
number; if it is large, reducing it is a cheap, concrete improvement to make
before the next analysis.

### Why the split changes the whole remedy

- **Involuntary** responds to dunning sequences, card-updater services, smarter
  retry timing, and pre-expiry outreach. These are configuration changes with
  fast, measurable effects.
- **Voluntary** responds to product, pricing, onboarding and support. These are
  slow, expensive and uncertain.

**A retention programme aimed at the wrong half shows no effect and gets
cancelled.** The split takes an afternoon and decides where a quarter of work
goes.

### Recovered involuntary churn

Accounts that fail payment and are recovered by dunning never appear as churn —
which is correct, and it means **dunning improvements show up as churn that did
not happen**, invisible unless you track the recovery rate directly:

```
dunning recovery rate = payments recovered / payments failed
```

Track it. It is the outcome metric for the involuntary half and it is not in any
retention number.

---

## 3. Driver analysis

What distinguishes retained from churned accounts. The discipline is in the
setup, not in the model.

### Setup rules

1. **Fixed observation window for every account** — usually the first 30 days —
   so that tenure cannot masquerade as a driver.
2. **Fully elapsed outcome window.** Only cohorts old enough to have churned or
   not.
3. **Exclude anything unavailable at prediction time**, including the
   cancellation event itself and any field the offboarding process writes. See
   `feature-engineering-gtm` — leakage here produces a model with excellent
   accuracy and no use.
4. **Segment before pooling.** SMB and enterprise have different drivers, and a
   pooled model finds the average of two different stories.

### Reporting a driver

Each driver ships with four things:

| Field | Why |
|---|---|
| **Direction and magnitude** | "accounts with no second user churn at 2.1× the rate" beats "user count is predictive" |
| **Observation window** | the defence against the survivorship artefact |
| **n on both sides** | small-n drivers are noise with a p-value |
| **Confounder note** | the obvious alternative explanation, named |

And the standing caveat: **drivers are correlational.** "Accounts with a second
user churn less" does not mean adding a second user reduces churn. The accounts
that added one were different already. The resolving evidence is an experiment
on the intervention, and `experiment-design-readout` is the route.

### The decomposition to run alongside

Before concluding that a driver explains a churn increase, check whether the
**population of that driver changed**. If accounts with no second user churn at
2.1×, and the share of such accounts rose from 30% to 45%, the churn increase is
a mix effect in the acquisition funnel, not a change in how any group behaves —
the same arithmetic as §1, applied to the driver rather than the segment.
