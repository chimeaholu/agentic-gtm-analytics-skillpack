---
name: regression-and-value-models
description: Use when predicting a continuous GTM quantity — expected deal size, expected customer value, expected order value, or expected spend. Handles the right-skewed distributions that dominate GTM amounts, chooses an error metric that matches the business cost, and separates the "will they buy" question from the "how much" question rather than modelling a zero-inflated amount directly. Prevents a mean-optimising model that is systematically wrong on the large deals that matter most.
---

# Regression and Value Models

Predicting an amount is not predicting a class with extra decimals. GTM amounts
are **right-skewed with long tails**, frequently **zero-inflated**, and the
business cares disproportionately about the tail — which is exactly where a
squared-error model is worst.

Run `ml-foundations-marketing` first for the go/no-go, the split and the leakage
audit. This skill starts once the target is chosen.

---

## 1. Look at the distribution before choosing anything

Five numbers and one plot, every time:

```sql
select count(*)                                           as n,
       avg((amount = 0)::int)                             as zero_share,
       avg(amount)                                        as mean,
       percentile_cont(0.50) within group (order by amount) as p50,
       percentile_cont(0.90) within group (order by amount) as p90,
       percentile_cont(0.99) within group (order by amount) as p99,
       max(amount)                                        as max,
       sum(case when amount >= percentile_cont(0.90)
                     within group (order by amount) then amount end)
         / nullif(sum(amount), 0)                         as top_decile_revenue_share
from   deals where stage = 'closed_won';
```

What the numbers decide:

| Observation | Consequence |
|---|---|
| `mean` far above `p50` | Right-skewed. Squared error will chase the tail badly; consider a log transform or quantile regression |
| `p99 / p50` above ~20 | Heavy tail. **Stratified evaluation by magnitude is mandatory** |
| `top_decile_revenue_share` above ~0.5 | The money is in the tail. A model optimising the middle is optimising the wrong thing |
| `zero_share` above ~0.2 | **Zero-inflated. Use a two-part model** (§3) |
| Multi-modal | Usually a mixture of products or segments. Model them separately or add the segment as a feature and check residuals per segment |

**Multi-currency check before anything else.** Amounts in mixed currencies do not
sum to anything meaningful. Use the home-currency variant, and note that the
conversion rate is typically snapshotted per record rather than recomputed — so
the converted amount is itself a point-in-time value and re-deriving it today
gives a different number.

---

## 2. Transform, or model the scale directly

| Approach | When | Cost |
|---|---|---|
| **Model raw amount with squared error** | Symmetric, light-tailed target. Rare in GTM | Systematically wrong in the tail |
| **Log transform** (`log1p`) | Multiplicative errors, strictly non-negative target, tail present | **Back-transform bias** — see below |
| **Gamma / Tweedie objective** | Non-negative, variance rising with the mean. Tweedie handles zero-inflation natively (`p` between 1 and 2) | Less familiar; needs the power parameter tuned |
| **Quantile regression** | The decision needs a conservative or an optimistic figure, not a mean | One model per quantile |
| **Rank/band the target** | Only the tier matters operationally | Loses magnitude |

### The back-transform trap

`exp(mean(log(y)))` is the **geometric** mean, which is below the arithmetic
mean. Exponentiating a log-model's prediction therefore **understates**, and the
understatement grows with the variance. For a log-normal error with residual
variance σ²:

```
E[y | x] ≈ exp(ŷ_log + σ² / 2)        # smearing correction, parametric
```

Duan's non-parametric smearing estimator is safer when residuals are not normal:

```
E[y | x] ≈ exp(ŷ_log) · mean_i( exp(residual_i) )
```

**Sum the predictions and compare against the actual total on the holdout.** If
the predicted total is 20% below actual, the back-transform is the first suspect,
and it is almost always the cause.

---

## 3. Two-part models beat a single zero-inflated regression

For "expected value" questions — expected revenue from this lead, expected value
of this account — the honest structure is two models:

```
E[value] = P(purchase) × E[amount | purchase]
             ↑                  ↑
     supervised-propensity   this skill, fitted on purchasers only
```

Why this beats one regression on all records including zeros:

1. **The parts are individually interpretable**, which matters for adoption. "60%
   likely to buy, and if they buy it is about 14k" is a sentence a sales leader
   uses. "Expected value 8.4k" is one they distrust.
2. **The drivers genuinely differ.** What makes someone buy is not what makes
   them buy a lot. A single model averages two relationships into one confused
   set of coefficients.
3. **Each part gets the right metric.** The propensity half gets PR-AUC and
   calibration; the amount half gets an error metric chosen on cost.
4. **You can fix one half without retraining the other.**

**The variance of the product is larger than either part's**, so an interval on
the combined expected value must propagate both. Do not report the product with
only the amount model's interval.

```
Var(P·A) = E[P]²·Var(A) + E[A]²·Var(P) + Var(P)·Var(A)
```

**When a single model is fine:** the zero share is small (under ~10%), the
decision is aggregate rather than per-record, and nobody will read an individual
prediction. Say which case you are in. Tweedie is the reasonable single-model
route when you want one.

---

## 4. Error metric selection is a business decision

| Metric | Formula | Choose when | Never |
|---|---|---|---|
| **MAE** | `mean(|y − ŷ|)` | Errors cost linearly. Robust to the tail. **The GTM default** | |
| **RMSE** | `sqrt(mean((y − ŷ)²))` | Large errors cost disproportionately — capacity planning, cash commitments | As the only metric on a heavy tail; one outlier dominates it |
| **MAPE** | `mean(|y − ŷ| / y)` | Relative error is what matters and the target is **strictly positive and bounded away from zero** | **Near-zero values — it explodes.** Also asymmetric: it punishes over-prediction more than under-prediction |
| **sMAPE / WAPE** | `sum(|y − ŷ|) / sum(y)` | A relative measure that survives small values. **WAPE is the right default when someone asks for "percentage error"** | |
| **Pinball loss** | quantile-weighted absolute error | Quantile models; asymmetric costs | |
| **Bias** | `mean(ŷ − y)` | **Always report alongside.** Accuracy without bias hides systematic over- or under-prediction | |

**Report MAE and bias together, at minimum.** A model with excellent MAE that is
consistently 12% low is a budget problem, and MAE alone hides it.

**When the costs are asymmetric, say so and use quantile regression.** If
under-forecasting revenue causes a hiring freeze and over-forecasting causes a
missed number, those are not the same error, and a mean model serves neither.

---

## 5. Prediction intervals, not point estimates

**A single number invites false precision. The interval is the deliverable.**

| Method | How | Notes |
|---|---|---|
| **Quantile regression** | Fit separate models at 0.1 / 0.5 / 0.9 | Native, well-behaved. Quantile crossing is possible — sort the outputs |
| **Conformal prediction** | Take absolute residuals on a held-out calibration set; the (1−α) quantile is the half-width | **Distribution-free and has a real coverage guarantee.** The cheapest defensible interval |
| **Quantile forests / GBM quantile objective** | Tree-based quantile estimates | Good with heteroscedastic GTM data |
| **Bootstrap** | Resample, refit, take prediction quantiles | Expensive; captures model uncertainty but not noise unless combined |

Split conformal, which is five lines and hard to get wrong:

```python
import numpy as np

def conformal_halfwidth(y_calib, pred_calib, alpha=0.2):
    """Split-conformal: width such that ~(1-alpha) of future points fall inside."""
    resid = np.abs(np.asarray(y_calib) - np.asarray(pred_calib))
    n = len(resid)
    q = np.ceil((n + 1) * (1 - alpha)) / n          # finite-sample correction
    return float(np.quantile(resid, min(q, 1.0)))


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    y = rng.normal(100, 15, 4000)
    pred = np.full_like(y, 100.0)
    h = conformal_halfwidth(y[:2000], pred[:2000], alpha=0.2)
    cover = np.mean(np.abs(y[2000:] - pred[2000:]) <= h)
    assert 0.76 < cover < 0.84, cover                # ~80% coverage, as promised
    print(f"conformal ok: halfwidth={h:.1f} coverage={cover:.3f}")
```

**On a skewed target, fit conformal on the log scale** and back-transform the
bounds — a symmetric interval in raw space produces negative lower bounds on
small deals.

**Verify coverage on the holdout.** A nominal 80% interval covering 62% of actual
outcomes is worse than no interval, because it is trusted. Report measured
coverage next to nominal coverage, always.

---

## 6. Residual analysis by segment and by magnitude

**Mandatory. Aggregate error hides systematic bias in exactly the place the money
is.**

```sql
select ntile(10) over (order by actual) as magnitude_decile,
       count(*)                          as n,
       avg(predicted - actual)           as bias,
       avg(abs(predicted - actual))      as mae,
       sum(abs(predicted - actual)) / nullif(sum(actual), 0) as wape
from   holdout_predictions
group by 1 order by 1;
```

The pattern this almost always reveals on GTM data:

| Decile | Bias | Reading |
|---|---|---|
| 1–3 (small) | positive | Over-predicts small deals — mean reversion |
| 4–7 (middle) | ≈ 0 | The model is good here |
| 8–10 (large) | **large negative** | **Under-predicts big deals, which is where the revenue is** |

That is the signature of squared-error regression on a skewed target, and it is
why the magnitude breakdown is not optional. The fix is a transform, a quantile
objective, or a separate tail treatment — and **it must be named in the output
even when it is not fixed**, because a forecast built by summing these
predictions will be systematically low.

Break residuals down by segment too: region, product, channel, deal type, and
**time period**. A model that was unbiased in training and is 15% low in the most
recent quarter has met a motion change.

---

## 7. Propagate uncertainty into the decision

Where expected value feeds prioritisation or budget, **ranking on point estimates
that are individually unreliable is the failure mode.**

- **Rank on a conservative quantile** (e.g. the 30th percentile of predicted
  value) when the downside of chasing a phantom large deal is real. This is
  robust and takes one extra model.
- **Where the top of the ranking is what matters, check rank stability**:
  bootstrap the model, re-rank, and measure how often the top-20 set is the same.
  A top-20 that reshuffles 60% between bootstrap replicates is not a top-20.
- **Aggregate before you trust.** Individual predictions are noisy; their sum
  over a few hundred records is much better. A portfolio-level forecast can be
  good while every individual prediction is poor — say which level the number is
  trustworthy at.

```
Aggregate error scales roughly as 1/sqrt(n) IF errors are independent.
GTM errors are correlated — same quarter, same motion, same seasonality —
so the real aggregate error is larger than the naive calculation.
Use the backtest, not the formula.
```

---

## 8. Output

```yaml
target:
  name, currency, currency_handling, n, zero_share
  distribution: {mean, p50, p90, p99, max, top_decile_revenue_share}
structure: single | two-part
  propensity_part: <link to supervised-propensity-models output>
  amount_part: {trained_on: purchasers_only, n}
transform: none | log1p | gamma | tweedie(p=<v>) | quantile
  back_transform_correction: none | smearing | parametric
  predicted_total_vs_actual_total: <ratio on holdout>
metrics:
  primary: mae | rmse | wape | pinball
  justification: "<the business cost this metric matches>"
  values: {mae, rmse, wape, bias}
  baselines: {mean, segment_mean, last_value}
intervals:
  method: conformal | quantile | bootstrap
  nominal_coverage: 0.80
  measured_coverage: <v>
residuals:
  by_magnitude_decile: [{decile, n, bias, mae, wape}]
  by_segment: [{segment, n, bias, mae}]
  by_period: [{period, n, bias}]
  systematic_bias_flags: ["under-predicts top decile by <x>%"]
decision_use:
  ranking_basis: point_estimate | conservative_quantile
  rank_stability: "<top-k agreement across bootstrap replicates>"
  trustworthy_at: individual | segment | portfolio
```

---

## 9. Answering

**Answer first, with the interval and the bias direction attached.**

> **Expected value of this account is about 18k over the next twelve months —
> call it 11k to 31k.**
>
> That is a 62% purchase probability times about 29k if they buy. The interval is
> conformal at 80% nominal and measured 78% coverage on the holdout, so it is
> honest. Both halves are worth reading separately: the purchase probability is
> the well-measured part, the amount is the noisy one.
>
> **It understates at the top.** In the holdout the model is 14% low in the
> largest-deal decile, which is the standard squared-error-on-a-skewed-target
> pattern. If you sum these predictions across the pipeline the total will be
> low by roughly that much in the tail-heavy segments.
>
> For territory planning and relative prioritisation this is fine as it stands.
> For a committed revenue number, use the quantile version — I would rank on the
> 30th percentile rather than the mean, because the top of a point-estimate
> ranking reshuffles about 40% between bootstrap replicates.
>
> Does not claim causality: this is what accounts like this one have been worth,
> not what this account will be worth if you invest in it.

**Withhold only** what cannot be computed: an interval where no calibration set
exists (give the point estimate and say the interval is unavailable and why), a
per-record value where the amount model has fewer than the minimum purchasers
(give the segment mean instead, which is honest and useful), and a causal claim
about investment. Never withhold the point estimate itself.

---

## Calls

- `answer-contract` — every amount, interval and error metric
- `provenance-block` — **currency and FX basis are mandatory here**, alongside
  window, timezone and label version
- `comparability-rules` — before comparing amounts across currencies, periods or
  sources; before summing predictions across segments modelled differently
- `warning-field-reader` — extract-level caveats on the amount source

## References

- `references/skew-and-transforms.md` — transforms, back-transform corrections,
  the two-part model worked, and Tweedie
- `references/intervals-and-residuals.md` — conformal prediction, quantile
  regression, and the residual diagnostic battery

## Related skills

- `ml-foundations-marketing` — the gate, split and leakage audit
- `feature-engineering-gtm` — point-in-time features, including the commercial
  family where the amount-adjacent leakage lives
- `supervised-propensity-models` — the first half of every two-part model
- `model-evaluation-monitoring` — acceptance and drift
- `pipeline-forecast` — where per-deal expected values get aggregated, and where
  the tail bias compounds
- `timeseries-forecasting-models` — the aggregate-series alternative to summing
  per-record predictions
