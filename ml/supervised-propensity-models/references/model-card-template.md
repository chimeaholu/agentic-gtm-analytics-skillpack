# Model card template

Ships with every model. If the card cannot be completed, the model is not ready.

```yaml
# ---------- identity ----------
model_name: <name>
version: <semver>
created: <date>
owner: <role, not a person's name>
status: candidate | shipped | deprecated
supersedes: <version or null>

# ---------- intended use ----------
intended_use: >
  One sentence: which decision, made by whom, at what moment.
in_scope_populations: [<segment>, ...]
out_of_scope_populations:
  - segment: <name>
    reason: "model loses to the existing rule (lift 1.2x vs 1.6x)"
must_not_be_used_for:
  - "estimating the effect of an intervention — this is propensity, not uplift"
  - "any population not in in_scope_populations"
  - "individual performance measurement of reps"

# ---------- data ----------
training_window: [<start>, <end>]
embargo_days: <int>
label:
  version: <label version>
  predicate: "<exact>"
  horizon_days: <int>
  positives: <n>
  censored_excluded: <n>
features:
  count: <n>
  dictionary: <path>
  point_in_time_status: {correct: n, partial: n, unverified: n}
  excluded_for_leakage: [<name: reason>, ...]
known_data_caveats:
  - "activity capture coverage 0.78; the model partly learns which reps log activity"
  - "enrichment coverage biased against small, non-US and private companies"

# ---------- evaluation ----------
split: temporal, grouped on <key>
baselines:
  - {name: majority_class, metric: pr_auc, value: <base rate>}
  - {name: existing_rule,  metric: pr_auc, value: <v>}
performance:
  pr_auc: <v>
  roc_auc: <v>
  lift_at_10pct: {value: <v>, ci: [<lo>, <hi>], positives_in_decile: <n>}
  accuracy: not_reported   # rejected for imbalanced problems
calibration:
  method: platt | isotonic
  ece: <v>
  brier: <v>
  statement: "a score of X means roughly X% within <horizon>"
segment_performance:
  - {segment, n, positives, base_rate, model_lift, baseline_lift, verdict}

# ---------- operation ----------
threshold:
  cost_optimal: <v>   # from C_act / V_win, with both inputs recorded
  capacity: <v>
  shipped: <v>
scoring:
  mode: realtime | hourly | daily | weekly
  feature_availability_constraint: "<slowest source and its lag>"
  latency_budget: <ms or hours>
monitoring:
  feature_drift: {measure: PSI, investigate: 0.1, act: 0.25}
  prediction_drift: {measure: PSI on score deciles}
  outcome_drift: {measure: base rate, window: <n> weeks}
  calibration: {measure: ECE, act: 0.05}
  pipeline: {any feature 100% null or constant -> immediate}
  reference_cohort: "<n> fixed historical records scored every run"
retraining:
  trigger: schedule | drift_threshold | performance_floor
  cadence: <interval>
  gate: "retraining is a gated action; see write-gate"
rollback: "<previous version or the rule; both remain runnable>"

# ---------- honesty ----------
does_not_claim:
  - "causality — no holdout ran; high scores have historically been worked harder"
  - "importance is not causation"
  - "performance outside the training window's GTM motion"
open_risks:
  - "<motion change expected in Q<n>; revisit>"
```
