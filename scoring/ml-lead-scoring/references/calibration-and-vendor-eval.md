# Calibration for lead scores, and evaluating a vendor

---

## 1. Why a lead score in particular must be calibrated

A lead score does not stay a ranking. It gets multiplied:

- Expected pipeline = `Σ score × average deal value`
- Capacity planning = "how many leads above 0.6 will we get next month"
- Routing rules = "anything above 0.8 goes straight to an AE"
- Forecast inputs = the top of the funnel in a pipeline model

**Every one of those is arithmetic on the probability.** An uncalibrated score
makes all of them wrong by however much the calibration is off, and the error
compounds through the funnel model.

---

## 2. The three-way split

```
|--- train ---|-gap-|--- calibrate ---|-gap-|--- test ---|
```

Each gap is one label horizon, so no record's outcome is unresolved at the
boundary. Train on the first block, fit the calibration map on the second, report
everything on the third.

**Below roughly 1,500 positives total, a three-way temporal split starves every
block.** The fallback is cross-validated calibration (`cv=5`) over the training
set — acceptable, but the folds are random, so the temporal discipline breaks and
the reported ECE is optimistic. **Say which you used.**

---

## 3. Platt versus isotonic, decided by sample size

| Positives in the calibration set | Method | Why |
|---|---|---|
| < 300 | **Platt** | Two parameters; isotonic will fit the noise |
| 300–1,000 | **Platt**, isotonic if the reliability curve is clearly non-sigmoid | |
| > 1,000 | **Isotonic** | No shape assumption, better fit |

```python
from sklearn.calibration import CalibratedClassifierCV

method = "isotonic" if n_positives_calib > 1000 else "sigmoid"
cal = CalibratedClassifierCV(base_model, method=method, cv="prefit")
cal.fit(X_calib, y_calib)
```

### The isotonic plateau problem

Isotonic produces step functions. With few positives the steps are wide, so many
distinct raw scores map to one calibrated value and **the ranking inside a
plateau is destroyed.**

**Rank on the raw score, quote the calibrated one.** They are monotonically
related, so the top-200 list is identical either way — but sorting by the
calibrated score inside a plateau is sorting by tie-break order.

---

## 4. The reliability table that goes in the output

```
bin | n   | mean predicted | observed | 95% CI      | gap
 1  | 840 |     0.012      |  0.011   | 0.005-0.020 | +0.001
 2  | 839 |     0.031      |  0.036   | 0.024-0.051 | -0.005
 ...
 9  | 839 |     0.412      |  0.388   | 0.356-0.421 | +0.024
10  | 840 |     0.810      |  0.781   | 0.752-0.808 | +0.029
ECE (quantile bins, 10): 0.014
```

**Quantile bins, not equal-width.** On a 4% base rate, equal-width bins put
almost every record in the first bin and the table shows nothing.

**Bin 10 is the one that matters** — it is the only bin anyone acts on. An
aggregate ECE of 0.02 with a 0.10 gap in the top bin is a badly calibrated score
where it counts, and the aggregate hides it.

---

## 5. Calibration drift after deployment

Discrimination and calibration degrade independently:

| Symptom | Cause | Fix |
|---|---|---|
| ECE rising, ranking stable | **Base-rate shift** — the market or the lead mix changed | **Recalibrate on recent data. No retrain needed** |
| Ranking degrading, ECE stable | The relationship changed | Retrain |
| Both degrading | Motion change | Retrain and revisit the framing |
| ECE jumps in one period | Pipeline or scoring change | Check the reference cohort first |

**Recalibration is cheap and retraining is not.** Monitoring ECE separately from
lift is what lets you tell them apart, and most teams monitor only lift.

---

## 6. Evaluating a vendor's predictive score

Run it as an evaluation, on your data, before paying. It takes about a day.

### The protocol

```
1. Pick a historical window where outcomes have resolved.
2. Have the vendor score that population AS OF the window's start.
   — If they cannot score historically, that is itself the finding: the model
     cannot be evaluated point-in-time, and its live performance is unverifiable.
3. Score the same population with your existing rule.
4. Compare at EQUAL LIST LENGTH — your weekly capacity.
5. Compute: precision@k, lift@k, positives@k, and the reliability curve.
6. Break down by segment.
```

### The questions, and what a non-answer means

| Question | A non-answer means |
|---|---|
| Lift against **our** rule on **our** holdout? | They have not measured it, or it is unflattering |
| Reliability curve on our data? | **Treat the output as a rank, not a probability** — and say so in every downstream use |
| Segment breakdown? | Aggregate lift may be hiding a segment where your rule wins |
| Feature families used? | If third-party intent data is involved, that is a different claim with a different error profile — and often a different data-protection posture |
| Point-in-time trained? | Most cannot answer. The answer matters, because a leaking vendor model looks excellent in a demo |
| Per-lead explanation in business language? | Adoption will fail the same way an in-house black box does |
| Retrained on our data or a pooled model? | A pooled model may not fit your motion at all |
| What happens when our motion changes? | Nobody is watching for it |

**"Proprietary" is not an answer to any of these.** It is a reasonable answer to
"what algorithm" and an unreasonable one to "what is the lift on my data".

### Reading the result honestly

Many vendor scores **do** beat a weak rule — a rule with no decay, uncapped
actions and intuition-assigned weights is a low bar. **Fix the rule first, then
re-run the comparison.** A vendor beating your broken rule by 40% may beat your
fixed rule by 5%, and that changes the purchase decision entirely.

**Report it as a number either way.** "The vendor score converts at 11.2% at our
list length against our current rule's 8.4% and our fixed rule's 12.9%" is the
sentence that settles the procurement conversation.
