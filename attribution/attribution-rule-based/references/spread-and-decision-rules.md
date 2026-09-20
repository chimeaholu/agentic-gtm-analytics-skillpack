# Spread, agreement and the act / hold / test gate

A single model's column is an assertion. The spread across columns is the only
thing in rule-based attribution that behaves like evidence: it tells you which
findings survive the arbitrary choices and which are artefacts of them.

---

## 1. Building the spread table

For each channel `c`, over the set `M` of models that actually ran:

```
share(c, m)   = credit(c, m) / Σ_c credit(c, m)          # normalise per model
min(c)        = min over m in M
max(c)        = max over m in M
range_pp(c)   = (max(c) − min(c)) × 100
```

Two rules that decide whether the table means anything:

- **Only models computed on the same journey set may share a row.** If W-shaped
  ran on 61% of journeys for lack of milestone stamps, either restrict every
  model to that 61% subset for the comparison, or report W-shaped in a separate
  block with its coverage. Comparing a 61% column to a 100% column is the
  comparison-contract violation `comparability-rules` exists to catch, committed
  inside a single skill.
- **Time-decay contributes one column at the declared `H`**, with the sweep
  reported separately. Feeding five half-lives into the range makes time-decay's
  free parameter look like model disagreement.

---

## 2. Rank agreement: minimum pairwise Kendall's tau

Range alone misses the case that matters most: two models that agree on
magnitude but disagree on order.

```python
from itertools import combinations
from scipy.stats import kendalltau

ranks = {m: rank_channels_by_share(m) for m in models_run}
taus  = {(a, b): kendalltau(ranks[a], ranks[b]).statistic
         for a, b in combinations(models_run, 2)}
headline = min(taus.values())
```

**Report the minimum, not the mean.** The mean is dragged up by the several
models that are near-identical by construction (linear and U-shaped agree on
most journey shapes), which hides the one pair that disagrees — and that pair is
the finding.

| min tau | Reading |
|---|---|
| ≥ 0.8 | the channel ordering is robust; argue about magnitude, not rank |
| 0.5–0.8 | the top and bottom are stable, the middle is not; do not rank-order the middle in a slide |
| < 0.5 | **the ordering is a function of the model chosen.** Any "top channel" claim is a claim about your choice of rule |

Also report **which pair produced the minimum.** "First-touch and last-touch
disagree" is expected and uninteresting. "Linear and U-shaped disagree" means
something structural about journey length distribution and is worth a look.

---

## 3. The gate

| Range | Rank stable | Verdict | Action |
|---|---|---|---|
| ≤ 5pp | yes | **act** | the finding survives every defensible rule |
| 5–15pp | yes | **hold** | direction is stable; do not size a spend change on the magnitude |
| > 15pp | any | **test** | name the experiment |
| any | no (rank flips) | **test** | unresolved regardless of range |
| < 30 credited conversions | — | **count only** | report the count, not the share |

Two calibration notes:

- **The thresholds are conventions, like the models.** They are chosen so that a
  channel's verdict does not flip on rounding, and they are stated in the output
  so a reader can disagree with them explicitly rather than silently.
- **The gate is relative to the decision.** A 12pp range is `hold` for a 30%
  budget reallocation and effectively `act` for "should we keep this channel at
  all". Where the decision is known, state the range against the decision's
  threshold rather than against the generic bands.

---

## 4. Reading the two signatures that recur

### The create/harvest pair
One channel is high under first-touch and low under last-touch; another is the
exact mirror. Almost always: the first creates demand, the second harvests it.
**No allocation rule resolves this** — both readings are internally consistent.
The resolving evidence is a holdout on the harvest channel: if conversions hold
when it is paused, it was harvesting; if they fall, it was doing work.

### The volume-flattered channel
A channel's share is high under linear and unremarkable everywhere else. It is
accumulating credit through touch frequency, not influence. Check touches per
journey for that channel against the others; a channel with four times the touch
count and 1.1× the credit is being rewarded for its own send volume.

---

## 5. Three worked readouts

### (a) Models agree — act

> **Paid search is 31–34% of credit under all eight models, range 3pp, minimum
> pairwise tau 0.93.** It is the largest channel under every rule we can apply,
> so this ranking is not an artefact of the model choice. Credit is an
> allocation, not a count of people, and all models assign 100% of credit to
> touches we tracked.
>
> For sizing a budget increase, this is solid. For deciding *how much* more to
> spend, it is not — none of these models says anything about the next dollar;
> that needs the saturation curve in `budget-allocation` or a geo test.

### (b) Models disagree — test

> **Email carries between 11% and 27% of credit depending on the rule, a 16-point
> spread, and it ranks second under last-touch and sixth under first-touch.**
> That is not a measurement error; it is what a harvest channel looks like. Email
> is usually the last thing someone touches before converting, and last-touch
> models reward that heavily.
>
> Both readings are defensible and I will not pick one. The number that settles
> it: hold out email from a randomly selected slice for two weeks and compare
> conversion rates. On current volume that test can detect a change of about a
> fifth in the held-out group — see `experiment-design-readout` before running it.
>
> If a figure is needed for a slide today, the linear share of 20% is the middle
> of the range and is the least-wrong single number, with the range shown beside
> it.

### (c) Below the volume floor — one model, and say so

> **184 conversions last month, so only last-non-direct is reported: paid search
> 38%, email 24%, organic 18%, other 20%.** Below roughly 200 conversions the
> other models are not stable enough to compare — shifting two deals moves a
> channel by several points, so a spread table would show disagreement that is
> noise rather than structure.
>
> That does not make this number useless: the top channel is the top channel by a
> wide margin and that is robust. Treat the smaller channels as roughly equal
> rather than as a ranking. Three months pooled would support the full
> comparison, at the cost of mixing seasons.

---

## 6. What the spread table never claims

Closing negative list, carried on every readout:

- **Does not claim causality.** No holdout ran. These are credit allocations
  alongside conversions, not the conversions the channels caused.
- **Does not include untracked influence.** All models allocate 100% to observed
  touches, so offline, word-of-mouth and unconsented traffic have their
  contribution silently redistributed to the tracked channels.
- **Does not deduplicate people across platforms** — v1 is single-source by
  construction.
- **Credit is not people and not a rate.** Do not divide it by a population.
- **The model set is a choice**, and so are the 40/20/40 weights, the seven-day
  half-life and the act/hold/test thresholds. All four are printed in the output
  so they can be argued with.
