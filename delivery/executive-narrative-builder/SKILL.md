---
name: executive-narrative-builder
description: Use when writing the narrative that accompanies a GTM number for an executive, board or leadership audience — the commentary on a weekly report, the QBR story, or the explanation of a miss. Structures it as what happened, versus expectation, why in decomposed named drivers, what we are doing, and what we need — with the driver decomposition doing the analytical work rather than the adjectives. Prevents the non-answer that revenue was down, and prevents a narrative that asserts a cause the analysis cannot support.
---

# Executive Narrative Builder

"Revenue was down" is not an answer. "Revenue missed by 12%: 8 points from fewer
opportunities, 3 from a lower win rate, 1 from ASP" is an answer, and the gap
between those two sentences is arithmetic, not writing skill.

**The decomposition is the analytical work.** Everything else in this skill is
packaging around it.

**Core contracts this skill must call:** `answer-contract` (the narrative is the
number's final form, and the causal disclaimer lives in its negative list),
`comparability-rules` (a decomposition across a definition change or a currency
basis change is arithmetic on incomparable quantities), `provenance-block` (every
driver figure carries its window and basis), `warning-field-reader` (a driver
computed from sampled or thresholded data is named as such).

---

## 1. The structure

```
1. What happened          ONE number
2. Versus what we expected forecast, actual, variance — and the accuracy record
3. Why                    two or three decomposed drivers, each quantified
4. What we are doing      actions, each with an owner
5. What we need           specific asks, or "nothing this period", written
```

Two or three drivers. **A narrative listing every contributing factor has not done
the ranking work**, it has offloaded it onto the reader, and the reader will not
do it. Where the fourth-largest driver matters, it goes in the appendix with the
full decomposition table.

**Lead with what the reader can act on.** Technical detail belongs only where it
explains an outcome or a decision. If a sentence does not change what anyone does
or believes, delete it.

---

## 2. The decomposition, which is the whole point

Revenue in most B2B GTM motions factors multiplicatively:

```
Revenue  =  Opportunities  ×  Win rate  ×  Average deal size
    R     =       N        ×      W     ×        A
```

The question is how to split the change in R across changes in N, W and A so the
parts sum exactly to the whole. Two correct methods, and one wrong one everybody
reaches for first.

### The wrong one: percentage changes

```
N down 10%, W down 4%, A up 1%   →   "so revenue is down about 13%"
```

It is an approximation that drifts badly once changes exceed a few percent, the
parts do not sum to the actual change, and an executive who adds them up and gets
a different number than the headline stops trusting the analysis. Do not ship it.

### Method 1: sequential substitution (chained)

Change one factor at a time, in a declared order, holding the rest at the values
they have already been updated to.

```
ΔN effect = (N₁ − N₀) ×  W₀ × A₀
ΔW effect =  N₁ × (W₁ − W₀) × A₀
ΔA effect =  N₁ ×  W₁ × (A₁ − A₀)
─────────────────────────────────
sum       =  R₁ − R₀            ← exact, always
```

**Exact and simple. Order-dependent**: whichever factor you substitute first is
credited with the interaction term. Declare the order, use the same order every
period, and say it is a convention. For most GTM narratives, order the factors
volume → conversion → price, which matches how the business thinks about them.

### Method 2: LMDI, when order-dependence is contentious

The logarithmic mean divisia index is exactly additive **and** order-independent.
Use it when the decomposition is going to be argued about — a board pack, a
compensation-relevant number, anything where "you chose the order that blamed my
team" is a conversation that could happen.

```
L(a, b) = (a − b) / ln(a / b)        for a ≠ b;  L(a, a) = a

ΔR_N = L(R₁, R₀) × ln(N₁ / N₀)
ΔR_W = L(R₁, R₀) × ln(W₁ / W₀)
ΔR_A = L(R₁, R₀) × ln(A₁ / A₀)
─────────────────────────────────
sum  = R₁ − R₀                       ← exact, and independent of factor order
```

```python
from math import log

def lmdi(r0, r1, factors0, factors1):
    """Exact, order-independent multiplicative decomposition.
    factors are dicts of name -> value; their products must equal r0 and r1."""
    L = r1 if r1 == r0 else (r1 - r0) / log(r1 / r0)
    return {k: L * log(factors1[k] / factors0[k]) for k in factors0}
```

**Both methods require every factor to be strictly positive.** A period with zero
opportunities, or a sign flip in revenue, breaks the logarithm and makes the ratio
meaningless. That case is `unavailable` for the decomposition — report the change
itself and say the factorisation does not apply, rather than dropping a factor
and presenting the remainder as complete.

### Worked, with illustrative figures

```
                 Forecast (R₀)      Actual (R₁)
Opportunities          420               370        −11.9%
Win rate              0.24              0.228        −5.0%
Avg deal size        49,600            50,100        +1.0%
Revenue           5,000,000          4,288,000       −14.2%   (−712,000)
```

Sequential substitution, order volume → conversion → price:

```
ΔN : (370 − 420) × 0.24  × 49,600           = −595,200
ΔW : 370 × (0.228 − 0.24) × 49,600          = −220,224
ΔA : 370 × 0.228 × (50,100 − 49,600)        = + 42,180
                                     total  = −773,244
```

That total does not equal −712,000 — because 420 × 0.24 × 49,600 is 4,999,680,
not exactly 5,000,000. **Reconcile the factor product against the reported total
before decomposing.** A residual is either rounding (state it) or a sign that the
factors do not actually multiply to the metric (stop, and find the missing
factor — usually a segment mix effect or a revenue line outside the funnel).

Narrated:

> Revenue came in at 4.29M against a 5.0M forecast, a 14% miss. Opportunity
> volume accounts for 8.4 points of it, win rate for 3.1 points, and deal size
> worked slightly in our favour at +0.6 points. This is a top-of-funnel problem,
> not a closing problem.

**That last sentence is what the decomposition buys.** It is a direction for the
next quarter's effort, and it is defensible because the arithmetic sums to the
miss.

---

## 3. Mix effects, which get misattributed as performance

When a metric is an average or a rate over a heterogeneous population, a change
in the **mix** moves it with no underlying performance change anywhere. Blended
win rate falls because a lower-converting segment grew, while every segment's win
rate improved. This is Simpson's paradox, it is common in GTM data, and narrating
it as a performance decline is a concrete way to send a team to fix the wrong
thing.

Split the change into a within-segment effect and a mix effect:

```
Δ(blended)  =  Σᵢ wᵢ⁰ × (rateᵢ¹ − rateᵢ⁰)      ← within-segment (real performance)
            +  Σᵢ (wᵢ¹ − wᵢ⁰) × rateᵢ¹          ← mix shift
```

where `wᵢ` is segment *i*'s share of the denominator. The two terms sum exactly to
the blended change.

```python
def mix_decomposition(w0, r0, w1, r1):
    within = sum(w0[k] * (r1[k] - r0[k]) for k in r0)
    mix    = sum((w1[k] - w0[k]) * r1[k] for k in r0)
    return {'within_segment': within, 'mix_shift': mix}
```

**Run this before narrating any blended-rate change.** If the mix term dominates,
the honest sentence is:

> Blended win rate fell from 24% to 22.8%. Every segment's win rate held or
> improved; the blended figure fell because the lower-converting segment grew from
> 31% to 44% of closed opportunities. This is a mix change, not a closing problem.

---

## 4. Causal language is reserved for causal evidence

Most GTM analysis is correlational. The narrative's verbs must match the
evidence.

| Evidence | Permitted language |
|---|---|
| Randomised test, holdout, geo-lift with adequate power | **"caused", "drove", "increased ... by"** |
| Uncontrolled before/after, correlation, observed lift | **"coincided with", "is consistent with", "alongside"** |
| A decomposition | **"accounts for", "contributed", "explains N points of"** |

A decomposition is arithmetic, not causation. *"Fewer opportunities account for 8
points of the miss"* is a true statement about where the number went. *"Fewer
opportunities caused the miss"* is a claim about why opportunities fell, which the
decomposition says nothing about.

The negative list carries the disclaimer explicitly, in full, every time the shape
is before-and-after:

> Measured before and after in uncontrolled windows, with no control group and no
> seasonality adjustment. This shows what happened, not what caused it.

**The "what changed that week" trap:** a narrative that names the one thing that
changed in the same week as the movement is asserting causation with a sample size
of one. Say "coincided with", give the decomposition, and name the test that would
settle it — see `incrementality-and-mmm`.

---

## 5. Forecast versus actual, every time, with the accuracy record

**This is what makes the next forecast better and almost nobody does it.**

| | Value |
|---|---|
| Forecast (made 2026-07-01) | 5.00M |
| Actual | 4.29M |
| Error | −0.71M, −14.2% |
| Naive baseline (= prior period) | 4.55M → error −5.7% |
| Our last four quarters' errors | −14.2%, +2.1%, −8.9%, −11.4% |
| Mean signed error | −8.1% — **we forecast high, consistently** |

Two columns do the work here.

**The naive baseline.** A forecasting process that does not beat "same as last
period" consumes effort for negative value. In the table above it did not, this
quarter — say so. That is uncomfortable and it is the point; a QBR that cannot
report a bad forecast is a defence, not a learning event.

**The signed error history.** A process that is consistently 8% high has a
correctable bias — subtract it, or find the optimism in the pipeline weighting. A
process that is randomly ±8% has irreducible noise, and the correct response is
wider intervals and less confidence, not more process. **These two look identical
in a single quarter** and demand opposite responses, which is why the history
column is not optional.

Forecast a **range** with a named method, not a point (see `pipeline-forecast`).
A point forecast is a range with its uncertainty deleted, and it is the reason
"we missed" conversations happen about outcomes that were inside the interval all
along.

---

## 6. The asks are specific and owned

**A narrative with no asks is a status update.** Executives read narratives to
decide something; if there is nothing to decide, say so explicitly — "no asks this
period" — rather than leaving the section off, which reads as an oversight.

| Bad ask | Good ask |
|---|---|
| "More marketing investment" | "Move 180K from paid social to paid search for Q4, based on the cost-per-opportunity gap; decision needed by 15 Oct — marketing lead" |
| "Better sales and marketing alignment" | "Agree a single qualified-opportunity definition at the 8 Oct revops review; both teams currently report different numbers — revops lead" |
| "Hire more reps" | "Approve two reps by 1 Nov: at a 90-day ramp they contribute from February, which is what the Q1 plan assumes — sales lead" |

Each good ask carries the **decision, the amount or scope, the date, and the
owner**. An ask missing any of those will not be acted on, and it will reappear
next quarter phrased identically.

---

## 7. Per-surface narration lenses

Where the narrative is generated per view — a dashboard tile, a filtered segment,
a channel page — **one generic narration prompt produces identical generic
commentary on every view.** Readers notice within two surfaces and stop reading
all of them.

Keep a lens dictionary: what matters on *this* surface, composed with the current
filtered data.

```yaml
lenses:
  pipeline_by_stage:
    focus: [stage conversion, stage ageing, volume entering the top stage]
    compare_to: same_weekday_4w
    known_traps:
      - "stage duration is right-censored: open opportunities have no exit yet,
         so average time-in-stage understates"
      - "a stage-definition change invalidates the trend"
    asks_shape: "which stage transition to work on next"

  paid_channel_detail:
    focus: [cost per opportunity, volume, platform-attributed vs warehouse figures]
    compare_to: prior_period
    known_traps:
      - "platform-attributed conversions overlap across platforms and overstate"
      - "the recent window sits inside the platform's settlement period"
    asks_shape: "reallocate, hold, or test"

  _default:
    focus: [largest absolute change, direction vs baseline]
    compare_to: prior_period
    known_traps: ["uncontrolled comparison, no causal claim"]
    asks_shape: "what to investigate next"
```

**The `_default` lens is required.** An unmapped surface must still narrate, with
a generic-but-honest lens, rather than producing nothing or hallucinating a focus
the view does not support.

Compose the request as **lens + current filtered data + the decomposition**, never
as "summarise this chart". A narration given only a chart describes the chart; a
narration given the decomposition explains the business.

---

## 8. Answering

**Answer first.** The headline is the number and its direction. The caveats follow
in plain sentences, each one sentence long:

> **Revenue came in at 4.29M against a 5.0M forecast, a 14% miss.** Opportunity
> volume accounts for 8.4 points, win rate for 3.1, and deal size helped by 0.6.
> Our forecast has run 8% high on average across the last four quarters, so part
> of this gap is a known forecasting bias rather than a business result; the
> bias-adjusted miss is nearer 6%. Two of the twelve weeks sit inside the CRM's
> close-date edit window, so the actual will rise slightly. The decomposition
> shows where the number went, not why — no holdout ran, so nothing here is a
> causal claim.

**Give the bias-adjusted number.** It is computable, the user will otherwise do it
in their head incorrectly, and naming the direction of the known error is exactly
the contract. Present it alongside the raw figure, never instead of it.

**Withhold only what cannot honestly be computed:**

- **The decomposition, when the factors do not multiply to the metric.** Report the
  change, state that the factorisation does not close, and name the missing factor
  you would need. Do not present a decomposition with an unexplained residual as
  if it were complete.
- **A causal claim, always, absent a control.** This is the one genuine refusal in
  this skill: no phrasing, no user pressure and no deadline makes an uncontrolled
  before-and-after into evidence of cause. Give the correlation, give the
  decomposition, name the test that would settle it.
- **A driver on a segment below the volume floor.** A win rate on nine
  opportunities is not a driver, it is noise with a percentage sign.

---

## Files

- `references/decomposition-methods.md` — sequential substitution, LMDI, mix
  effects and additive decomposition, with worked examples and the failure cases
- `references/narrative-templates.md` — the five-part structure filled for the
  miss, the beat, the flat quarter and the weekly, plus the lens dictionary
- `evals/cases.json` — behavioural cases including the honest-limit cases

## Related skills

- `revenue-waterfall` — the reconciling decomposition this narrative is built on
- `kpi-tree-builder` for the factor tree the decomposition walks
- `pipeline-forecast` for the forecast and its interval
- `report-generator` assembles this narrative into the artefact
- `incrementality-and-mmm` for the only evidence that licenses causal language
- `win-loss-analysis` when win rate is the dominant driver, because its
  denominator choice changes the story
