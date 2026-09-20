# Detection methods

Each method, a runnable implementation, when it is right, and — the section people
skip — what it cannot detect.

---

## 1. Static threshold

```python
fired = value > threshold          # or < for a floor
```

**Right when** the number has a hard business or contractual meaning: daily spend
above the budget cap, error rate above the SLA, a queue older than the response
commitment.

**Cannot detect** anything relative. A metric that halves while staying above its
floor never fires. Thresholds also rot: one set against last year's volume is
either permanently firing or permanently silent, and nobody notices which.

**Review every static threshold quarterly.** Put the date it was set next to the
value in the registry, because a threshold with no set-date cannot be judged.

---

## 2. Percentage change versus prior period

```python
pct = (value - prior) / prior if prior else None      # None, not inf
fired = pct is not None and abs(pct) > tolerance
```

**Right when** the metric is stable and genuinely non-seasonal — a stock
(open pipeline, active subscriptions), not a flow.

**Cannot detect** anything in a weekly-cycling metric without firing constantly:
Monday against Sunday is a 300% move in most B2B GTM data and means nothing.

**`prior == 0` returns `None`, not infinity.** This is the `answer-contract` rule
for a zero denominator, and in an alerting context it is the difference between a
silent skip and a critical page for a metric that went from 0 to 1.

---

## 3. Seasonal baseline — same weekday, trailing four weeks

The highest value-per-unit-complexity method in this file, and the one most often
skipped on the way to statistics.

```python
def seasonal_baseline(series: dict[date, float], d: date, weeks: int = 4):
    peers = [series[d - timedelta(days=7 * k)] for k in range(1, weeks + 1)
             if (d - timedelta(days=7 * k)) in series]
    if len(peers) < 3:
        return None          # not enough history: report unavailable, do not guess
    return sum(peers) / len(peers)
```

**Right when** the metric has a weekly cycle, which is nearly every GTM metric:
activity, meetings, pipeline creation, email engagement, web sessions.

**Cannot detect** a slow drift — a metric declining 3% a week is never more than
3% off its own trailing baseline and never fires. Pair it with a month-over-month
or a trend test.

**Holidays poison the baseline for the following four weeks.** A public holiday
sits in the trailing window and drags the baseline down, so the week after looks
anomalously high. Exclude flagged calendar days from the peer set rather than
suppressing the alert after it fires.

```python
peers = [v for dt, v in peer_days if dt not in holiday_calendar]
```

---

## 4. Robust z-score (median / MAD)

```python
import numpy as np

def robust_z(history: np.ndarray, x: float) -> float | None:
    med = np.median(history)
    mad = np.median(np.abs(history - med))
    if mad == 0:
        return None                       # undefined, not zero, not infinite
    return 0.6745 * (x - med) / mad

# |z| > 3.5 is the conventional outlier threshold on this scale
```

**Why median and MAD rather than mean and standard deviation:** a single prior
spike inflates the standard deviation enough to hide the next one. The
breakdown point of the mean is 0% — one bad value moves it arbitrarily far — while
the median's is 50%. In alerting terms: after an incident, a mean-and-sigma
detector is *less* able to detect the next incident, which is exactly backwards.

Worked, with plausible numbers:

```
history (14 days): 100, 98, 102, 99, 101, 97, 103, 100, 400, 99, 101, 98, 102, 100
                                                        ↑ a prior incident

mean = 121.4, sd = 79.6   →  z for today's 40  = (40−121.4)/79.6  = −1.02   NOT FLAGGED
median = 100,  MAD = 1.5  →  z_rob for 40      = 0.6745×(40−100)/1.5 = −27.0  FLAGGED
```

The mean-based detector misses a 60% drop because of an unrelated spike nine days
earlier. That is the whole argument.

**Cannot detect** anomalies in a trending series — see §6 — and behaves badly on
low counts — see §5. `mad == 0` is a real case on constant metrics and returns
`None`; fall back to an absolute-change rule and **label the alert as using the
fallback method**, because the reader needs to know the detector changed.

**History length:** 28 to 90 points. Fewer than about 14 and the median is
unstable; more than 90 and a genuine level shift from months ago is still being
counted as normal.

---

## 5. Count metrics: use a Poisson tail, not a z-score

For a metric averaging a handful of events a day, the normal approximation is
wrong in a way that matters: the distribution is right-skewed, and zero is often
less than three standard deviations below the mean, so **a downside alert can be
mathematically impossible to trigger.**

```python
from scipy.stats import poisson

def count_anomaly(observed: int, baseline_mean: float, alpha: float = 0.001):
    p_low  = poisson.cdf(observed, mu=baseline_mean)        # P(X ≤ observed)
    p_high = poisson.sf(observed - 1, mu=baseline_mean)     # P(X ≥ observed)
    if p_low  < alpha: return ('low',  p_low)
    if p_high < alpha: return ('high', p_high)
    return None
```

With a baseline of 3/day, observing 0 has p ≈ 0.050 — **not** significant at
α=0.001. That is correct and important: zero conversions on a 3/day metric is an
ordinary Tuesday, and a detector that pages for it is manufacturing alerts.

**If the variance exceeds the mean** (overdispersion, which is common where a
single account can place several orders), Poisson is too tight and will
over-alert. Check `var/mean` on the history; above about 1.5, switch to a
negative binomial or aggregate to a weekly grain.

**The practical alternative to all of this: aggregate up.** A metric too small to
alert on daily is often fine weekly, and a weekly alert on a small metric is
better than a daily alert nobody can trust.

---

## 6. Detrending: STL residuals

A metric growing steadily is anomalous against its own median every day by
construction. Decompose first, then detect on the residual.

```python
from statsmodels.tsa.seasonal import STL

res = STL(series, period=7, robust=True).fit()       # robust=True downweights outliers
z = robust_z(res.resid[:-1].values, res.resid.iloc[-1])
```

`period=7` for daily GTM data with a weekly cycle; `period=12` for monthly with an
annual one. **`robust=True` matters** for the same reason MAD matters: a prior
outlier otherwise distorts the fitted seasonal component itself.

**Needs at least two full seasonal cycles** and preferably several. With eight
weeks of daily data STL is fitting noise, and its residuals will not mean what
you think. Below that, use the same-weekday baseline (§3).

**Cannot detect** a change in the seasonal pattern itself — a business whose
weekly shape changes shows up as elevated residuals for weeks and then is
absorbed into the new fitted seasonality. Watch the residual *variance*, not only
its individual points.

---

## 7. Forecast-interval breach

Where a forecast already exists, an actual outside its prediction interval is an
anomaly with a calibrated probability attached.

```python
fired = actual < lower_80 or actual > upper_80
```

**Right when** a forecast is maintained anyway. It is free, and the interval
already encodes seasonality and trend.

**The trap:** prediction intervals from most forecasting libraries are
systematically too narrow, because they capture parameter uncertainty and not
model uncertainty. An 80% interval frequently contains well under 80% of actuals
in practice. **Measure your own interval coverage before trusting it as a
threshold** — count the fraction of past actuals that fell inside, and widen the
interval or lower the alert confidence to match. See `model-evaluation-monitoring`.

---

## 8. Choosing the threshold

Thresholds are a false-positive budget, not a statistical truth. Set them from the
budget backwards.

| Metrics monitored | Evaluations per week | Threshold for ~1 false alert/week |
|---|---|---|
| 10 | 70 | p ≈ 0.014 → \|z_rob\| ≈ 2.5 |
| 50 | 350 | p ≈ 0.003 → \|z_rob\| ≈ 3.0 |
| 200 | 1,400 | p ≈ 0.0007 → \|z_rob\| ≈ 3.5 |

**Monitoring more metrics requires a stricter threshold, not the same one.** At
the same per-test threshold, 200 metrics produce twenty times the false alerts of
10 — this is the multiple-comparisons problem, and in an alerting system it
presents as "the alerts stopped being useful when we scaled up monitoring".

Calibrate empirically before going live: **run the detector over the last 90 days
of history and count how many times it would have fired.** If that number exceeds
what a human will read, the threshold is wrong — regardless of what the
statistics say. This backtest takes minutes and is the single most useful thing
to do before enabling any detector.

---

## 9. What none of these can do

State it in the alert, not only here.

- **They detect movement, not cause.** Every method above is correlational. The
  segment decomposition narrows *where*, never *why*.
- **They cannot distinguish a real business change from a measurement change.** A
  tracking script that stopped firing, a UTM taxonomy change, a consent-banner
  rollout and a genuine demand drop are identical to every detector in this file.
  That is why pipeline health is checked first and why the segment-definition
  check in §8 of the SKILL.md exists.
- **They cannot see what was never collected.** A channel that stopped being
  tagged looks like a channel that stopped performing.
- **A non-firing detector is not evidence that nothing happened.** It is evidence
  that nothing exceeded the threshold, which — per §8 — was set from an alert
  budget, not from a level of business significance.
