# Designing a geo test, and the record that makes it credible

The order below is not negotiable. **Power simulation, then market selection,
then pre-registration, then spend.** Every step performed after seeing outcome
data is a degree of freedom that turns the result into a story.

---

## 1. Fix the decision before the design

Write these four down before touching the data. They determine the whole design
and they are what the result gets compared against.

| | |
|---|---|
| **Decision** | what changes depending on the answer, in concrete terms |
| **Effect worth acting on** | the smallest lift that would change the decision — **not** the lift you hope for |
| **Break-even** | the lift at which the channel pays for itself at your contribution margin |
| **Cost of the test** | the revenue foregone in the under-spent markets, priced |

If the effect worth acting on is smaller than break-even, the decision is already
made and the test is unnecessary. This check costs a minute and occasionally
cancels a six-week test.

---

## 2. Power simulation

```
inputs:  market-level daily or weekly outcome history (≥ 1–2 years)
         planned test duration
         planned treated-market count
         planned spend change

for effect_size in [0, 0.05, 0.10, 0.15, 0.20, 0.30]:
    for replicate in 1..500:
        sample a candidate treatment/control split
        inject effect_size into the treated series over the test window
        fit the synthetic control on the pre-period
        estimate lift and run placebo inference
        record detected / not detected
    power(effect_size) = detections / 500
```

Read three things off the result:

- **MDE** — the smallest effect with power ≥ 0.80.
- **False-positive rate at effect = 0** — should be near your threshold. If
  injecting *no* effect produces detections 15% of the time, the inference
  procedure is broken and nothing downstream is trustworthy.
- **The power curve's shape** — a curve that is still climbing steeply at your
  target effect means the design is marginal; small changes in market behaviour
  will flip the result.

### The gate

```
if MDE > effect_worth_acting_on:
    verdict = "this test cannot answer this question"
    levers  = [more treated markets, longer window, larger spend change]
    do NOT run a smaller version
```

**An underpowered test is worse than no test**, because its null gets reported as
a finding and the channel gets cut on evidence that could never have shown
otherwise. Cancelling is a legitimate, valuable output of this step.

---

## 3. Market selection

Rules, all of which exist to prevent selection from becoming the result:

1. **Select on pre-period fit, never on outcome during the test.** The synthetic
   control's job is to track the treated markets *before* the intervention.
2. **Prefer more, smaller markets over few, larger ones.** Variance falls with
   the number of independent units, and one large treated market means one
   idiosyncratic local event can be the whole result.
3. **Exclude adjacent markets from control where spillover is plausible.** Media
   bleeds across boundaries. A contaminated control biases measured lift toward
   zero.
4. **Check pre-period parallel trends visually, not only numerically.** A good
   pre-period RMSE with a visibly diverging recent trend is a bad match.
5. **Record the selection procedure and the seed.** "We chose these markets
   because the tool did" is not a record.

---

## 4. Pre-registration record

Written before the test starts, stored, and quoted in the readout. Five fields.

```yaml
hypothesis:        paid social drives incremental conversions in treated markets
primary_outcome:   conversions, first-party, market-daily grain, account timezone
design:            holdout — treated spend to zero for 4 weeks
treated_markets:   [selected by GeoLift market selection, seed 42]
control_pool:      [all remaining markets, less adjacent exclusions]
window:            fixed, 28 days, no early stopping
analysis:          synthetic control, non-negative weights summing to one,
                   placebo inference over control markets
MDE:               11% at 80% power
decision_rule:     act if lower bound of the 80% interval clears break-even
```

**`decision_rule` written in advance is what stops the readout from becoming a
negotiation.** Without it, a 9% lift with a wide interval is whatever the person
presenting it needs it to be.

---

## 5. Inference by placebo

Do not run a t-test on the outcome series — the observations are not independent
across time and the synthetic control was fitted to this data.

```
for each control market m:
    treat m as if it were the treated unit
    re-run the entire procedure, including weight fitting
    record its "effect"
placebo_distribution = the resulting effects
p_value ≈ rank of the actual effect within that distribution
```

Two diagnostics worth reporting alongside:

- **Pre-period RMSE ratio.** Discard placebo markets whose pre-period fit was
  poor — a market the synthetic control could never track produces a large
  spurious "effect" and fattens the tails artificially.
- **Effect-to-pre-RMSE ratio** for the treated unit. A large effect relative to
  the pre-period fit error is the credible case; an effect the same size as the
  fitting error is not.

---

## 6. Reporting

Mandatory in every readout, whatever the result:

| Field | Why |
|---|---|
| Point estimate **and interval** | a point estimate alone is unreadable as evidence |
| **MDE from the pre-registered power analysis** | the only way a null can be interpreted |
| Spillover assessment and its **direction** — toward zero | so the reader knows which way the number is wrong |
| Generalisation bounds: period, creative, spend level, markets | stops a local result becoming a planning constant |
| Opportunity cost actually incurred | the test had a price; it belongs in the record |
| Whether the pre-registered decision rule was met | prevents post-hoc reinterpretation |

And the sentence that must never appear after a null: *"the channel doesn't
work"*. The correct sentence is: *"this test could not detect an effect of X% or
larger; the interval runs from A to B"*.

---

## 7. CausalImpact as the cross-check

For a single treated market or a discrete event, CausalImpact fits a Bayesian
structural time series on control series and projects the counterfactual forward.

- **It models trend and seasonality explicitly**, which synthetic control does
  not, so it handles a trending outcome more gracefully.
- **It is less constrained**, so it can extrapolate beyond the range of the
  control series where synthetic control's non-negative sum-to-one weights
  cannot.
- **Running both on the same test is a reasonable cross-check.** They frequently
  agree. Where they do not, plot both counterfactuals against the actual series
  and look at whether CausalImpact's is outside the envelope of the controls —
  that is usually the explanation, and when it is, prefer the constrained fit.
