---
name: supervised-propensity-models
description: Use when predicting a binary GTM outcome — will this lead convert, will this opportunity close, will this account buy, will this trial upgrade. Covers model selection for tabular GTM data, class imbalance, calibration so a predicted probability means what it says, threshold selection tied to the actual business cost of a false positive versus a false negative, and explanation good enough for a sales leader to accept. Prevents an uncalibrated score being read as a probability and a threshold chosen by convention rather than by cost.
---

# Supervised Propensity Models

Binary outcome, per-record probability, a decision attached. The modelling is the
easy part; the four things that decide whether it works are **calibration, the
threshold, the segment breakdown, and whether anyone can explain it.**

Run `ml-foundations-marketing` first. It owns the go/no-go, the label, the split
and the leakage audit. This skill assumes those are settled.

---

## 1. Model selection for tabular GTM data

| Model | Use when | Give up |
|---|---|---|
| **Logistic regression** (regularised) | Explanation is the binding constraint; few hundred positives; coefficients will be argued about | Typically **2–5 AUC points** against a tuned tree ensemble |
| **Gradient-boosted trees** (XGBoost / LightGBM / CatBoost) | The sensible default for tabular GTM data. Handles mixed types, interactions, missingness natively | Needs calibration; needs explanation tooling |
| **Random forest** | A robust middle: less tuning than boosting, better out-of-the-box calibration than boosting, handles noisy features | Usually 1–3 AUC points below tuned boosting; large models are slow to score |
| **Deep learning** | Rarely justified at GTM data volumes. Text or sequence inputs are the only honest case | Data hunger, opacity, operational cost. **Say this out loud rather than shipping it** |

**Recommended sequence, and it is short:** logistic regression as the
interpretable reference → gradient-boosted trees as the performance candidate →
pick on the margin between them against the *business* metric, not AUC. If the
tree is 0.02 AUC better and the logistic model will actually get used, take the
logistic model.

### Practical defaults that survive contact with GTM data

```python
# gradient boosting, GTM-shaped starting point
params = dict(
    n_estimators=2000, learning_rate=0.03,
    max_depth=4,                    # shallow: GTM signal is mostly additive
    min_child_weight=20,            # ~ the positives-per-leaf floor
    subsample=0.8, colsample_bytree=0.8,
    reg_lambda=5.0,
    scale_pos_weight=neg/pos,       # class weighting, not resampling
    eval_metric="aucpr",            # PR, not ROC, on a rare positive
    early_stopping_rounds=100,
)
# monotone_constraints={"engaged_contacts_28d": 1, "days_since_last_event": -1}
# ^ where the business requires direction. Cheap trust, small accuracy cost.
```

`max_depth=4` and a high `min_child_weight` are deliberate: deep trees on a few
hundred positives memorise the training set and the damage shows up as a
beautiful validation curve on a leaking feature.

---

## 2. Calibration — the section that matters most

**An uncalibrated tree ensemble's "0.8" is a ranking position, not an 80%
chance.** Boosting with log-loss pushes scores towards 0 and 1; class weighting
and resampling shift them further. If anyone will read the output as a
probability — and in GTM they always will, because it goes into an expected-value
calculation — it must be calibrated.

### Measure first

```python
from sklearn.calibration import calibration_curve
prob_true, prob_pred = calibration_curve(y_test, p_test, n_bins=10,
                                         strategy="quantile")
# perfectly calibrated => prob_true == prob_pred on every bin
```

Report two numbers alongside the curve:

```
Expected Calibration Error (ECE) = Σ_bins (n_b / N) · |mean_pred_b − mean_actual_b|
Brier score                      = mean((p − y)²)      # lower is better
```

**ECE below about 0.02 is fine; above 0.05 the probabilities should not be quoted
as probabilities** until fixed. Use quantile bins, not equal-width — with a 3%
base rate, equal-width bins put everything in the first bin and the chart lies.

### Fix it

| Method | How | When |
|---|---|---|
| **Platt scaling** | Fit a logistic regression on the model's scores: `p_cal = σ(a·s + b)` | Small calibration sets (a few hundred positives). Two parameters, hard to overfit. Assumes a sigmoid-shaped distortion |
| **Isotonic regression** | Fit a non-decreasing step function from score to observed rate | Larger calibration sets (≥ ~1,000 positives). No shape assumption, more flexible, **overfits on small sets and produces flat plateaus** |

```python
from sklearn.calibration import CalibratedClassifierCV
cal = CalibratedClassifierCV(base_model, method="isotonic", cv="prefit")
cal.fit(X_calib, y_calib)       # a held-out calibration set, NOT the training set
```

**Rules that are not optional:**

1. **Calibrate on held-out data.** Calibrating on the training set produces a
   confident, wrong calibration curve.
2. **Three-way split:** train / calibrate / test, all temporally ordered. The
   calibration set sits between train and test in time.
3. **Recalibrate after any resampling or class weighting.** Both change the base
   rate the model implies. If you undersampled the majority class by factor *r*,
   the prior shift correction is
   `p_true = p_obs / (p_obs + (1 − p_obs)·r)` — but prefer refitting a
   calibration map on a set with the true base rate, which handles the rest of
   the distortion too.
4. **Calibration drifts when the base rate drifts.** Monitor ECE, not only AUC.
   Discrimination can be perfectly stable while calibration rots.
5. **Calibration does not change the ranking.** Both methods are monotone, so AUC
   is unchanged. Anyone claiming calibration improved their AUC has a bug.

### The sentence to put in the output

> A score of 0.80 means roughly 80 of every 100 such leads convert within the
> 90-day horizon — measured on the holdout, ECE 0.014. Within the top bin the
> observed rate was 78% (n=210, 95% CI 72–83%).

---

## 3. Thresholds come from cost, not from 0.5

0.5 is the right threshold only when a false positive and a false negative cost
the same and the score is calibrated. In GTM they never cost the same.

### The decision rule

Act when expected value is positive:

```
EV(act) = p · V_win − C_act
Act if   p > C_act / V_win           =  the cost-optimal threshold t*
```

With a per-error framing (`C_FP` = cost of acting on a non-converter, `C_FN` =
cost of missing a converter):

```
t* = C_FP / (C_FP + C_FN)
```

Worked: an SDR touch costs about 25 in loaded time; a missed opportunity is worth
about 1,200 in expected margin. `t* = 25 / (25 + 1200) ≈ 0.020`. **Two percent,
not fifty.** That is the whole point of this section — convention would have
thrown away 96% of the value.

### The capacity constraint usually binds harder than the cost

If the team can work 200 leads a week, the threshold is *whatever score the 200th
lead has*, recomputed as the distribution moves. Cost tells you whether working
200 is the right number; capacity tells you where the line falls this week.

```sql
-- capacity-derived threshold, recomputed each cycle
select min(score) as threshold
from  (select score,
              row_number() over (order by score desc) as rn
       from   scored_leads
       where  scored_at >= current_date - 7) x
where rn <= 200;
```

**Report both thresholds and the gap.** If the cost-optimal threshold admits
1,400 leads a week and capacity is 200, the finding is not the threshold — it is
that the team is leaving 1,200 positive-EV leads untouched, and that is a
staffing conversation with a number attached.

### Two thresholds, not one

A single cut wastes the middle. Three bands work better operationally:

| Band | Rule | Action |
|---|---|---|
| High | `p > t_capacity` | Worked now, full sequence |
| Medium | `t* < p ≤ t_capacity` | Automated nurture; positive EV but below the line |
| Low | `p ≤ t*` | No spend |

---

## 4. Evaluation on imbalanced GTM data

**Accuracy is rejected, explicitly, in the output.** On a 3% base rate,
predicting "no" every time scores 97%.

| Metric | What it tells you | When to lead with it |
|---|---|---|
| **PR-AUC (average precision)** | Performance on the rare positive class. **Baseline = the base rate**, so quote it against that | The primary offline metric for rare positives |
| **ROC-AUC** | Ranking quality across all thresholds. Insensitive to imbalance, which is both its virtue and why it looks flattering | Comparing models; never as the business number |
| **Lift @ decile k** | `precision@k / base_rate`. The business-facing number | The headline for a targeting model |
| **Precision / recall at the chosen threshold** | What actually happens operationally | Always, at the threshold you will ship |
| **Calibration (ECE, Brier)** | Whether the probability is a probability | Whenever the score feeds an EV calculation |
| **Accuracy** | Nothing useful here | Never |

```
lift@10% = (positives in top decile / records in top decile) / overall positive rate
```

**Report lift with its confidence interval.** A holdout with 100 positives has
roughly 25–35 in the top decile; the interval on that lift is wide, and a lift of
"3.1×" quoted bare is false precision. `sqrt(p)/p` on the decile's positive count
gives the rough relative error in one step.

**Quote PR-AUC against the base rate, always.** A PR-AUC of 0.18 sounds poor and
is excellent on a 3% base rate. Without the base rate the number is unreadable,
and a stakeholder will compare it to an accuracy figure they saw elsewhere.

---

## 5. Explanation that survives a sales leader

Three layers, all required.

**Global — what the model leans on.** Permutation importance on the holdout, not
the training set, and not the tree's built-in gain (which is biased towards
high-cardinality features). Check every top feature for tautology before showing
it.

**Local — why this record scored what it did.** SHAP values are the standard;
what actually gets used is the top three drivers rendered in business language:

> Score 0.71 (high). Top signals: four contacts engaged this month (+0.18),
> pricing page viewed twice this week (+0.11), company size in the band that
> converts best (+0.06). Counter-signal: no meeting booked in 60 days (−0.09).

**Counterfactual — what would change it.** "This account would move to high if a
second contact engaged." That is the sentence that makes a rep act.

### The tautology check, run before anything is shown

A model that finds "had a demo" predicts closing has found a definition, not an
insight. Screen every top feature:

1. Could this field only be true because the outcome is near? → leakage, back to
   `ml-foundations-marketing` §5.
2. Is this field *part of* the process that produces the outcome? → tautology.
   Keep it if it improves the score materially and is available at the prediction
   point, but **never narrate it as a driver.**
3. Is the direction what the business expects? An unexpected direction is either
   a real finding or a data bug, and it is a data bug more often.

**Importance is not causation.** State it in the output, once, plainly. For "what
happens if we do X", route to `uplift-and-causal-models`.

---

## 6. Segment-level performance is mandatory

**A model with good aggregate AUC can be worse than the baseline exactly where
the money is.** Enterprise deals are a small share of records and most of the
revenue; a model optimised on the full set will happily be mediocre there.

Break performance down by, at minimum:

- Deal size band or account segment
- Region
- Channel or lead source
- Industry, where volume allows
- **Time period** — most recent quarter versus training period

```
segment | n | positives | base_rate | lift@10% | model_PR-AUC | baseline_PR-AUC | verdict
```

**Any segment where the model loses to the baseline is a named limitation in the
model card and an exclusion in the deployment rule.** The honest deployment is
often "use the model for mid-market and SMB, keep the rule for enterprise", and
that is a better outcome than one score everywhere.

Where a segment has too few positives to evaluate, say so with the number rather
than reporting a noisy metric as if it were stable.

---

## 7. The motion-change failure

A model trained on a past GTM motion degrades when the motion changes — new ICP,
new pricing, a channel switched off, a product launch, a sales reorg. **The
degradation looks exactly like market conditions**, so it gets attributed to the
market and the model keeps running.

Distinguish them:

| Observation | Likely cause |
|---|---|
| Feature drift + prediction drift + outcome drift, all together | The business genuinely changed |
| Prediction drift, no feature drift | The scoring pipeline changed. Check first, it is cheap |
| Feature drift, no outcome drift | Input mix changed; the model may still be fine |
| **Outcome drift, no feature drift** | The relationship changed — retrain |
| Calibration degrading, ranking stable | Base-rate shift. Recalibrate; a full retrain may be unnecessary |

Two cheap guards, both set up at deployment:

- **Rolling performance on the most recent complete horizon**, compared against
  the training-period value, with the baseline recomputed alongside.
- **Score a fixed reference cohort** — the same 1,000 historical records, every
  run. Any movement is the model or the pipeline, never the market.

`model-evaluation-monitoring` owns the alerting and the retraining triggers.

---

## 8. Output

```yaml
model:
  type, library, version, hyperparameters, training_window, label_version
performance:
  primary_metric: pr_auc
  pr_auc: {model, baseline_is_base_rate, existing_rule}
  roc_auc: {model, existing_rule}
  lift_at_decile: {value, ci, n_positives_in_decile}
  accuracy_reported: false        # deliberately
calibration:
  method: platt | isotonic | none
  ece, brier, curve_points
  calibration_set: {rows, positives, window}
  statement: "a score of X means roughly X% within <horizon>"
threshold:
  cost_optimal: {value, c_fp, v_win, source_of_costs}
  capacity_derived: {value, weekly_capacity}
  shipped: <value>, rationale
  gap_finding: "<positive-EV volume above capacity, if any>"
segments:
  - name, n, positives, base_rate, model_lift, baseline_lift, verdict
explanation:
  global_importance: [...]        # permutation, holdout
  tautology_screen: pass | flagged: [...]
  local_method: shap
  monotone_constraints: {...}
limitations:
  - "<segment where the baseline wins>"
  - "importance is not causation"
  - "<what the model does not see>"
```

---

## 9. Answering

**Answer first, with the number and the threshold that follows from it.**

> **The model ranks well and your threshold is far too high.** Top-decile lift is
> 3.4× (95% CI 2.6–4.2, 31 positives in the decile), PR-AUC 0.21 against a 4.1%
> base rate, and it beats your current rule's 0.13 on the same holdout.
>
> It is calibrated — ECE 0.016 after isotonic — so 0.80 really does mean about
> 80%. At your stated 25 per touch and 1,200 per won deal, the cost-optimal
> threshold is 0.02, not the 0.5 currently in use. That admits about 1,400 leads
> a week against a capacity of 200, so the operational threshold is the 200th
> score, and the real finding is 1,200 positive-EV leads a week that nobody
> touches.
>
> **One limitation worth acting on:** on enterprise accounts the model is *worse*
> than your existing rule (lift 1.2× vs 1.6×, 44 positives — wide interval). Ship
> it for mid-market and SMB, keep the rule for enterprise, and revisit when the
> enterprise positive count supports an evaluation.
>
> Does not claim causality: high-scoring leads have also historically been worked
> harder, so some of the measured lift is the follow-up, not the lead.

**Withhold only** what cannot be computed: a probability from an uncalibrated
model (give the rank or the decile instead, and say why), a segment metric with
too few positives (give the count and the detectable effect), and a cost-optimal
threshold when no costs have been supplied — in that case give the capacity
threshold, which needs no cost inputs, and name the two numbers that would
produce the other one.

---

## Calls

- `answer-contract` — every score, lift and threshold that reaches a human
- `provenance-block` — training window, label version, source freshness, timezone
- `comparability-rules` — before comparing this model against a vendor score, a
  prior version, or a different period
- `warning-field-reader` — extraction caveats on the training data carry through
  into stated performance
- `write-gate` — pushing scores back into a CRM or an ad platform is a write

## References

- `references/calibration-and-thresholds.md` — calibration methods worked end to
  end, the EV arithmetic, and the capacity-threshold procedure
- `references/model-card-template.md` — the card that ships with the model

## Related skills

- `ml-foundations-marketing` — the gate, the label, the split, the leakage audit
- `feature-engineering-gtm` — the point-in-time feature table
- `model-evaluation-monitoring` — acceptance and post-deployment monitoring
- `ml-lead-scoring` — this skill applied to the lead-scoring problem specifically
- `churn-prediction-models` — the same machinery with a definitional problem in
  front of it
- `uplift-and-causal-models` — when the question is who to *influence*, not who
  will convert
- `segmentation-model-support` — turning the score into an operational segment
