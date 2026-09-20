---
name: ml-foundations-marketing
description: Use before building any machine-learning model on GTM data, and when someone asks whether AI or ML should be applied to a marketing or sales problem. Decides whether the problem is a prediction problem at all, whether enough clean labelled history exists, and whether a simple rule or aggregate would answer it better. Covers the train/validate/test split discipline for time-ordered GTM data, baseline requirements, and the leakage patterns specific to CRM and marketing data. Prevents a model built where a heuristic would do and a model trained on data that leaks the outcome.
---

# ML Foundations for Marketing

This is the gate in front of Tier 8 and Tier 9. Nothing else in those tiers runs
until this has answered three questions: **is it a prediction problem, is there
enough history, and would a rule do it better.**

Most GTM "ML projects" fail before a line of modelling code is written. They fail
at the label definition, at the split, or at a feature that could not have been
known when the prediction would have been made. Those failures do not produce an
error — they produce a model with excellent offline metrics and no production
value, which is much worse.

---

## 1. Is a model the right answer at all?

Run this before scoping anything. It is a real gate, not a formality.

| Ask | If the answer is... | Then |
|---|---|---|
| Is the output a **decision** someone will change their behaviour on? | No — it is a report | Build the aggregate, not the model |
| Does the decision need a **per-record** answer? | No — a segment-level rate is enough | Build the rate |
| Is there a **labelled outcome** with at least the minimum positives (§4)? | No | Rule-based, and start collecting the label |
| Would a **sorted list on one or two known-good fields** get most of the value? | Yes | Ship the list. Revisit in a quarter with measured shortfall |
| Is the **relationship stable** over the horizon the model will be used on? | No — the motion changes quarterly | Model will degrade faster than it can be retrained; use a rule |
| Is there an **owner** for retraining and monitoring? | No | Do not build. An unowned model is wrong within two quarters |

**A rule beats a model when any of these hold:**

- Fewer than a few hundred positive outcomes in the usable window.
- The decision is high-stakes and low-volume — a human reviews every case anyway,
  so explanation matters more than the marginal lift.
- The driver is known and mechanical: trial users who invited a teammate convert
  at 4× the rate of those who did not. That is a rule. A gradient-boosted tree
  will find the same thing and be harder to defend.
- The business motion changes faster than the retraining cadence.
- Regulatory or contractual constraints require a fully specified decision path.

**A model earns its keep when** the signal is spread across many weak features,
interactions matter, the volume is high enough that a few points of lift is real
money, and someone owns it. Say which of these applies, by name, in the go/no-go.

### The go/no-go output

```yaml
decision: go | no-go | go-with-rule-first
problem_type: classification | regression | uplift | forecasting | clustering | ranking
reason: "<one sentence naming the decision the output changes>"
label:
  definition: "<exact predicate>"
  horizon_days: <int>
  source_fields: [...]
  version: "v1 (2026-09-20)"
split_strategy: temporal | grouped-temporal | rolling-origin
baseline_to_beat: "<named baseline and its current measured performance>"
owner: "<role>"
retrain_cadence: "<interval or trigger>"
blocking_gaps: [...]
```

---

## 2. Baselines are mandatory and named

**A model that cannot beat its baseline is not earning its keep.** The baseline
is measured on the same holdout, with the same metric, before the model is built
— not reconstructed afterwards to flatter the result.

| Problem type | Mandatory baselines |
|---|---|
| Binary classification | Majority class; **the current business rule or existing score**; a single-best-feature split |
| Regression | The mean; the segment mean; last known value |
| Time series | **Naive (last value)**; seasonal naive (value at t−season); linear trend |
| Uplift | Random targeting at the same volume; propensity-ranked targeting |
| Ranking / lead scoring | The existing rule-based score, at the same list length |
| Clustering | The existing rule-based segmentation (e.g. RFM tiers) |

The existing business rule is the baseline that matters, because it is the thing
the model has to displace operationally. A model that beats "majority class" but
loses to the SDR team's current filter is a regression dressed as progress.

**Report baseline and model side by side, always, with the same confidence
interval treatment.** If the intervals overlap, say so.

---

## 3. Temporal splits, never random splits

GTM data has temporal structure — always. Random splitting leaks the future into
training, and the leak is invisible because the metrics improve.

### The three ways a random split leaks

1. **Future information.** A record from March in training and a record from
   January in test means the model saw the later period's conditions.
2. **Entity leakage.** The same account appears as several opportunities. A
   random split puts some of that account's opportunities in train and some in
   test, and the model learns the account, not the pattern.
3. **Cohort correlation.** Records created in the same week share campaign,
   pricing, product and seasonality. Splitting them apart makes the test set a
   near-duplicate of training.

### The correct split

```
|--------- train ---------|-- gap --|-- valid --|-- gap --|-- test --|
                           ^ embargo             ^ embargo
     time ------------------------------------------------------->
```

- **Cut by time, at the prediction point**, not by the outcome date. A record
  belongs to the period in which the *prediction would have been made*.
- **Embargo (gap) at least one label horizon.** If the label is "converted
  within 90 days", the last 90 days of the training window contain records whose
  outcome is not yet known; including them as negatives teaches the model that
  recent records do not convert. The embargo is the fix, and it is the single
  most-skipped step.
- **Group by entity on top of time.** An account may not straddle the boundary.
  `GroupShuffleSplit`-style grouping alone is not sufficient — it must be
  grouped *and* temporal.
- **Rolling-origin evaluation** for anything where the decision recurs: fit on
  [t0, t1], test on [t1, t1+h], roll forward, repeat. One holdout is one draw;
  the variance across folds is part of the finding.

```sql
-- the label-horizon censoring check, run before training
select
  count(*) filter (where prediction_ts > (select max(event_ts) from fact) - interval '90 days')
    as records_inside_unresolved_horizon
from training_set;
-- must be 0, or those rows are false negatives by construction
```

### Right-censoring is a real category, not an inconvenience

A record whose horizon has not elapsed is **censored**, not negative. Three
honest treatments, in order of preference:

1. Exclude it from training (the embargo).
2. Use a survival framing that handles censoring natively (see
   `churn-prediction-models`).
3. Include it, labelled censored, with sample weighting — and say you did.

Silently labelling it 0 is the fourth option and it is wrong.

---

## 4. Minimum sample sizes, stated as numbers

These are working floors for tabular GTM problems. They are rules of thumb with
a known direction of error: **below them the model is not necessarily wrong, but
you cannot tell whether it is**, because the evaluation set is too small to
distinguish it from the baseline.

| Problem | Floor | The binding constraint |
|---|---|---|
| Binary classification | **≥ 500 positives** in the usable window; ≥ 1,000 preferred | Positives, not rows. 200,000 leads with 80 conversions is an 80-row problem |
| Features per model | **≥ 10 positives per feature** as a hard floor, 20+ comfortable | Beyond this, tree ensembles memorise |
| Regression | ≥ 1,000 rows, and **≥ 100 rows in the top magnitude decile** | The tail is what you are wrong about |
| Uplift | **4–10× the propensity requirement** — run the power calculation | You are estimating a difference of two small rates |
| Time series, non-seasonal | ≥ 30 observations at the modelled frequency | |
| Time series, seasonal | **≥ 3 complete cycles**, 4+ preferred | 12 quarterly points cannot support annual seasonality |
| Clustering | ≥ 30 × (number of features) rows, and ≥ 50 per expected cluster | |
| Evaluation holdout | **≥ 100 positives in the test set**, or the confidence interval swamps the difference | |

**The test-set rule of thumb that settles most arguments:** with *p* positives
in the holdout, the standard error on a rate is roughly `sqrt(p)/p`. Thirty
positives gives ±18% relative — wide enough that a 10% lift is unmeasurable.
Give the number with that interval attached rather than refusing it.

**Below the floor, answer honestly and usefully:** report the achievable
precision, say what could be detected at that sample size, and recommend
improving the rule-based alternative while the label accumulates. Do not refuse
to produce any estimate — produce the estimate with its interval and name it
underpowered.

---

## 5. Target leakage, the GTM catalogue

Leakage is the single most common cause of a model with implausible offline
accuracy and no production value. Suspicious accuracy is a *symptom of leakage*
until proven otherwise. In GTM data it has five distinct shapes.

### 5.1 Post-outcome fields on closed records

The record's current state was written *by* the outcome.

- Stage-derived features on a closed opportunity — `StageName`, stage duration,
  "days in final stage", probability.
- "Days since last activity" computed against `now()` on a closed record: it
  measures how long ago the deal closed.
- Close date, close reason, loss reason, contract fields.
- Any `*_at`/`*_date` field that only populates on conversion.

**Test:** would this field have had this value the morning of the prediction?

### 5.2 Fields updated by the outcome process

- Owner reassignment that happens at handoff.
- Lifecycle stage / lead status advanced by the same automation that records the
  conversion.
- Lead source rewritten at MQL by an attribution tool.
- Amount edited at close (`amount`, and in multi-currency portals
  `amount_in_home_currency`, which is converted at a snapshotted rate — the rate
  itself is a post-hoc artefact).

### 5.3 Backfilled integration data

**The quiet one.** An integration writes a field retroactively across all
history: an enrichment vendor backfills firmographics on every record last
Tuesday; a touchpoint system recalculates attribution weights on its own
schedule, so a report over last quarter returns different numbers today than it
did last week; a CRM sync fills `SystemModstamp`-ordered fields on old records.

The field looks historical. It is not. It was written after the outcome, with
knowledge of the outcome's era, and often only for records that still exist.

**Detection:** compare the field's record-modified timestamp distribution against
the record's creation timestamp. A field whose population date clusters on one
recent date across ten years of records is backfilled.

```sql
select date_trunc('month', created_at)      as cohort,
       avg(case when enriched_industry is not null then 1 else 0 end) as coverage
from   accounts
group by 1 order by 1;
-- flat, high coverage across all cohorts on a field that is enriched
-- on creation = backfill. Coverage decaying with age = genuine.
```

### 5.4 Target-derived aggregates over the full dataset

Target encoding, out-of-fold statistics computed in-fold, "conversion rate of
this campaign" computed over all history including the row itself, standardising
using the full dataset's mean and standard deviation. Every aggregate a feature
depends on must be computed **from training data only, as of the prediction
point**.

### 5.5 Identity leakage

A feature that is a near-unique key — record ID, an email domain in a dataset
where one domain is one outcome, a campaign that ran for one week and converted
everyone. The model memorises the key.

### The leakage audit, run before every training run

1. **Rank features by single-feature AUC.** Anything above ~0.80 alone is
   suspect. Investigate before celebrating.
2. **Check timestamps.** For each feature, the source field's last-modified
   distribution versus the prediction timestamp.
3. **Ablate the top feature** and retrain. If performance collapses from 0.95 to
   0.62, that feature was the model.
4. **Sanity-read the top features aloud.** "Had a demo predicts closing" is a
   tautology, not an insight. "Renewal opportunity exists predicts renewal" is
   the label restated.
5. **Score a record as of a past date and compare to the stored score from that
   date.** If they differ, a feature is not point-in-time. This is the definitive
   test and `feature-engineering-gtm` builds the harness for it.

**Plausibility floor:** for B2B conversion, win, or churn prediction on honest
point-in-time features, expect test AUC in the **0.65–0.80** band. Above 0.90,
assume leakage and prove otherwise. This is a prior, not a law — say it as one.

---

## 6. Label definition is a business decision, and it is versioned

"Churned", "qualified", "converted", "engaged" are threshold choices, not facts.

Every label carries:

```yaml
label_version: "mql-v3"
effective_from: "2026-04-01"
predicate: "lifecycle stage reached SQL within 90 days of creation"
horizon_days: 90
positive_definition: "<exact>"
negative_definition: "<exact — and distinguish from censored>"
excluded: ["test records", "internal domains", "records created before the CRM migration"]
superseded_by: null
```

**A label redefined mid-history silently trains the model on two different
problems.** If the definition changed, either restrict the window to one
definition, or recompute the old period under the new definition from raw
fields — and say which you did. Never train across the seam.

Mark any trendline that crosses a label-version boundary on the output. The
`provenance-block` contract carries the label version alongside the metric
version.

---

## 7. Class imbalance is the normal condition

Win rates, conversion rates, churn rates, and reply rates are all small. A 3%
base rate means a model predicting "no" every time is 97% accurate.

**Accuracy is rejected for imbalanced problems. Explicitly, in the output.**

| Technique | When it helps | What it costs |
|---|---|---|
| **Class weights** (`class_weight='balanced'`, `scale_pos_weight`) | Almost always the first move; no data is discarded | Distorts predicted probabilities — recalibrate after |
| **Threshold tuning** on the raw model | Always. Often the *only* thing needed | Nothing. Do this before resampling |
| Random undersampling of the majority | Very large datasets where training cost binds | Discards data; increases variance |
| Random oversampling / SMOTE | Small positive counts | **SMOTE interpolates between records — on categorical GTM features this invents customers that do not exist.** Rarely the right tool here |
| Two-stage (coarse filter, then model) | Extreme imbalance, < 0.5% | Extra moving part |

**The order that works:** train on the natural distribution with class weights,
evaluate with precision-recall and top-decile lift, tune the threshold on cost,
and only then consider resampling. Resampling first is the common mistake and it
mostly buys a worse-calibrated model.

**Resampling changes the base rate, so it changes the meaning of every predicted
probability.** If you resample, recalibrate on a validation set with the true
base rate before anyone reads a score as a probability. See
`supervised-propensity-models` §calibration.

---

## 8. Interpretability is an adoption requirement

A sales leader who cannot interrogate a score overrides it. Once overridden, the
model's measured performance is polluted by the overrides, and you can no longer
tell whether it works.

**The interpretability floor for a model sales will act on:**

1. **A per-record reason, in business language, at prediction time.** Not a SHAP
   plot — three drivers, named in the vocabulary the rep uses: "Top signal:
   pricing page visited 3× this week. Second: 4 people from this account now
   engaged. Counter-signal: no meeting booked in 60 days."
2. **A global ranking of what the model uses**, checked for tautology.
3. **A worked example the leader picks.** Give them a record they know and walk
   the score. This single exercise decides adoption more often than any metric.
4. **A stated negative list** — what the score does not consider, so nobody
   assumes it read the notes.
5. **Monotonicity where the business expects it.** If more engagement must never
   lower the score, enforce monotone constraints (both XGBoost and LightGBM
   support them). A non-monotone blip in a plot destroys trust faster than a
   lower AUC.

**Feature importance is not causation.** A model that finds "had a demo"
predicts closing has found a tautology. Report importance as "what the model
leans on", never as "what drives the outcome". For "what would happen if we did
X", route to `uplift-and-causal-models`.

The honest trade: on tabular GTM data, logistic regression typically gives up
**2–5 AUC points** against a tuned gradient-boosted tree. If explanation is what
makes the model get used, that is a good trade and you should say so plainly
rather than treating the lift as free.

---

## 9. Declared dependencies (F33)

Any shipped model code declares its numerical and statistical libraries in the
project manifest. The recurring real-world defect: an analysis module imports a
library that appears nowhere in the declared dependencies, so it runs on the
author's machine and fails in a clean container.

```bash
# CI check: every third-party import must appear in the manifest
python - <<'PY'
import ast, pathlib, sys, tomllib
declared = set()
try:
    declared = set(tomllib.loads(pathlib.Path("pyproject.toml").read_text())
                   .get("project", {}).get("dependencies", []))
except FileNotFoundError:
    pass
declared = {d.split("[")[0].split("=")[0].split(">")[0].split("<")[0].strip().lower()
            for d in declared}
stdlib = set(sys.stdlib_module_names)
missing = set()
for p in pathlib.Path(".").rglob("*.py"):
    for node in ast.walk(ast.parse(p.read_text())):
        mod = None
        if isinstance(node, ast.Import):
            mod = node.names[0].name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            mod = node.module.split(".")[0]
        if mod and mod not in stdlib and mod.lower() not in declared:
            missing.add(mod)
print("UNDECLARED:", sorted(missing) or "none")
sys.exit(1 if missing else 0)
PY
```

Pin versions. `scikit-learn` changes default behaviour between minor versions —
an unpinned environment silently changes your model.

---

## 10. Cost, latency and the refresh reality

The go decision includes the operating cost, not just the build cost.

| Question | Why it decides the answer |
|---|---|
| Who retrains it, and on what cadence? | A model with no named owner is wrong within two quarters |
| What is the scoring latency budget? | Real-time scoring on a form submit is a different architecture from a nightly batch |
| Which features will exist at scoring time? | See `feature-engineering-gtm` §availability lag. A feature that arrives 48h late cannot serve a real-time score |
| What happens when the pipeline breaks? | A stale score looks exactly like a fresh one. Serve staleness alongside the score |
| What is the rollback? | The previous model version, or the rule. Both must remain runnable |

**Availability lag kills more real-time GTM models than accuracy does.** Ad
platform insights settle over weeks; web analytics reprocesses over a day or
two; CRM syncs run on a schedule. A model whose top feature arrives tomorrow
cannot score today.

---

## 11. Output

```yaml
go_no_go: go | no-go | go-with-rule-first
rationale: "<one sentence>"
problem_framing:
  type: classification | regression | uplift | forecasting | clustering | ranking
  unit_of_prediction: "<lead | contact | account | opportunity | account-week>"
  prediction_point: "<when the score is produced>"
  horizon_days: <int>
label:
  version, predicate, horizon, positives_available, censored_count
sample_adequacy:
  positives: <n>, floor: <n>, verdict: adequate | underpowered
  detectable_lift_at_this_n: "<±x% relative>"
split:
  strategy, boundaries, embargo_days, grouping_key
baselines:
  - name, metric, measured_value
leakage_audit:
  single_feature_auc_flags: [...]
  backfill_flags: [...]
  point_in_time_replay: pass | fail | not-run
imbalance:
  base_rate, treatment, accuracy_rejected: true
interpretability_plan: "<reason codes | monotone constraints | worked example>"
operations:
  owner, retrain_cadence, scoring_latency, rollback
dependencies_declared: true | false
```

---

## 12. Answering

**Answer first.** When someone asks "can we predict X", the answer is a verdict
and a number, not a questionnaire.

> **Yes, but a rule will get you most of it this quarter.** You have 214
> conversions in 14 months of usable history. That is below the 500-positive
> floor for a model you could evaluate confidently — at 214 positives the
> holdout supports roughly ±20% relative precision, so a model beating your
> current rule by 10% would be indistinguishable from noise.
>
> What you can do now: your current rule converts at 8%; leads matching both
> "pricing page visited" and "2+ contacts engaged" convert at 19% on the same
> history, n=61. That is a usable filter today, and it is defensible because
> anyone can read it.
>
> **For the model:** keep the label stable, and at ~500 conversions — roughly
> two more quarters at current volume — the evaluation becomes decisive. I would
> start logging point-in-time feature snapshots now, because the reason most
> teams cannot build this later is that the history is current-state only.
>
> Does not claim causality: leads that visit pricing convert better, which is not
> the same as the pricing page causing conversion.

**Withhold only** what cannot be computed: a performance estimate for a model
that has not been trained, a leakage verdict without access to the field
timestamps, a sample-size verdict when the label is undefined. In every one of
those, name the one input that resolves it.

---

## Calls

- `answer-contract` — every verdict and every number produced here
- `provenance-block` — carries `label_version` alongside `metric_version` on
  anything derived from a labelled dataset
- `comparability-rules` — before comparing model performance across periods,
  segments or label versions
- `warning-field-reader` — source caveats on the training extract (sampling,
  thresholding, truncation) propagate into the dataset

## References

- `references/leakage-catalogue.md` — the GTM leakage patterns with detection
  queries and the point-in-time replay harness
- `references/split-and-sample.md` — split recipes, embargo sizing, the power
  calculations behind §4, and rolling-origin evaluation

## Related skills

- `feature-engineering-gtm` — builds the point-in-time feature table this gate
  requires
- `gtm-metric-dictionary` — the label must be expressed in defined metric terms
- `data-model-designer` — SCD2 and snapshot tables are what make point-in-time
  features possible at all
- `model-evaluation-monitoring` — the acceptance protocol this gate's baselines
  feed into
- `supervised-propensity-models`, `churn-prediction-models`,
  `uplift-and-causal-models`, `timeseries-forecasting-models` — the branches
  this gate routes to
