# Splits, embargoes and sample size

---

## 1. Split recipes

### Temporal holdout (default)

```python
train = df[df.prediction_ts <  T1 - EMBARGO]
valid = df[(df.prediction_ts >= T1) & (df.prediction_ts < T2 - EMBARGO)]
test  = df[df.prediction_ts >= T2]
# EMBARGO = one full label horizon
```

Use when the decision is made once and the data volume is comfortable.

### Grouped temporal holdout (B2B default)

Same cut, plus: no entity may appear on both sides. Where an account straddles
the boundary, assign the whole account to the earlier side and drop its later
records, or assign by the account's first prediction date. **Assigning by the
account's last record leaks**, because the account's earlier records then sit in
test alongside their own history in train.

### Rolling-origin (recurring decisions, all time series)

```
fold 1: train [t0, t1)          test [t1, t1+h)
fold 2: train [t0, t1+h)        test [t1+h, t1+2h)
fold 3: train [t0, t1+2h)       test [t1+2h, t1+3h)
```

Expanding window is the default; a sliding window of fixed length is correct when
the motion has changed and old data is actively misleading. **Report every fold,
not the mean alone** — the spread across folds is the honest uncertainty, and a
single good fold is a single draw.

### What to do when there is not enough history for a temporal split

Say so, then do the useful thing: cross-validate with grouping, report the
result, and label it **optimistic with unknown magnitude** because the temporal
structure is unmodelled. That is more useful than refusing and more honest than
presenting it as a clean holdout.

---

## 2. Sizing the embargo

```
embargo_days = label_horizon_days + data_settling_days
```

`data_settling_days` is the slowest source's settling window feeding any feature
or the label. Ad platform conversions back-fill for weeks; web analytics
reprocesses for a day or two; billing refunds land weeks later; CRM close dates
get edited after close. If the label is billing-derived, the settling term can
exceed the horizon term.

Check the embargo is doing its job:

```sql
select date_trunc('week', prediction_ts) as wk,
       avg(label) as positive_rate,
       count(*)   as n
from   training_set
group by 1 order by 1 desc limit 12;
```

A positive rate that falls off a cliff in the most recent weeks means the embargo
is too short: those records' outcomes have not happened yet, and they are sitting
in the data as negatives.

---

## 3. Power and detectable effect

### Binary outcome, two groups (the A/B or model-vs-baseline case)

Approximate required n **per group**, for 80% power at α = 0.05 two-sided:

```
n ≈ 16 * p̄ * (1 - p̄) / (p1 - p0)²        where p̄ = (p1 + p0) / 2
```

The 16 is `2 * (1.96 + 0.84)² ≈ 15.7`.

| Baseline rate | Relative lift to detect | n per group |
|---|---|---|
| 2% | +20% (2.0% → 2.4%) | ~ 42,000 |
| 2% | +50% (2.0% → 3.0%) | ~ 7,400 |
| 10% | +20% (10% → 12%) | ~ 7,400 |
| 10% | +10% (10% → 11%) | ~ 30,000 |
| 25% | +20% (25% → 30%) | ~ 2,500 |

Read it the other way round when the sample is fixed: solve for `(p1 - p0)` and
report **the smallest lift this dataset could have detected**. That number is
almost always the most useful thing you can tell someone who wants a model built
on a small dataset.

### Uplift is far more expensive

Uplift estimates a *difference of differences*, so its variance is roughly the
sum of both arms' variances. As a working rule, **budget 4–10× the propensity
sample** for the same confidence. Run the calculation on the expected
incremental effect, not on the base conversion rate — a 1-point incremental
effect on a 10% base needs the sample for a 1-point difference, not a 10% one.

### Confidence interval on a rate, for the answer

```
se ≈ sqrt(p * (1 - p) / n)      95% CI ≈ p ± 1.96 * se
```

With few positives use a Wilson interval instead; the normal approximation is
poor below ~30 positives and will produce a lower bound below zero.

---

## 4. Evaluation-set sizing

The holdout needs enough **positives** to distinguish the model from the
baseline, which is a tighter constraint than the training set.

| Positives in holdout | Relative precision on a rate | What you can conclude |
|---|---|---|
| 30 | ±36% | Nothing about a 10–20% lift |
| 100 | ±20% | Large differences only |
| 400 | ±10% | Ordinary model-vs-rule comparisons |
| 1,000 | ±6% | Segment-level comparison becomes possible |

**Top-decile lift needs positives in the decile, not in the set.** A holdout with
100 positives has roughly 25–35 in the top decile of a working model; the
interval on that is wide and should be reported with the lift, never without.
