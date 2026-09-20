# Skew, transforms and the two-part model

---

## 1. Diagnosing the target in one pass

```python
import numpy as np

def target_profile(y):
    y = np.asarray(y, dtype=float)
    p50, p90, p99 = np.percentile(y, [50, 90, 99])
    top_decile_cut = np.percentile(y, 90)
    return {
        "n": len(y),
        "zero_share": float((y == 0).mean()),
        "mean": float(y.mean()),
        "p50": float(p50), "p90": float(p90), "p99": float(p99),
        "max": float(y.max()),
        "mean_over_median": float(y.mean() / p50) if p50 else None,
        "p99_over_p50": float(p99 / p50) if p50 else None,
        "top_decile_revenue_share": float(y[y >= top_decile_cut].sum() / y.sum()),
    }


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    skewed = rng.lognormal(mean=9, sigma=1.2, size=20000)
    prof = target_profile(skewed)
    assert prof["mean_over_median"] > 1.5, prof
    assert prof["top_decile_revenue_share"] > 0.4, prof
    flat = rng.normal(100, 5, 20000)
    assert target_profile(flat)["mean_over_median"] < 1.1
    print("target_profile ok:", {k: round(v, 3) for k, v in prof.items()
                                 if isinstance(v, float)})
```

**Decision table:**

| Condition | Action |
|---|---|
| `zero_share > 0.2` | Two-part model (§3) or Tweedie |
| `mean_over_median > 1.5` | Transform or a non-Gaussian objective |
| `p99_over_p50 > 20` | Stratified evaluation by magnitude is mandatory |
| `top_decile_revenue_share > 0.5` | The tail is the business. Optimise for it explicitly |

---

## 2. Transform options, with their arithmetic

### log1p

```python
y_t = np.log1p(y)              # log(1 + y); safe at y = 0
pred = np.expm1(model.predict(X))   # naive back-transform — BIASED LOW
```

**Corrections:**

```python
# parametric (assumes log-normal residuals)
sigma2 = np.var(y_log_train - pred_log_train)
pred_corrected = np.expm1(pred_log + sigma2 / 2)

# Duan smearing (non-parametric; prefer this)
resid = y_log_train - pred_log_train
smear = np.mean(np.exp(resid))
pred_corrected = np.expm1(pred_log) * smear
```

**The acceptance check for any transform:** predicted total versus actual total
on the holdout.

```python
ratio = pred_corrected.sum() / y_holdout.sum()
assert 0.95 < ratio < 1.05, f"back-transform bias: predicted total is {ratio:.2f}x actual"
```

A ratio of 0.8 is the naive back-transform, every time.

### Gamma

For strictly positive targets whose variance rises with the mean — the usual GTM
shape. `objective="reg:gamma"` in XGBoost, `family=Gamma(link=log)` in a GLM.
Predictions are on the response scale already, so there is no back-transform
bias. Cannot handle zeros.

### Tweedie

Handles zero-inflation and a skewed positive part in one model. The power
parameter `p` sits between 1 (Poisson) and 2 (Gamma):

- `p ≈ 1.1–1.3` — many zeros, small positive values
- `p ≈ 1.5` — the usual GTM starting point
- `p ≈ 1.7–1.9` — few zeros, heavy tail

Tune `p` on validation; it changes the fit materially. `objective="reg:tweedie"`
with `tweedie_variance_power`.

**Tweedie versus two-part:** Tweedie is one model and usually a touch more
accurate; two-part is two interpretable numbers a sales leader will actually
use. In GTM, adoption usually wins. Say which you chose and why.

---

## 3. The two-part model, worked

```python
# Part 1: will they buy?  (see supervised-propensity-models for the full treatment)
clf = fit_classifier(X_train, y_train_bought)
p_buy = calibrated_predict(clf, X_score)          # calibration is required here

# Part 2: how much, GIVEN they buy?  Fit on purchasers only.
mask = y_train_bought == 1
reg = fit_regressor(X_train[mask], y_train_amount[mask])
amt = reg.predict(X_score)

expected_value = p_buy * amt
```

### Three rules

1. **The amount model is trained on purchasers only.** Training it on everyone
   with zeros included makes it a badly specified zero-inflated model.
2. **The propensity half must be calibrated**, or the product is not an expected
   value — it is a ranking multiplied by an amount, which means nothing.
3. **Interval on the product propagates both parts:**

```
Var(P·A) = E[P]²·Var(A) + E[A]²·Var(P) + Var(P)·Var(A)
```

In practice, simulate rather than derive: draw `p ~ Beta` fitted to the
calibration bin and `a` from the amount model's conformal residual distribution,
multiply, repeat 1,000 times, take quantiles. Five lines, no algebra, and it
handles the correlation if you draw jointly.

### Selection bias in the amount half

The amount model is fitted on purchasers, but scored on everyone. If the reason
someone bought correlates with how much they bought, the amount model
extrapolates into a population it never saw.

**Check:** compare the feature distributions of purchasers against the scoring
population. Where they differ materially on a feature the amount model leans on,
say so — the amount estimate for non-purchaser-like records is an extrapolation,
not an interpolation, and its error is larger than the holdout suggests.

---

## 4. When a single model is the right call

- Zero share under ~10%.
- The output feeds an aggregate, not a per-record decision.
- Nobody will read an individual prediction aloud.
- Operational simplicity genuinely matters — one model to monitor, not two.

In that case: Tweedie, or log1p with smearing. Report the same residual
diagnostics either way.
