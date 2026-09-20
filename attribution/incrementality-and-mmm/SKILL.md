---
name: incrementality-and-mmm
description: Use when a budget decision is worth more than the opportunity cost of a test, when channels include offline or otherwise unmeasurable media, when privacy loss has broken user-level measurement, or when attribution and intuition disagree and someone needs the truth. Covers geo-lift and synthetic-control incrementality testing — including the power simulation you run before spending a dollar — and media mix modelling with adstock, saturation and experiment calibration. Composes Meridian, Robyn, PyMC-Marketing, GeoLift and CausalImpact rather than reimplementing them, and teaches which to reach for. Prevents an underpowered test being read as "the channel doesn't work", which is the most damaging failure in this family.
---

# Incrementality and MMM

**This is the only causal member of the attribution family.** Everything in
`attribution-rule-based` and `attribution-algorithmic` describes the journeys you
recorded. A geo-lift experiment creates a counterfactual, and an MMM calibrated
against one estimates the shape of returns. Nothing else in the pack answers
"what did the spend actually cause".

It is also the family where the pack's contribution is **not** implementation.
Meridian, Robyn, PyMC-Marketing, GeoLift and CausalImpact are mature, maintained
and better than anything written for one engagement. The useful skill is knowing
**when to reach for which, what data each truly requires, how each misleads, and
how to read a null result** — because the most expensive failure in this family
is a correctly-executed test whose result is misread.

---

## 1. Route first

| Situation | Reach for | Why |
|---|---|---|
| One channel, a decision worth real money, and you can withhold or increase spend by geography | **geo-lift** (GeoLift, or CausalImpact for a single-market intervention) | the only design that produces a counterfactual |
| Allocate a whole budget across channels including offline, TV, OOH, sponsorships | **MMM** (Meridian, Robyn, PyMC-Marketing) | no user-level data required, which is why it resurged post-ATT |
| An MMM exists and nobody trusts it | **geo-lift to calibrate the MMM** | this is the strongest current practice in the field |
| A single discrete event — a launch, a pricing change, a PR spike — in one market | **CausalImpact** | Bayesian structural time series handles trend and seasonality explicitly |
| In-flight weekly optimisation | **neither** | MMM refreshes quarterly at best; use the MTA spread and MER as guardrails |
| A channel whose budget has never varied | **neither** | no identification is possible; say so rather than producing a coefficient |
| Under 52 weeks of history | **not MMM** | below the floor; a geo test is still available |

**The decision rule that matters most: if the budget move under consideration is
worth more than the opportunity cost of under-spending one region for a few
weeks, run the test.** Nothing else settles the question, and every model in the
rest of the tier will keep disagreeing until something does.

---

## 2. Geo-lift

### 2.1 The design

Split geographies into treatment and control. Change spend in treatment — a
holdout (spend to zero), a spend-down, or a spend-up. Estimate the
counterfactual with a **synthetic control**: a weighted combination of untreated
markets chosen to track the treated markets' pre-period trajectory.

```
minimise over w:   Σ_{t ∈ pre}  ( y_treated(t) − Σ_j w_j · y_j(t) )²
subject to:        w_j ≥ 0,   Σ_j w_j = 1
```

The non-negativity and sum-to-one constraints are what stop the fit being an
unconstrained regression that extrapolates. Then

```
lift(t)     = y_treated(t) − ŷ_synthetic(t)        for t in the test period
total lift  = Σ_{t ∈ test} lift(t)
incremental CPA = incremental spend / total lift
```

Inference comes from **placebo tests**: re-run the whole procedure treating each
control market as if it were treated, build the distribution of placebo effects,
and locate your actual effect in it. That is where the interval comes from — not
from a t-test on the outcome series.

### 2.2 Power simulation is non-negotiable, and it comes first

**Run the power simulation before spending a dollar.** Simulate the test you
intend to run at a range of effect sizes, against your actual market-level
history, and read off the smallest effect the design can detect.

```
for effect in [0%, 5%, 10%, 15%, 20%, 30%]:
    for replicate in 1..N:
        inject `effect` into the treated markets over the planned test window
        run the estimator
        record whether the effect was detected at the chosen threshold
    power(effect) = detections / N
MDE = smallest effect with power ≥ 0.80
```

GeoLift ships exactly this — market selection and power simulation are its
headline features, not an add-on.

**Then apply the gate.** If the MDE exceeds the effect size worth acting on, the
honest output is *"this test cannot answer this question"*, with the three things
that would change it: more markets, a longer test window, or a larger spend
change. **Do not run a smaller version.** An underpowered test does not return
"inconclusive" in the real world — it returns a non-significant result that gets
reported as "the channel doesn't work", and that is the most damaging failure in
this family.

### 2.3 How geo-lift still misleads

1. **Spillover.** People travel, media bleeds across DMA boundaries, and
   connected-TV and social targeting are imprecise geographically. Spillover
   contaminates control markets and **biases the measured lift toward zero** —
   so a geo-lift result is typically a conservative estimate of the true effect.
   Name that direction.
2. **The result is local.** It applies to the tested period, the tested creative,
   the tested spend level and the tested markets. **A lift figure is not a
   constant you can apply to next year's budget**, and treating it as one is the
   quiet way a good test becomes a bad forecast.
3. **Opportunity cost is real.** You deliberately under-spent somewhere. Price
   it, state it, and weigh it against the decision the test informs.
4. **Market selection is a researcher degree of freedom.** Choosing treatment
   markets after seeing the outcome data is p-hacking with extra steps. Fix the
   selection with the power simulation, in advance, and record it.

---

## 3. Media mix modelling

### 3.1 Mechanics

Regress an aggregate weekly outcome on channel spend plus controls, with two
marketing-specific transforms applied to each channel's spend before it enters
the model.

**Adstock / carryover.** Advertising seen this week affects next week.
Geometric adstock:

```
a_t = x_t + λ · a_{t−1}          λ ∈ [0, 1)
```

`λ` is the decay rate; the effective memory is roughly `1/(1−λ)` weeks. `λ=0.3`
is about 1.4 weeks of memory, `λ=0.8` about five. Robyn also offers **Weibull**
adstock, which allows a delayed peak — right for media whose effect builds
before it decays, such as TV, and wrong-shaped for direct response.

**Saturation / diminishing returns.** The tenth impression is worth less than
the first. Hill:

```
f(a) = a^α / (a^α + γ^α)
```

`γ` is the half-saturation point (the spend level at which the channel delivers
half its maximum response) and `α` controls the S-curve's steepness. The
negative-exponential form `f(a) = 1 − exp(−θ·a)` is a simpler alternative with
no inflection.

The model then estimates channel coefficients, and the outputs are **channel
contribution**, **marginal ROI** (the derivative of the saturation curve at
current spend) and an **optimal allocation curve**.

**No user-level data anywhere in that.** That is precisely why MMM resurged after
ATT, and it is the property to lead with when explaining it.

### 3.2 How MMM misleads, with the honest severity

1. **It is correlation, not causation, unless calibrated.** The strongest current
   practice is to use geo-lift experiment results as priors on channel
   coefficients. **An uncalibrated MMM is a fancy regression on observational
   data**, and presenting one as causal is the central failure of the method.
2. **Severe multicollinearity.** Channels move together — budgets rise before
   the holidays across the board — and the model cannot separate what moved
   together. Check the correlation matrix of transformed spend before reading
   any individual channel's coefficient.
3. **Researcher degrees of freedom are enormous.** Adstock decay, saturation
   shape, control set and priors can each swing a channel's ROI by large
   factors. **"Keep tuning until it looks right" is endemic**, and it is
   undetectable in the output. The defence is pre-registering the model
   specification, reporting the candidate models you rejected, and reporting a
   range across plausible specifications rather than one point estimate.
4. **Ecological fallacy.** Aggregate results do not license individual
   decisions. "TV contributes 14%" says nothing about which households to target.
5. **It is slow.** Quarterly refresh at best. It is an allocation tool, not an
   optimisation loop.

### 3.3 Data floors, as refusals

| Requirement | Floor | Real requirement |
|---|---|---|
| History | 52 weeks is the widely-cited floor and it is thin | **2–3 years** |
| Spend **and** volume | spend alone is not enough | impressions, GRPs or clicks by channel, because spend conflates price and quantity |
| Controls | — | seasonality, price, promotions, distribution, macro, competitor activity where available |
| **Variation in spend** | — | **a channel whose budget never changed cannot be identified.** Report it as `unavailable` with the reason, not as a coefficient near zero |

That last row is the refusal that matters. A channel held at a constant budget
for three years has no variation for the model to learn from, and the coefficient
it produces is whatever the collinear neighbours leave over. **Naming that
channel as unidentifiable is the finding.**

---

## 4. Which library, and why

| Library | What it is | Reach for it when | Watch for |
|---|---|---|---|
| **Google Meridian** | Bayesian MMM on TensorFlow Probability, geo-hierarchical, **designed for experiment calibration** | you have geo-level data and intend to calibrate with geo-lift — which is the practice this whole skill points toward | Bayesian workflow and sampling time; needs someone who can read a trace plot |
| **Meta Robyn** | R, ridge regression with evolutionary hyperparameter search over adstock and saturation; **surfaces a menu of candidate models** | fastest path from data to a defensible budget recommendation | the candidate menu is a strength and a hazard — picking the prettiest model from the menu is the researcher-degrees-of-freedom problem made easy |
| **PyMC-Marketing** | Python/Bayesian, the most flexible of the three; also ships CLV models | you need custom priors, custom structure, or CLV in the same stack | flexibility is degrees of freedom; pre-register the specification |
| **Meta GeoLift** | synthetic control with non-negative weights summing to one, **plus the pre-spend power simulation and market selection** | designing or reading a geo test — this is the default | R; the power simulation is the reason to use it and the step people skip |
| **Google CausalImpact** | Bayesian structural time series; models trend and seasonality explicitly and is less constrained than synthetic control | a single-market intervention or a discrete event, or as a cross-check on GeoLift | the less-constrained fit can extrapolate where synthetic control would not |
| Google Matched Markets, CausalPy | market-matching and causal-inference toolkits | market selection, or a design synthetic control does not fit | — |

**PyMC Labs publish a benchmark claiming roughly 2–20× faster sampling and about
40% lower channel-contribution error versus Meridian. That is a vendor-authored
comparison and the pack presents it as a claim, not a settled result.** Choose on
the fit to your data and your team's language, not on that benchmark.

**GeoLift and CausalImpact frequently agree, and running both is a reasonable
cross-check** on a single test. Where they disagree, the usual cause is that
CausalImpact's less-constrained fit is extrapolating outside the range of the
control markets — inspect the counterfactual series before adjudicating.

---

## 5. Reading a null result, which is where this family actually fails

**A non-significant result means "we could not detect an effect of at least this
size". It is not evidence that the effect is zero.** This is the single most
damaging misread in the tier, and it recurs identically in A/B testing —
`experiment-design-readout` states the same rule for the same reason.

The rules that make a null readable:

1. **Report the confidence interval, always.** A result of `−2% to +18%` and a
   result of `−1% to +1%` are both non-significant and they mean opposite
   things: the first is uninformative, the second is genuine evidence of a small
   effect.
2. **Report the MDE beside the null.** "We could not detect an effect; this test
   could only have detected 15% or larger" is a complete, honest sentence.
3. **Compare the interval against the decision threshold.** If the entire
   interval sits below the break-even return, that is an actionable finding even
   without significance. Say so.
4. **Never write "the channel doesn't work" from a null.** Write "this test could
   not detect an effect of X or larger", and name what would.

---

## 6. Calibration, the practice that ties the tier together

The defensible stack, in order:

1. **Run geo-lift on the two or three channels where the budget decision is
   biggest.** Each gives a causal lift estimate with an interval.
2. **Use those estimates as priors on the corresponding channel coefficients in
   the MMM.** Meridian is built for this; PyMC-Marketing supports it directly;
   Robyn accepts calibration input.
3. **Use the calibrated MMM for allocation across all channels**, including the
   ones you cannot test.
4. **Use the MTA spread for in-flight direction** between MMM refreshes.
5. **Record the calibration**: which experiments, which periods, which channels,
   and how much the coefficients moved. **If calibration moved a channel's
   coefficient substantially, the uncalibrated MMM was wrong about it, and
   anything previously decided on that basis should be revisited.**

---

## 7. Output

```
route: geo_lift | mmm | mmm_calibrated | none, with the reason

geo_lift:
  design: { treated_markets, control_markets, window, spend_change, selection_method }
  power:  { simulated_effects[], power_curve[], MDE, gate: pass | fail }
  result: { lift, interval, placebo_distribution_ref, incremental_CPA }
  validity: { spillover_risk, opportunity_cost, generalisation_bounds }

mmm:
  data:   { weeks, channels, volume_metric_present, controls[] }
  floors: { history_ok, variation_ok, unidentifiable_channels[] }
  spec:   { adstock_form, lambda_or_shape, saturation_form, alpha, gamma, priors }
  fit:    { contribution_by_channel, marginal_roi, saturation_curves }
  robustness: { specification_range, collinearity_flags[], rejected_candidates_n }
  calibration: { experiments_used[], coefficient_shift_by_channel }

library: { name, version, seed }
limitations[]: correlational_if_uncalibrated, local_to_test_conditions, aggregate_only, refresh_cadence
```

---

## 8. Answering

**Answer first**, with the interval attached to the number rather than behind it.

> **The geo holdout measured a 9% lift in conversions from paid social, with an
> 80% interval of 3% to 15%, giving an incremental CPA roughly 2.4× the
> platform-reported figure.** That gap is expected: the platform counts
> conversions it can claim, the holdout counts conversions that would not have
> happened.
>
> The 9% is probably a slight under-estimate, because media and people cross
> market boundaries and that contamination pushes measured lift toward zero. It
> applies to the creative, spend level and weeks we tested — it is not a constant
> to apply to next year's plan.
>
> For deciding whether to keep the channel, the interval is decisive: even the
> bottom of it clears break-even at your contribution margin. For deciding how
> much more to spend, it is not — that needs the saturation curve, which needs
> the MMM, which this result should now calibrate.

And the null, which is the case this skill exists for:

> **We could not detect an effect. The interval runs from −4% to +11%.** That is
> not evidence the channel does nothing — the test was only powered to detect
> 12% or larger, so an effect of 8% would have looked exactly like this result.
> The useful conclusion is narrower and still real: any effect is probably below
> 11%, which is under your break-even threshold at current spend. To resolve it
> properly you would need roughly twice the treated markets or a four-week longer
> window; whether that is worth it depends on how much budget rides on the answer.

**Withhold only:** an MMM coefficient for a channel with no spend variation
(§3.3), and a test design whose MDE exceeds the effect worth acting on (§2.2). In
both cases the refusal names the specific change that resolves it, and the rest
of the analysis still ships.

---

## References

- `references/geo-test-design.md` — the power simulation, market selection, MDE, placebo inference and the pre-registration record
- `references/mmm-specification.md` — adstock and saturation forms with parameter meanings, the control set, collinearity diagnostics, and the calibration procedure

## Core contracts called

- **`answer-contract`** — the null-result readout, the intervals, and both refusals
- **`provenance-block`** — library and version, seed, model specification, window, timezone and currency on every spend series
- **`comparability-rules`** — before any spend series from several platforms enters one model; currencies, timezones and date bases differ per account and no platform normalises them for you
- **`rate-limit-governor`** — multi-year daily spend extracts across platforms are the largest routine pull in the pack
- **`warning-field-reader`** — modelled conversions in the outcome series make the model's target partly a vendor estimate; flag it or use a first-party outcome

## Related skills

- `experiment-design-readout` — the same power-and-null discipline for A/B tests; run it before any geo design.
- `attribution-rule-based` and `attribution-algorithmic` — the correlational layers this one calibrates.
- `budget-allocation` — consumes the saturation curves and lift estimates produced here.
- `gtm-metric-dictionary` — for contribution margin and break-even, which decide whether a lift is worth having.
