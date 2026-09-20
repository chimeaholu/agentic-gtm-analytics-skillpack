---
name: attribution-rule-based
description: Use when asked which channels or campaigns drove conversions, revenue or pipeline, or to compare first-touch, last-touch, last-non-direct, linear, time-decay, U-shaped, W-shaped or full-path attribution. Computes all applicable models over the same assembled journeys and reports the spread rather than a single answer, because the rule is an assertion, not a finding. Scoped in v1 to a single-source touchpoint stream and returns a typed unavailable for cross-platform journeys, naming identity resolution as the missing prerequisite. Use for heuristic credit allocation; for estimated models use `attribution-algorithmic`, and for causal truth use `incrementality-and-mmm`.
---

# Rule-Based Attribution

A rule-based attribution model is **an assertion about how credit should be
divided, not a finding about how demand was created.** Nothing in the data
chose 40/20/40. Nothing in the data chose a seven-day half-life. A human did,
and then the arithmetic ran.

So this skill does not pick a model. **It runs every model the data supports
over the same journeys and reports the spread.** Where the models agree, the
finding is robust enough to act on. Where they disagree, that channel's
contribution is genuinely unresolved, and the honest next step is an experiment,
not a different rule.

---

## 1. The v1 scope boundary, stated before anything is computed

**v1 runs on a single-source touchpoint stream only** — one platform's event or
campaign-influence data, where the journey was assembled inside that one
system's own identity resolution. Web analytics sessions for one property. One
CRM's campaign-influence records. One product-analytics project's events.

**Cross-platform journeys return `unavailable`.** Not a lower-quality number, not
a best-effort join on email address: a typed non-answer that names the missing
prerequisite.

```
status: unavailable
scope: cross_platform_journey
reason: >
  Touchpoints span 3 sources. Stitching them into one ordered journey requires
  a resolved identity spine — a deterministic or probabilistic mapping from each
  source's own ID to one person or account, with a measured match rate.
  Without it, ordering touches across sources is a guess, and every model below
  is arithmetic on a fiction.
missing_prerequisite: identity-resolution, then journey-assembler
what_is_available_now:
  - per-source rule-based attribution, run independently, each labelled with its
    own identity basis and its own coverage
  - the cross-source total under comparability-rules as an annotated total,
    with the overlap named as unquantified
resolving_change: >
  a person-level or account-level key present in all three sources, with a
  reported match rate; or a warehouse identity table joining them
```

Two things this refusal must never do, because both are the failure it exists to
prevent:

- **Never silently concatenate touches from several sources by timestamp.** Two
  sources' clocks, two timezone rules and two identity graphs produce a journey
  that looks ordered and is not.
- **Never fall back to matching on email address alone and call the journey
  assembled.** Report the match rate or do not make the claim.

The single-source case is not a toy. Most usable rule-based attribution in
production is single-source, and saying so is more useful than implying the
cross-platform version is one query away.

---

## 2. Prerequisites checked before any model runs

| # | Check | Fails when | Consequence |
|---|---|---|---|
| 1 | **One source** | touches carry more than one `source_system` | `unavailable`, §1 |
| 2 | **Ordered journeys** | touches lack a monotonic timestamp in one timezone | `unavailable` — ordering is the input to six of the eight models |
| 3 | **Lookback window declared** | no window stated | stop and declare one; an undeclared window is an undeclared model |
| 4 | **Conversion definition declared** | "conversions" unqualified | route to `gtm-metric-dictionary`; three event sets is three metrics |
| 5 | **Backfill present** | touch history starts at the window edge | first-touch is **catastrophically wrong**, §5 |
| 6 | **Volume floor** | < ~200 conversions in the period | last-non-direct only, §7 |
| 7 | **Milestones stamped** | no lead-creation / opportunity-creation timestamps | W-shaped and full-path are `not_applicable`, not approximated |
| 8 | **Direct classification rule stated** | unknown how Direct is assigned | last-non-direct is unauditable until it is, §5 |

A model that fails its prerequisite is reported as `not_applicable` **with the
reason**, and the remaining models still run. A missing milestone removes W-shaped
from the comparison; it does not stop the analysis.

---

## 3. The eight models, with their exact credit rules

Notation: a journey is an ordered list of touches `t₁ … tₙ` inside the lookback
window, ending at a conversion at time `T`. `age_i = T − time(t_i)`, in days.
Every model allocates exactly 1.0 of credit per conversion.

### 3.1 First touch
`credit(t₁) = 1.0`, everything else 0. The earliest touch **within the lookback
window** — which is not the same as the earliest touch that ever happened, and
the difference is the entire backfill problem.

### 3.2 Last touch
`credit(tₙ) = 1.0`, everything else 0.

### 3.3 Last non-direct click
Let `k = max{ i : channel(t_i) ≠ Direct }`. Then `credit(t_k) = 1.0`.

**If every touch is Direct, credit goes to Direct** — the model degrades to
last-touch, and the output must say how many journeys took that path. A silent
degradation here is how "Direct" quietly becomes the top channel.

### 3.4 Linear
`credit(t_i) = 1/n` for every touch.

### 3.5 Time decay
```
w_i      = 2 ^ ( − age_i / H )        H = half-life in days, default 7
credit_i = w_i / Σ_j w_j
```
A touch `H` days before conversion carries half the weight of a touch at the
moment of conversion; `2H` days, a quarter.

**`H = 7` is convention, not science.** There is no empirical derivation of it
for your business, and it changes the answer. This skill therefore **runs a
half-life sensitivity sweep by default** at `H ∈ {1, 3, 7, 14, 30}` days and
reports each channel's credit range across the sweep. If a channel's share moves
more than a few points across that sweep, time-decay is not evidence about that
channel — it is evidence about your choice of `H`.

### 3.6 U-shaped / position-based
Three cases, all of which must be defined explicitly, because the undefined ones
are where implementations silently disagree:

| n | Allocation |
|---|---|
| 1 | 100% to the single touch |
| 2 | 50% / 50% — **not 40/40 with 20% discarded.** Credit must sum to 1.0 |
| ≥3 | 40% to `t₁`, 40% to `tₙ`, and `20%/(n−2)` to each middle touch |

**40/20/40 has no evidence behind it over 30/40/30 or 35/30/35.** It is a
convention that became a default because one vendor shipped it.

### 3.7 W-shaped
Requires three stamped milestones: first touch, the touch at lead creation, the
touch at opportunity creation.

- 30% to `t₁`, 30% to the lead-creation touch, 30% to the opportunity-creation
  touch, and `10%/m` to each of the `m` remaining touches.
- If `m = 0`, redistribute the 10% equally across the three milestone touches
  (33.3% each) — and say that you did.
- **If one touch serves two milestones, its credits add** (a touch that is both
  first and lead-creating carries 60%). Do not de-duplicate to 30%; that leaks
  credit and breaks the 1.0 sum.
- If a milestone is unstamped, the model is `not_applicable` for that journey.
  **Never substitute the nearest touch** — that is inventing a milestone.

### 3.8 Full path / Z-shaped
W-shaped plus a fourth milestone at close: 22.5% each to first touch, lead
creation, opportunity creation and close, with `10%/m` to the remainder.

**Full-path makes recent periods structurally unattributable**, because the close
milestone lies in the future for every open opportunity. A full-path report for
last month is a report about the deals that closed unusually fast. Say so, and
report the share of the period's pipeline that is still open and therefore
absent.

---

## 4. What all eight share, taught before the individual flaws

1. **The rule is an assertion.** No parameter in any of the eight is estimated
   from your data. They are division schemes.
2. **None answers the counterfactual.** Not one of them can say what would have
   happened without the channel. That question belongs to
   `incrementality-and-mmm`, and nothing here substitutes for it.
3. **All eight allocate exactly 100% to observed touches.** So when the true
   driver was unobserved — word of mouth, a billboard, a podcast mention, a
   colleague's recommendation, the product simply being good — **its credit is
   not lost, it is redistributed to whatever was tracked.** Rule-based
   attribution cannot show a channel it cannot see, and it cannot show you that
   it is missing one.
4. **Fractional credit is not a count of people.** 0.4 of a conversion is an
   allocation, not a person. Sum at full precision and round only for display.
   State in the metric definition that the figure is credit, not conversions,
   and never divide it by a population to produce a "conversion rate".
5. **A monetary amount is never multiplied across touches.** A 12,000 deal with
   four touches contributes 12,000 of allocated revenue in total, split by the
   model's weights. If your channel revenue sums to more than your actual
   revenue, a join fan-out multiplied it — see `relationship-discovery`.

---

## 5. How each model specifically misleads

| Model | The specific failure |
|---|---|
| **First touch** | Wildly overcredits cheap top-of-funnel discovery, and **is catastrophically wrong when touch history is missing before the window**: the earliest *retained* touch is reported as the first touch, so whichever channel happens to sit at the retention boundary wins. Check history depth before trusting it. |
| **Last touch** | Overcredits the channels that **harvest** existing demand rather than create it — branded search, retargeting, email, Direct. Still the most common model in production and the most misleading one. |
| **Last non-direct** | Silently reassigns credit by a Direct-classification rule that almost nobody audits. Direct is a dumping ground for untagged email, dark social, app-to-web transitions and stripped referrers, so the reassignment is systematic, not random. |
| **Linear** | **Rewards touch volume.** A channel that fires many cheap impressions or many low-intent emails accumulates credit proportional to its own frequency, which is a budget decision, not a performance signal. |
| **Time decay** | The half-life is a free parameter that moves the answer and is essentially never justified. Structurally disadvantages long-lagged channels — content, SEO, brand — by construction rather than by evidence. |
| **U-shaped** | 40/20/40 is arbitrary, and the n=2 case is implemented inconsistently across tools, so two systems can report different U-shaped numbers from identical journeys. |
| **W-shaped** | Requires milestone data most orgs do not have cleanly, and **the day someone changes the lead-creation definition, the entire history changes** with no data change. Version the milestone definitions. |
| **Full path** | All of W-shaped, plus recent periods are unattributable because the close milestone has not happened. |

---

## 6. Run them side by side, then read the spread

This is the deliverable. Not a number — a table and a verdict.

```
                first  last   LNDC  linear  decay(7)  U    W    full   range
Paid search      31%    38%    36%    29%     34%    33%  30%   28%    10pp
Organic          24%     9%    11%    18%     14%    19%  22%   23%    15pp
Paid social      18%    12%    13%    17%     15%    16%  18%   19%     7pp
Email            11%    27%    26%    20%     24%    19%  16%   15%    16pp
Referral          9%     8%     8%     9%      8%     8%   9%   10%     2pp
Direct            7%     6%     6%     7%      5%     5%   5%    5%     2pp
```

**Range** is `max − min` of a channel's credit share across the applicable
models, in percentage points. The decision rule:

| Range | Rank stable? | Verdict | What it means |
|---|---|---|---|
| ≤ 5pp | yes | **act** | every defensible rule agrees; the finding survives the choice of model |
| 5–15pp | yes | **hold** | direction is stable, magnitude is not; do not size a budget move on it |
| > 15pp | either | **test** | the models disagree more than the decision needs them to agree; name the experiment |
| any | no | **test** | if the channel's *rank* flips between models, its contribution is unresolved regardless of range |

Rank stability: compute Kendall's tau between each pair of model rankings.
Report the minimum pairwise tau as the headline agreement figure — a pack that
reports the average hides exactly the disagreement it was built to surface.

In the table above, Paid search and Referral are **act**. Organic and Email are
**test**, and they are the same finding twice: Organic is first-touch-flattered
and last-touch-starved, Email is the mirror image. That is the classic
create-versus-harvest signature, and no rule resolves it. A holdout on the email
programme resolves it, and that is the recommendation.

---

## 7. Volume floors, stated as numbers

| Conversions in the period | What runs |
|---|---|
| **< 200** | **Last-non-direct only.** Nothing else is stable. Report the count and say that the spread analysis is unavailable at this volume, not that the channels agree |
| 200–1,000 | all eight where prerequisites hold, with credit rounded to whole percentage points and an explicit note that channel-level differences under ~5pp are noise |
| > 1,000 | all eight, plus `attribution-algorithmic` becomes worth running |

Per-channel floor as well: **a channel carrying fewer than ~30 credited
conversions gets a count, not a share.** A 4% share built on 7 conversions moves
several points when one deal lands differently.

---

## 8. The 2026 measurement environment, stated rather than papered over

This determines how much of the journey exists to attribute at all.

- **ATT opt-in runs roughly 15–25%**, so most iOS app traffic carries no
  cross-app identifier.
- **Pixel-only accounts lose roughly 30–40% of iOS Purchase signal.**
- **Paid social typically reports 40–60% modelled rather than observed
  conversions.** Those are vendor estimates, not observations, and they cannot
  be reproduced from raw events.
- **Server-side / CAPI recovers an estimated 15–25% of lost signal.**
- **Consent Mode v2 Advanced is the prerequisite** for Google's modelled
  conversions; without it, the gap is simply missing rather than modelled.

**Every percentage in that list is vendor- or practitioner-reported and varies
enormously by vertical, geography and implementation. Cite them as ranges and
never as constants.** The pack does not have your number; it has the shape.

The practical consequence, which is the honest headline: **user-level attribution
is no longer reliably available for the majority of traffic.** The defensible
posture is a triangulation stack —

| Layer | Question it answers | Skill |
|---|---|---|
| Rule-based MTA | directional, in-flight, "what does the tracked journey look like" | this skill |
| Algorithmic MTA | estimated rather than asserted allocation | `attribution-algorithmic` |
| MMM | how to allocate the whole budget, including untrackable media | `incrementality-and-mmm` |
| Incrementality | what the spend actually caused; calibrates the other three | `incrementality-and-mmm` |

---

## 9. Output

```
scope: single_source | unavailable
source_system, identity_basis, coverage: { journeys, conversions, touches }
window: { start, end, timezone, timezone_status, lookback_days, date_basis }
conversion_definition: { event_set, metric_version }
models_run[]:      name, applicable: true, assumptions{}
models_skipped[]:  name, reason                       # not_applicable, with cause
credit_table:      model × channel → { share, credit, revenue_allocated }
sensitivity:
  time_decay_half_life: { 1d, 3d, 7d, 14d, 30d } × channel → share
  direct_fallback_journeys: n                         # all-Direct journeys, §3.3
spread[]:          channel, min, max, range_pp, min_pairwise_tau, verdict
verdict_summary:   act[], hold[], test[]
recommended_experiment: for each channel in test[]
limitations[]:     backfill_depth, unobserved_channels, modelled_share, floors_hit
```

---

## 10. Answering

**Answer first.** Lead with what the models agree on, then the disagreement as a
finding in its own right.

> **Paid search carries 28–38% of conversion credit and is the largest channel
> under every model we can run — that one is safe to act on.** Email and organic
> are the open question: email ranges from 11% under first-touch to 27% under
> last-touch, and organic is the exact mirror. That spread is the signature of a
> harvest channel and a create channel, and no allocation rule can separate them —
> a two-week email holdout can, and would cost less than the reallocation being
> considered.
>
> All of these are credit allocations, not people, and all eight models assign
> 100% of credit to touches we tracked, so anything untracked — word of mouth,
> offline, the product itself — is silently redistributed across the channels
> above. For directional channel sizing this table is fine. For a budget move
> larger than the spread, it is not.

**Withhold only:** cross-platform journeys without identity resolution (§1), and
any individual model whose prerequisite failed (§2), which is reported as
`not_applicable` with its reason while the rest still run. **Never withhold the
spread table because the models disagree** — the disagreement is the finding.

---

## References

- `references/model-formulas.md` — the eight models as executable pseudocode, with every edge case (n=1, n=2, all-Direct, duplicate milestones, zero middles) resolved
- `references/spread-and-decision-rules.md` — the spread table, Kendall's tau, the act/hold/test gate, and three worked readouts

## Core contracts called

- **`answer-contract`** — every credit figure and the typed `unavailable` in §1
- **`provenance-block`** — source, window, timezone status and lookback on every table
- **`comparability-rules`** — mandatory before any cross-source total is quoted alongside this analysis
- **`warning-field-reader`** — sampling, thresholding and `(other)` rollup in the touchpoint source; a rolled-up channel dimension invalidates the credit table
- **`pagination-patterns`** — touchpoint extraction is the most common place a cap silently truncates a journey tail

## Related skills

- `journey-assembler` and `identity-resolution` are **hard prerequisites** for anything beyond single-source.
- `gtm-metric-dictionary` for the conversion and revenue definitions.
- `attribution-algorithmic` when path volume supports an estimated model.
- `incrementality-and-mmm` for the causal question none of these answer.
- `budget-allocation` consumes the spread table, not any single model's column.
