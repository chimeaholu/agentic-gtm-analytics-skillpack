# Intervals and residual diagnostics

---

## 1. Split conformal prediction

The cheapest interval with a real guarantee. Requires only a held-out
calibration set and makes no distributional assumption.

```
1. Fit the model on train.
2. Predict on calibrate. Compute absolute residuals r_i = |y_i − ŷ_i|.
3. Take q = the ceil((n+1)(1−α))/n quantile of r.
4. Interval for a new point: [ŷ − q, ŷ + q].
```

Coverage is guaranteed at (1−α) **marginally** — across all records, not within
every subgroup. On a heteroscedastic GTM target that means small deals get an
interval that is far too wide and large deals one that is too narrow.

### Locally weighted conformal (fixes the heteroscedasticity)

```
1. Fit the mean model m(x) on train.
2. Fit a second model s(x) on |y − m(x)| — the expected error magnitude.
3. Normalised residual on calibrate: r_i = |y_i − m(x_i)| / s(x_i).
4. q = quantile of r as before.
5. Interval: [m(x) − q·s(x), m(x) + q·s(x)].
```

Two models, still distribution-free, and the interval now widens where the model
is genuinely less certain. **This is the right default for GTM amounts.**

### On the log scale

For a skewed non-negative target, run conformal on `log1p(y)` and back-transform
the bounds:

```python
lo = np.expm1(pred_log - q)
hi = np.expm1(pred_log + q)
```

This gives an asymmetric interval in raw space — wide above, tight below — which
is the correct shape for a deal size, and it cannot produce a negative lower
bound.

---

## 2. Quantile regression

```python
# gradient boosting, three quantiles
models = {}
for alpha in (0.1, 0.5, 0.9):
    models[alpha] = GradientBoostingRegressor(loss="quantile", alpha=alpha).fit(X, y)
lo, mid, hi = (models[a].predict(X_new) for a in (0.1, 0.5, 0.9))
lo, mid, hi = np.minimum(lo, mid), mid, np.maximum(hi, mid)   # fix crossing
```

**Quantile crossing is real** — independently fitted quantile models can produce
a 10th percentile above the 90th for some records. Sort the outputs; do not
pretend it did not happen.

Pinball loss is the evaluation metric:

```
L_α(y, ŷ) = α·(y − ŷ)      if y ≥ ŷ
            (1 − α)·(ŷ − y) otherwise
```

Quantile regression is the right tool when the **costs are asymmetric**: forecast
the 30th percentile when under-delivery is the expensive error, the 70th when
over-provisioning is.

---

## 3. Coverage verification

```python
import numpy as np

def coverage_report(y, lo, hi, groups=None):
    y, lo, hi = map(np.asarray, (y, lo, hi))
    inside = (y >= lo) & (y <= hi)
    out = {"overall": float(inside.mean()),
           "mean_width": float((hi - lo).mean())}
    if groups is not None:
        groups = np.asarray(groups)
        out["by_group"] = {str(g): float(inside[groups == g].mean())
                           for g in np.unique(groups)}
    return out


if __name__ == "__main__":
    rng = np.random.default_rng(1)
    y = rng.normal(50, 10, 5000)
    pred = np.full_like(y, 50.0)
    q = 1.2816 * 10                               # exact 80% half-width
    rep = coverage_report(y, pred - q, pred + q,
                          groups=(y > 50).astype(int))
    assert 0.77 < rep["overall"] < 0.83, rep
    print("coverage ok:", rep)
```

**Report measured coverage beside nominal coverage, always.** A nominal 80%
interval measuring 62% is worse than no interval because it is believed. Break
coverage down by magnitude decile — marginal coverage hides the fact that the
tail is uncovered.

---

## 4. The residual diagnostic battery

Run all five. Each catches something the others miss.

### 4.1 By magnitude decile

```sql
select ntile(10) over (order by actual) as decile,
       count(*)                          as n,
       avg(actual)                       as mean_actual,
       avg(predicted - actual)           as bias,
       avg(abs(predicted - actual))      as mae,
       sum(abs(predicted - actual)) / nullif(sum(actual), 0) as wape
from   holdout_predictions group by 1 order by 1;
```

Expected pathology on a skewed target: positive bias in the low deciles, large
negative bias in the top. **Name it in the output even if you do not fix it** —
anyone summing these predictions needs to know the total is low.

### 4.2 By segment

Region, product, channel, deal type, account size band. A model unbiased overall
can be 20% low in one region and 20% high in another, and the aggregate hides it
perfectly.

### 4.3 By period

```sql
select date_trunc('month', as_of_ts) as period,
       count(*), avg(predicted - actual) as bias
from   holdout_predictions group by 1 order by 1;
```

A bias that grows monotonically with recency is a motion change, not noise.

### 4.4 Predicted-versus-actual, binned

Plot mean actual against mean predicted in twenty bins of predicted value. The
line should sit on the diagonal. A shallower-than-45° slope is **regression to
the mean**: the model is under-confident at both ends, which is common and fixable
with a simple linear recalibration of the predictions.

### 4.5 Total reconciliation

```python
ratio = predicted.sum() / actual.sum()
```

The single most useful number for anyone aggregating predictions. Report it. If
it is not within a few percent of 1.0, something structural is wrong — usually
the back-transform, sometimes a filter mismatch between the scoring and holdout
populations.

---

## 5. Rank stability for prioritisation

```python
def top_k_stability(fit_predict, X, y, k=20, replicates=30, rng=None):
    """How often does the same record stay in the top k across bootstrap refits?"""
    import numpy as np
    rng = rng or np.random.default_rng(0)
    n = len(y)
    tops = []
    for _ in range(replicates):
        idx = rng.integers(0, n, n)
        pred = fit_predict(X[idx], y[idx], X)
        tops.append(set(np.argsort(-pred)[:k]))
    base = tops[0]
    return float(np.mean([len(base & t) / k for t in tops[1:]]))
```

Below roughly 0.6 agreement, **the top-k list is not a list** — it is one draw
from a distribution, and ranking on a conservative quantile instead of the mean
is the fix. Report the agreement figure alongside any "top accounts" output.
