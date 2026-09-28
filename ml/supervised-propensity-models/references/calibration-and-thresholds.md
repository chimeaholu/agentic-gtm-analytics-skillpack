# Calibration and thresholds, worked

---

## 1. Why a boosted tree is not calibrated

Gradient boosting minimises log-loss by pushing scores towards the extremes; the
resulting distribution is sharper than reality. Class weighting adds a second
distortion by changing the effective base rate. The result is a score that
**ranks correctly and reads wrong**: the top bin might be labelled 0.92 and
convert at 0.61.

Random forests have the opposite bias — averaging over trees pulls scores towards
the middle, so a forest's 0.7 is often an under-confident 0.85. Both need the
same fix.

---

## 2. The three-way temporal split

```
|--- train ---|-gap-|--- calibrate ---|-gap-|--- test ---|
```

- Train the model on `train`.
- Fit the calibration map on `calibrate` (model's raw scores → observed rate).
- Report ECE, Brier, lift and everything else on `test`, which has touched
  neither.

A common shortcut — cross-validated calibration with `cv=5` over the whole
training set — is acceptable when data is scarce, but it breaks the temporal
discipline: the folds are random. If you use it, say so and treat the reported
ECE as optimistic.

---

## 3. Platt scaling by hand

```python
import numpy as np
from sklearn.linear_model import LogisticRegression

def fit_platt(raw_scores, y):
    """Logistic map from raw score to calibrated probability."""
    lr = LogisticRegression(C=1e6, solver="lbfgs")   # effectively unregularised
    lr.fit(np.asarray(raw_scores).reshape(-1, 1), y)
    return lr

def apply_platt(lr, raw_scores):
    return lr.predict_proba(np.asarray(raw_scores).reshape(-1, 1))[:, 1]
```

Two parameters. It cannot do much damage, which is exactly why it is the right
choice on a few hundred positives. It assumes the distortion is sigmoid-shaped;
where the miscalibration is non-monotone in shape (rare), it will not fix it.

---

## 4. Isotonic regression

```python
from sklearn.isotonic import IsotonicRegression

iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
iso.fit(raw_scores_calib, y_calib)
p_cal = iso.predict(raw_scores_test)
```

Non-parametric, non-decreasing, no shape assumption. Two failure modes to watch:

- **Plateaus.** With few positives isotonic produces long flat regions, so many
  distinct raw scores map to one calibrated value. The ranking within a plateau
  is destroyed — which matters if you rank by the calibrated score. **Rank on the
  raw score, quote the calibrated one.**
- **Edge clipping.** Scores outside the calibration range clip to the endpoints.
  With `out_of_bounds="clip"` this is explicit; without it you get a NaN in
  production.

Rule of thumb: **isotonic above ~1,000 positives in the calibration set, Platt
below.**

---

## 5. ECE, computed

```python
import numpy as np

def ece(y_true, p, n_bins=10):
    """Expected calibration error, quantile bins."""
    y_true, p = np.asarray(y_true), np.asarray(p)
    edges = np.quantile(p, np.linspace(0, 1, n_bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    total, n = 0.0, len(p)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p > lo) & (p <= hi)
        if m.sum() == 0:
            continue
        gap = abs(p[m].mean() - y_true[m].mean())
        total += m.sum() / n * gap
        rows.append((m.sum(), p[m].mean(), y_true[m].mean()))
    return total, rows


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    y = rng.binomial(1, 0.1, 20000)
    perfect = np.where(y == 1, 0.1, 0.1)          # constant == base rate
    e_ok, _ = ece(y, perfect)
    inflated = np.clip(perfect * 3, 0, 1)          # systematically 3x too high
    e_bad, _ = ece(y, inflated)
    assert e_ok < 0.02, e_ok
    assert e_bad > 0.15, e_bad
    print(f"ece ok: calibrated={e_ok:.4f} inflated={e_bad:.4f}")
```

**Quantile bins, not equal-width.** On a 3% base rate, equal-width bins put
almost every record in `[0, 0.1]` and the chart shows nothing.

Report the per-bin table alongside the single number — the aggregate can be small
while the top bin, the only one anyone acts on, is badly off.

---

## 6. Prior correction after undersampling

If sampling changes the class prior while class-conditional feature
distributions remain stable, correct the training posterior using the
population and training positive-class priors:

```
p_pop = p_train / (p_train + (1 − p_train) × ((1 − π_pop)/π_pop) × (π_train/(1 − π_train)))
```

Here `π_pop` is the population positive prior, `π_train` is the training
positive prior, and `p_train` is the model posterior under the training prior.
For example, with `π_pop = 0.02`, `π_train = 0.17`, and `p_train = 0.50`,
`p_pop = 0.50 / (0.50 + 0.50 × (0.98/0.02) × (0.17/0.83)) ≈ 0.091`.
This is the Bayes prior-probability correction (Elkan, 2001, §2).

**Prefer refitting a calibration map on a set with the true base rate.** The
formula corrects the prior shift only; it does not correct the shape distortion
that boosting introduces, and in practice both are present.

---

## 7. Expected value and the cost-optimal threshold

```
EV(act on record) = p · V_win − C_act
Act if p > C_act / V_win

Equivalently, with explicit error costs:
t* = C_FP / (C_FP + C_FN)
```

`V_win` is the **incremental** value of acting, not the deal value. If half those
deals would have closed without the touch, `V_win` is halved — and establishing
that fraction is an uplift question, not a propensity one. Where it is unknown,
compute `t*` with the gross value, label it a **lower bound on the threshold**
(gross value overstates, so the true threshold is higher), and say what would
resolve it.

### Worked table

| C_act | V_win | t* | Reading |
|---|---|---|---|
| 25 | 1,200 | 0.020 | SDR touch on a mid-market lead |
| 25 | 120 | 0.172 | SDR touch on a low-value SKU |
| 400 | 40,000 | 0.010 | Field-sales engagement on enterprise |
| 5 | 60 | 0.077 | Automated nurture email |
| 2,000 | 8,000 | 0.200 | A discount or retention credit — **and here propensity is the wrong model; see `uplift-and-causal-models`** |

That last row is the important one. When the action is an incentive, targeting on
propensity spends the budget on people who would have converted anyway.

---

## 8. The capacity threshold procedure

1. Establish weekly capacity **in records actually worked**, not in headcount.
2. Score the incoming population for a representative week.
3. The threshold is the score at rank = capacity.
4. Recompute weekly. Score distributions move; a fixed numeric threshold silently
   changes the list size.
5. Track the **gap**: how many records clear `t*` but not the capacity threshold.
   That is the untouched positive-EV volume, and it is the number that justifies
   headcount or automation.

```sql
with ranked as (
  select record_id, score,
         row_number() over (order by score desc) as rn,
         count(*)    over ()                     as n
  from   scored_records
  where  scored_at >= current_date - 7
)
select max(case when rn = :capacity then score end)          as capacity_threshold,
       count(*) filter (where score > :t_star and rn > :capacity)
                                                              as untouched_positive_ev,
       n
from   ranked group by n;
```

---

## 9. Reporting lift honestly

```
lift@k = precision@k / base_rate
```

With `p_k` positives in the top-k set, the relative standard error on
`precision@k` is roughly `1/sqrt(p_k)`. So:

| Positives in the decile | Relative error | Report as |
|---|---|---|
| 10 | ±32% | "roughly 3×, wide interval on 10 positives" |
| 30 | ±18% | "3.1× (2.2–4.0)" |
| 100 | ±10% | "3.1× (2.5–3.7)" |
| 400 | ±5% | "3.10× (2.9–3.3)" |

**Give the number with the interval. Never withhold the lift because the interval
is wide** — state it and let the reader weigh it.
