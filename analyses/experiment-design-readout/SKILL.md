---
name: experiment-design-readout
description: Use when designing or reading any GTM experiment — an A/B test, a campaign test, a pricing test, a geo holdout or a sales-process trial. Computes the required sample size from the minimum detectable effect before anything runs, refuses to design a test that cannot detect the effect in question, and reads a non-significant result as "we could not detect an effect of this size", never as "it does not work". Prevents peeking, prevents underpowered tests being reported as findings, and prevents a winner declared from mismatched definitions.
---

# Experiment Design and Readout

Two sentences carry most of this skill.

**Before: if the available population cannot detect the effect worth acting on,
the honest output is "this test cannot answer this question", not a smaller
test.**

**After: a non-significant result means "we could not detect an effect of at
least this size". It is not evidence of no effect.**

The second is the most damaging misread in GTM analytics, and it recurs
identically in geo-lift — see `incrementality-and-mmm`, which states the same
rule for the same reason.

---

## 1. Power first, always

Required sample per arm derives from four inputs. All four must be written down
before anything runs.

| Input | Where it comes from |
|---|---|
| **Baseline rate** `p₁` (or mean and variance for a continuous outcome) | historical data for the same population and window length |
| **Minimum detectable effect** | **the smallest effect that would change the decision** — not the effect you hope for |
| **Significance level** `α` | conventionally 0.05, two-sided |
| **Power** `1−β` | conventionally 0.80 |

### Two proportions

```
n per arm = (z_{1−α/2} + z_{1−β})² · [ p₁(1−p₁) + p₂(1−p₂) ] / (p₂ − p₁)²

at α = 0.05 two-sided and 80% power,  (z_{1−α/2} + z_{1−β})² = 7.849
```

| Baseline | Relative lift to detect | Absolute effect | **n per arm** |
|---|---|---|---|
| 2% | 5% | 0.10pp | **315,203** |
| 2% | 10% | 0.20pp | **80,679** |
| 2% | 20% | 0.40pp | **21,106** |
| 5% | 5% | 0.25pp | **122,121** |
| 5% | 10% | 0.50pp | **31,231** |
| 5% | 20% | 1.00pp | **8,155** |
| 10% | 5% | 0.50pp | **57,760** |
| 10% | 10% | 1.00pp | **14,748** |
| 10% | 20% | 2.00pp | **3,838** |

**Read the shape, not just the cells.** Required sample scales with roughly
`1/effect²`: halving the effect you want to detect quadruples the sample. This is
why "let's just detect a 5% lift" turns a feasible test into an impossible one,
and why the honest conversation is about the MDE rather than about the duration.

### Continuous outcome

```
n per arm = 2 · (z_{1−α/2} + z_{1−β})² · σ² / Δ²
```

**Revenue-per-user outcomes have high variance and heavy right tails**, so the
naive `σ` from history overstates achievable precision. Winsorise or use a
bounded outcome, state which, and expect substantially larger samples than a
conversion-rate test on the same traffic.

### The gate

```
if required_n > available_population_in_a_reasonable_window:
    verdict = "this test cannot answer this question"
    levers  = [larger MDE — i.e. only act on bigger effects,
               a higher-baseline sub-population,
               a more sensitive outcome metric,
               a different design: geo, holdout, sequential]
    do NOT run a smaller version
```

Running it anyway does not produce "inconclusive". It produces a
non-significant result that gets reported as "it doesn't work".

---

## 2. Reading a null

Four rules, in order.

1. **Report the confidence interval, always.** `−2% to +18%` and `−1% to +1%` are
   both non-significant and mean opposite things. The first is uninformative; the
   second is genuine evidence of a small effect.
2. **Report the MDE beside the null.** "We could not detect an effect; this test
   could only have detected 12% or larger" is a complete sentence and the
   incomplete version is what causes the damage.
3. **Compare the interval against the decision threshold.** If the entire
   interval sits below the effect worth acting on, **that is an actionable
   finding even without significance** — you have learned the effect is small,
   which is frequently what you needed.
4. **Never write "it doesn't work".** Write "this test could not detect an effect
   of X or larger", and name what would.

---

## 3. Peeking

**Checking a fixed-horizon test repeatedly inflates the false-positive rate**,
because each look is another chance to cross the threshold. A test peeked at
daily for two weeks has a false-positive rate far above the nominal 5%.

Three legitimate options, and you must say which you used:

| Option | What it requires |
|---|---|
| **Fixed horizon, no early stopping** | the duration and analysis plan fixed in advance; look at the end |
| **Sequential testing** (mSPRT, always-valid inference) | a method designed for continuous monitoring, applied from the start, not adopted mid-test |
| **Group sequential with pre-specified interim analyses** | alpha-spending fixed in advance at a set number of looks |

**Switching to a sequential method after the test started does not fix peeking
already done.** Neither does "we only stopped early because it was obvious".

**Monitoring for health is not peeking.** Watching for sample-ratio mismatch,
tracking failures, or broken variants is required. Monitoring the **primary
outcome** with intent to stop is peeking. Separate the two dashboards.

---

## 4. The randomisation unit must match the analysis unit

**Randomising by session and analysing by user, or randomising by lead and
analysing by account, breaks the independence assumption and understates
variance** — which makes results look more significant than they are.

| Randomise by | Analyse by | Valid? |
|---|---|---|
| user | user | yes |
| session | session | yes, but a returning user can see both variants |
| session | user | **no** — correlated observations within user |
| lead | account | **no** — multiple leads per account are correlated, and in B2B this is the common error |
| account | account | yes, and it is the right unit for B2B |

**Randomise at the highest unit the decision applies to.** If the decision is
about accounts, randomise accounts, even though it costs sample size. A
statistically cheaper design that answers a different question is not cheaper.

### Sample-ratio mismatch

Check the arm split against the intended ratio before reading anything:

```
chi-square test of observed arm counts against the intended split
```

**A significant SRM invalidates the test.** It means assignment was not random —
a redirect failing on one variant, a bot filter applying unevenly, a tracking
difference between arms. **Do not analyse the outcome. Find the cause.** SRM is
the single highest-value automated check in experimentation and it is cheap.

---

## 5. Multiple comparisons

**Ten metrics on one test produces a "significant" result by chance** — at
α = 0.05 the probability of at least one false positive across 10 independent
metrics is about 40%.

Three defences, and you need one:

- **Pre-register one primary metric.** Everything else is secondary and reported
  as exploratory, explicitly.
- **Correct.** Bonferroni for a small, important family; Benjamini-Hochberg where
  you are screening many.
- **Report the family size.** If no correction is applied, say how many metrics
  and segments were examined. **A finding from the 23rd segment cut is a
  hypothesis, not a result**, and labelling it as one is honest and still useful.

Segment slicing is the same problem in disguise: testing one metric across eight
segments is eight tests.

---

## 6. Novelty, primacy and run length

- **Novelty effect** — a UI change gets engagement because it is new. Short tests
  on interface changes over-read.
- **Primacy effect** — existing users are slowed by an unfamiliar change and the
  early read understates it.
- **Both decay**, usually over one to two weeks.

**Run for a whole number of business cycles**, typically full weeks, and state
the run length and whether it covered a full cycle. A test run Tuesday to
Thursday measures midweek behaviour.

For anything shipping to existing users, **report new-user and returning-user
results separately.** They frequently diverge, and the blended number is a mix of
two different effects weighted by traffic composition.

---

## 7. Sales-process and pricing experiments

Small n, slow feedback, and reps who will not comply with randomisation they
disagree with.

**The right design is usually a geo, team or segment holdout rather than per-deal
randomisation.** That routes to `incrementality-and-mmm`, which covers synthetic
control and the power simulation for exactly this case.

Additional cautions specific to this family:

- **Compliance is the binding constraint**, not statistics. Measure it, report
  it, and analyse intention-to-treat rather than as-treated. Analysing only the
  deals where the rep complied re-introduces selection and destroys the
  randomisation.
- **The outcome lags by a full sales cycle.** A pricing test read at six weeks
  in a four-month-cycle business has seen a fraction of its effect — and the
  fraction it has seen is biased toward fast-closing deals.
- **Contamination is likely.** Reps talk, and a team holdout leaks.

---

## 8. The comparison contract applies before any two arms are compared

Same population definition, same window, same metric definition, same timezone.
See `comparability-rules`. **A winner declared from mismatched definitions is the
most embarrassing failure in this family**, because it survives every statistical
check.

The specific ones that bite:

- Arms measured over different windows because one launched a day late.
- A metric redefined mid-test.
- One arm including a population the other excluded — internal traffic, a test
  account list, a region.
- Timezone differences between the assignment system and the analytics system,
  which shift edge-of-window events between arms.

---

## 9. Platform limits worth knowing before you promise a readout

**Iterable's experiment metrics endpoint (`GET /api/experiments/metrics`) supports
email experiments only.** Push, SMS and in-app A/B tests have no metrics
endpoint. **A multichannel programme's experiment reporting is genuinely
incomplete, and the skill says so rather than implying parity** — the non-email
arms need an independent measurement route through the warehouse or event
pipeline, planned before the test launches, not discovered at readout.

More generally, **establish the readout route before the test runs.** "We ran the
test and the platform cannot report on it" is a recoverable problem if caught at
design time and an unrecoverable one afterwards.

---

## 10. Output

```
design:
  hypothesis, primary_metric, secondary_metrics[], family_size
  randomisation_unit, analysis_unit, match: bool
  baseline, MDE, alpha, power
  required_n_per_arm, available_n, duration, cycles_covered
  gate: pass | fail, levers_if_fail[]
  stopping_rule: fixed | sequential | group_sequential
  readout_route: platform | warehouse, verified_before_launch: bool
health:
  srm: { expected_split, observed_split, p_value, verdict }
  tracking_parity, exclusions_applied[]
readout:
  effect, confidence_interval, p_value
  MDE_from_design
  interpretation: detected | not_detected_above_MDE
  vs_decision_threshold
  segments[]: labelled exploratory unless pre-registered
  new_vs_returning: separate results
not_claimed[]: …
```

---

## 11. Answering

**Answer first.** The design case:

> **This test cannot answer this question.** At a 2% baseline, detecting the 5%
> relative lift you would act on needs about 315,000 users per arm; you have
> roughly 40,000 a month, so it would take thirteen months and the page will
> change before then.
>
> Three ways forward. Raise the bar to a 20% lift, which needs 21,000 per arm and
> runs in about three weeks — that only tells you about large effects, which may
> be all you need. Or test on a higher-converting sub-population where the
> baseline is 8–10%. Or change the outcome to something more frequent, such as
> add-to-cart rather than purchase, accepting that it is a proxy.
>
> I would run the 20% version. It answers "is this a big win" in three weeks, and
> a 5% improvement on this page is not worth thirteen months of a fixed layout.

The readout case:

> **No detectable effect. The interval runs from −1.2% to +2.8%, and this test
> was powered to detect 4% or larger.**
>
> That is not "the variant doesn't work" — it is "any effect is smaller than 4%,
> and probably smaller than 2.8%". Since the effect worth shipping for was 5%,
> **that is a decisive result: don't ship it.** The narrow interval is what makes
> it decisive; a wider one would have left the question open.
>
> The 14% lift in the mobile-tablet segment is not a finding. It is one of eleven
> segment cuts examined, so at least one crossing the threshold by chance was
> likely. It is worth a dedicated test if the hypothesis is interesting.

**Withhold only:** a test design whose MDE exceeds the effect worth acting on
(§1), a readout from a test with a significant sample-ratio mismatch (§4), and a
causal claim from a test whose randomisation unit did not match its analysis
unit. **Never withhold a point estimate and interval because the result is
non-significant** — that is the finding, and hiding it is how the same test gets
run again next quarter.

---

## References

- `references/power-and-sample-size.md` — the formulas, worked tables for proportions and continuous outcomes, duration calculation, sequential methods and the MDE conversation
- `references/readout-checklist.md` — SRM, the null-interpretation template, multiple-comparison handling, segment discipline, and three worked readouts

## Core contracts called

- **`answer-contract`** — the three withholds above and the null-result readout shape
- **`provenance-block`** — assignment system, analytics system, timezone of each, and whether they agree on day boundaries
- **`comparability-rules`** — §8; applies before any two arms are compared
- **`warning-field-reader`** — thresholded or sampled arm data, which biases small segments most and is invisible unless the flags are read

## Related skills

- `incrementality-and-mmm` — geo and holdout designs, the power simulation, and the same null-reading discipline.
- `pricing-discount-analysis` — price tests, where n is small and feedback is slow.
- `uplift-and-causal-models` — who is persuadable, once an average effect is established.
- `gtm-metric-dictionary` — the metric definition that must be fixed before the test runs.
