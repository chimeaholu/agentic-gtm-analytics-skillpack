# Choosing an implementation, and what each one hides

The maths in this skill is solved. The reason to read this page is that each
library makes a different silent decision on your behalf, and the decision is
usually invisible in its output.

---

## The four

| | `ChannelAttribution` | `DP6/Marketing-Attribution-Models` | `ianchute/shapley-attribution` | `google/fractribution` |
|---|---|---|---|---|
| Language | R, with a Python port | Python | Python, scikit-learn API | SQL, BigQuery-native |
| Models | Markov orders 1–n, plus heuristics | heuristics + Markov + Shapley in one class | Shapley | fractional / DDA-style |
| Data shape | one row per **unique path** with converted and non-converted counts | one row per journey | feature matrix | event tables already in BigQuery |
| Ships sample data | **yes — a large sample path set** | no | no | no |
| Best for | Markov as the primary model; validating your pipeline against known output | getting all three from one interface | Shapley inside an existing sklearn pipeline | avoiding moving warehouse-scale event data out of BigQuery |

**Start with `ChannelAttribution` when Markov is the point.** The bundled sample
path set is worth more than it sounds: run it first, confirm you reproduce the
documented output, and you have proven your data-shaping code before you point it
at data whose right answer you do not know.

**Reach for `fractribution` when the data is already in BigQuery.** The expensive
part of this analysis is moving event-level paths, not fitting the model.

---

## What each one decides for you

### Path aggregation
`ChannelAttribution` expects **unique paths with counts**, not raw journeys. The
aggregation step — collapsing 5,600 journeys into 7 distinct paths — is yours,
and it is where repeated consecutive touches get silently collapsed or not.
`A → A → C` and `A → C` are different paths to the library and usually the same
path to the business. **Decide, and write the decision in the output.**

### Null-state construction
Some implementations require you to supply non-converting paths explicitly;
others infer a null absorption from a total-journeys column. If a library runs
happily on converter-only data and returns removal effects, **it inferred
something** — find out what, because §1 of the skill says those numbers are not
usable.

### Channel classification
Every one of them takes channel labels as given. The mapping from raw
source/medium to channel label is entirely yours and it is a model parameter
(§5). Two libraries fed two classification rules will disagree, and the
disagreement will look like a methodological difference.

### Order default
`ChannelAttribution` defaults to order 1. Raising the order is one argument and
no warning fires when the resulting states are too sparse to estimate. Check
state occupancy before trusting an order-2 or order-3 result: any state with
fewer than a few dozen observations is contributing noise.

### Shapley characteristic function
`shapley-attribution` and the Shapley path in `DP6` each make a choice about
whether `v(S)` is a count or a rate, and whether coalitions are matched exactly
or as subsets. **Read the source for this one specific thing.** The rate version
is non-monotone and produces negative values — see the worked example in
`references/markov-and-shapley.md`.

### Coalition imputation
Any Shapley implementation must do something about the coalitions your data does
not contain. Zero, grand mean and model-fitted imputation give different
answers, and few libraries document which they use. If it is not documented,
test it: construct a small input with a known missing coalition and read the
output.

---

## Pinning and provenance

These are research-grade packages. A maintainer changing a default between
versions is indistinguishable, in your trendline, from a change in the business.

- **Pin the exact version** and record it in the provenance block with the model
  parameters.
- **Re-run the previous period on any version bump** before publishing the new
  one. If the old period's numbers moved, the change is the library, and the
  trend comparison needs a restatement note.
- **Record the random seed** for anything sampled, including Monte Carlo Shapley.
  An unseeded sampled result is not reproducible, and someone will ask why the
  number changed.

---

## The honest summary

**A competent implementation on clean path data is days. Assembling clean path
data is weeks.** None of these four ships identity resolution or journey
assembly — they all assume a correct, ordered, deduplicated path list as input,
and that input is the thing that is actually hard and actually wrong. Time spent
hand-rolling a transition matrix is time not spent on the only input that
determines whether any of this means anything.
