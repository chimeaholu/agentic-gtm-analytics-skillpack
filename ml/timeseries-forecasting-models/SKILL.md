---
name: timeseries-forecasting-models
description: Use when forecasting a GTM time series — revenue, orders, traffic, spend, signups or usage — or when reviewing an existing time-series forecast. Selects among exponential smoothing, ARIMA, state-space and additive decomposition methods based on the series length, seasonality and intervention history, declares a minimum observation count per frequency and refuses below it, and always reports an interval with the point estimate. Prevents a confident seasonal model fitted to twelve quarterly observations.
---

# Time-Series Forecasting Models

Forecasting always returns a line. The line is confident, smooth, and takes no
position on whether the series was long enough to support it.

So the first section of this skill is a **counting exercise**, and it is the one
that prevents most bad GTM forecasts: twelve quarterly bookings observations
cannot support a seasonal model, and no amount of method sophistication changes
that.

---

## 1. Minimum observations per frequency — count first

| Frequency | Non-seasonal minimum | Seasonal minimum | Comfortable |
|---|---|---|---|
| **Daily** | 30 | **2 complete years for annual seasonality**; 8 weeks for weekly seasonality | 2–3 years |
| **Weekly** | 30 | **3 complete years** for annual seasonality (156 obs) | 4 years |
| **Monthly** | 24 | **3 complete years** (36 obs) | 5 years |
| **Quarterly** | 16 | **5 complete years** (20 obs) | 8 years |
| **Yearly** | 10 | n/a | 20 |

**The rule underneath the table: a seasonal model needs at least three complete
cycles of the seasonality it is fitting, and four is where it becomes stable.**
Two cycles cannot distinguish seasonality from a one-off event. One cycle cannot
see seasonality at all — it fits it to the trend.

**The GTM case this exists for:** quarterly B2B bookings. A company with three
years of history has twelve observations. A seasonal model on twelve points has
roughly four parameters per seasonal index and two degrees of freedom left. It
will fit the history almost perfectly and forecast badly, and the chart will look
authoritative.

### Below the minimum, answer — do not just refuse

```
Observations: 12 quarterly.
Seasonal model: not supported (needs 20 for quarterly seasonality).
Non-seasonal trend model: supported but weak (needs 16, have 12).

Answer: next quarter ≈ <naive> to <trend>, with the range as the honest interval.
```

Then say what a shorter aggregation would buy: **twelve quarterly points is
thirty-six monthly points**, and monthly supports a seasonal model. If the
underlying data can be re-aggregated, that is the answer — and it is the single
most useful thing to check before declining.

---

## 2. Method selection

| Method | Use when | Avoid when |
|---|---|---|
| **Naive / seasonal naive** | **Always, as the baseline.** Last value, or the value one season ago | Never skip it |
| **Exponential smoothing (ETS)** | **The robust primary for GTM.** Handles level, trend and seasonality; damped trend stops it extrapolating growth to the moon | Multiple interacting regressors |
| **Linear regression on time** | Short series, clear trend, and you need explicability | Any seasonality; any non-linearity |
| **ARIMA / SARIMA** | Autocorrelation structure is real and the series is long enough (50+ observations) | Short series — it will happily overfit; heavy intervention history |
| **State-space / structural (BSTS-family)** | **Trend, seasonality and interventions must be separated explicitly**; regressors matter | Small data with many components |
| **Prophet-style additive** | Multiple seasonalities, holidays, known changepoints, analyst-friendly | **Its changepoint defaults over-fit short noisy series** — tune deliberately |
| **Classical decomposition (STL)** | **Diagnosis, not forecasting.** Seeing the trend and seasonal components | As the forecast itself |
| **ML regressors on lag features** | Long series, many exogenous drivers | Short series; and you must construct lags without leaking |

**The honest default for a GTM series: damped-trend ETS, with seasonal naive as
the baseline and a rolling-origin backtest.** It beats more sophisticated methods
on short business series more often than anyone expects, and it is defensible in
a room.

**Damping matters.** An undamped trend on a series with two good quarters
extrapolates those quarters forever. A damped trend flattens as the horizon
extends, which is what actually happens to business series.

---

## 3. Always return an interval, and name the model

**A point forecast is not a forecast.** The interval is the deliverable, and the
method that produced it must be named in the result object.

```yaml
forecast:
  method: "ETS(A,Ad,M)"          # named, in the output object
  horizon: 4 periods
  points:
    - period: "next", point: 1_240_000, lo_80: 1_050_000, hi_80: 1_430_000
  interval_basis: "model-based, 80% prediction interval"
  interval_verified_against_backtest: true
  measured_coverage: 0.74        # vs 0.80 nominal
```

**Model-based intervals are systematically too narrow** on business series,
because they assume the model is correct and the future resembles the past.
Verify empirically:

```
1. Run a rolling-origin backtest at the actual forecast horizon.
2. Compute the share of actuals that fell inside the nominal interval.
3. Report both: "nominal 80%, measured 74% over 18 origins".
4. If measured coverage is well below nominal, widen using the empirical
   residual quantiles instead of the model's.
```

Empirical widening, which is the cheap honest fix:

```python
# half-width from backtest residuals at this horizon, not from the model
half_width = np.quantile(np.abs(backtest_residuals_h), 0.80)
```

---

## 4. Seasonality requires complete cycles

- **One year of daily data supports weekly seasonality and does not support
  annual seasonality.** The model will happily fit an annual pattern to a single
  year — it is fitting the trend and calling it seasonality.
- **Multiple seasonalities coexist** in GTM: weekly (B2B traffic collapses at
  weekends), monthly (end-of-month deal pushes), quarterly (end-of-quarter
  bookings spikes), annual (budget cycles, holidays).
- **Test for seasonality before assuming it.** Autocorrelation at the seasonal
  lag, or a seasonal-strength measure from an STL decomposition. If seasonal
  strength is weak, a non-seasonal model is more accurate and far more stable.
- **Fiscal calendars are not calendar seasonality.** A business with a fiscal
  year ending in January has its "Q4 push" in January. A model with calendar
  seasonality will attribute that to January-the-month forever, including after a
  fiscal-calendar change.
- **The quarter-end spike is a process, not a season, when the sales motion
  changes.** If the company moves from quarterly to monthly quota, the spike
  moves. Seasonality assumes the pattern persists; a motion change is a structural
  break (§5).

---

## 5. Interventions are modelled, not smoothed over

A pricing change, a site migration, a channel switched off, a product launch, a
rebrand, an outage, a market entry — each is a **level shift, a slope change, or
a transient spike**. Fitting through it produces a forecast that assumes it never
happened.

| Intervention shape | Model treatment |
|---|---|
| **Level shift** (price change, channel off) | A step regressor from the event date. The pre-period level is no longer relevant |
| **Slope change** (new motion, new market) | A ramp regressor from the event date |
| **Transient spike** (launch, campaign, outage) | A pulse regressor, so it is not learned as seasonality |
| **Gradual adoption** | A saturating ramp |
| **Data artefact** (tracking break, migration) | **Exclude the window and mark it**, do not model it |

**Keep an intervention register.** It is a data asset, not documentation:

```yaml
interventions:
  - date: "2026-03-15"
    type: level_shift
    description: "pricing change"
    affects: [revenue, arpu]
    direction: up
  - date: "2026-06-01"
    type: pulse
    description: "tracking outage, 3 days"
    affects: [sessions, signups]
    treatment: exclude_and_mark
```

**Without this register, every structural break becomes noise the model averages
into its error term**, which widens intervals, corrupts seasonality, and makes
the forecast worse in a way nobody can see.

**Detect what the register missed.** Run a changepoint detection and reconcile
the found breaks against the register — an unexplained break is either a
forgotten intervention or a data problem, and both are worth knowing.

### The changepoint over-fitting warning

Some popular additive libraries place changepoints automatically with defaults
tuned for long web-traffic series. **On a short, noisy business series those
defaults find changepoints in noise**, and the forecast then extrapolates the
most recent spurious trend. Reduce changepoint flexibility, restrict the
candidate range to the historical portion, and **plot the fitted changepoints** —
if they do not correspond to anything in the register, they are noise.

---

## 6. Backtest against the naive baseline, rolling-origin

**A single holdout is a single draw.** Rolling-origin evaluation gives a
distribution, and the spread is part of the finding.

```
origin 1: fit on [t0, t1)      forecast [t1, t1+h)      compare
origin 2: fit on [t0, t1+1)    forecast [t1+1, t1+1+h)  compare
...
```

**Evaluate at the horizon you will actually forecast.** A model excellent at
one-step-ahead can be useless at four-step-ahead, and the four-step number is
what the business will use.

| Metric | Use |
|---|---|
| **MASE** | `MAE / MAE_of_naive_on_training`. **Scale-free and interpretable: below 1 beats naive.** The best single number for a forecast |
| **MAE** | Absolute error in the series' own units |
| **RMSE** | When large errors cost more |
| **WAPE** | `sum(|e|) / sum(y)` — the honest percentage measure |
| **MAPE** | Only if the series is strictly positive and bounded away from zero |
| **Coverage** | Share of actuals inside the nominal interval. **Report alongside accuracy, always** |
| **Bias** | `mean(forecast − actual)`. A forecast can have good MAE and be consistently 8% high |

**MASE below 1 is the acceptance bar.** A model that cannot beat seasonal naive
at the real horizon is not earning its keep, and reporting that plainly is more
valuable than shipping it.

---

## 7. Time series ignores pipeline, which in B2B is the leading indicator

**For B2B bookings, a time-series model is a cross-check, not the primary
method.** The pipeline already contains information about the future that the
historical bookings series does not: the deals that exist, their stages, their
amounts, their close dates.

| Series | Primary method | Time series role |
|---|---|---|
| B2B bookings / new ARR | **Pipeline model** (`pipeline-forecast`) | Cross-check and sanity bound |
| Renewals | Renewal base × retention rate | Cross-check |
| Web traffic, sessions | **Time series** | Primary |
| Self-serve signups | **Time series** | Primary |
| Ad spend, impressions | **Time series** with spend as a driver | Primary |
| Product usage | **Time series** | Primary |
| Support volume | **Time series**, driven by customer count | Primary |
| Ecommerce orders | **Time series** with promotions as regressors | Primary |

**Where the two disagree, that is the finding**, not a problem to be averaged
away. A pipeline forecast far above the time-series trend means either the
pipeline is inflated or something genuinely changed; both are worth a
conversation, and reporting the mean of the two hides it.

---

## 8. The last bar is always short

Inherited from `temporal-integrity-audit` and it matters doubly here: **the most
recent period is both incomplete and still settling.**

- **Exclude the incomplete period from the fit**, or the model learns a
  downturn that is an artefact of the calendar.
- **Account for restatement.** Sources with settling windows — paid media
  settling over weeks, conversions back-filling for months, web analytics
  reprocessing over a day or two, billing refunds landing later — mean the last
  several points will rise after you fit.
- **Train on data at equal maturity.** If the series will be forecast from data
  that is 3 days old, backtest using data as it looked 3 days after each origin,
  not as it looks today. Otherwise the backtest is optimistic in a way production
  will not reproduce.

```sql
-- assert the fit window ends before the settling boundary
select max(period) as last_fitted_period, :settling_boundary as boundary
from   fit_data
having max(period) > :settling_boundary;    -- any row returned is a defect
```

---

## 9. Output

```yaml
series:
  name, frequency, n_observations, start, end
  complete_cycles_of_seasonality: <n>
  last_period_complete: bool
  settling_window_days: <n>
adequacy:
  non_seasonal_minimum: <n>, seasonal_minimum: <n>
  verdict: supported | non_seasonal_only | insufficient
  re_aggregation_option: "<e.g. 12 quarterly points = 36 monthly points>"
seasonality:
  tested: true, strength: <v>, periods_detected: [...]
  fiscal_calendar_note: "<if applicable>"
interventions:
  register: [...]
  detected_not_in_register: [...]
  treatment_per_intervention: {...}
model:
  method: "<named, e.g. ETS(A,Ad,M)>"
  parameters, damped: bool
  baseline: seasonal_naive
forecast:
  horizon, points: [{period, point, lo_80, hi_80}]
  interval_basis: model | empirical_backtest
backtest:
  method: rolling_origin, origins: <n>, horizon: <h>
  mase, mae, wape, bias
  vs_baseline: {baseline_mase: 1.0, model_mase: <v>, beats_baseline: bool}
  nominal_coverage: 0.80, measured_coverage: <v>
  per_origin_spread: [...]
cross_check:
  pipeline_forecast: <value or null>
  divergence: "<and what it means>"
limitations:
  - "assumes no structural break in the horizon"
  - "<settling window means recent actuals will rise>"
```

---

## 10. Answering

**Answer first. A short series gets a number with a wide interval, not a
refusal.**

> **Next quarter lands around 4.1M, and I would plan against a range of 3.4M to
> 4.9M.**
>
> That range is wide because your history is short: twelve quarterly
> observations. A seasonal model needs about twenty for quarterly data, so there
> is no seasonal component here — which matters, because your Q4 has run ~20%
> above trend in each of the three years observed, and this forecast does not
> include that. **The direction of the error is therefore low for a Q4, and the
> point estimate should be read as a floor for that quarter.**
>
> **The better number is available and cheap:** the same data at monthly grain is
> thirty-six observations, which does support a seasonal model. If the underlying
> bookings can be re-aggregated monthly, that forecast would be materially better
> and I would use it instead.
>
> **On method:** damped-trend exponential smoothing, backtested rolling-origin
> over six origins at a one-quarter horizon. MASE 0.87, so it beats seasonal
> naive, but only modestly. Measured interval coverage was 71% against a nominal
> 80%, so I have widened the interval using the empirical residuals rather than
> the model's — the range above is the widened one.
>
> **And it is a cross-check, not your primary forecast.** For B2B bookings the
> pipeline is the leading indicator; this series knows nothing about the deals
> currently open. Where this and the pipeline forecast disagree, the disagreement
> is the finding.
>
> Does not claim causality, and assumes no structural break: a pricing change or
> a motion change inside the horizon invalidates it.

**Withhold only** what genuinely cannot be computed:

- **A seasonal forecast below the cycle minimum.** Give the non-seasonal forecast,
  name the seasonal pattern visible in the history with its magnitude, and state
  the direction of the resulting error.
- **A forecast at a horizon far beyond what the backtest covers.** Give the
  nearest backtested horizon and say the longer one is unvalidated.
- **Any forecast on a series with fewer than the non-seasonal minimum.** Give the
  naive baseline and the observed range instead — both are honest, and both are
  better than nothing.

---

## Calls

- `answer-contract` — every forecast, interval and backtest metric; the
  `insufficient` verdict where history cannot support a method
- `provenance-block` — **timezone, date basis, currency and freshness** on the
  series; the settling window is a provenance field
- `comparability-rules` — before comparing periods of unequal coverage or across
  a fiscal-calendar change; before comparing a settled period with an unsettled
  one
- `warning-field-reader` — sampling, thresholding and restatement on the source
  series; a restating source changes history under the model

## References

- `references/method-selection.md` — the methods with parameters, seasonality
  testing, and the intervention regressor patterns
- `references/backtesting.md` — rolling-origin procedure, MASE, coverage
  verification and equal-maturity backtesting

## Related skills

- `pipeline-forecast` — the primary method for B2B bookings; calls this skill for
  its time-series branch
- `ml-foundations-marketing` — the gate and the minimum-sample discipline
- `temporal-integrity-audit` — incomplete periods, settling windows, timezone and
  fiscal-calendar handling
- `model-evaluation-monitoring` — forecast monitoring and retraining triggers
- `anomaly-detection` — the complement: a forecast interval is an anomaly
  threshold
- `incrementality-and-mmm` — where interventions are the question rather than a
  nuisance regressor
