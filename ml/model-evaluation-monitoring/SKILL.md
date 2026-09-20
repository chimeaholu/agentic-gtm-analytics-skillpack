---
name: model-evaluation-monitoring
description: Use when evaluating any GTM model before deployment and when monitoring one already in production. Defines the evaluation protocol appropriate to the problem type, requires a beaten baseline, checks segment-level and calibration performance rather than aggregate metrics alone, and sets up drift monitoring on features, predictions and outcomes with an owner and an action per alert. Prevents a model accepted on an aggregate metric and then degrading silently for two quarters because nobody was watching the right thing.
---

# Model Evaluation and Monitoring

Two jobs. **Before deployment:** decide whether the model is good enough, against
a baseline, on the metric the decision actually needs. **After deployment:**
notice when it stops being good enough, before two quarters of bad decisions have
been made.

The second job is where GTM models actually fail. A model degrades slowly, the
degradation looks like market conditions, and nobody is watching the specific
signal that would distinguish them.

---

## 1. Metric choice follows the decision, not convention

| Problem shape | Primary metric | Also required | Rejected |
|---|---|---|---|
| **Rare-positive targeting** (lead scoring, propensity, churn) | **Top-decile lift**, with its interval | PR-AUC against the base rate; calibration; precision/recall at the shipped threshold | **Accuracy, explicitly** |
| **Anything called a probability** | **Calibration** — ECE and the curve | Brier score | A ranking metric alone |
| **Uplift** | **Qini**, against random *and* against propensity-ranked | Decile uplift table with intervals | AUC — the individual effect is never observed |
| **Regression / value** | **MAE or RMSE chosen from error cost**; bias reported alongside | Residuals by magnitude decile and by segment; interval coverage | MAPE near zero |
| **Time series** | **MASE** at the real horizon | Rolling-origin spread; interval coverage; bias by horizon step | A single holdout |
| **Clustering** | **Stability (ARI)** and outcome differentiation | Per-cluster Jaccard; silhouette as a secondary | Silhouette alone |
| **Ranking / recommendation** | Precision@k **and coverage/diversity together** | Online test for any business claim | Offline metrics as a business claim |

**Two rules that cut across all of them:**

- **Accuracy is rejected for imbalanced problems, and the rejection is stated in
  the output** — not silently omitted. Otherwise someone compares your PR-AUC to
  a vendor's accuracy figure and reaches the wrong conclusion.
- **Every metric ships with its uncertainty.** A lift of "3.4×" computed on 31
  positives in the decile is `3.4 (2.6–4.2)`, and the interval changes what a
  reasonable person does with it.

---

## 2. A beaten baseline is an acceptance criterion

Not a courtesy, not a nice-to-have. **A model that does not beat its baseline
does not ship**, and the correct deliverable in that case is the baseline.

| Model type | The baseline that matters |
|---|---|
| Lead scoring | **The existing rule-based score**, at the same list length |
| Propensity | The current business rule; majority class as a floor |
| Churn | The existing health score |
| Regression | Segment mean; last known value |
| Time series | Naive and seasonal naive at the real horizon |
| Uplift | Random targeting at the same volume; propensity-ranked targeting |
| Clustering | The existing rule-based segmentation |
| Recommendation | Segment-conditioned popularity |

**The rules that make the comparison honest:**

1. **Measure the baseline on the same holdout, at the same time, with the same
   metric.** A baseline reconstructed afterwards from memory is not a baseline.
2. **Report the interval on the difference**, not just on each side. Overlapping
   intervals mean the improvement is unproven — say so.
3. **Price the operational cost.** A model beating a rule by 4% relative, needing
   a retraining pipeline, a feature store and an owner, is often a worse deal
   than the rule. State the trade rather than assuming the model wins.

---

## 3. Segment-level evaluation is mandatory

**A model with good aggregate performance can be worse than the baseline exactly
where the money is.** Enterprise deals are a small share of records and a large
share of revenue; an optimiser on the full set will trade them away without
telling you.

Break down by, at minimum: **deal-size or value band, region, channel or source,
tenure band (for churn), and the most recent period versus the training period.**

```
segment | n | positives | base_rate | model_lift | baseline_lift | interval | verdict
```

| Verdict | Consequence |
|---|---|
| Model wins materially | Deploy here |
| Indistinguishable | Deploy, note it; the model is not adding value in this segment |
| **Baseline wins** | **Exclude the segment from the deployment rule** and record it in the model card as out-of-scope |
| Too few positives to tell | Report the count and the detectable effect. Do not report a noisy metric as a finding |

**A split deployment — model for some segments, rule for others — is a better
outcome than one score everywhere.** It is also the finding that a single
aggregate number is structurally unable to produce.

---

## 4. Three drift channels, monitored separately

They are different signals requiring different responses, and collapsing them
into one "model health" number destroys the diagnostic value.

| Channel | What it watches | Measure |
|---|---|---|
| **Feature drift** | Input distributions | PSI per feature against the training baseline; missing rate; unknown-category rate |
| **Prediction drift** | Score distribution | PSI on score deciles; mean score; share above threshold |
| **Outcome drift** | The label rate and realised performance | Base rate; realised lift at the horizon; ECE |

### The diagnostic table — this is the useful part

| Feature | Prediction | Outcome | Most likely cause | Action |
|---|---|---|---|---|
| — | **drift** | — | **The scoring pipeline changed.** Cheapest to check, check first | Diff the pipeline; compare reference-cohort scores |
| **drift** | drift | — | Input mix changed; the relationship may still hold | Investigate the source; usually no retrain |
| — | — | **drift** | **The relationship changed** | **Retrain** |
| **drift** | drift | drift | The business genuinely changed | Retrain, and revisit the problem framing |
| — | — | calibration only | Base-rate shift | **Recalibrate; a full retrain may be unnecessary** |

**Prediction drift with no feature drift is almost always an engineering
problem**, not a market one, and it is the cheapest thing to rule out. The
reference cohort (§5) settles it in one query.

```
PSI = Σ over bins of (actual% − expected%) × ln(actual% / expected%)
```

Working thresholds: **PSI > 0.1 investigate, > 0.25 act.** Bin on the training
deciles, not on equal widths, or a skewed feature puts everything in one bin and
the measure goes blind.

---

## 5. Pipeline failure alerts louder than metric movement

**A broken feature pipeline and a genuine market shift look identical on a
metric chart.** The pipeline check is cheap, unambiguous and fires first — the
same rule `data-quality-harness` applies to data.

| Check | Threshold | Severity |
|---|---|---|
| Any feature 100% null in a scoring batch | any | **Critical — page** |
| Any feature constant across the batch | any | **Critical** |
| Scoring batch row count vs expected | ±30% | **Critical** |
| Feature freshness beyond its declared lag | any | **Critical** |
| Unknown-category rate vs baseline | > 2× | High |
| Missing rate shift on any feature | ±10pp absolute | High |
| Score distribution PSI | > 0.25 | High |
| Realised lift vs acceptance | < 80% of accepted | Medium — investigate before retraining |

### The reference cohort

**Score the same fixed set of historical records on every run.** Their features
do not change, so their scores must not either.

```sql
select run_date,
       avg(score)                                as mean_score,
       corr(score, baseline_score)               as rank_agreement
from   reference_cohort_scores
group by 1 order by 1 desc limit 10;
```

Any movement is the model or the pipeline — **never the market**. This one query
separates the two causes that otherwise take a week to argue about, and it costs
a few hundred rows of scoring per run.

---

## 6. Every alert names an owner and an action

**An alert that fires weekly is furniture.** Within a month nobody reads it, and
the one that mattered is lost in the noise.

```yaml
- alert: score_distribution_psi
  measure: "PSI of score deciles vs training baseline"
  threshold: 0.25
  window: "7-day rolling"
  severity: high
  owner: "<role that owns the model>"
  action: |
    1. Check the reference cohort. If it also moved, it is the pipeline — stop here.
    2. If not, check feature PSI to find which inputs moved.
    3. If outcome rate also moved, open a retraining ticket.
  expected_frequency: "< once per quarter"
  suppression: "suppressed during declared migration windows"
```

**`expected_frequency` is the field that keeps the system honest.** An alert
firing far more often than expected is mistuned, and mistuned alerts are
retired, not ignored.

**Alert on the scoring population, not on the training data.** The training set
is frozen; the population is what changed.

---

## 7. Retraining triggers, defined up front

Three legitimate triggers. Pick and write them down before deployment, because
choosing afterwards means choosing while the model is already failing.

| Trigger | Definition | Fits |
|---|---|---|
| **Schedule** | Fixed cadence — monthly, quarterly | Stable motions; simple to operate |
| **Drift threshold** | Outcome drift or feature PSI beyond a bound | Variable environments |
| **Performance floor** | Realised lift falls below an agreed fraction of accepted performance | The most principled; needs outcomes to have resolved |

**The horizon problem:** realised performance is only measurable after the label
horizon elapses. A 90-day churn model cannot be evaluated on this month's scores
for three months. **Monitor prediction and feature drift as leading indicators,
and treat realised performance as the confirming lagging one.**

**Retraining is a gated action**, not an automatic one:

- The new model is evaluated against the **old model** and the **original
  baseline**, on a fresh holdout.
- A retrained model that does not beat the incumbent does not replace it.
- **Label-version and feature-version changes are breaking changes**, not
  retrains. Treat them as new models with new acceptance.
- **The previous version stays runnable.** A rollback nobody has tested is not a
  rollback. Passes `write-gate`.

**Automatic retraining on a schedule with no acceptance gate is how a model
silently gets worse**, because each retrain inherits the last one's drift and
nobody compares.

---

## 8. The model card ships with the model

Not documentation — the artefact that makes the model auditable and reusable, and
the thing that stops it being used for a purpose it was never validated for.

**Minimum contents:** intended use and the decision it informs; in-scope and
**out-of-scope populations with reasons**; training window and label version;
features with their point-in-time status and the ones excluded for leakage;
evaluation against baselines with intervals; segment performance; calibration and
its statement; the shipped threshold and its derivation; the monitoring
specification; the retraining trigger; the owner; the rollback; and **the
explicit list of what the model must not be used for.**

**The "must not be used for" list is the most valuable section**, because the
most common post-deployment failure is a model repurposed without re-validation —
a lead-conversion score used to forecast revenue, a churn-risk score used to
decide who gets a discount (a propensity-versus-uplift error), a model validated
on mid-market applied to enterprise.

The full template lives in `supervised-propensity-models/references/model-card-template.md`;
this skill owns the requirement and the acceptance of it.

---

## 9. Output

```yaml
acceptance:
  problem_type, primary_metric, metric_rationale
  model_value, interval
  baselines: [{name, value, interval}]
  beats_baseline: bool
  difference_interval: [lo, hi]
  overlapping: bool
  accuracy_rejected: true | n/a
  operational_cost_note: "<what the model costs to run vs the rule>"
calibration:
  applicable: bool, method, ece, brier, statement
segments:
  - {name, n, positives, model, baseline, interval, verdict}
  deployment_rule: "<model for X, baseline for Y>"
  out_of_scope: [{segment, reason}]
monitoring_spec:
  feature_drift:    {measure: PSI, bins: training_deciles, investigate: 0.1, act: 0.25}
  prediction_drift: {measure: PSI on score deciles, act: 0.25}
  outcome_drift:    {measure: base rate + realised lift, window, lag: <horizon>}
  calibration:      {measure: ECE, act: 0.05}
  pipeline:         [{check, threshold, severity}]
  reference_cohort: {n, cadence}
  alerts: [{alert, threshold, severity, owner, action, expected_frequency}]
retraining:
  trigger, cadence, gate, rollback, previous_version_runnable: bool
model_card: present | missing
  must_not_be_used_for: [...]
verdict: accept | accept_with_scope_limits | reject_use_baseline
```

---

## 10. Answering

**Answer first: the verdict, the number, the scope limit.**

> **Accept it for mid-market and SMB, keep the rule for enterprise.**
>
> Top-decile lift is 3.4× (2.6–4.2, 31 positives in the decile) against your
> existing rule's 2.1× (1.6–2.7) on the same holdout. The intervals do not
> overlap, so the improvement is real, and PR-AUC is 0.21 against a 4.1% base
> rate. Accuracy is not reported and would be misleading here — a model
> predicting "no" every time scores 96% on this base rate.
>
> **The scope limit is the finding.** On enterprise the model gets 1.2× against
> the rule's 1.6×, on 44 positives — the interval is wide, but it points the
> wrong way and there is no reason to take the risk. That segment stays on the
> rule and is recorded as out-of-scope in the card.
>
> **Monitoring is the part that decides whether this is still true in six
> months.** Three channels, separately: feature PSI, score PSI, and realised
> lift. The realised number lags 90 days behind scoring because that is the
> label horizon, so the drift channels are the leading indicators and realised
> lift is the confirmation. There is a 500-record reference cohort scored every
> run — if scores move there, it is the pipeline, not the market, and that
> distinction is what usually takes a week to establish.
>
> **One caveat worth a sentence:** the model was trained on a period before the
> segmentation change in the CRM, so its enterprise definition is the old one.
> That is part of why the enterprise result is poor, and it is worth revisiting
> after two more quarters of data under the new definition.

**Withhold only** what cannot be computed: realised performance before the label
horizon has elapsed (give the drift channels, which are available now, and name
the date the real number arrives), segment metrics with too few positives (give
the count and the detectable effect), and an acceptance verdict with no baseline
— in that case, say the baseline is the missing input and name the two queries
that would produce it.

---

## Calls

- `answer-contract` — every metric, verdict and alert; and the `partial` result
  where realised performance is not yet measurable
- `provenance-block` — training window, label version, feature version and
  freshness on every evaluation
- `comparability-rules` — **before comparing model versions, periods or
  segments**; a label-version or feature-version change makes two results
  incomparable
- `warning-field-reader` — extract caveats on evaluation data; a sampled or
  truncated holdout produces a performance figure that is not what it appears
- `write-gate` — **retraining and model promotion are gated writes**; so is
  pushing scores to any downstream system

## References

- `references/drift-and-alerting.md` — PSI computation, the three-channel
  diagnostic, the reference cohort and the alert schema
- `references/acceptance-protocols.md` — per-problem-type acceptance checklists
  with the metrics, baselines and intervals required

## Related skills

- `ml-foundations-marketing` — sets the baselines this skill enforces
- `supervised-propensity-models`, `regression-and-value-models`,
  `churn-prediction-models`, `uplift-and-causal-models`,
  `timeseries-forecasting-models`, `clustering-and-persona-discovery`,
  `recommendation-systems` — the models this skill accepts or rejects
- `ml-lead-scoring`, `scoring-model-evaluation` — the Tier 9 applications
- `data-quality-harness` — the pipeline checks under the feature layer
- `anomaly-detection` — the same alerting discipline applied to business metrics
- `feature-engineering-gtm` — emits the drift baseline this skill monitors against
