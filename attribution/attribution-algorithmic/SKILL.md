---
name: attribution-algorithmic
description: Use when there is enough path volume for an estimated rather than asserted attribution model — Markov chain removal effect, Shapley value coalition allocation, or a comparison of the two — and when explaining what GA4's or Google Ads' data-driven attribution actually does. Requires full paths for converters AND non-converters; without non-converting paths the transition matrix is conditioned on success and the removal effects are garbage. Composes maintained open-source implementations rather than reimplementing the maths. Still correlational, never causal — for causal answers use `incrementality-and-mmm`.
---

# Algorithmic Attribution

Rule-based models assert a division. Algorithmic models **estimate** one from
observed paths. That is a real improvement and it is routinely oversold: an
estimated model is still a description of the journeys you recorded, not a
statement about what the channels caused. Markov and Shapley both answer "what
role does this channel play in the paths that exist", never "what happens if we
turn it off".

The skill's job is to run both, report where they agree, and be explicit about
the three inputs that silently determine the answer: **non-converting paths,
channel granularity and the path-length cap.**

---

## 1. The hard prerequisite: non-converting paths

**Both models require paths for converters *and* non-converters.** This is the
single most-skipped requirement in the family and it is not a quality issue, it
is a correctness one.

A Markov chain estimated only from converting paths has a transition matrix in
which every path ends in conversion. The probability of reaching `Conversion`
from anywhere is 1.0, removing any channel changes it by approximately nothing,
and the removal effects that come out are noise dressed as evidence. The same
defect hits Shapley: coalition conversion rates estimated from converters only
are all 1.0, and every marginal contribution is 0.

```
status: unavailable
model: markov_removal_effect, shapley
reason: >
  The extract contains 41,200 converting paths and no non-converting paths.
  Both models estimate a conversion probability, which requires observing
  journeys that did not convert. Conditioned on success, every transition
  leads to conversion and every removal effect collapses toward zero.
resolving_change: >
  export all sessions or journeys in the window, converted and not, with the
  same identity basis and the same channel classification — typically the
  event-level warehouse export rather than the conversion report
what_is_available_now: >
  rule-based attribution over the converting paths (attribution-rule-based),
  which does not estimate a probability and is therefore unaffected
```

Two quieter versions of the same defect to check for:

- **A conversion-report export** that happens to include the pre-conversion
  touches. It looks like path data. Every path in it converted.
- **A journey table filtered to "engaged" users.** Conditioning on engagement is
  a milder version of conditioning on success and biases every removal effect
  upward for the channels that drive engagement.

---

## 2. When it is not worth running

Before the maths, the honest gate. Say no here more often than the literature
implies.

| Condition | Verdict | Why |
|---|---|---|
| < ~1,000 conversions in the window | **do not run** | transition probabilities for the less-travelled states have wide intervals; the model will produce confident-looking numbers on three observations |
| Median path length ≤ 1–2 touches | **do not run** | with one touch per path, Markov and Shapley both collapse to last-touch and you have spent two weeks reproducing it. Report path-length distribution first |
| No non-converting paths | **cannot run** | §1 |
| The decision is a budget cut worth more than an experiment | **run, but subordinate it** | a geo holdout answers the actual question; the algorithmic model is a cross-check, not the evidence |
| Channels move together in lockstep | **run with caution** | co-occurring channels are hard to separate here too; check how often they appear in the same path |
| Fewer than ~5 channels | **marginal** | the spread across rule-based models already tells you most of it, at a fraction of the effort |

**Path-length distribution is the pre-flight check.** Report it before anything
else: if 70% of paths have one touch, every model in this skill is last-touch
with error bars, and saying that is the deliverable.

---

## 3. Markov chain removal effect

### 3.1 Mechanics

Model journeys as a Markov chain over states
`{Start, c₁ … cₙ, Conversion, Null}`, where `Conversion` and `Null` are
absorbing.

**Estimate the transition matrix** by counting observed transitions:

```
P(a → b) = count(a → b) / count(a → ·)
```

Every path contributes `Start → first touch → … → last touch → Conversion` or
`→ Null`. Non-converting paths are what populate the `→ Null` column, which is
why §1 is a hard gate.

**Baseline conversion probability** `π` = probability of absorption in
`Conversion` starting from `Start`. For an absorbing chain with transient block
`Q` and absorbing block `R`, the absorption probabilities are

```
B = (I − Q)⁻¹ R
π = B[Start, Conversion]
```

`(I − Q)⁻¹` is the fundamental matrix. For a handful of channels this is a
direct solve; for higher-order chains, iterate or simulate.

**Removal effect** for channel `c`: delete state `c` and route every transition
that entered it to `Null`, recompute absorption, and take

```
RE(c) = (π − π_without_c) / π
```

**Allocate credit** by normalising removal effects, because they do not sum to
1.0 — channels overlap in paths, so the effects overlap too:

```
credit(c) = RE(c) / Σ_j RE(j)
```

**That normalisation is an assumption, not a result.** The removal effects
themselves are the estimated quantity; forcing them to sum to 100% is the same
100%-allocation convention the rule-based family uses, re-imposed on top of an
estimate. Report the raw removal effects alongside the normalised credit — the
raw ones are what a stakeholder can actually interpret.

### 3.2 Why it explains well

"If we turned this channel off entirely, the model says we would lose about 18%
of conversions" is the most stakeholder-legible sentence any attribution model
produces, and Markov produces it natively. It also **scales far better than
Shapley with channel count** — the cost is a matrix solve, not `2ⁿ` coalitions.

Use that sentence, and immediately qualify it with §3.3, because on its face it
sounds causal and is not.

### 3.3 How Markov misleads

1. **It is correlational.** The removal effect measures a channel's structural
   role in observed paths. It does not model substitution: if you cut paid
   search, some of that demand arrives through organic or direct instead, and
   the chain has no way to represent that. **The removal effect is therefore an
   upper bound on the loss from cutting the channel**, and naming that direction
   is more useful than a warning that it "may be inaccurate".
2. **First-order memorylessness is empirically false.** The model assumes the
   next touch depends only on the current one. Real journeys have structure the
   first-order chain cannot hold. Higher-order chains recover some of it at a
   steep data cost — order 2 multiplies the state space, and sparse states get
   unstable estimates. **Run order 1 and order 2 and compare; if they disagree
   materially, report that as a limitation rather than picking the prettier one.**
3. **It is sensitive to channel granularity.** Splitting "Paid Social" into four
   campaigns changes every other channel's number, because the split channel's
   internal transitions become visible and its removal effect fragments. The
   skill therefore **runs a granularity sensitivity check by default** (§5).
4. **It inherits every identity-resolution defect.** A broken person spine
   produces broken paths, and the model has no way to notice.
5. **Unobserved channels have their contribution redistributed** to whatever was
   observed — the same structural blindness as the rule-based family. An
   estimated model does not see what was never recorded.

---

## 4. Shapley value

### 4.1 Mechanics

Treat channels as players in a cooperative game. `v(S)` is the conversion rate
of the coalition `S` — the observed conversion rate of journeys whose channel
**set** is exactly `S` (or a superset, depending on the characteristic-function
convention, which you must state).

```
φ_c = Σ_{S ⊆ N \ {c}}  [ |S|! (n − |S| − 1)! / n! ] · [ v(S ∪ {c}) − v(S) ]
```

In words: a channel's Shapley value is its **average marginal contribution
across every coalition it could join**, weighted so that every ordering of
players is equally likely. It uniquely satisfies four axioms — efficiency
(values sum to `v(N)`), symmetry, null player, and additivity — which is the
precise sense in which it is "fair".

### 4.2 The three costs, all real

1. **Order is discarded.** Shapley works on channel *sets*, not ordered paths.
   A first-touch awareness play and a closing retargeting ad in the same journey
   are interchangeable to it. **This is a genuine information loss, not a
   simplification**, and it is the main reason to run Markov alongside.
2. **Exact computation is `O(2ⁿ)`.** Roughly 15–20 channels is the practical
   ceiling. Beyond it, use Monte Carlo permutation sampling: draw random
   orderings, accumulate marginal contributions, average. **Report the number of
   permutations and the standard error of each channel's estimate.** A sampled
   Shapley presented without its error is an approximation passed off as exact.
3. **Unobserved coalitions must be imputed.** With `n` channels there are `2ⁿ`
   possible sets and your data contains a small fraction of them. The imputation
   choice — zero, the grand mean, a fitted model — **drives the answer**, and it
   must be named in the output. This is the least-discussed and most
   consequential degree of freedom in the method.

---

## 5. Channel granularity and path-length caps are model parameters

Both change the answer. Both are usually set by whoever wrote the extract query.
**Both must appear in the output.**

### Granularity sensitivity, run by default
Compute credit at two or three levels — channel group, channel, campaign — and
report each channel group's total credit at each level. If the group's total
moves materially when its internals are split, the model is sensitive to a
decision nobody made deliberately, and the coarser level is the defensible one
for reporting.

### Path-length cap
Long-tail paths of 40+ touches are usually a bot, a monitoring agent or a broken
identity merge that glued several people together. Capping is reasonable.
**Declare the cap, report how many paths hit it, and report what share of
conversions they carry.** A cap at 10 touches that truncates 3% of paths is
housekeeping; one that truncates 30% is a modelling decision.

### Channel classification
The mapping from raw source/medium to channel is a rule you wrote. Two channels
that are frequently misclassified into each other will have their removal
effects and Shapley values mixed accordingly. Print the classification rule.

---

## 6. Vendor data-driven attribution, explained rather than reimplemented

GA4 and Google Ads DDA fit a probabilistic model on your own converting and
non-converting paths and allocate fractional credit using Shapley values. That
is a real algorithmic model, and it has four properties worth stating plainly to
anyone relying on it:

1. **It is not auditable.** Weights, features and decision rules are not
   inspectable. You cannot show a CFO why a channel's number changed, because
   you cannot see the model. For a pack that sells auditability, this is the
   decisive limitation.
2. **It only sees the vendor's own observable surface.** Touches the vendor
   cannot observe do not exist to it, and their credit is redistributed to those
   it can.
3. **There is a live industry argument** that high-frequency upper-funnel
   Google-property touches receive preferential credit. **This is a disputed
   claim, not a finding**, and it is presented that way. It matters here only
   because it cannot be checked — see (1).
4. **Model changes on the vendor's schedule restate your history.** A number
   quoted last quarter may not reproduce, with no change on your side.

**`google/fractribution` is the open, inspectable cousin** — a BigQuery-native
fractional attribution implementation — and it is the better anchor when the
requirement is to explain a budget decision rather than to accept one.

---

## 7. Compose, do not reimplement

| Library | What it is | Reach for it when |
|---|---|---|
| **`ChannelAttribution`** (R, with a Python port) | the canonical Markov removal-effect implementation; supports higher-order chains and ships a large sample path dataset | Markov is the primary model; the sample data also lets you sanity-check your pipeline against known output |
| **`DP6/Marketing-Attribution-Models`** (Python) | heuristics, Markov and Shapley in one class | you want all three from one interface and one data shape |
| **`ianchute/shapley-attribution`** (Python) | scikit-learn-compatible Shapley | Shapley inside an existing sklearn pipeline |
| **`google/fractribution`** (SQL / BigQuery) | fractional attribution that runs in the warehouse | the data is already in BigQuery and moving it out is the expensive part |

**A competent implementation on clean path data is days, not weeks. Assembling
the clean path data is weeks.** That asymmetry is the whole point: none of these
libraries ships identity resolution or journey assembly, and those are the parts
that actually fail. Time spent hand-rolling a transition matrix is time not
spent on the input that determines whether the output means anything.

Pin the version and record it in the provenance block — these are research-grade
packages, and a maintainer's default change is indistinguishable from a
business change in your trendline.

---

## 8. Markov versus Shapley, honestly

| | Markov removal effect | Shapley value |
|---|---|---|
| Uses path **order** | yes | no |
| Scales to many channels | yes — matrix solve | no — `O(2ⁿ)` exact, sampling beyond ~15–20 |
| Explains to a stakeholder | "if we removed it we'd lose X%" | "average marginal contribution across coalitions" |
| Principled fairness axioms | no | yes — efficiency, symmetry, null player, additivity |
| Key hidden parameter | chain order, granularity | coalition imputation, sampling error |
| Causal | **no** | **no** |

**They frequently rank channels similarly and disagree on magnitude.** Running
both and reporting the spread is more informative than picking a winner — and it
is the same discipline as `attribution-rule-based`, applied one layer up. Extend
the spread table across all the models that ran, rule-based and algorithmic
together, and apply the same act / hold / test gate.

---

## 9. Output

```
preflight:
  paths: { converting, non_converting, total }
  path_length: { p50, p90, max, share_single_touch }
  conversions_in_window
  gate_verdict: run | do_not_run | cannot_run, with reason
markov:
  order: 1 | 2, and the comparison if both ran
  transition_matrix_ref
  baseline_conversion_probability
  removal_effects[]: channel, raw_RE, normalised_credit, paths_containing
shapley:
  characteristic_function: exact_set | superset, stated
  computation: exact | monte_carlo
  permutations, standard_error_per_channel
  unobserved_coalition_imputation: zero | grand_mean | fitted, stated
  values[]: channel, phi, normalised_credit
sensitivity:
  granularity: level → channel_group → total_credit
  path_length_cap: { cap, paths_truncated, conversion_share_truncated }
spread[]: channel, min, max, range_pp, min_pairwise_tau, verdict   # incl. rule-based columns
library: { name, version }
limitations[]: correlational, first_order_assumption, identity_basis, unobserved_channels
```

---

## 10. Answering

**Answer first**, then the direction of the error.

> **The Markov removal effect puts paid social at 18% of conversions: if it
> disappeared from every path, the model expects roughly 18% fewer conversions.**
> Shapley puts it at 15%, which is close enough that the ranking is not in
> dispute — it is the third-largest channel under both.
>
> That 18% is an **upper bound on what you would actually lose by cutting it**,
> because the model cannot represent substitution — some of those people would
> have arrived through organic or direct instead. Both models are descriptions
> of the paths we recorded, not statements about causation; neither can tell you
> what the spend caused. Both ran at channel-group level; splitting paid social
> into campaigns moves its total by about two points, so the group-level number
> is the one to quote.
>
> For deciding that paid social is a real contributor rather than a passenger,
> this is enough. For deciding how much to cut, it is not — that is a geo
> holdout, and the difference between 18% and the true figure is exactly what the
> holdout would measure.

**Withhold only:** the models themselves when non-converting paths are absent
(§1) or the volume and path-length gates fail (§2). In both cases rule-based
attribution still runs and still ships, because it estimates no probability and
is unaffected by the missing input.

---

## References

- `references/markov-and-shapley.md` — worked transition matrix, absorption solve, removal effect and Shapley computation on a small synthetic path set, with the sampling-error calculation
- `references/library-selection.md` — the four implementations compared on data shape, output shape, pinning and the failure they each hide

## Core contracts called

- **`answer-contract`** — the typed `unavailable` in §1 and the gate verdicts in §2
- **`provenance-block`** — library name and version, path extract query, identity basis, window and timezone
- **`comparability-rules`** — before any algorithmic column shares a table with rule-based columns or with platform-reported conversions
- **`warning-field-reader`** — a channel dimension rolled into `(other)` silently merges states in the transition matrix, which is invisible in the output
- **`pagination-patterns`** — path extracts are large; a truncated extract removes the tail of the path-length distribution, which is where the cap decision lives

## Related skills

- `journey-assembler` and `identity-resolution` — hard prerequisites, and the part that actually takes the time.
- `attribution-rule-based` — runs first, provides the spread columns these models join.
- `incrementality-and-mmm` — the causal question neither model answers.
- `budget-allocation` — consumes the combined spread, never a single model's column.
