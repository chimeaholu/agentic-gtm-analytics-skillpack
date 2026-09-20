# Acceptance protocols by problem type

A checklist per problem type. Every item produces a number that goes in the
output. An unchecked item is a gap, and gaps are reported rather than skipped.

---

## 1. Binary classification / propensity / lead scoring

- [ ] Temporal (and entity-grouped) split, with an embargo of one label horizon
- [ ] Leakage audit: single-feature AUC screen, timestamp check, ablation of the
      top feature, point-in-time replay where snapshots exist
- [ ] **Baselines measured on the same holdout**: majority class, the existing
      business rule or score
- [ ] **Top-decile lift with a confidence interval**, and the positives-in-decile
      count
- [ ] PR-AUC quoted **against the base rate**
- [ ] **Accuracy explicitly not reported**, with one sentence saying why
- [ ] Calibration: method, ECE, Brier, the plain-language statement
- [ ] Threshold: cost-optimal and capacity-derived, both, with the gap
- [ ] Segment breakdown with a verdict per segment
- [ ] Plausibility check against the problem's honest AUC band
- [ ] Model card, including the must-not-be-used-for list

**Reject if:** it does not beat the existing rule with non-overlapping intervals,
or calibration is required and ECE is above ~0.05, or the leakage audit is
unresolved.

---

## 2. Regression / value models

- [ ] Target distribution profile: zero share, mean/median ratio, p99/p50,
      top-decile revenue share
- [ ] Structure decision justified: single model versus two-part
- [ ] **Predicted total versus actual total on the holdout** — the back-transform
      check
- [ ] Error metric chosen from the business cost, with the reasoning stated
- [ ] **Bias reported alongside the accuracy metric**
- [ ] Residuals by magnitude decile, by segment, by period
- [ ] Prediction intervals with **measured coverage against nominal**
- [ ] Baselines: mean, segment mean, last value
- [ ] Rank stability where the output drives prioritisation

**Reject if:** the predicted total is materially off actual with no stated
correction, or intervals are absent, or bias in the top magnitude decile is
material and unnamed.

---

## 3. Uplift

- [ ] **Randomisation verified**, including holdout integrity in the activity data
- [ ] Balance check on pre-treatment covariates, standardised differences reported
- [ ] Power calculation and the minimum detectable effect, **before** the model
- [ ] **Qini against random and against propensity-ranked targeting**
- [ ] Decile uplift table **with confidence intervals on every decile**
- [ ] Quadrant shares reported with uncertainty, and as inferences not observations
- [ ] Targeting depth from net value, with the interval propagated
- [ ] Where non-randomised: the identification strategy, its assumption in one
      plain sentence, its test, and a sensitivity bound

**Reject if:** uplift is claimed from observational data with no identification
strategy, or decile estimates are presented without intervals, or the sample
cannot support the claimed decile-level effects.

---

## 4. Time series

- [ ] Observation count against the frequency's minimum, seasonal and non-seasonal
- [ ] Complete seasonal cycles counted
- [ ] Seasonality **tested**, not assumed; seasonal strength reported
- [ ] Intervention register applied; detected changepoints reconciled against it
- [ ] Incomplete final period excluded or marked
- [ ] **Rolling-origin backtest at the real horizon**, with per-fold spread
- [ ] **MASE against naive and seasonal naive**
- [ ] Bias by horizon step
- [ ] Interval coverage: nominal versus measured, widened empirically if short
- [ ] Equal-maturity backtesting, or an explicit statement that results are
      optimistic by an unmeasured amount

**Reject if:** MASE ≥ 1 at the real horizon (ship the naive forecast instead), or
a seasonal model was fitted below the cycle minimum, or no interval is given.

---

## 5. Clustering

- [ ] Scaling declared, with the transform per feature
- [ ] Correlated blocks handled, with the choice stated
- [ ] k selection across at least three criteria including **stability**
- [ ] **Bootstrap ARI: mean and 10th percentile**
- [ ] **Per-cluster Jaccard**; clusters below ~0.5 reported as a remainder
- [ ] Temporal stability: re-score versus refit, both diagonals
- [ ] **Outcome differentiation with intervals, an omnibus test, and multiple-
      comparison correction**
- [ ] Reproducibility: persisted scoring artefact **and** surrogate rules with
      their fidelity

**Reject if:** mean ARI is below ~0.4, or no outcome differs across clusters and
the segmentation is intended to drive targeting, or there is no way to assign a
new record.

---

## 6. Recommendation

- [ ] Matrix viability assessed: density, interactions per user, per item
- [ ] **Segment-conditioned popularity baseline**, not just global popularity
- [ ] Temporal split
- [ ] Precision@k / NDCG **with the baseline's value alongside**
- [ ] **Coverage and diversity reported with accuracy**
- [ ] Explicit statement of what offline metrics do not establish
- [ ] Online test designed, with a business primary metric and a power calculation
- [ ] Recommendation logging in place, with position and arm
- [ ] Randomised holdout share defined

**Reject a business-impact claim** made on offline metrics alone. The model may
still ship; the claim may not.

---

## 7. The cross-cutting gates

Applied to every model regardless of type:

| Gate | Requirement |
|---|---|
| **Baseline** | Measured on the same holdout, same metric, same time. Beaten, with intervals |
| **Interval** | Every headline number carries one |
| **Segments** | Breakdown run; any segment where the baseline wins is out of scope |
| **Point-in-time** | Feature correctness verified or explicitly marked unverified |
| **Owner** | A named role, not a person |
| **Monitoring** | Three channels plus pipeline checks, each alert with an owner and an action |
| **Rollback** | The previous version or the rule, runnable and tested |
| **Card** | Complete, including the must-not-be-used-for list |
| **Dependencies** | Declared in the manifest and version-pinned |

**A model failing any cross-cutting gate is not accepted**, regardless of its
metrics. The metrics describe a model that works in a notebook; the gates
describe one that works in a business.
