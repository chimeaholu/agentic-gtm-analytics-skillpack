# MMM specification, diagnostics and calibration

The model is a regression. Everything that makes it useful or useless happens in
the transforms, the control set and the calibration.

---

## 1. Data assembly

| Column | Grain | Notes |
|---|---|---|
| `week_start` | weekly | one timezone, declared. Weekly is the standard grain; daily adds noise without adding identification |
| `outcome` | weekly | revenue, conversions or new customers. **Prefer a first-party outcome** — using platform-reported conversions makes the target partly a vendor estimate |
| `spend_<channel>` | weekly | net media cost, one currency, FX basis declared |
| `volume_<channel>` | weekly | impressions, GRPs or clicks. **Spend alone conflates price and quantity**: a CPM rise looks identical to a budget rise |
| `price` | weekly | average realised price or a price index |
| `promotion` | weekly | discount depth or promo flag |
| `distribution` | weekly | stores, SKUs, availability, where applicable |
| `seasonality` | weekly | Fourier terms or holiday flags; do not rely on the model to find annual structure from two cycles |
| `macro`, `competitor` | weekly | where available; absence is a limitation to state, not a reason to skip |

**The volume column is the most-skipped and it matters.** Without it, a channel
whose CPMs doubled looks like a channel that doubled its activity.

---

## 2. Adstock

**Geometric** — one parameter, the default:

```
a_t = x_t + λ · a_{t−1},        λ ∈ [0, 1)
effective memory ≈ 1/(1 − λ) weeks
```

| λ | Memory | Typically right for |
|---|---|---|
| 0.0–0.2 | ~1 week | direct response, search, retargeting |
| 0.3–0.5 | 1.4–2 weeks | paid social, display |
| 0.6–0.8 | 2.5–5 weeks | video, upper-funnel |
| > 0.9 | 10+ weeks | brand, TV — **and a red flag if fitted freely**, because high λ absorbs trend and will fit anything |

**Weibull** (Robyn) allows a delayed peak — the effect builds before it decays,
which is right for TV and sponsorship and wrong-shaped for search.

Two failure modes:

- **λ fitted freely with no prior drifts high**, because a long carryover is an
  excellent trend absorber. Bound it by channel using the table above, and say
  you did.
- **λ set by convention and never varied** hides the fact that the result depends
  on it. Report channel ROI across the plausible λ range, not at one value.

---

## 3. Saturation

**Hill:**

```
f(a) = a^α / (a^α + γ^α)
```

- `γ` — **half-saturation point**: the adstocked spend level at which the channel
  delivers half its maximum response. This is the parameter a marketer can
  actually sanity-check: is your current spend below, at, or above it?
- `α` — steepness. `α = 1` is a smooth hyperbolic curve; `α > 1` produces an
  S-shape with a threshold region where small spend does little.

**Negative exponential:**

```
f(a) = 1 − exp(−θ · a)
```

Simpler, no inflection, no threshold region. Appropriate when you have no reason
to believe in a minimum effective spend.

**Marginal ROI is the derivative at current spend**, and it — not average ROI —
is what allocation uses. A channel well past `γ` can have excellent average ROAS
and a marginal return below every alternative. That distinction is the entire
premise of `budget-allocation`.

**The identification problem to state out loud:** if a channel's spend has never
been near saturation, the curve's upper region is extrapolation, not estimation.
Mark the observed spend range on every saturation plot and never quote a
marginal ROI outside it.

---

## 4. Diagnostics, run before any coefficient is quoted

| Check | Threshold | What a failure means |
|---|---|---|
| **Spend variation per channel** | coefficient of variation near zero | the channel is **unidentifiable**; report `unavailable`, not a coefficient |
| **Pairwise correlation of transformed spend** | \|r\| > 0.8 | the pair cannot be separated; report their **joint** contribution, not two individual ones |
| **VIF** | > 10 | same conclusion, multi-channel version |
| **Holdout period fit** | — | fit on all but the last 8–13 weeks and predict them. A model that cannot predict held-out weeks cannot support a budget plan |
| **Residual autocorrelation** | — | structure left in the residuals means a missing control, usually seasonality or a promotion calendar |
| **Coefficient sign** | negative on a media channel | almost always collinearity or a missing control, **not** evidence that advertising reduced sales. Investigate; do not report it as a finding |
| **Specification range** | — | re-fit across plausible adstock, saturation and control choices; **report the range of each channel's ROI**, not the single point from the chosen spec |

That last row is the defence against the researcher-degrees-of-freedom problem.
A channel whose ROI is 2.1 under one defensible specification and 6.8 under
another does not have an ROI of 4.5 — it has an unresolved contribution, and the
honest report says so and names the experiment that would settle it.

---

## 5. Calibration with experiment results

The step that converts a regression into something defensible.

1. Run geo-lift on the channels where the budget decision is largest.
2. Convert each lift estimate into a prior on that channel's coefficient or ROI —
   **with the experiment's uncertainty carried into the prior's width.** A tight
   experimental interval gives a tight prior; a wide one should not.
3. Re-fit. Meridian is designed around this; PyMC-Marketing supports it directly;
   Robyn accepts calibration input.
4. **Record how far each calibrated coefficient moved from its uncalibrated
   value.**

That last record is the most useful artefact the whole exercise produces:

> Paid social's uncalibrated contribution was 6% and its calibrated contribution
> is 11%. The uncalibrated model was understating it by nearly half, and any
> allocation decision previously made on that model under-funded the channel.

**Uncalibrated channels stay labelled uncalibrated in every output.** Do not let
the credibility of two calibrated channels transfer to the six that were not
tested.

---

## 6. Refresh and drift

- **Quarterly at best.** MMM is an allocation tool. Anyone asking for a weekly
  MMM number wants MER and the MTA spread instead.
- **Re-run the previous quarter on the new model at every refresh.** If the
  history moved, the change is the model, and the comparison needs a restatement
  note — the same discipline `temporal-integrity-audit` applies to any restated
  series.
- **Creative, market and competitive conditions change**, so a coefficient is a
  statement about the period it was fitted on. An 18-month-old MMM is a
  historical document.

---

## 7. What an MMM never claims

The closing negative list:

- **Not causal unless calibrated**, and only for the calibrated channels.
- **Not applicable to individuals.** Aggregate contribution says nothing about
  who to target.
- **Not valid outside the observed spend range.** Extrapolated marginal ROI is a
  guess with a curve drawn through it.
- **Not a real-time tool.** Nothing here supports an in-flight bid change.
- **Not independent of the specification**, which is why the specification range
  is reported alongside the point estimates.
