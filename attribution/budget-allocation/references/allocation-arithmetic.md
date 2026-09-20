# Allocation arithmetic

Every number on this page is computed, not asserted. The worked curve is
synthetic; the arithmetic is the arithmetic you will run.

---

## 1. Break-even

```
break-even ROAS = break-even MER = 1 / contribution margin

contribution margin = (revenue − COGS − variable fulfilment
                       − payment fees − variable support) / revenue
```

| Contribution margin | Break-even ROAS | A channel at 4.0× is |
|---|---|---|
| 70% | 1.43 | comfortably profitable |
| 60% | 1.67 | comfortably profitable |
| 50% | 2.00 | profitable |
| 40% | 2.50 | profitable |
| 30% | 3.33 | marginally profitable |
| 25% | 4.00 | exactly break-even |
| 20% | 5.00 | **loss-making** |
| 15% | 6.67 | **loss-making** |

The right-hand column is the point. **The same 4.0× ROAS is a good channel and a
bad channel depending on a number that lives in the finance system, not the ad
platform.** Get contribution margin from finance, record its source in the
provenance block, and re-check it when the product mix changes.

Three refinements that change the answer:

- **Blended (MER) versus per-channel.** Break-even MER applies to total revenue
  over total spend and is the guardrail that survives attribution disputes.
  Per-channel break-even ROAS depends on an attribution model and inherits all
  of its uncertainty. **Use MER as the constraint and per-channel ROAS as the
  direction.**
- **First order versus lifetime.** A break-even set on first-order revenue
  under-invests in any business with real repeat rates. A break-even set on LTV
  over-invests unless payback period is also constrained — see
  `gtm-metric-dictionary` on CAC payback.
- **Contribution margin excludes fixed costs by construction.** A channel above
  break-even MER contributes to overhead. Whether that is "profitable" depends
  on what the business is asking.

---

## 2. Marginal versus average, on a real curve

Hill saturation with `α = 1`, half-saturation `γ = 50,000` spend, maximum
response `R_max = 1,000,000` revenue:

```
R(x)        = R_max · x / (x + γ)
average     = R(x) / x       = R_max / (x + γ)
marginal    = dR/dx          = R_max · γ / (x + γ)²
```

| Spend | Revenue | Average ROAS | **Marginal ROAS** |
|---|---|---|---|
| 25,000 | 333,333 | 13.33 | **8.89** |
| 50,000 | 500,000 | 10.00 | **5.00** |
| 72,500 | 591,837 | 8.16 | **3.33** |
| 100,000 | 666,667 | 6.67 | **2.22** |
| 150,000 | 750,000 | 5.00 | **1.25** |
| 200,000 | 800,000 | 4.00 | **0.80** |

At a 30% contribution margin, break-even is 3.33. Read the table:

- **The next unit of spend stops paying at about 72,500** — that is where
  marginal return crosses break-even.
- **At that exact point, average ROAS still reads 8.16**, which looks like one of
  the best channels in the account.
- At 200,000 spend the channel still shows a 4.0× average ROAS and is destroying
  0.8 of return on every additional unit.

**That gap between 8.16 and 3.33 is the entire reason this skill exists.**
Average ROAS does not fall below break-even until spend reaches 200,000 — by
which point nearly 130,000 has been spent past the point of paying.

### Doing it without a fitted curve

If you have two spend levels and their outcomes — a before/after, a spend-up
test, two comparable geos — you have a crude marginal estimate:

```
marginal ROAS ≈ (revenue₂ − revenue₁) / (spend₂ − spend₁)
```

**This is only causal if the spend change was the only thing that changed**,
which in an uncontrolled before/after it never is. Label it as an observed
difference, not a measured marginal return, and name seasonality and creative
changes as the competing explanations. It is still far better than reading
average ROAS as marginal.

---

## 3. Bounding the move

```
bound = min(
    what the evidence's precision supports,
    the observed spend range,
    the operational ceiling
)
```

**Precision bound.** Size the move off the interval's lower bound, not the point
estimate. A lift of 9% with a lower bound of 3% supports a move justified by 3%.
Using the point estimate is betting the budget on the middle of a distribution
you measured precisely so you would not have to.

**Range bound.** A measurement at current spend says nothing about 3× spend —
that region of the curve was not visited. Increases beyond the observed range are
extrapolation and get the staged treatment below.

**Operational ceiling.** Auction dynamics, creative supply, inventory and sales
capacity all cap how fast spend can rise without CPMs or lead quality moving.
A 60% increase in a channel where you have three creatives is a CPM experiment,
not a spend increase.

### Staged increase with re-measure

When the recommendation genuinely is "spend more", and more is outside the
measured range:

| Stage | Action | Gate to proceed |
|---|---|---|
| 1 | +20% over 4 weeks | CPA holds within the tolerance; MER holds above break-even |
| 2 | +20% more | same gates, re-read against the same window length |
| 3 | re-measure | a spend-up geo test at the new level, which extends the observed range and updates the curve |

**Each stage extends the observed spend range**, which is worth more than the
increase itself: it converts extrapolation into estimation for every future
decision.

---

## 4. The reallocation ledger

A reallocation is two decisions, and the cut side is the one that gets skipped.

```
for each channel:
    marginal_return_at_current_spend
    marginal_return_if_reduced_by_X
    confidence_band
    operational_constraint
```

Move money from the lowest marginal return to the highest, subject to:

- **The cut channel's marginal return is what you lose**, not its average. Cutting
  a channel with a 2.0 marginal return costs 2.0 per unit, not the 6.0 its
  average ROAS suggests.
- **Cross-channel effects are unmodelled.** Cutting the harvest channel can
  reduce conversions the create channel generated. Nothing in the attribution
  tier measures this; only a holdout does.
- **Total spend held constant is a different decision from total spend
  increased.** State which you are recommending. The arithmetic is the same and
  the risk is not.

---

## 5. The sanity checks

```python
assert abs(sum(channel_spend) - total_spend) < tolerance
assert all(roas_basis[c] in ("marginal", "average") for c in channels)   # labelled
assert break_even_roas == 1 / contribution_margin
assert all(spend_after[c] <= observed_range_max[c] or flagged_extrapolation[c])
assert mer_after_reallocation >= break_even_mer     # the guardrail that survives
```

The last one is the check worth running even when every per-channel number is
disputed: **blended MER after the move must still clear break-even.** It depends
on no attribution model at all, which is exactly why it is the constraint to
keep.
