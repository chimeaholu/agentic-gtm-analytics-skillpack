# Backtest protocol

The forecast's accuracy claim comes from this procedure and nowhere else. If
the procedure has not run, the answer says the accuracy is unmeasured rather
than borrowing a number from a vendor page.

## 1. Set up the walk-forward

**Periods.** The last 8 closed periods minimum; 12 is better. Fewer than 4 is
not a backtest, it is an anecdote, and the answer should say so.

**As-of points.** Day 15, 45 and 75 of each period (adapt to a monthly cadence
as day 5, 15, 25). Accuracy at different as-of points are **different claims**.
Never average across them and never compare a day-15 MAPE to a day-75 one.

**Grid.** periods × as-of points × methods. Eight quarters, three as-of points
and four methods is 96 forecast runs, each of which re-queries history. Budget
it with `rate-limit-governor` and cache the reconstructed states — the state is
the expensive part, and every method reuses it.

## 2. Reconstruct state as of each point

This is where backtests silently break. Everything below must be true of the
state used at as-of date `T`:

- Open pipeline is the set of opportunities **open at T**, with the stage and
  amount they carried **at T**. From `fact_opportunity_snapshot`, or from
  stage-history replay, never from current-state records.
- Stage probabilities are calibrated on deals that **closed before T**. Using
  the full-history calibration to forecast a period from two years ago leaks
  the future into the past and produces a backtest number that cannot be
  reproduced live.
- Rep calibration factors use only periods **ending before T**.
- Segment assignment, owner and territory are as of T. Reassignments since then
  must not travel backwards.
- Deals **created after T** do not exist.
- Deals deleted since T **do exist**, if they existed at T. Salesforce
  `queryAll` / `IsDeleted` and HubSpot `?archived=true` recover them;
  Salesforce's 15-day Recycle Bin retention means older deletions are
  unrecoverable, which is itself a limit to state.

### Leakage checklist

Run before trusting any backtest result. Each item has produced a too-good
backtest in the wild.

| # | Leak | Symptom |
|---|---|---|
| 1 | Current stage used instead of stage at T | accuracy far above what the method achieves live |
| 2 | Probabilities calibrated on the full history | accuracy improves for *older* periods, which is backwards |
| 3 | Close date as currently recorded rather than as of T | slippage disappears entirely from the error |
| 4 | Amount as currently recorded | late-stage amount revisions read as forecast skill |
| 5 | Deals created after T included | forecast "anticipates" deals that did not exist |
| 6 | Deals deleted since T excluded | the hardest deals quietly leave the test set |
| 7 | Features derived from close-time fields in an ML variant | near-perfect backtest, useless in production |
| 8 | Seasonal index fitted on the full series including the test period | seasonality looks far more predictable than it is |

**The diagnostic that catches most of these:** plot MAPE by period age. Genuine
backtests show no systematic relationship between how old a period is and how
accurate the method was. A downward slope in error as periods get older means
the future is leaking into them.

## 3. Score

```
error_i          = forecast_i − actual_i
ape_i            = |error_i| ÷ actual_i
pe_i             = error_i ÷ actual_i

MAPE             = mean(ape_i)                   magnitude, direction-blind
Bias (MPE)       = mean(pe_i)                    direction; the correctable part
MAE              = mean(|error_i|)               use when actuals approach zero
Hit rate         = share of i where lower_i ≤ actual_i ≤ upper_i
Interval width   = mean(upper_i − lower_i) ÷ mean(actual_i)
```

Reporting rules:

- **Always report MAPE and bias together.** Alternating ±20% and constant +20%
  share a MAPE; only one of them is fixable with a multiplier.
- **Hit rate must be scored against the range you actually stated.** A "80%
  confidence" range that contained the actual in 3 of 8 periods was not an 80%
  range. Say that, and widen it.
- **Hit rate and interval width are read as a pair.** A range wide enough to
  always contain the actual is not a forecast.
- **MAPE is asymmetric** — it penalises over-forecasting more than under-
  forecasting at the same absolute error, so it quietly rewards a pessimistic
  method. Where that matters, report MAE alongside.
- **MAPE is undefined at zero actuals** and explodes near them. For thin
  segments use MAE against a stated scale.
- **Score by method, period, as-of point, segment and rep.** The rep-level bias
  distribution is the input to calibration, and segment-level MAPE usually
  shows one segment carrying most of the total error.

## 4. Pick the method, then say why

Selection rule, in order:

1. Discard any method that fails to beat run-rate on MAPE at the relevant
   as-of point. Say which methods those were — a losing sophisticated method is
   a finding about the pipeline data, not an embarrassment.
2. Among survivors, prefer the lower MAPE. Where two are within a point or two,
   prefer the one with the smaller absolute bias, then the one whose inputs are
   more stable.
3. Apply the measured bias as a correction, and say you did.
4. Set the range from the **backtest's own error distribution** — for example
   the 10th and 90th percentile of past errors applied to the central figure —
   not from an assumed percentage.

## 5. The accuracy record

Persist one row per scored forecast. This is the artefact that makes the QBR
postmortem possible.

```json
{
  "period": "2026-Q2",
  "as_of_day": 45,
  "method": "calibrated_weighted_pipeline",
  "forecast_central": 4900000,
  "forecast_low": 4600000,
  "forecast_high": 5400000,
  "stated_confidence": 0.70,
  "actual": 5120000,
  "ape": 0.043,
  "pe": -0.043,
  "in_range": true,
  "segment": "all",
  "calibration_window": "2024-Q3..2026-Q1",
  "inputs_snapshot_id": "snap_2026-05-15",
  "notes": "stage definition change 2026-01-14 excluded pre-change deals"
}
```

Fields that earn their place: `inputs_snapshot_id` makes the run reproducible,
`calibration_window` explains why two runs of the "same" method differ, and
`notes` is where a stage redefinition or a territory change gets recorded so
next quarter's analyst does not rediscover it.

## 6. The QBR postmortem

Four questions, answered from the accuracy record:

1. Which method had the lowest MAPE at the day-of-period the leadership team
   actually commits on?
2. What was the bias, and is it stable enough to correct for?
3. Which segments or reps carried the error, and is their bias persistent?
4. Did the stated range contain the actual as often as its label claimed?

If the answer to (4) is no, the range was mislabelled, and the fix is a wider
range rather than a better story.
