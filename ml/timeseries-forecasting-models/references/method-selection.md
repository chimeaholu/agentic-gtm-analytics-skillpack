# Method selection, seasonality and intervention regressors

---

## 1. The adequacy check, first

```python
MINIMUMS = {                      # (non_seasonal_min, cycles_needed_for_seasonal)
    "daily":     (30, 2),         # cycles here = years, for annual seasonality
    "weekly":    (30, 3),
    "monthly":   (24, 3),
    "quarterly": (16, 5),
    "yearly":    (10, None),
}
PERIODS_PER_CYCLE = {"daily": 365, "weekly": 52, "monthly": 12, "quarterly": 4}


def adequacy(frequency, n_obs, want_seasonal=True):
    non_seasonal_min, cycles = MINIMUMS[frequency]
    out = {"n": n_obs, "non_seasonal_min": non_seasonal_min}
    if want_seasonal and cycles:
        need = cycles * PERIODS_PER_CYCLE[frequency]
        out["seasonal_min"] = need
        out["complete_cycles"] = n_obs / PERIODS_PER_CYCLE[frequency]
        if n_obs >= need:
            out["verdict"] = "supported"
        elif n_obs >= non_seasonal_min:
            out["verdict"] = "non_seasonal_only"
        else:
            out["verdict"] = "insufficient"
    else:
        out["verdict"] = "supported" if n_obs >= non_seasonal_min else "insufficient"
    return out


if __name__ == "__main__":
    q12 = adequacy("quarterly", 12)
    assert q12["verdict"] == "insufficient", q12      # 12 < 16 non-seasonal min
    assert q12["seasonal_min"] == 20
    m36 = adequacy("monthly", 36)
    assert m36["verdict"] == "supported", m36         # exactly 3 complete cycles
    m30 = adequacy("monthly", 30)
    assert m30["verdict"] == "non_seasonal_only", m30
    print("adequacy ok:", q12["verdict"], m36["verdict"], m30["verdict"])
```

**Always report the re-aggregation option.** Twelve quarterly points are
thirty-six monthly points, and monthly clears the seasonal minimum. Checking
whether the underlying data can be re-aggregated is the highest-value thirty
seconds in this skill.

---

## 2. Testing for seasonality before assuming it

### Autocorrelation at the seasonal lag

```python
def acf_at(series, lag):
    import numpy as np
    x = np.asarray(series, dtype=float)
    x = x - x.mean()
    denom = (x * x).sum()
    return float((x[lag:] * x[:-lag]).sum() / denom) if denom else 0.0


if __name__ == "__main__":
    import math
    seasonal = [10 + 5 * math.sin(2 * math.pi * i / 12) for i in range(120)]
    assert acf_at(seasonal, 12) > 0.7                 # strong at the season
    assert acf_at(seasonal, 6) < 0                    # antiphase at half-season
    flat = [10.0] * 120
    assert acf_at(flat, 12) == 0.0
    print("acf ok")
```

Significance band for white noise is roughly `±1.96/sqrt(n)`. An ACF at the
seasonal lag inside that band means the seasonality is not established, and a
non-seasonal model is both more accurate and far more stable.

### Seasonal strength from a decomposition

```
F_seasonal = max(0, 1 − Var(remainder) / Var(seasonal + remainder))
```

Above ~0.6 is strong seasonality; below ~0.3, do not fit a seasonal component.
Report the number rather than a yes/no.

---

## 3. Method parameters worth setting deliberately

### Exponential smoothing (ETS)

```python
ExponentialSmoothing(y, trend="add", damped_trend=True,
                     seasonal="mul" if multiplicative else "add",
                     seasonal_periods=m).fit()
```

- **`damped_trend=True` by default.** An undamped trend extrapolates the last
  two good quarters forever. Business series flatten; damping encodes that.
- **Additive versus multiplicative seasonality:** multiplicative when the
  seasonal swing grows with the level (usual for revenue), additive when it is
  constant in absolute terms (sometimes true for counts).
- ETS is a **family**, and automatic selection over the family (error, trend,
  seasonal, each additive/multiplicative/none) with AICc is a reasonable default.
  **Report which member was selected** — "ETS(A,Ad,M)" is the named model.

### ARIMA / SARIMA

Needs 50+ observations to identify orders reliably. Differencing removes trend;
seasonal differencing removes seasonality. **Automatic order selection on a short
series will find a model** — that is not the same as the model being right.
Check the residual ACF is white noise before trusting it.

### Structural / state-space

Explicit level, trend, seasonal and regression components, each with its own
variance. **The right choice when interventions and regressors both matter**,
because the components are separable and interpretable. Costs data: more
components need more observations.

### Additive decomposable models (Prophet-family)

```python
m = Prophet(
    changepoint_prior_scale=0.01,   # default is often too flexible for short series
    seasonality_mode="multiplicative",
    yearly_seasonality=n_years >= 3,   # do NOT let it auto-fit on < 3 years
    weekly_seasonality=True,
    changepoint_range=0.8,
)
for iv in interventions:
    m.add_regressor(iv.name)
```

**The changepoint warning is the important one.** Defaults tuned for long
high-volume web series find changepoints in the noise of a short business series,
and the forecast then extrapolates a spurious recent trend. Lower the prior
scale, restrict the changepoint range, and **plot the fitted changepoints against
the intervention register.** Unexplained changepoints are noise or a forgotten
intervention; both need resolving before the forecast ships.

---

## 4. Intervention regressors

| Shape | Regressor | Example |
|---|---|---|
| Level shift | `1 if t >= t_event else 0` | Price change, channel switched off |
| Slope change | `max(0, t − t_event)` | New motion, new market entry |
| Pulse | `1 if t == t_event else 0` | Launch day, outage, one-off campaign |
| Decaying pulse | `exp(−(t − t_event)/τ)` for `t ≥ t_event` | Campaign with an afterglow |
| Saturating ramp | `1 − exp(−(t − t_event)/τ)` | Gradual feature adoption |

```sql
-- build the regressor matrix from the register
select d.period,
       max(case when i.type = 'level_shift' and d.period >= i.event_date
                then 1 else 0 end)                              as lvl_pricing,
       max(case when i.type = 'ramp' and d.period >= i.event_date
                then date_diff('day', i.event_date, d.period)
                else 0 end)                                     as ramp_market_entry
from   date_spine d
cross join interventions i
group by 1;
```

**Data artefacts are excluded, not modelled.** A tracking outage is not a
business event; fitting a pulse to it teaches the model that the business dipped.
Exclude the window, mark it, and make sure the exclusion is visible on any chart.

---

## 5. Multiple seasonalities

GTM series commonly carry two or three at once:

| Pattern | Period (daily data) | Cause |
|---|---|---|
| Weekly | 7 | B2B traffic collapses at weekends |
| Monthly | ~30.4 | End-of-month deal pushes, billing cycles |
| Quarterly | ~91 | End-of-quarter bookings spikes |
| Annual | 365 | Budget cycles, holidays, seasonal demand |

Methods that handle multiple seasonality: TBATS, Fourier terms added to an ARIMA
or regression, or an additive decomposable model with several seasonal
components.

**Each seasonality needs its own three complete cycles.** Weekly seasonality on
daily data needs about eight weeks; annual seasonality needs three years. A model
fitting both on one year of data has established one of them.

**Holiday and fiscal effects are regressors, not seasonality.** Moving holidays
shift date year to year, so a fixed annual seasonal index smears them across two
periods and captures neither.
