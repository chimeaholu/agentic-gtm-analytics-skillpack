# Forecast method register

One entry per method: formula, inputs, grain, denominator where there is one,
assumptions, failure modes, and the honest statement of what it cannot do.

---

## Run-rate (baseline — always computed)

```
Run-rate = mean(bookings over last N comparable periods) × seasonal_index(target)
```

- **Inputs:** closed-won bookings by period. Nothing else.
- **Grain:** period.
- **Assumptions:** the near future resembles the near past; the seasonal index
  is real and estimable.
- **Fails when:** an inflection is under way in either direction — a new
  segment ramping, a large deal cohort landing, a pricing change, a territory
  redesign, a layoff.
- **Cannot do:** see pipeline at all. It is blind by construction, which is
  exactly why beating it is a meaningful test.
- **Seasonal index needs several full cycles.** With three years of quarters,
  say the index is indicative and give the unadjusted figure alongside.

---

## Weighted pipeline (recalibrated)

```
Forecast = Σ amount × P(stage, segment) × in_period(close_date) × decay(staleness)

P(stage, segment) = won ÷ (won + lost), over deals that ENTERED that stage
                    within the calibration window and have since closed
```

- **Inputs:** open pipeline with stage, amount, close date, days in stage;
  ≥4 quarters of closed deals for calibration.
- **Grain:** opportunity, summed to period.
- **Denominator (for P):** closed deals that entered the stage. Open deals
  excluded from both numerator and denominator.
- **Assumptions:** stage advancement is honest and consistent; deals in period
  close in period; the calibration window's motion still holds.
- **Fails when:** stage definitions changed mid-window; reps advance stages to
  satisfy a forecast-category rule; a small number of large deals dominate, in
  which case the expected-value logic does not describe any likely outcome.
- **Common miscomputation:** using `Opportunity.Probability` /
  `hs_deal_stage_probability` as-is. Those are configuration defaults, not
  measurements. Also: including all open pipeline rather than filtering to
  close-date-in-period.
- **Cannot do:** model slippage, or distinguish a dead deal from a slow one.

**Concentration check.** If the top five deals are more than ~40% of the
weighted figure, expected value is the wrong summary. Report the weighted
number, then report those deals individually with their own judgement attached
— the forecast is those deals.

---

## Cohorted stage conversion

```
Forecast = Σ amount × P(win | stage, segment)
                    × P(close within period | stage, days_in_stage, segment)
```

- **Inputs:** `fact_opportunity_snapshot` or full stage history; historical
  stage-duration distributions.
- **Grain:** opportunity × day.
- **Assumptions:** stage semantics stable across the calibration window;
  duration distributions stationary.
- **Fails when:** the snapshot table does not exist (the usual case); stages
  were redefined; segments are thin enough that the duration distribution is
  noise.
- **Common miscomputation:** deriving stage transitions from the current-stage
  field. Deals that skipped a stage or moved backwards are invisible, and
  HubSpot's `hs_v2_date_entered_<stage>` properties are **overwritten on
  re-entry**, so re-entered stages lose their earlier history.
- **Cannot do:** survive a mid-history stage redefinition. Calibrate on one
  side of the change and accept the shorter window.

---

## Velocity / flow

```
Pipeline velocity = (opportunities × win rate × average deal value) ÷ cycle length
```

- **Inputs:** creation counts, win rate, deal value, cycle length — **all from
  the same cohort and the same segment**.
- **Grain:** segment × period. Units are revenue per unit time.
- **Assumptions:** stationarity in all four inputs.
- **Fails when:** seasonality is material; the motion changed; segments are
  mixed.
- **Common miscomputation:** mean cycle length on a right-skewed distribution.
  Use the median. Also: computing cycle length from closed deals only, which is
  **survivorship-biased downward** because slow deals are still open — for an
  incomplete cohort, report cycle length as a lower bound.
- **Cannot do:** handle a changing mix. A velocity improvement driven by more
  SMB deals is a mix shift, not an improvement.

---

## Calibrated rep roll-up

```
factor(rep)    = median over prior periods of (actual ÷ commit at same day-of-period)
Forecast       = Σ commit(rep) × factor(rep)
```

- **Inputs:** rep commit history at comparable day-of-period; actual bookings
  by rep.
- **Grain:** rep × period.
- **Assumptions:** individual bias is persistent — which it demonstrably is.
- **Fails when:** fewer than 4 prior periods per rep (use the team factor and
  flag it); the rep is new, where ramp dominates; the rep changed segment or
  territory, which resets the factor.
- **Common miscomputation:** comparing commits taken at different points in the
  period. Commit and coverage both move mechanically through a quarter, so a
  day-15 commit compared against a day-75 factor is a category error.
  Snapshotting commit history is a prerequisite most orgs must build.
- **Cannot do:** repair category definitions that differ between managers.
  Calibrate per manager where they differ, and say the categories are not a
  shared language.

---

## Time series

- **Inputs:** ≥36 observations of a stationary or trend-stationary series.
- **Grain:** period.
- **Assumptions:** the series carries the signal; seasonality is estimable from
  several full cycles.
- **Fails when:** applied to B2B quarterly bookings. Twelve quarters cannot
  support a yearly seasonal term, and library defaults — Prophet's changepoint
  prior in particular — over-fit short noisy series into confident nonsense.
- **Cannot do:** see pipeline, which is the leading indicator. Appropriate for
  B2C daily or weekly revenue; **this skill refuses on B2B quarterly bookings**
  and returns run-rate plus a seasonal index instead, with the refusal reason
  stated.

---

## Per-deal win probability (ML)

- **Inputs:** ≥18 months of deal history with consistent stage semantics,
  built from **snapshots** so features are restricted to what was knowable at
  the as-of date.
- **Grain:** opportunity × as-of date.
- **Assumptions:** the motion that produced the training data still holds.
- **Fails when:** the GTM motion changes — silently, with no error, and the
  model keeps producing confident scores.
- **Common miscomputation:** feature leakage. "Days since last activity" on a
  closed deal, stage at close, amount as finally recorded, any field reps touch
  at win or loss. Leakage produces excellent backtests and useless production
  behaviour.
- **Cannot do:** be explained to a sales leader, so it gets overridden in the
  call. Its realistic value is ranking deals for attention rather than
  producing the committed number.
- **Vendor accuracy figures are vendor benchmarks computed on data most orgs
  lack.** Your number comes from your own walk-forward backtest or you do not
  have one.

---

## Scenario modelling

- **Output:** a range with a stated probability, plus a sensitivity table.
  Never three nouns with one number each.
- **Assumptions:** the ones you name. Name them.
- **Fails when:** correlated assumptions are moved independently — win rate and
  deal size usually move together, so cutting both 20% in the bear case
  double-counts one cause.
- **Most-omitted parameter: rep ramp.** Take the curve from
  `territory-quota-capacity`; assuming day-one productivity overstates capacity
  across the whole horizon.
- **Most useful output:** forecast movement per unit change in each of the two
  or three assumptions the answer is most sensitive to. That table beats the
  point estimate for most decisions.
