# Backtesting a forecast

---

## 1. Rolling-origin evaluation

```python
def rolling_origin(y, fit_forecast, min_train, horizon, step=1):
    """
    y            : the series, oldest first
    fit_forecast : callable(train_slice, horizon) -> list of `horizon` forecasts
    returns      : list of (origin_index, forecasts, actuals)
    """
    out = []
    t = min_train
    while t + horizon <= len(y):
        fc = fit_forecast(y[:t], horizon)
        out.append((t, list(fc), list(y[t:t + horizon])))
        t += step
    return out


if __name__ == "__main__":
    y = list(range(1, 41))                       # perfectly linear
    naive = lambda train, h: [train[-1]] * h     # last value carried forward
    folds = rolling_origin(y, naive, min_train=20, horizon=4)
    assert len(folds) == (40 - 4 - 20) + 1, len(folds)
    origin, fc, act = folds[0]
    assert fc == [20] * 4 and act == [21, 22, 23, 24]
    print(f"rolling_origin ok: {len(folds)} folds")
```

**Rules:**

- **`min_train` must clear the adequacy minimum**, or the early folds evaluate a
  model that should not have been fitted.
- **Evaluate at the horizon you will use.** A model good at one step ahead can be
  useless at four, and four is what the business plans against.
- **Refit each origin**, do not reuse parameters. Reusing them leaks later data
  into earlier folds.
- **Report the spread across folds**, not only the mean. Three good folds and one
  disaster is a different situation from four mediocre ones, and the mean hides
  it.

---

## 2. MASE — the best single number

```python
def mase(actuals, forecasts, train, m=1):
    """Mean absolute scaled error. m = seasonal period (1 = non-seasonal naive)."""
    import numpy as np
    a, f, tr = map(lambda v: np.asarray(v, dtype=float), (actuals, forecasts, train))
    scale = np.mean(np.abs(tr[m:] - tr[:-m]))
    return float(np.mean(np.abs(a - f)) / scale) if scale else float("inf")


if __name__ == "__main__":
    train = [10, 12, 11, 13, 12, 14]            # naive one-step MAE ≈ 1.6
    actuals = [13, 15]
    perfect = mase(actuals, [13, 15], train)
    assert perfect == 0.0
    poor = mase(actuals, [10, 10], train)
    assert poor > 1.0, poor                      # worse than naive
    print(f"mase ok: perfect={perfect} poor={poor:.2f}")
```

**Reading it:**

| MASE | Meaning |
|---|---|
| < 1 | **Beats naive.** The acceptance bar |
| ≈ 1 | No better than carrying the last value forward |
| > 1 | Worse than naive. Do not ship; report the naive forecast instead |

MASE is scale-free, so it is comparable across series, and it is defined at zero
values — which MAPE is not. Use `m` = seasonal period to scale against **seasonal**
naive, which is the harder and more honest baseline for a seasonal series.

---

## 3. Interval coverage verification

```python
def coverage(actuals, los, his):
    import numpy as np
    a, lo, hi = map(lambda v: np.asarray(v, dtype=float), (actuals, los, his))
    return float(((a >= lo) & (a <= hi)).mean())
```

Compute across all backtest origins at the target horizon. Then:

| Measured vs nominal | Reading | Action |
|---|---|---|
| Measured ≈ nominal | Intervals are honest | Ship |
| **Measured well below nominal** | **Intervals too narrow — the usual case** | Widen using empirical residual quantiles |
| Measured above nominal | Intervals too wide | Acceptable; note it |

**Empirical widening:**

```python
half_width = np.quantile(np.abs(residuals_at_horizon_h), nominal)
lo, hi = point - half_width, point + half_width
```

This replaces the model's theoretical interval with one derived from how the
model has actually performed at this horizon on this series. It is nearly always
wider, and nearly always more honest.

**Report both numbers** — "nominal 80%, measured 74% over 18 origins, widened
empirically" — so the reader knows what the range means.

---

## 4. Equal-maturity backtesting

The subtle one, and it makes production forecasts worse than backtests predict.

If the series restates — paid media settling over weeks, conversions back-filling
for months, web analytics reprocessing for a day or two, billing refunds landing
later — then **today's view of a past period is not the view you would have had
at the time.**

A backtest using today's fully-settled values evaluates a model fitted on data
that was *better* than what production will get. The backtest is optimistic, and
the optimism is invisible.

**The fix:** keep a read log — every value, as read, with its read timestamp —
and backtest against the value as it stood N days after each origin, where N is
the production lag.

```sql
-- the value as it looked `lag_days` after the period, not as it looks now
select business_period, value
from   metric_reads r
where  r.read_at = (select min(read_at) from metric_reads r2
                    where r2.business_period = r.business_period
                      and r2.read_at >= r.business_period + :lag_days);
```

Without a read log this cannot be done, and the honest statement is: *the
backtest uses settled data and is therefore optimistic by an unmeasured amount;
start logging reads to quantify it.*

---

## 5. Bias, reported separately

```python
bias = float(np.mean(np.asarray(forecasts) - np.asarray(actuals)))
relative_bias = bias / float(np.mean(actuals))
```

**A forecast can have excellent MAE and be consistently 8% high.** MAE cannot see
it; anyone building a plan on the forecast will feel it every period.

Report bias by horizon step as well as overall. A forecast that is unbiased at
one step and 12% high at four steps has a trend-extrapolation problem, and
damping is the fix.

---

## 6. The backtest report

```yaml
backtest:
  origins: 18
  horizon: 4
  min_train: 24
  refit_each_origin: true
  equal_maturity: true | false   # false => results are optimistic
  metrics:
    mase: 0.87
    mae: 142_000
    wape: 0.061
    bias: +18_400
    relative_bias: +0.008
  by_horizon_step:
    - {step: 1, mase: 0.71, bias: +2_100}
    - {step: 4, mase: 1.02, bias: +41_000}   # degrades; damping or a shorter horizon
  coverage:
    nominal: 0.80
    measured: 0.74
    action: "widened empirically"
  per_origin_spread: {min_mase: 0.52, max_mase: 1.31}
  baseline:
    seasonal_naive_mase: 1.0
    beats_baseline: true
```

**The `by_horizon_step` breakdown is the part people skip and the part that
changes decisions.** A model that beats naive at one step and loses at four
should not be used at four, and the aggregate MASE will not tell you that.
