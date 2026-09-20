---
name: churn-prediction-models
description: Use when predicting customer or account churn, building a health score, or identifying at-risk revenue. Handles the definitional problem first — churn is a threshold decision, not a fact, and in non-contractual businesses the event is never observed — then the horizon choice, the survival framing where it fits, and the split between voluntary and involuntary churn that determines whether the model is even predicting the right thing. Prevents a churn model that predicts billing failures and is then used to drive customer-success outreach.
---

# Churn Prediction Models

Three decisions happen before any modelling, and getting them wrong makes the
model useless regardless of how well it is built:

1. **What counts as churn**, which is a choice and not a fact.
2. **Over what horizon**, because "at risk" with no horizon is unactionable.
3. **Voluntary or involuntary**, because they are different phenomena with
   different fixes and mixing them wastes the customer-success team.

Run `ml-foundations-marketing` first. The technique for the classifier itself is
in `supervised-propensity-models`; this skill owns what makes churn different.

---

## 1. Churn is a definition, and it must be versioned

### Contractual businesses have an event

Subscription cancelled, contract not renewed, auto-renew disabled. The event
exists, with a timestamp. Even here there are choices:

| Choice | Options | Consequence |
|---|---|---|
| Which date is the churn date? | Cancellation request / end of paid term / last access | Weeks apart. The features available differ at each |
| Does a downgrade count? | Full churn / partial / not churn | A 90% contraction that stays technically active is a churn the metric will miss |
| Does a pause count? | Churn / suspended / excluded | Pauses that never resume are churn recorded as neither |
| Winbacks? | New customer / returning / continuous | Affects both the label and the retention denominator |
| Which grain? | Logo / seat / revenue | **Logo churn and revenue churn can move in opposite directions.** A business losing many small accounts and expanding large ones churns badly on logos and grows on revenue |

### Non-contractual businesses have no event

Ecommerce, marketplaces, transactional B2B. **The customer never announces
departure, so churn is a window threshold** — "no purchase in N days" — and N is
an assumption.

Derive N from the data rather than picking 90 because it is round:

```sql
-- inter-purchase interval distribution among customers who DID come back
select percentile_cont(0.50) within group (order by gap_days) as p50,
       percentile_cont(0.80) within group (order by gap_days) as p80,
       percentile_cont(0.90) within group (order by gap_days) as p90,
       percentile_cont(0.95) within group (order by gap_days) as p95
from  (select customer_id, purchased_at,
              date_diff('day', lag(purchased_at)
                over (partition by customer_id order by purchased_at),
                purchased_at) as gap_days
       from   purchases) g
where  gap_days is not null;
```

A defensible N sits at the p90–p95 of observed return gaps: at p90, roughly 10%
of the customers you declare churned will come back. **State that number.** And
the threshold must be **segment-specific** — a monthly-replenishment buyer and an
annual buyer cannot share one lapse window.

The probabilistic alternative is better where the volume supports it:
BG/NBD-style models estimate `P(alive)` per customer from the purchase pattern
instead of thresholding. `rfm-and-value-segmentation` and the `lifetimes`-family
libraries cover this; compose rather than reimplement.

### Version the definition

```yaml
churn_label:
  version: "churn-v2"
  effective_from: "2026-04-01"
  type: contractual | non_contractual
  predicate: "subscription_status = 'cancelled' at the end of the paid term"
  grain: logo | seat | revenue
  downgrade_treatment: "contraction > 50% counts as churn"
  pause_treatment: "excluded; tracked separately"
  horizon_days: 90
  lapse_window_days: null        # non-contractual only
  expected_false_churn_rate: 0.10   # share who return after the window
  supersedes: "churn-v1"
```

**A trendline crossing a definition change is not a trend.** Mark it.

---

## 2. Split voluntary from involuntary before modelling

**Involuntary churn** is payment failure: expired card, insufficient funds,
issuer decline, failed retry. **Voluntary churn** is a decision.

They have almost nothing in common:

| | Involuntary | Voluntary |
|---|---|---|
| Top predictors | Card expiry date, payment method type, retry history, issuer, billing country | Usage decline, support friction, champion departure, contract dates, value realisation |
| Predictability | **High — legitimately AUC 0.85–0.95**, because card expiry is nearly deterministic | Moderate — 0.70–0.82 on honest features |
| Fix | Dunning, card updater, retry logic, pre-expiry prompts | Product, onboarding, CSM intervention, pricing |
| Owner | Billing / RevOps | Customer Success / Product |
| Share of total churn | Often **20–40%** in self-serve subscription businesses | The rest |

**The failure this prevents:** a combined model is dominated by the involuntary
signal because it is so much more predictable. It posts a great AUC, gets used to
drive CSM outreach, **and the CSM team spends its week calling customers whose
card expired** — which wastes the team and leaves the billing problem unfixed.

```sql
-- the split, before any modelling
select case when last_payment_status in ('declined','expired_card','insufficient_funds')
              and cancelled_by_user = false           then 'involuntary'
            when cancelled_by_user = true             then 'voluntary'
            else 'unclassified' end                   as churn_type,
       count(*), avg(mrr) as mean_mrr
from   churned group by 1;
```

**Report the split before reporting any model.** If involuntary is 30% of churn,
that is the first finding, and a dunning improvement is a cheaper win than any
model. If `unclassified` is large, say so — the split is then approximate, and
the approximation is in the direction of over-counting voluntary churn.

---

## 3. The horizon is part of the prediction

**"At risk" with no horizon is unactionable.** Different horizons are different
models:

| Horizon | Signal | Achievable performance | Action it supports |
|---|---|---|---|
| 30 days | Acute: usage collapse, support escalation, billing failure | Highest — the signal is loud | Immediate intervention; small actionable population |
| 60–90 days | Mixed: engagement decline, champion change, value gap | **The usual sweet spot for CSM programmes** | Structured intervention with time to work |
| 180+ days | Structural: fit, segment, contract terms | Lowest — closest to the base rate | Portfolio and segment strategy, not individual outreach |

**Choose the horizon from the intervention's lead time**, not from data
convenience. If a CSM save plan takes six weeks to run, a 30-day horizon gives no
room to act.

**Renewal-date alignment matters in B2B.** For annual contracts, risk is not
continuous — it concentrates at renewal. A rolling 90-day model on an annual
contract predicts almost nothing for ten months and everything in the last two.
Either model **time-to-renewal explicitly as a feature**, or score relative to
the renewal date ("risk at this renewal") rather than to the calendar.

---

## 4. Survival analysis where timing matters

A binary classifier at a fixed horizon throws away two things: **when** churn
happens, and the information in customers who have not churned **yet**.

**Censoring is the concept.** A customer active today has not churned — but that
is not the same as "will not churn". They are *right-censored*: we know their
tenure exceeds their current age, and nothing more. A binary classifier labels
them 0, which is wrong in a specific way — it treats "not yet" as "never".

| Method | Use | Gives |
|---|---|---|
| **Kaplan–Meier** | Descriptive retention curves by cohort or segment | The survival curve, with intervals. **The right first artefact, before any model** |
| **Cox proportional hazards** | Effect of covariates on the hazard rate | Hazard ratios — interpretable, and popular with executives |
| **Discrete-time survival** | Monthly/weekly panel, time-varying covariates | **The practical GTM choice**: one row per customer-period, a standard classifier on it, and time-varying features handled naturally |
| **Accelerated failure time** | When the covariate effect is on the timescale | Time-to-event directly |
| **Survival forests / gradient-boosted survival** | Non-linear, interactions | Flexibility, less interpretability |

**Discrete-time survival is the under-used practical answer.** Explode the data
into customer-month rows, label each with "churned in this month", fit any
classifier with `months_tenure` as a feature. You get a hazard curve, natural
handling of time-varying features, and no new library.

```sql
-- customer-month panel for discrete-time survival
select c.customer_id,
       m.month_start                                   as as_of,
       date_diff('month', c.started_at, m.month_start) as tenure_months,
       (c.churned_at is not null
        and date_trunc('month', c.churned_at) = m.month_start)::int as churned_this_month
from   customers c
join   months m
  on   m.month_start >= date_trunc('month', c.started_at)
 and   m.month_start <= coalesce(date_trunc('month', c.churned_at),
                                 date_trunc('month', current_date))
-- features joined as-of m.month_start, per feature-engineering-gtm
```

**Proportional hazards is an assumption, not a given.** Cox assumes covariate
effects are constant over time; in GTM they rarely are (onboarding problems
matter in month 1, price sensitivity at renewal). Test it — Schoenfeld residuals
— and if it fails, use discrete-time or stratify.

---

## 5. Leakage is severe here

Churn has the richest leakage surface of any GTM prediction problem, because the
churn *process* leaves traces all over the CRM before the churn *date*.

| Leaking field | Why |
|---|---|
| Support tickets tagged "cancellation" or "refund" | The customer has already decided |
| A downgrade already processed | The contraction is part of the outcome |
| A renewal opportunity marked lost | The label, restated |
| Auto-renew turned off | Often *is* the churn event under another name |
| Owner changed to a "save team" | The save process started because churn was flagged |
| Last-login recency computed against `now()` | Measures time since the account closed |
| Contract end date on a closed record | Post-outcome |
| NPS or survey response collected during the exit process | Post-decision |
| Discount applied in the final month | A retention offer — a response to the risk, not a predictor |

**Every feature must be computable from the state at the prediction point.** Run
the point-in-time replay from `feature-engineering-gtm`.

**The plausibility check for churn:** honest voluntary-churn models land in
**0.70–0.82 test AUC**. Above 0.90 on voluntary churn, assume leakage and prove
otherwise. Involuntary-churn models legitimately reach 0.85–0.95 — so a combined
model showing 0.93 is most likely an involuntary-churn model wearing a costume,
which is exactly the failure §2 exists to catch.

---

## 6. Evaluation: lift at the top, and revenue weighting

Churn base rates are small, so the metric discipline from
`supervised-propensity-models` applies in full: **accuracy rejected,
precision-recall over ROC, lift at the top decile as the business number,
calibration if the score is called a probability.**

Two additions specific to churn:

**Revenue-weighted evaluation.** Retaining a large account is worth more than a
small one. Report both the logo view and the revenue view:

```sql
select decile,
       count(*)                                     as accounts,
       avg(churned::int)                            as churn_rate,
       sum(mrr)                                     as mrr_in_decile,
       sum(case when churned then mrr else 0 end)   as mrr_at_risk_captured
from   scored group by 1 order by 1;
```

A model with good logo lift and poor revenue lift is optimising the wrong thing
for a CSM team whose job is revenue retention. **Say which one it is good at.**

**Calibration matters more than usual**, because churn scores feed revenue-at-risk
forecasts. An uncalibrated score multiplied by MRR produces a revenue-at-risk
number that is wrong by however much the calibration is off, and it goes into a
board deck.

**Segment the evaluation by tenure.** A model that predicts first-90-day churn
well and mature-account churn poorly is two models' worth of performance averaged
into one misleading number — and mature-account churn is usually the one with the
revenue attached.

---

## 7. Health scores are not churn models

A weighted-sum health score is **a rule**. That is fine — rules are stable,
explicable, and adjustable by the people who own the outcome.

**What is not fine is presenting a rule as a prediction without evaluating it as
one.** If a health score is used to predict churn, it gets the same treatment as
a model:

- The same baselines (majority class, existing process).
- The same lift-by-tier measurement with confidence intervals.
- The same calibration check if "red" is claimed to mean a churn probability.
- `scoring-model-evaluation` is the skill that runs this.

**The comparison to run, and it is usually decisive:** the health score's
top-decile lift against a trained model's, on the same holdout. The frequent
result is that the health score gets 60–70% of the model's lift for a fraction of
the operational cost, which is a legitimate reason to keep it. Report both.

---

## 8. The score is not the action

**The highest-risk customers are not necessarily the persuadable ones.** A
customer who has already decided to leave is high-risk and unsaveable; a customer
wavering at 40% risk may be entirely saveable.

Targeting retention spend on risk alone is the classic propensity-versus-uplift
error, and it is expensive because retention offers cost real money and can
backfire — a "we noticed you might leave" outreach that prompts a customer to
reconsider is a sleeping dog.

**Route to `uplift-and-causal-models` for whom to intervene on.** The minimum
honest version: hold out a randomised share of flagged accounts from the save
programme and measure the difference. Without it, the save rate is uninterpretable
— a programme "saving" 62% of flagged accounts may be saving 4%, and there is no
way to tell.

**Sequence the two:** this skill produces risk and revenue-at-risk. The uplift
model decides who gets the intervention. They are complementary, not competing.

---

## 9. Output

```yaml
definition:
  version, type, predicate, grain, horizon_days
  lapse_window_days, expected_false_churn_rate       # non-contractual
  downgrade_treatment, pause_treatment, winback_treatment
  definition_changes_in_window: [...]
churn_split:
  voluntary: {n, share, mrr}
  involuntary: {n, share, mrr}
  unclassified: {n, share, direction_of_error}
  finding: "<e.g. involuntary is 31% — dunning is the cheaper first fix>"
model:
  scope: voluntary | involuntary | combined_with_reason
  framing: binary_at_horizon | discrete_time_survival | cox
  horizon_days, features, label_version
  proportional_hazards_tested: pass | fail | n/a
performance:
  pr_auc, lift_at_decile: {logo, revenue_weighted}
  calibration: {method, ece}
  by_tenure_band: [...]
  by_segment: [...]
  plausibility_check: "AUC <v> against the 0.70-0.82 band for voluntary churn"
  baselines: {majority_class, existing_health_score}
survival:
  kaplan_meier_by_cohort: <curve>
  median_tenure, censoring_share
revenue_at_risk:
  value, basis: "calibrated probability × MRR", interval
health_score_comparison:
  score_lift, model_lift, verdict
action_routing:
  uplift_model: present | absent
  save_programme_holdout: present | absent
  warning_if_absent: "save rate is uninterpretable without a holdout"
```

---

## 10. Answering

**Answer first: the number, the split, and the action caveat.**

> **About 1.1M of ARR is at elevated risk over the next 90 days, concentrated in
> 74 accounts — and roughly a third of your churn problem is a billing problem,
> not a customer-success one.**
>
> Of last year's churn, 31% was involuntary: expired cards and failed retries. A
> card-updater and a better dunning sequence would address that, and it is
> cheaper than anything in this model.
>
> **The model here predicts voluntary churn only**, at 0.76 test AUC — squarely
> in the honest range for this problem, which is reassuring rather than
> disappointing. Top-decile lift is 3.8× on logos and 2.9× on revenue, so it is
> somewhat better at spotting small churners than large ones. It is calibrated
> (ECE 0.019), which is what makes the 1.1M figure meaningful rather than
> decorative; the interval on it is roughly 0.9M to 1.4M.
>
> **Two caveats, one sentence each.** The 90-day horizon was chosen to match your
> save-plan lead time, so this is not the same population a 30-day model would
> flag. And 12% of churn is unclassified between voluntary and involuntary, which
> means the voluntary share is slightly overstated.
>
> **The part that changes what you do:** this ranks *risk*, not *saveability*.
> The top decile includes accounts that have already decided. Before scaling the
> save programme, hold out a randomised 10% of flagged accounts — without it, the
> save rate you report next quarter cannot be interpreted, and you will not know
> whether the programme worked.

**Withhold only** what cannot be computed: a churn rate where the definition is
undefined (offer two defined variants with both numbers), revenue-at-risk from an
uncalibrated score (give the ranked account list instead, which needs no
calibration), a voluntary/involuntary split where billing status is not available
(say so and give the combined figure with the direction of error), and a save-rate
effectiveness claim with no holdout.

---

## Calls

- `answer-contract` — risk scores, revenue-at-risk, and the definitional
  `ambiguous` result when churn is undefined
- `provenance-block` — **label version and churn definition version** alongside
  the metric version; currency on any revenue-at-risk figure
- `comparability-rules` — before comparing churn rates across periods,
  definitions, segments or grains; logo churn and revenue churn are not
  comparable series
- `warning-field-reader` — billing and usage extract caveats propagate into both
  the label and the features
- `write-gate` — pushing risk scores or save-programme membership to a CRM

## References

- `references/definition-and-split.md` — the definition decision tree, lapse-window
  derivation, and the voluntary/involuntary classification
- `references/survival-methods.md` — Kaplan–Meier, Cox, and the discrete-time
  panel worked end to end

## Related skills

- `subscription-analytics` — the retention and NRR metrics this model's label
  must agree with
- `churn-retention-analysis` — the descriptive analysis that should precede the
  model
- `supervised-propensity-models` — the classifier machinery, calibration and
  thresholds
- `uplift-and-causal-models` — **whom to actually intervene on**
- `feature-engineering-gtm` — point-in-time features and the replay harness
- `model-evaluation-monitoring` — acceptance and drift
- `scoring-model-evaluation` — evaluating a health score as if it were a
  prediction, because it is being used as one
