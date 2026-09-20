---
name: budget-allocation
description: Use when deciding how to reallocate marketing budget across channels, or when asked "where should we spend more". Combines the rule-based spread, the algorithmic models, MMM saturation curves and any incrementality results into a recommendation with explicit confidence bands, break-even constraints from contribution margin, and a named list of channels whose contribution is too uncertain to act on. Prevents a reallocation driven by one attribution model's point estimate, and prevents spending past the saturation point because the average ROI still looks good.
---

# Budget Allocation

This is where measurement becomes a decision, and it is the step where every
caveat carried carefully through the attribution tier usually gets dropped,
because a spreadsheet cell wants one number.

Three rules hold the whole skill together:

1. **Marginal return decides allocation, not average return.**
2. **Break-even comes from contribution margin, not from the ad platform.**
3. **Reallocate on agreement across models; where they disagree, the channel
   goes to test, not to a budget change.**

---

## 1. Marginal, not average

A channel's average ROAS tells you what the whole spend returned. Allocation is
decided by **what the next unit of spend returns**, which is the derivative of
the saturation curve at current spend.

```
average ROAS  = revenue attributed to the channel / channel spend
marginal ROAS = d(revenue) / d(spend), evaluated at current spend
```

Under any diminishing-returns curve, **marginal is below average everywhere past
the origin, and the gap widens with spend.** A channel with an excellent average
ROAS can be past the point where the next unit returns less than the next unit
somewhere else — and average ROAS will never show you that, because it keeps
looking good on the strength of the early, cheap conversions.

| What you have | What to say |
|---|---|
| A fitted saturation curve from an MMM | read marginal return at current spend; state the observed spend range and refuse to quote marginal return outside it |
| A spend-up or spend-down geo test | you have measured a marginal return directly, at that spend level — the strongest evidence available |
| Attribution only | **say the recommendation is based on average returns and is therefore weaker.** Do not silently treat average as marginal |
| Nothing but platform-reported ROAS | it is average, it is the platform's own attribution, and it includes modelled conversions |

**The honest downgrade matters more than the sophistication.** "This is an
average-return recommendation, so it will tend to over-fund your largest existing
channel" is a real, actionable caveat with a named direction.

---

## 2. Break-even comes from the business

```
break-even MER  = 1 / contribution margin
break-even ROAS = 1 / contribution margin           (same arithmetic, per channel)
contribution margin = (revenue − COGS − variable fulfilment − payment fees
                       − variable support) / revenue
```

| Contribution margin | Break-even ROAS |
|---|---|
| 70% | 1.43 |
| 50% | 2.00 |
| 30% | 3.33 |
| 20% | 5.00 |
| 15% | 6.67 |

**A 6× ROAS can be loss-making.** At a 15% contribution margin, break-even is
6.67, and a channel running at 6.0 is destroying money while clearing every
target in the ad platform's interface.

Two adjustments that change the number and are routinely omitted:

- **Repeat purchase.** If the margin target is set on first order only, a
  business with real repeat rates will under-invest. If it is set on lifetime
  value, the payback period becomes the binding constraint instead — see
  `gtm-metric-dictionary` on CAC payback, the most-omitted term in GTM
  analytics.
- **Fixed costs are not in contribution margin**, by definition. A channel above
  break-even MER is contributing to overhead, not generating profit. Say which
  one the business needs.

---

## 3. The model-agreement gate

Inputs arrive as a spread table across every model that ran — rule-based columns
from `attribution-rule-based`, Markov and Shapley from `attribution-algorithmic`,
MMM contribution and any measured lift from `incrementality-and-mmm`.

| Evidence state | Verdict | What happens to the budget |
|---|---|---|
| Measured lift from an incrementality test, interval clears break-even | **act** | reallocate, bounded by §4 |
| All models agree within ~5pp, ranks stable, no lift test | **act, smaller move** | reallocate within the agreement band; the models agree on direction, not on magnitude |
| Models agree on rank, disagree on magnitude (5–15pp) | **hold** | keep spend flat; the evidence supports the channel existing, not resizing it |
| Models disagree materially (> 15pp) or ranks flip | **test** | **no budget change.** Name the specific experiment that would settle it |
| Channel below the volume floor | **hold** | not enough conversions to distinguish it from its neighbours |
| MMM coefficient with no spend variation | **test** | the channel is unidentifiable until its spend moves; a deliberate change is both the test and the identification |

**"Test" is a real output, not a deferral.** It ships with the design: which
channel, which markets or which holdout, how long, what it would cost in
foregone revenue, and what MDE the design achieves. A recommendation that says
"uncertain" without naming the experiment has passed the problem back unchanged.

---

## 4. Reallocation is bounded by what the evidence could detect

**Do not recommend a 40% shift on evidence that could not distinguish a 40%
effect from zero.** The size of a defensible move is bounded by the precision of
the evidence behind it.

| Evidence | Defensible move |
|---|---|
| Lift measured with a tight interval | up to the range the interval supports, at the tested spend level |
| Lift measured with a wide interval | the direction is supported; size the move to the lower bound, not the point estimate |
| Model agreement within a few points | a move proportionate to the agreement band |
| One model's point estimate | **no move.** This is the failure the skill exists to prevent |

And the constraint people forget entirely: **a result measured at one spend level
does not transfer to a much larger one.** A lift measured at current spend says
nothing about the return at 3× spend, because that is exactly the region of the
saturation curve the test did not visit. Increases beyond the tested range are
extrapolation and must be labelled as such, with a staged increase and a
re-measure as the alternative.

---

## 5. The attribution-model selection table, applied

Which measurement to trust for which situation — the routing that determines what
evidence you even have to allocate on.

| Situation | Use | Notes |
|---|---|---|
| **< 200 conversions/month** | last-non-direct only | nothing else is stable; say so rather than showing a spread built on noise |
| **Short-cycle single-session DTC** | last-touch or LNDC, **with MER as the guardrail** | journeys are short enough that the model choice barely matters; the blended guardrail catches what per-channel attribution misses |
| **B2B, > 60-day cycle, clean milestones** | W-shaped or full-path, **plus Markov as a cross-check** | the milestones are the whole reason the multi-touch models are worth running here |
| **Multi-channel digital, good path data, ≥ 1k conversions/month** | Markov and Shapley side by side; **act on agreement** | this is the case algorithmic attribution was built for |
| **Offline, brand, TV, or heavy privacy loss** | MMM, **calibrated by geo-lift** | user-level measurement is not available and no amount of tagging recovers it |
| **A budget decision worth more than the test's opportunity cost** | **a geo-lift experiment** | nothing else settles it; everything above will keep disagreeing |
| **An executive asking "which channel works?"** | the spread across **≥ 3 models**, with the uncertainty named | a single number here is the answer they want and the one that gets them into trouble |

---

## 6. State the reversing assumptions

Every recommendation carries the **two or three assumptions that, if wrong, flip
it.** This is what makes a recommendation reviewable instead of authoritative,
and it is the difference between advice someone can act on and advice someone has
to take on faith.

The recurring ones:

| Assumption | If wrong |
|---|---|
| Contribution margin is ~X% | break-even moves, and channels near the line change sides |
| The saturation curve's shape past current spend | the recommended increase returns less than modelled; this is the most common reversal |
| Measured lift transfers to the planned spend level | the increase is extrapolation |
| Channel credit is not double-counted across platforms | the reallocated channel is smaller than it looks |
| Demand is independent of the channel being cut | cutting the harvest channel reduces conversions the create channel generated |
| Creative and competitive conditions hold | a lift estimate is a statement about the period it was measured in |

Write them as sentences with their direction, not as a disclaimer:

> If contribution margin is nearer 20% than 30%, break-even ROAS rises from 3.3
> to 5.0 and two of the four channels recommended for increase fall below it.

---

## 7. What this skill will not do

- **Will not produce an "optimal" allocation from attribution data alone.**
  Optimisation requires marginal returns, which requires a saturation curve or a
  spend-level experiment. Attribution gives credit shares, and **credit shares
  are not returns.**
- **Will not reallocate on one model.** Not last-touch, not the vendor's
  data-driven attribution, not the MMM alone.
- **Will not recommend spending past the observed range** without labelling it
  extrapolation and proposing a staged increase with a re-measure.
- **Will not present a platform-reported ROAS target as a profitability target.**
  It is the platform's attribution over the platform's revenue definition.

---

## 8. Output

```
inputs_available: { rule_based_spread, algorithmic, mmm_curves, lift_tests }
economics: { contribution_margin, margin_source, break_even_MER, break_even_ROAS,
             basis: first_order | lifetime, payback_constraint }
per_channel[]:
  channel
  current_spend_share
  evidence: { models_agreeing, range_pp, lift_estimate, interval,
              marginal_or_average: marginal | average }
  verdict: act | hold | test
  recommended_change: { direction, magnitude, bound_reason }
  within_observed_spend_range: bool
test_queue[]:
  channel, design, markets_or_holdout, duration, MDE, opportunity_cost
expected_effect: { range, basis, what_it_excludes }
reversing_assumptions[]: assumption, direction_if_wrong, which_channels_flip
not_claimed[]: causality_where_untested, cross_platform_dedup, extrapolation
```

---

## 9. Answering

**Answer first.** Give the allocation, then the bounds on it.

> **Move roughly 15% of the display budget into paid search, and hold everything
> else flat this quarter.**
>
> Paid search is the only channel where the evidence supports resizing: the geo
> test measured 9% lift with a lower bound of 3%, and even the lower bound clears
> your break-even ROAS of 3.33 at a 30% contribution margin. The move is capped at
> 15% rather than the 40% the point estimate would justify, because the test was
> run at current spend and a 40% increase is outside the range anything measured.
>
> Display is the channel everyone expects to cut, and I am not recommending a cut:
> its credit ranges from 6% to 21% across the models, its rank flips between them,
> and that is unresolved rather than low. A four-week holdout in eight markets
> would settle it, is powered to detect 12%, and costs roughly one month of
> display spend in those markets.
>
> Two assumptions reverse this. If contribution margin is nearer 20% than 30%,
> break-even rises to 5.0 and paid search's lower bound no longer clears it. And
> if a material share of paid search conversions are branded queries that would
> have arrived anyway, the measured lift is real but it is harvesting, and the
> increase buys less than it appears to.
>
> This does not claim causality for any channel except paid search, which is the
> only one tested.

**Withhold only:** an optimal allocation when no marginal-return evidence exists
(§7) — and even then, give the directional recommendation from the agreement
gate, labelled as average-return based, rather than nothing. **The user will
reallocate today either way.** A recommendation with its bounds named is strictly
safer than a refusal followed by a spreadsheet.

---

## References

- `references/allocation-arithmetic.md` — break-even tables, marginal-versus-average worked with a Hill curve, staged-increase design, and the bounded-move calculation
- `references/decision-record.md` — the recommendation template with the reversing assumptions, the test queue, and a worked review six weeks later

## Core contracts called

- **`answer-contract`** — the recommendation shape, the confidence bands, and the refusal in §7
- **`provenance-block`** — spend currency and FX basis, attribution window and basis per platform, and which figures are modelled rather than observed
- **`comparability-rules`** — **mandatory.** Spend and conversions arriving from several platforms are on different windows, different date bases and different currencies; an allocation built on a naive cross-platform sum is a wrong number with a clean schema
- **`warning-field-reader`** — modelled conversion share per platform, which inflates the channels that model most
- **`rate-limit-governor`** — multi-platform spend and conversion pulls across a long window

## Related skills

- `attribution-rule-based` — the spread table, never a single column.
- `attribution-algorithmic` — where path volume supports it.
- `incrementality-and-mmm` — saturation curves and measured lift; the only source of marginal evidence.
- `gtm-metric-dictionary` — contribution margin, MER, break-even MER, CAC payback.
- `experiment-design-readout` — powers every entry in the test queue.
