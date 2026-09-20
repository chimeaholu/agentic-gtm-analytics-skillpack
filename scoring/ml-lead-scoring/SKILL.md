---
name: ml-lead-scoring
description: Use when replacing or augmenting rule-based lead scoring with a predictive model, or when evaluating whether a vendor's predictive scoring is worth adopting. States the data requirements honestly before building, keeps the model's output calibrated and thresholded to sales capacity, explains predictions well enough for a sales leader to accept them, and compares against the existing rule-based score as the baseline. Prevents a predictive score that beats nothing, degrades silently when the motion changes, and gets overridden because nobody can explain it.
---

# ML Lead Scoring

The most-requested model in GTM and the one with the highest failure rate. It
fails for organisational reasons more often than technical ones: **it beats
nothing, nobody can explain it, and sales overrides it — at which point its
measured performance is polluted by the overrides and you can no longer tell
whether it works.**

So the order here is deliberate: **requirements first, baseline second, model
third, explanation fourth, and threshold from capacity — never from a
percentile.**

---

## 1. The honest requirements, stated before the build

| Requirement | Floor | Why |
|---|---|---|
| **Clean history** | **18+ months** | Enough to cover a full cycle plus an embargo, and to see whether the motion is stable |
| **Positive outcomes** | **≥ 500 conversions** at the label horizon; 1,000 comfortable | Positives are the binding constraint, not row count |
| **Stable label definition** | No mid-history redefinition | A changed MQL/SQL definition trains the model on two problems |
| **Consistent stage semantics** | One meaning per stage across the window | A stage renamed or repurposed breaks the label |
| **Point-in-time features** | A snapshot or history source per feature | Current-state tables cannot produce a valid feature set |
| **An existing rule-based score** | Running, and measurable on the same holdout | It is the baseline the model must beat |
| **Sales capacity, in records worked** | A real number | The threshold comes from it |
| **An owner** | A named role | An unowned model is wrong within two quarters |

**Below these floors, say so and improve the rule-based score instead.** That is
not a consolation prize: a fit/behaviour rule with validated weights, decay and
caps (`demographic-fit-scoring`, `behavioural-activity-scoring`) is a genuinely
good scoring system, and it is what most teams should have before a model.

**And give the number anyway.** With 214 conversions you can still report what is
detectable at that sample, what the existing rule achieves, and which two rule
changes would move it most. Refusing outright sends the requester to a vendor who
will not mention the requirement at all.

```yaml
readiness:
  history_months: 14          # floor 18
  positives: 214              # floor 500
  label_stable: false         # redefined at month 9
  point_in_time_features: partial
  rule_baseline_measurable: true
  capacity_known: true
  verdict: not_ready
  detectable_lift_at_this_n: "±20% relative — a 10% improvement is unmeasurable"
  recommended_now: "improve the rule; start snapshot logging"
  revisit_when: "positives reach ~500, roughly two quarters at current volume"
```

---

## 2. The existing rule is the baseline

**Not majority class. Not random. The score sales is using today**, measured on
the same holdout, at the same list length, with the same metric.

```sql
-- both scores, same holdout, same list length
with ranked as (
  select person_id, converted,
         row_number() over (order by rule_score  desc) as rule_rank,
         row_number() over (order by model_score desc) as model_rank
  from   holdout_scores
)
select 'rule'  as scorer, avg(converted::int) as precision_at_k
from   ranked where rule_rank  <= :k
union all
select 'model', avg(converted::int)
from   ranked where model_rank <= :k;
```

**A predictive model that does not beat the rule materially is not worth the
operational cost** — a feature pipeline, a retraining cadence, monitoring, an
owner, and the organisational cost of a score nobody can read. Price that in.

**Report the interval on the difference.** Overlapping intervals mean the
improvement is unproven; say so rather than shipping on a point estimate.

**The comparison must be at equal list length.** A model evaluated at the top 500
against a rule evaluated at its natural MQL cut is not a comparison.

---

## 3. Model progression: logistic → forest → boosting

**Build all three. It takes an afternoon and it settles the accuracy-versus-
explanation argument with evidence instead of preference.**

### Logistic regression — the interpretable baseline

```python
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

logit = make_pipeline(
    StandardScaler(),
    LogisticRegression(penalty="l2", C=0.5, class_weight="balanced",
                       max_iter=2000),
)
```

- **Coefficients are the explanation**, and on standardised features they are
  directly comparable: `exp(β)` is the odds ratio per standard deviation.
- **Naturally well-calibrated** when fitted with log-loss and no resampling —
  often it needs no calibration step at all.
- Needs explicit handling of non-linearity (band the continuous features) and
  interactions (add them by hand, guided by the domain).
- **Works at a few hundred positives**, where tree ensembles overfit.

**Start here, always.** If it is within a couple of points of the boosted model,
ship it — an explicable score that gets used beats an accurate one that gets
overridden.

### Random forest — the robust middle

```python
from sklearn.ensemble import RandomForestClassifier
rf = RandomForestClassifier(n_estimators=500, max_depth=8,
                            min_samples_leaf=25, class_weight="balanced_subsample",
                            n_jobs=-1, random_state=42)
```

- Handles interactions and non-linearity without manual work.
- **Better out-of-the-box calibration than boosting** (its bias is towards the
  middle rather than the extremes), though it still needs checking.
- Less tuning-sensitive than boosting — a reasonable default when nobody will own
  hyperparameter maintenance.
- Slower to score at volume; large forests are heavy.

### Gradient boosting — the performance candidate

```python
params = dict(
    n_estimators=2000, learning_rate=0.03,
    max_depth=4,                    # shallow: GTM signal is mostly additive
    min_child_weight=20,
    subsample=0.8, colsample_bytree=0.8, reg_lambda=5.0,
    scale_pos_weight=neg / pos,
    eval_metric="aucpr",
    early_stopping_rounds=100,
    monotone_constraints={"engaged_contacts_28d": 1,
                          "days_since_last_event": -1},
)
```

- **Usually the best ranking performance** on tabular GTM data, by 2–5 AUC points
  over logistic regression.
- **Requires calibration** (§4). Its raw scores are pushed towards 0 and 1.
- **Monotone constraints are cheap trust.** If the business requires that more
  engagement never lowers the score, enforce it — the accuracy cost is small and
  a non-monotone blip in a partial-dependence plot destroys credibility faster
  than a lower AUC.

### The comparison table that decides it

```
model    | PR-AUC | lift@200 | ECE (pre-cal) | ECE (post-cal) | explainable
logistic |  0.19  |   2.9×   |     0.021     |      0.018     | coefficients
forest   |  0.21  |   3.2×   |     0.048     |      0.019     | importance + SHAP
boosting |  0.22  |   3.4×   |     0.110     |      0.014     | SHAP only
rule     |  0.13  |   2.1×   |      n/a      |       n/a      | fully readable
```

**Read it against adoption, not just accuracy.** The step from rule (2.1×) to
logistic (2.9×) is large and comes with an explicable model. The step from
logistic to boosting (3.4×) is real but smaller, and costs the explanation. Which
is right depends on whether the sales team will use it — which is a question you
should ask out loud rather than assume.

---

## 4. Calibration: a 0.8 must mean 80 percent

**Non-negotiable here**, because a lead score feeds expected-value arithmetic,
capacity planning and forecasts. An uncalibrated 0.8 is a rank position.

### Platt scaling

```python
from sklearn.calibration import CalibratedClassifierCV
cal = CalibratedClassifierCV(base_model, method="sigmoid", cv="prefit")
cal.fit(X_calib, y_calib)          # held-out calibration set
```

Fits a two-parameter logistic map from raw score to probability. **The right
choice below roughly 1,000 positives in the calibration set** — two parameters
are hard to overfit. Assumes a sigmoid-shaped distortion, which is what boosting
produces.

### Isotonic regression

```python
cal = CalibratedClassifierCV(base_model, method="isotonic", cv="prefit")
cal.fit(X_calib, y_calib)
```

Non-parametric, non-decreasing, no shape assumption. **Better above ~1,000
positives.** Two failure modes: it overfits on small sets, and it produces
plateaus where many raw scores map to one calibrated value — so **rank on the raw
score and quote the calibrated one.**

### The rules

1. **Three-way temporal split**: train / calibrate / test, in time order.
2. **Never calibrate on the training set.** You get a confident wrong curve.
3. **Recalibrate after any class weighting or resampling** — both change the
   implied base rate.
4. **Report ECE and the per-bin table**, with quantile bins. ECE under ~0.02 is
   fine; above ~0.05 the number should not be quoted as a probability until
   fixed.
5. **Calibration does not change the ranking.** Both methods are monotone, so
   PR-AUC and lift are unchanged. Anyone reporting that calibration improved
   their AUC has a bug.
6. **Monitor ECE after deployment.** Discrimination can be perfectly stable while
   calibration rots — a base-rate shift does exactly that, and **recalibration
   fixes it without a full retrain.**

**The sentence that goes in the output:**

> A score of 0.80 means roughly 80 of every 100 such leads convert within 90
> days. Measured on the holdout: top bin predicted 0.81, observed 0.78 (n=210,
> 95% CI 72–83%). ECE 0.014.

---

## 5. Leakage is the dominant technical risk

Lead scoring sits on CRM data, where the conversion process writes back into the
record. The catalogue from `ml-foundations-marketing` §5 applies in full; three
patterns dominate here:

| Pattern | Example |
|---|---|
| **Post-outcome CRM fields** | Lifecycle stage, lead status, MQL date, "became an SQL on" — all written by the conversion |
| **Fields written by the conversion process** | Owner reassigned at handoff, source re-stamped by an attribution tool, campaign membership added at MQL |
| **Backfilled integration data** | An enrichment vendor writing firmographics across all history last Tuesday; an attribution tool recalculating touchpoints retroactively |

**The plausibility band for lead → SQL on honest point-in-time features is
0.65–0.78 test AUC.** Above 0.85, assume leakage and prove otherwise. A model at
0.94 has almost always found a field that only populates on conversion.

**Run the full audit before reporting any number:** single-feature AUC screen,
field write-timestamp clustering, ablation of the top feature, and the
point-in-time replay where snapshots exist.

---

## 6. Thresholds come from capacity, not percentiles

**"Top 20%" is not a threshold.** The threshold is whatever score the *N*th
record has, where *N* is what the team actually works.

```sql
select min(score) as mql_threshold
from  (select score, row_number() over (order by score desc) as rn
       from   scored_leads where scored_at >= current_date - 7) x
where rn <= :weekly_capacity;
```

**Re-set it when capacity changes** — headcount, territory, a new channel — and
recompute it each cycle, because the score distribution moves.

**Also compute the cost-optimal threshold** `t* = cost_of_touch / value_of_won`
and report the gap. If `t*` admits 1,400 a week and capacity is 200, the finding
is 1,200 untouched positive-EV leads, which is a staffing or automation case with
a number attached. `segmentation-model-support` owns turning this into bands, a
refresh cadence and an activation path.

**Three bands beat one cut**: worked now, automated nurture, no spend. A single
threshold discards the middle, which is usually the largest positive-EV
population in the database.

---

## 7. Explanation is an adoption requirement

**A score a sales leader cannot interrogate gets overridden — and once overridden,
the model's measured performance is polluted by the overrides**, so you can no
longer evaluate it. This is the failure mode that kills most lead-scoring
projects, and it is organisational, not statistical.

**The floor:**

1. **Three drivers per lead, in the rep's vocabulary.**
   > 0.71 (high). Four contacts engaged this month (+0.18); pricing page viewed
   > twice this week (+0.11); company size in the best-converting band (+0.06).
   > Counter-signal: no meeting booked in 60 days (−0.09).
2. **A global ranking of what the model uses**, tautology-screened.
3. **A worked example the leader picks.** Hand them a lead they know and walk the
   score. This single exercise decides adoption more reliably than any metric.
4. **A stated negative list** — what the score does not see. Nobody should assume
   it read the call notes.
5. **Monotone constraints** where the business expects direction.
6. **Fit and behaviour remain separately visible**, even inside a combined model.
   Sales acts on them differently: a high-fit unengaged account is an outbound
   target; a low-fit engaged one is a disqualification conversation. See §8.

**Instrument the overrides.** Log when a rep works a low-scored lead or skips a
high-scored one, and evaluate those separately. A high override rate concentrated
in one segment is a finding about the model; spread evenly, it is a finding about
trust.

---

## 8. Fit and behaviour stay separately visible

Even when a single model consumes both, **the output surfaces both components.**

| Rendering | Use |
|---|---|
| Combined probability | Prioritisation, capacity planning, expected-value arithmetic |
| **Fit grade (A–D)** | Territory assignment, outbound targeting, ICP review |
| **Behaviour tier (1–4)** | Timing, sequence selection, routing |
| The grid cell (A1…D4) | **What the rep reads.** Fit and behaviour are different actions |

The two components are produced by `demographic-fit-scoring` and
`behavioural-activity-scoring`, and they remain the interpretable layer beneath
the model. When the model disagrees with the grid — a D-grade account scoring
high — **that disagreement is worth surfacing**, because it is either a real
finding about the ICP or a leak.

---

## 9. Evaluating a vendor's predictive score

**"Proprietary" is not an answer to any of the questions below.** A vendor score
gets exactly the same evaluation as an in-house model, run on your own data.

| Question | What to demand |
|---|---|
| **What is the baseline?** | Its lift against **your existing rule**, on **your holdout**, at **your list length** |
| **Is it calibrated?** | The reliability curve on your data. If the vendor cannot produce one, treat the score as a rank, not a probability — and say so |
| **Segment performance?** | The breakdown. Aggregate lift hides a model that is worse than your rule on enterprise |
| **What features?** | At minimum the feature *families*. If it uses third-party intent data, that is a different claim with a different error profile |
| **Point-in-time?** | Whether it was trained on point-in-time features. Most vendors cannot answer; the answer matters |
| **Explanation?** | Per-lead reasons in business language. Without them, adoption fails the same way |
| **Retraining?** | Cadence, and whether it is retrained on your data or a pooled model |
| **Drift handling?** | What happens when your motion changes |

**Run the evaluation yourself.** Score a historical holdout with the vendor tool,
compare against your rule at equal list length, and measure. Many vendor scores
do beat a weak rule; the point is to know by how much before paying for it, and
the measurement takes a day.

---

## 10. Output

```yaml
readiness:
  requirements_met: {...}, verdict, detectable_lift_at_this_n
  recommended_now, revisit_when
baseline:
  rule_version, rule_precision_at_k, rule_lift, k
models:
  - {type: logistic, pr_auc, lift_at_k, ece_pre, ece_post, explainability}
  - {type: random_forest, ...}
  - {type: gradient_boosting, ...}
  selected: <type>
  selection_rationale: "<accuracy vs adoption, stated>"
  vs_baseline: {delta, interval, overlapping: bool, operational_cost_note}
calibration:
  method, ece, brier, bin_table, statement
  ranking_basis: raw_score          # isotonic plateaus destroy within-bin rank
leakage_audit:
  single_feature_auc_flags, backfill_flags, ablation_result
  point_in_time_replay: pass | fail | unverified
  plausibility: "<AUC> against the 0.65-0.78 band for lead-to-SQL"
threshold:
  capacity: {value, weekly_capacity, recomputed: weekly}
  cost_optimal: {value, inputs}
  gap_finding: "<untouched positive-EV volume>"
  bands: [...]
explanation:
  per_lead_reasons: true
  global_importance, tautology_screen
  monotone_constraints, worked_example_delivered: bool
  negative_list: [...]
  override_logging: in_place | missing
axes:
  fit_grade_visible: true, behaviour_tier_visible: true
  model_vs_grid_disagreements: [...]
segments:
  - {segment, n, positives, model_lift, rule_lift, verdict}
  deployment_rule, out_of_scope: [...]
monitoring:
  motion_change_watch, reference_cohort, ece_monitoring, retrain_trigger
model_card: present
```

---

## 11. Answering

**Answer first: whether it beats the rule, by how much, and at what threshold.**

> **The model beats your current score by about 60% on top-of-list precision, and
> logistic regression gets most of that — I would ship the logistic one.**
>
> At your list length of 200 a week: the rule converts at 8.4%, logistic at
> 13.1%, gradient boosting at 14.0%. The gap between logistic and boosting is
> within the interval on 41 positives, so it is unproven, and the logistic model
> hands a sales leader a coefficient table they can argue with. That is worth
> more than half a point of precision.
>
> It is calibrated — ECE 0.018, and it barely needed it, which is one of
> logistic regression's advantages. A 0.80 means about 80%. **That is what makes
> the expected-value arithmetic below meaningful.**
>
> **On the threshold:** 0.5 is not the answer and neither is the top 20%. Your
> capacity is 200 a week, so the threshold is this week's 200th score, 0.34, and
> it needs recomputing weekly as the distribution moves. At 25 per touch and
> 1,200 per won deal, the break-even threshold is 0.02, which admits about 1,400
> leads — **so 1,200 positive-EV leads a week go untouched.** That is the more
> interesting number on this page and it is a staffing conversation, not a
> modelling one.
>
> **Two caveats, one sentence each.** Test AUC is 0.74, which sits inside the
> honest 0.65–0.78 band for lead-to-SQL — reassuring rather than disappointing,
> and I would have distrusted 0.9. And the model is trained on the motion before
> your segmentation change in March, so it should be revisited after two more
> quarters under the new definition.
>
> **One thing to do before rollout:** log the overrides. If reps work low-scored
> leads and skip high-scored ones, the model's measured performance next quarter
> will be a measurement of the overrides, not the model, and you will not be able
> to tell the difference.

**Withhold only** what cannot be computed: a performance claim for a model that
has not been trained, a probability from an uncalibrated model (give the decile's
observed rate instead), a segment metric with too few positives (give the count
and the detectable effect), and an acceptance verdict with no rule baseline
measured. Never withhold the readiness verdict, the rule's own performance, or
what could be improved in the rule today.

---

## Calls

- `answer-contract` — every lift, probability, threshold and readiness verdict
- `provenance-block` — training window, label version, scoring-rules version,
  feature freshness, timezone
- `comparability-rules` — before comparing the model against the rule, a vendor
  score, a prior version or another period; unequal list lengths are
  incomparable
- `warning-field-reader` — CRM and activity extract caveats propagate into both
  features and label
- `write-gate` — writing scores back to the CRM, and model promotion

## References

- `references/model-progression.md` — the three models with parameters, the
  comparison protocol and the adoption trade
- `references/calibration-and-vendor-eval.md` — calibration worked, and the
  vendor-score evaluation protocol

## Related skills

- `ml-foundations-marketing` — the gate, the split, the leakage catalogue
- `feature-engineering-gtm` — point-in-time features from CRM and activity data
- `supervised-propensity-models` — the general machinery this applies
- `demographic-fit-scoring`, `behavioural-activity-scoring` — the two axes, and
  the rule-based baseline this must beat
- `scoring-model-evaluation` — the post-deployment question: does it sort, and is
  anyone acting on it
- `model-evaluation-monitoring` — acceptance, drift, retraining triggers
- `segmentation-model-support` — turning the score into tiers with a refresh
  cadence and an activation path
