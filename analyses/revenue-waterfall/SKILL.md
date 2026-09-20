---
name: revenue-waterfall
description: Use when explaining why revenue, ARR, pipeline or bookings moved between two periods or against plan — the driver decomposition behind "why did we miss" or "what changed". Produces a waterfall whose components arithmetically reconcile to the total variance, separating volume, rate, price and mix effects, and naming the two or three drivers that actually explain the movement. Prevents the non-answer that revenue was down, and prevents a decomposition whose parts do not add up to the whole.
---

# Revenue Waterfall

"Revenue was down 10%" is not an answer. **"Revenue missed by 10.4%; 9.5 points
of that is fewer opportunities, 6.2 points is a lower win rate, and average deal
size gave back 5.3 points" is an answer**, because each component names something
a person can act on and the three of them reconcile to the whole.

Two rules make it trustworthy:

- **The components must reconcile to the total variance, exactly.**
- **Where they do not, the residual is its own line.** A waterfall that silently
  absorbs its residual into the largest component is the most persuasive wrong
  chart in the genre.

---

## 1. Comparability runs before decomposition

**A variance across a definition change, a coverage gap or a timezone difference
is not a business variance.** Check the six dimensions from
`comparability-rules` on both periods before decomposing anything:

| Dimension | The specific failure here |
|---|---|
| Tenant / scope | an entity added or removed between periods |
| Exact date endpoints and date basis | close date in one period, booking date in the other |
| Source medium | one period from the CRM, the other from finance |
| Event set | what counts as a booking changed |
| Attribution model | pipeline sourced under two different models |
| Timezone | deals at the period edge landing in different quarters |

**Equal window is not equal coverage.** A 90-day quarter with 88 days of data
against one with 90 is a 2% coverage gap that will appear as a real decline.

If any dimension mismatches, say so and stop. **A decomposition of a measurement
difference into business drivers is worse than no decomposition**, because it
attaches a plausible business story to an artefact.

---

## 2. The canonical forms

### B2B bookings

```
revenue = opportunity_count × win_rate × average_deal_size
```

Plus a **cycle/timing effect** where deals moved between periods rather than
appearing or disappearing — which is a fourth component and the one most often
mistaken for a win-rate decline.

### Subscription ARR — the one that must reconcile exactly

```
starting ARR
  + new
  + expansion
  − contraction
  − churn
  + reactivation
= ending ARR
```

**This is an identity, not an estimate.** If it does not close, a movement is
miscategorised — most often a downgrade-then-churn counted twice, or a
reactivation counted as new. Find it; do not plug it. See
`subscription-analytics`.

### B2C

```
revenue = traffic × conversion_rate × average_order_value
```

**AOV has five defensible versions** — see `gtm-metric-dictionary`. State which,
because the decomposition changes with it.

---

## 3. The arithmetic, and the order problem

For `R = x · y · z`, two decomposition conventions exist and neither is more
correct.

### Sequential (chained)

Each factor is evaluated with the already-updated prior factors. **Reconciles
exactly with no residual**, and is order-dependent.

```
Δ_x = (x₁ − x₀) · y₀ · z₀
Δ_y =  x₁ · (y₁ − y₀) · z₀
Δ_z =  x₁ ·  y₁ · (z₁ − z₀)
```

### Pure effects plus interaction

Each factor is evaluated holding the others at base, and the interaction is
shown as its own line. **Order-independent, and the interaction is visible.**

```
Δ_x = (x₁ − x₀) · y₀ · z₀
Δ_y =  x₀ · (y₁ − y₀) · z₀
Δ_z =  x₀ ·  y₀ · (z₁ − z₀)
interaction = ΔR − (Δ_x + Δ_y + Δ_z)
```

**Prefer pure-effects-plus-interaction when the interaction is material**, because
it is honest about order-dependence. Prefer sequential when the audience needs a
clean four-bar chart, **and declare the order.**

### Worked, both ways

| | Base | Current |
|---|---|---|
| Opportunities | 420 | 380 |
| Win rate | 22.0% | 20.5% |
| Average deal size | 48,000 | 51,000 |
| **Revenue** | **4,435,200** | **3,972,900** |

`ΔR = −462,300`, a 10.4% decline.

**Sequential** (order: count, win rate, deal size):

| Component | Effect | Share of base |
|---|---|---|
| Opportunity count | −422,400 | −9.5pp |
| Win rate | −273,600 | −6.2pp |
| Average deal size | +233,700 | +5.3pp |
| **Total** | **−462,300** | **−10.4pp** ✓ |

**Pure effects plus interaction:**

| Component | Effect |
|---|---|
| Opportunity count | −422,400 |
| Win rate | −302,400 |
| Average deal size | +277,200 |
| **Interaction** | **−14,700** |
| **Total** | **−462,300** ✓ |

Note what changes: the win-rate and deal-size components differ by about 10%
between the two conventions, and the interaction of −14,700 is what the
sequential version distributed silently. **Both are correct. Neither is the
truth. Which is why the order and the convention are declared in the output.**

---

## 4. Mix effects are the most commonly missed component

**A segment mix shift routinely masquerades as a rate change.**

```
R = Σ_s  w_s · r_s          # w = share of volume, r = revenue rate per unit

Δ_mix         = Σ_s (w_s¹ − w_s⁰) · r_s⁰
Δ_rate        = Σ_s  w_s⁰ · (r_s¹ − r_s⁰)
Δ_interaction = Σ_s (w_s¹ − w_s⁰) · (r_s¹ − r_s⁰)
```

The signature to watch for: **the blended metric moved and no segment's metric
moved in that direction.** `churn-retention-analysis` carries a worked case where
blended retention improves while both segments decline — the same arithmetic, the
same trap.

Mix effects worth decomposing separately in revenue work:

| Mix dimension | Masquerades as |
|---|---|
| Segment (SMB / mid-market / enterprise) | a win-rate or ASP change |
| Product | a pricing change |
| Geography | an ASP or FX change |
| New versus renewal | a win-rate change |
| Channel or source | a conversion-rate change |

**Run the mix decomposition before concluding a rate changed.** It is cheap, and
it inverts the conclusion often enough to be worth doing every time.

---

## 5. The residual

Where the decomposition does not fully explain the variance — an incomplete
driver set, a dimension you cannot break out, unallocated adjustments —
**show the residual as its own line.**

```
residual = ΔR_total − Σ components
```

Then say three things about it:

1. **Its size**, in the metric's units and as a share of the variance.
2. **Its likely composition**, named. "Probably the deals that changed currency
   mid-term, which we cannot break out from this extract."
3. **Whether it is worth pursuing.** A residual under a few percent of the
   variance is normally not; one that exceeds the second-largest component
   always is.

**A residual absorbed into the largest component produces a chart whose bars sum
correctly and whose story is wrong.** Someone acts on the inflated component.

---

## 6. A useful decomposition is specific in magnitude

| Not useful | Useful |
|---|---|
| "Revenue was down" | "Revenue missed by 10.4%" |
| "Pipeline was weak" | "9.5 of the 10.4 points is fewer opportunities: 380 against 420" |
| "Win rates slipped" | "Win rate cost 6.2 points, from 22.0% to 20.5%" |
| "Deal sizes helped" | "Deal size gave back 5.3 points, from 48k to 51k" |

**Rank the components by absolute magnitude and lead with the top two.** A
waterfall with eleven bars is a data dump; the answer is almost always in the
first two or three, and the rest belong in a table beneath.

And name the direction of each component explicitly. A component that *offset*
the decline is as important to the story as one that caused it — the deal-size
increase above is the reason the miss was 10% rather than 16%, and omitting it
makes the decline look uniform when it is not.

---

## 7. Timing is a component, not a rounding error

Deals that slipped between periods are **not** a win-rate decline, and they are
the single most common misdiagnosis in a quarterly miss.

```
timing effect = value of deals expected to close in the period that moved out
              − value of deals that moved in from a prior period
```

Distinguish:

| | Meaning |
|---|---|
| **Slipped** | still open, close date pushed | a timing effect; the pipeline still holds the value |
| **Lost** | closed-lost | a win-rate effect |
| **Pulled forward** | closed early from the next period | a timing effect that flatters this period and depletes the next |

**Slipped and lost look identical in a period-end snapshot** and have opposite
implications. Only stage history distinguishes them — see
`data-lineage-tracer` and `temporal-integrity-audit` for reconstructing it.

A quarter that missed entirely on slippage has a full pipeline and a process
problem. A quarter that missed on losses has an empty pipeline and a demand
problem. **Same number, opposite response.**

---

## 8. Output

```
comparability:
  six_dimensions[]: match | mismatch | unknown
  coverage: { period_a_days, period_b_days, equal_coverage: bool }
  verdict: proceed | not_a_business_variance
total_variance: { absolute, percent, metric, periods }
convention: sequential | pure_plus_interaction
order_declared: [factor, factor, factor]
components[]:
  name, effect_absolute, effect_pp_of_base, direction, rank
interaction: effect            # when the convention is pure_plus_interaction
mix_decomposition:
  dimension, mix_effect, rate_effect, interaction
timing:
  slipped_value, pulled_forward_value, net_timing_effect, evidence: stage_history
residual:
  amount, share_of_variance, likely_composition, pursued: bool, why_not
reconciles: bool               # hard assertion, not a soft check
```

---

## 9. Answering

**Answer first**, with the magnitudes attached, then the component nobody
expected.

> **Revenue missed by 10.4%, and almost all of it is pipeline volume: 380
> opportunities against 420 is worth 9.5 of those 10.4 points.**
>
> Win rate cost another 6.2 points, from 22.0% to 20.5%. Average deal size gave
> back 5.3 points, rising from 48k to 51k — without that, the miss would have
> been closer to 16%.
>
> **About a third of the win-rate decline is not a win-rate decline.** 340k of
> deals slipped out of the quarter rather than being lost, and they are still
> open. That is a timing effect with a full pipeline behind it, which is a
> different problem from losing deals.
>
> The three components reconcile exactly under a sequential decomposition,
> ordered count, win rate, deal size. Under the pure-effects convention the
> win-rate and deal-size components are about 10% larger with a −14.7k
> interaction term; the ranking is identical either way.
>
> For the board narrative, the headline is pipeline volume and the deal-size
> offset. For the operating response, the slippage question is the one to answer
> first, because it determines whether next quarter starts full or empty.

**Withhold only:** a decomposition where the comparability check failed (§1) —
report the total variance and name the mismatched dimension instead — and any
waterfall that does not reconcile, which is reported with its residual as an
explicit line rather than silently balanced. **Never withhold the total variance
because the decomposition is incomplete.**

---

## References

- `references/decomposition-arithmetic.md` — both conventions worked in full, the mix decomposition, the subscription identity and how to find a non-closing one
- `references/timing-and-residual.md` — separating slipped from lost using stage history, the pull-forward check, and how to size and report a residual

## Core contracts called

- **`answer-contract`** — the residual as a first-class line, and the refusal when comparability fails
- **`provenance-block`** — currency and FX basis on both periods, timezone, date basis, and which system each figure came from
- **`comparability-rules`** — **mandatory, and it runs first.** A variance across a definition change is not a business variance
- **`warning-field-reader`** — thresholded or suppressed rows in a segmented cut, which make segment components fail to sum to the total

## Related skills

- `kpi-tree-builder` — supplies the driver structure the waterfall decomposes.
- `subscription-analytics` — the ARR movement identity.
- `churn-retention-analysis` — the same mix/rate discipline applied to retention.
- `pricing-discount-analysis` — the price and rate components in detail.
- `win-loss-analysis` — the win-rate component and its four denominators.
- `gtm-metric-dictionary` — ASP, ACV, AOV and the definitions the decomposition depends on.
