---
name: pipeline-forecast
description: Use for any sales forecast request — will we hit the number, what will bookings be, how much pipeline do we need, or reviewing an existing forecast. Covers weighted pipeline with historically recalibrated stage probabilities, cohorted stage-conversion models, velocity and flow models, run-rate, rep roll-up with per-rep calibration, and time-series where it is appropriate. Always outputs a range with a stated confidence and a named method, always benchmarks against the naive run-rate, and tracks forecast accuracy over time. Prevents a weighted-pipeline number built on CRM default stage probabilities nobody ever recalibrated.
---

# Pipeline forecast

A forecast is a claim about the future that can be scored. This skill produces
a range, names the method, benchmarks it against the naive baseline, and
**earns its accuracy claim by backtesting on the org's own closed history** —
never by citing a vendor's number.

## The rule that orders everything else

**Backtest before you assert. Run-rate is the bar.**

Any method that cannot beat a naive run-rate extrapolation on this org's own
last eight quarters is not earning its keep, and the answer says so out loud.
The backtest is not a validation ceremony at the end; it is how the method gets
chosen. Section "Backtesting" below is the procedure, and it runs before the
forecast is presented.

## Method selection

Pick by what data actually exists, not by sophistication.

| Data you have | Method | What it cannot do |
|---|---|---|
| Open pipeline with stage and amount, ≥4 quarters of closed deals | **recalibrated weighted pipeline** | model slippage, or know when a stale deal is dead |
| The above **plus** daily opportunity snapshots or stage history | **cohorted stage conversion** | survive a mid-history stage redefinition |
| Creation rate, win rate, deal value, cycle length on one cohort | **velocity / flow** | handle seasonality or any GTM change |
| Recent actuals only | **run-rate** (always compute, as the baseline) | see pipeline, so it misses inflections |
| Rep forecast submissions with ≥4 quarters of outcomes | **calibrated rep roll-up** | fix category definitions that differ by manager |
| ≥36 periods of a stationary series | **time series** | apply to B2B quarterly bookings, where n is far too small |
| ≥18 months of clean deal history, consistent stage semantics | **per-deal win probability model** | be explained to a sales leader, so it gets overridden |

**Run these together where data allows.** The spread between methods is
information: three methods within 5% is a tighter forecast than any one of them;
three methods 30% apart means the pipeline is telling you something about its
own reliability.

## 1. Weighted pipeline, done properly

```
Weighted pipeline = Σ over open opportunities
                    amount × P(stage) × in_period(close_date) × decay(staleness)
```

- **Grain:** one row per open opportunity, as of a stated snapshot date.
- **Denominator:** none — a sum. The rate that needs one is `P(stage)`.
- **Window:** deals whose close date falls in the forecast period. Not "all
  open pipeline".

### P(stage) must be recalibrated

```
P(stage) = deals that entered this stage in the calibration window and were won
           ÷ deals that entered this stage in the calibration window and have
             since closed (won or lost)
```

- **Denominator:** deals **that entered the stage and have closed**. Deals
  still open must be excluded from both sides, or the rate is diluted by deals
  that have not had time to resolve.
- **Grain:** stage × segment. One probability set for the whole business is
  usually wrong for both halves of it.
- **Calibration window:** long enough to contain ≥30 closed deals per stage per
  segment, short enough not to cross a stage redefinition.

**The single biggest defect in this domain is using the CRM's default stage
probabilities.** Salesforce `Opportunity.Probability` defaults from
`OpportunityStage.DefaultProbability`, set once at implementation and never
revisited; HubSpot's `hs_deal_stage_probability` behaves the same way. They are
configuration, not measurement. Read them, compare them to the recalibrated set,
and **show both** — the gap is itself a finding a sales leader will act on.

### Three things weighted pipeline silently assumes

1. **Everything closes in period.** It does not. A deal at 60% with a close
   date pushed three times contributes exactly as much as a fresh one. Apply
   `in_period(close_date)` as a hard filter and a staleness decay on top.
2. **Stage is a proxy for probability.** It is a proxy for *process
   completion*, which correlates with probability only if reps advance stages
   honestly and consistently. Where stage advancement is required for a
   forecast category, the correlation is partly manufactured.
3. **Slippage does not exist.** It is the dominant error in most B2B forecasts.
   Measure it: the share of deals with a close date in the period that were
   still open at period end, and the median number of times a close date was
   pushed. Then apply it as a haircut, or model it explicitly.

A defensible staleness decay, with the parameters stated:

```
decay = 1                              if days_in_stage ≤ p50 stage duration
      = 0.5                            if p50 < days_in_stage ≤ p90
      = 0.15                           if days_in_stage > p90
      = 0                              if close_date is in the past and stage unchanged
```

These cut points come from the org's own stage-duration distribution, not from
this file. A deal whose close date has already passed and whose stage has not
moved is not a 60% deal; it is an unworked record.

## 2. Cohorted stage conversion

Apply historical stage→close conversion *and* historical stage duration to the
current pipeline, so a deal's contribution depends on when it is likely to
land, not only whether.

```
Forecast(period) = Σ over open opportunities
                   amount × P(win | current stage, segment)
                          × P(closes within period | current stage, days in stage)
```

**Requires `fact_opportunity_snapshot`** — the daily snapshot table most orgs
have never built (see `data-model-designer`). Current-stage fields cannot
support it: a deal that skipped a stage or moved backwards is invisible, and
HubSpot's `hs_v2_date_entered_<stage>` / lifecycle-stage date properties are
**overwritten on re-entry**, so a re-entered stage loses its first entry.
Salesforce `OpportunityHistory` covers stage changes but is typically enabled
after the fact and only for tracked fields.

Two further failure modes: **stage definitions changing mid-history** makes the
conversion rates non-comparable across the calibration window (mark the change
date and calibrate on one side of it only), and **thin segments produce
unstable rates** — apply the minimum-n rule and fall back to the parent segment
rather than quoting a rate from nine deals.

## 3. Velocity / flow

```
Pipeline velocity = (opportunities × win rate × average deal value) ÷ cycle length
```

Units are **revenue per unit time**. It is routinely mislabelled as a duration.
Two hard rules:

- **All four inputs come from the same cohort and the same segment.** Enterprise
  deal value over SMB cycle length describes no team that exists.
- **Cycle length uses the median, not the mean.** The distribution is
  right-skewed with a long tail; the mean is dragged by a handful of eighteen-
  month deals and makes velocity look worse than it is. Model the tail
  separately if the tail matters, and note that cycle length computed on closed
  deals only is **survivorship-biased downward**, because the still-open deals
  are disproportionately the slow ones.

Flow assumes stationarity: constant creation rate, constant conversion,
constant cycle. It breaks on seasonality and on any GTM change — a new segment,
a pricing change, a territory redesign. Check for those before using it.

## 4. Run-rate: the mandatory baseline

```
Run-rate forecast = mean bookings over the last N comparable periods
                    × seasonal index for the target period
```

Compute it **every time**, present it **next to** the sophisticated number, and
state which one the backtest favours. Run-rate is blind to pipeline and misses
inflections in both directions, which is exactly why beating it is a meaningful
test rather than a formality.

## 5. Rep roll-up and per-rep calibration

Raw rep-submitted forecasts run roughly ±30–40% at the individual level, and
**the bias is individually persistent**: sandbaggers sandbag every quarter and
optimists are optimistic every quarter.

```
Calibration factor(rep) = median over prior periods of
                          (actual bookings ÷ that rep's commit at the same
                           day-of-period)
Calibrated roll-up = Σ over reps  commit(rep) × calibration factor(rep)
```

- **Grain:** rep × period.
- **Compare at the same day-of-period.** A day-15 commit and a day-75 commit
  are different objects; coverage and commit both move mechanically through a
  quarter. This needs commit history — snapshot it if it is not already stored.
- **Use the median, not the mean**, over prior periods: one blown quarter should
  not rewrite a rep's factor.
- **Minimum history: 4 periods.** Below that, apply the team factor and say so.
- New reps have no factor. Use the team factor and flag them, because ramp (see
  `territory-quota-capacity`) is doing more work than calibration there.

**Category definitions drift between managers.** One manager's Commit is
another's Best Case. Calibration absorbs some of this, and where two teams'
categories differ materially the honest move is to calibrate per manager and say
that the categories are not a shared language.

## 6. Time series: refuse more often than you fit

B2B quarterly bookings have a small-n problem that no library solves. Twelve
quarters cannot support a seasonal model — a yearly seasonal term needs several
full cycles, and three is not several. Prophet's changepoint defaults will
happily over-fit a short noisy series and produce confident nonsense.

Time series also **ignores pipeline**, which is the actual leading indicator.
It is the wrong tool for B2B quarterly bookings and a reasonable tool for B2C
daily or weekly revenue, where n is large and seasonality is real.

**This skill refuses rather than fits.** When asked for a time-series forecast
on fewer than ~36 observations, return the refusal with the run-rate plus
seasonal-index alternative computed, and say what would make time series
appropriate. See `timeseries-forecasting-models` when the data supports it.

## 7. Per-deal win probability models

Needs ≥18 months of clean deal history with consistent stage semantics. Three
things to say to anyone considering one:

- **Vendor accuracy figures in the high eighties and low nineties are vendor
  benchmarks, computed on data most orgs do not have.** This skill never quotes
  one as a fact about your org. Your number comes from your backtest.
- **Feature leakage is the specific technical trap.** "Days since last
  activity" on a closed deal, stage at close, any field a rep updates when a
  deal is won or lost — all leak the outcome and produce backtest accuracy that
  evaporates in production. Features must be restricted to what was knowable at
  the as-of date. Build the training set from snapshots, not from current-state
  records.
- **It degrades silently when the GTM motion changes** and it is unexplainable
  to a sales leader, so it gets overridden in the forecast call anyway. Its
  realistic value is ranking deals for attention, not producing the number.

See `supervised-propensity-models`.

## 8. Scenarios are ranges, not three nouns

Bear / Base / Bull with one number each is theatre. Output a **range with a
stated probability**, and state the assumptions moved.

- **Correlated assumptions moved independently produce impossible scenarios.**
  Win rate and deal size usually move together; cutting both by 20% in the
  "bear" case double-counts one underlying cause.
- **Rep ramp is the most-omitted and most-consequential parameter.** A plan
  that assumes new hires carry full quota from their start date overstates
  capacity for the entire planning horizon. Take the ramp curve from
  `territory-quota-capacity` rather than assuming one.
- Name the two or three assumptions the answer is most sensitive to, with the
  forecast's movement per unit change in each. That sensitivity table is
  usually more decision-useful than the point estimate.

## Backtesting: how the accuracy claim gets earned

**Walk-forward on the org's own history. No exceptions, no vendor numbers.**

1. **Pick the as-of points.** Day 15, day 45 and day 75 of each of the last
   ≥8 closed periods. Forecast accuracy at day 15 and day 75 are different
   claims and must never be compared to each other.
2. **Reconstruct the state as of each point.** Only what was knowable then:
   open pipeline as it stood, stage as it stood, probabilities calibrated on
   deals closed *before* that date. This is the step that fails silently —
   using today's stage history to build a day-15 forecast from six quarters ago
   leaks the future and produces a backtest that cannot be reproduced live.
3. **Run every candidate method, including run-rate.**
4. **Score against the actual.**

```
Error            = forecast − actual
MAPE             = mean over periods of |forecast − actual| ÷ actual
Bias (MPE)       = mean over periods of (forecast − actual) ÷ actual
Hit rate         = share of periods where actual fell inside the stated range
```

- **MAPE without bias is half the picture.** A method that alternates +20% and
  −20% has the same MAPE as one that is +20% every time. The second is
  correctable by a constant; the first is not.
- **Report hit rate against the stated range**, because a range that contains
  the actual 40% of the time is not an 80% range, whatever it was labelled.
- **Score by method, by period and by rep.** Rep-level bias is what makes
  calibration work at all.
- **MAPE is asymmetric and undefined at zero actuals.** For a segment that
  sometimes books nothing, use MAE against a stated scale instead and say why.

Then state the result plainly: *"On the last eight quarters, calibrated
weighted pipeline at day 45 ran 11% MAPE with a +4% bias; run-rate ran 19%
MAPE. That is why the forecast below uses the calibrated method, and why the
range is ±11% rather than something tighter."*

**An org that never scores its own forecast cannot improve it, and almost none
do.** A forecast-accuracy postmortem belongs in every QBR: which method won,
where the bias sat, which reps drove it.

## Answering

> **The forecast is 4.6M to 5.4M for the quarter, with 4.9M as the central
> figure, at roughly 70% confidence.**
>
> That is calibrated weighted pipeline at day 45: recalibrated stage
> probabilities from the last six quarters, a staleness decay on deals past
> their p90 stage duration, and per-rep bias factors. Naive run-rate says 5.3M.
> The gap is mostly slippage — 22% of deals with a close date in the period were
> already past their original close date when the snapshot was taken, and the
> run-rate method cannot see that.
>
> Backtested on the last eight quarters at the same day-of-period, this method
> ran 11% MAPE with a +4% optimistic bias; run-rate ran 19%. The bias is why
> the central figure sits below the mechanical output. The range is the
> backtest's own error distribution, not an assumption.
>
> The number moves most on two things: win rate in the enterprise segment
> (±3 points moves the forecast ±340K) and whether the four deals over 250K
> land in period rather than slipping (±600K). Those four deals are the
> forecast.
>
> Does not claim causality and does not model a GTM change: the calibration
> window assumes the motion that produced the last six quarters still holds.

## Honest limits

- **No stage history, no cohorted model.** Say so, use recalibrated weighted
  pipeline, and name daily snapshotting as the change that unlocks the better
  method.
- **Fewer than four quarters of closed deals: no calibration.** Report the
  CRM-default weighted figure, label it as uncalibrated, state that CRM defaults
  are typically optimistic, and give the run-rate alongside.
- **A stage redefinition inside the calibration window** means the pre-change
  deals cannot be pooled with the post-change ones. Calibrate on the shorter
  post-change window, accept the wider interval, and mark the date.
- **Forecasting a new segment or a new motion is not a forecast.** With no
  comparable history, output a scenario range with the assumptions named and
  label it a plan, not a forecast.
- **Every vendor accuracy benchmark in this domain is a vendor benchmark.**
  This skill quotes none of them as a measurement.

## Core contracts this skill calls

- `answer-contract` — the range, the method, the confidence, and the
  `unavailable` / `partial` results when history is too short
- `provenance-block` — snapshot as-of date, currency and FX treatment on
  amounts, the three clocks (event, snapshot, query), and the modelled label on
  every forecast series
- `comparability-rules` — before a forecast built on one calibration window sits
  next to one built on another, and before CRM amounts are combined with report
  amounts (multi-currency conversion differs between the two paths)
- `warning-field-reader` — Salesforce `allData` on report-sourced pipeline,
  HubSpot rollup properties that are stale or null on read
- `pagination-patterns` — the 2,000-row report cap and the Bulk API path for
  full opportunity extraction; HubSpot's 10,000-result search ceiling
- `rate-limit-governor` — backtests re-query history repeatedly; budget before
  running eight periods × three as-of points × several methods

## References

- `references/backtest-protocol.md` — the walk-forward procedure, leakage
  checklist, scoring formulas and the accuracy record schema
- `references/method-register.md` — every method with formula, inputs, grain,
  assumptions, failure modes and the data that must exist

## Related skills

- `data-model-designer` for `fact_opportunity_snapshot`, without which half of
  this is unavailable
- `funnel-conversion-analysis` for the cohorted stage rates this skill consumes
- `win-loss-analysis` for the win rate, with its denominator declared
- `territory-quota-capacity` for the ramp curve and the coverage requirement
- `timeseries-forecasting-models` only where n supports it
- `supervised-propensity-models` for per-deal win probability
