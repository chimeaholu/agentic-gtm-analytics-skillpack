---
name: demographic-fit-scoring
description: Use when building or reviewing a fit or ICP score — firmographic, technographic and role-based scoring of leads or accounts against the ideal customer profile. Derives the fit criteria from closed-won and closed-lost evidence rather than from a workshop opinion, keeps fit separate from behaviour so the two can be read independently, and handles the enrichment data-quality reality that firmographic coverage is partial and biased. Prevents an ICP score that encodes who the team likes rather than who actually buys.
---

# Demographic Fit Scoring

Fit is "who they are". It changes slowly, it is knowable before any engagement,
and it is the half of lead scoring that gets built in a workshop rather than
from data.

**The single most common defect: an ICP derived from opinion and then presented
as evidence.** The second most common: a missing firmographic scored as a low
one, which silently penalises exactly the segments an enrichment vendor covers
badly.

---

## 1. Derive fit from outcomes, then compare to the stated ICP

Build the evidence version first, then put it next to the stated ICP and **report
the disagreements** — the gap is the finding.

```sql
-- win rate by firmographic attribute, with volume and interval inputs
select employee_band,
       count(*)                                          as opportunities,
       count(*) filter (where is_won)                    as wins,
       avg(is_won::int)                                  as win_rate,
       avg(amount_home_currency) filter (where is_won)   as mean_won_amount,
       avg(days_to_close) filter (where is_won)          as mean_cycle_days
from   opportunities
where  created_at between :start and :end
  and  stage in ('closed_won', 'closed_lost')
group by 1
having count(*) >= 30                                    -- volume floor
order by win_rate desc;
```

**Four rules that make this honest:**

1. **Include closed-lost.** A "what do our customers look like" query over
   closed-won only describes who you sold to, not who buys. It cannot
   distinguish "we win here" from "we try here".
2. **Volume floor per level.** A band with 6 opportunities and 4 wins is not a
   67% win rate; it is noise. Set a floor (30 is a reasonable default), and report
   levels below it as **insufficient evidence** rather than dropping them
   silently — a level with no data is not a level with a bad rate.
3. **Confidence intervals on every rate.** `p ± 1.96·sqrt(p(1−p)/n)`. Two bands
   at 22% and 27% on n=40 each are the same band.
4. **Win rate is not the only outcome.** An attribute with a high win rate and
   terrible retention, tiny deals, or a nine-month cycle is not a good fit.
   Score against **win rate, deal size, cycle length and 12-month retention**,
   and say which you weighted.

### The disagreement report — the deliverable

| Attribute | Stated ICP | Evidence | Verdict |
|---|---|---|---|
| Company size | 1,000+ employees | 200–500 wins at 2.4× the rate, n=180 | **Stated ICP disagrees with the data** |
| Industry | Manufacturing | Services wins more often and retains better | **Disagrees** |
| Region | North America | Matches | Confirmed |
| Job title | VP+ only | Director-level sourced deals close at the same rate | Disagrees, weakly (n=52) |

**Where the data says mid-market services and the stated ICP says enterprise
manufacturing, that gap is the finding** — not something to be reconciled away.
Report both, name which is evidence and which is intent, and let the business
decide. Sometimes the stated ICP is a deliberate strategy the history has not
caught up with; say that possibility out loud rather than assuming the data wins.

### Multivariate, once the univariate view is understood

Single-attribute rates confound: a size band may look good because it correlates
with a strong region. A regularised logistic regression on the firmographics
alone, or a shallow decision tree, gives the joint view — and the tree's rules
are directly usable as scoring criteria.

**Keep the univariate table anyway.** It is what people will argue with, and the
argument is productive.

---

## 2. Fit and behaviour are separate axes, always

**Never collapse them into one number.**

|  | **Low behaviour** | **High behaviour** |
|---|---|---|
| **High fit** | **Target** — right company, not engaged. Outbound works here | **Prioritise** — the best leads in the database |
| **Low fit** | **Ignore** — cheap to say no to | **Investigate** — either the ICP is wrong or this is a bad-fit deal that will churn |

A single blended score makes the two diagonal cells identical, and they demand
opposite actions: a high-fit unengaged account is an outbound target; a low-fit
highly-engaged account is a disqualification conversation or a signal the ICP
needs revisiting.

**The A1–D4 grid is the standard rendering**: a fit letter (A–D) and a behaviour
number (1–4), so "A1" reads as best-of-both and "D1" as a highly engaged bad fit.
Sales acts on the two components differently, so they stay visible even when a
combined model is used downstream.

`behavioural-activity-scoring` owns the other axis. `ml-lead-scoring` may combine
them in a model — and **must still surface both components**.

---

## 3. Enrichment coverage is partial and biased

**A missing firmographic is missing. It is not a low score.**

Scoring a null as zero silently penalises:

| Under-covered | Why |
|---|---|
| **Small companies** | Below vendor thresholds; no filings; no press |
| **Non-US companies** | Registry coverage varies enormously by country |
| **Privately held companies** | No public financials; revenue is modelled, not reported |
| **Recently founded companies** | Not yet in the data |
| **Non-English-language markets** | Web-scrape coverage is worse |

These are exactly the segments that may be growing, so **zero-scoring the missing
is a systematic bias against your next market.**

### Report coverage per attribute, always

```sql
select 'employee_count' as attribute,
       avg((employee_count is not null)::int)  as coverage,
       avg((employee_count is not null)::int) filter (where country = 'US')
                                               as coverage_us,
       avg((employee_count is not null)::int) filter (where country <> 'US')
                                               as coverage_non_us
from   accounts
union all
select 'industry', avg((industry is not null)::int),
       avg((industry is not null)::int) filter (where country = 'US'),
       avg((industry is not null)::int) filter (where country <> 'US')
from   accounts;
```

**A coverage difference between segments is itself a finding**, and it belongs in
the output next to the grade distribution.

### Handling the missing, in order of preference

1. **Score on what is present, and normalise.** If 3 of 5 attributes are known,
   score those and express the result as a proportion of the achievable maximum.
   The grade then reflects fit, not coverage.
2. **Carry an explicit confidence flag.** `fit_grade: B, confidence: low (2 of 5
   attributes known)`. Sales treats a low-confidence B differently from a
   high-confidence B, and correctly.
3. **Route to enrichment** for high-value unknowns rather than scoring them down.
4. **Never impute a firmographic with the mean.** That assigns mid-market status
   to every uncovered company and makes the bias invisible.

**The direction of error, stated in the output:** without coverage handling, fit
scores understate for small, non-US and private companies. That sentence belongs
in every fit-score deliverable.

---

## 4. Providers disagree, and joining them unnormalised produces contradictions

Employee count, revenue and industry come from different providers with different
definitions:

| Attribute | Where they differ |
|---|---|
| **Employee count** | Legal entity vs group vs "employees on the professional network". Can differ by an order of magnitude for a multinational |
| **Revenue** | Reported vs modelled vs estimated-from-headcount. For private companies it is almost always modelled |
| **Industry** | Standard classification codes vs vendor taxonomies of wildly different granularity. A vendor's 27 categories do not map cleanly onto a 4-digit standard code |
| **Country** | Registered vs HQ vs billing vs the contact's country — four different fields that are often all called "country" |
| **Technographics** | Detection method differs; a tag in the page source is not the same as a purchased licence |

**Joining without normalising produces conflicting grades for the same account**,
and the conflict surfaces as a sales rep saying the score is wrong — which they
are right about.

**Rules:**

- **One provider per attribute per model**, or an explicit **priority order** with
  the winning provider recorded as its own field.
- **Normalise to bands, not values.** "200–500 employees" survives a provider
  disagreement that "347 employees" does not.
- **Map industries to one taxonomy** and version the mapping. It is a business
  artefact and it will be argued with.
- **Record the provider and the observation date on every enriched attribute**,
  so a conflict can be diagnosed instead of debated.

---

## 5. Technographic signals decay

A detected technology may have been removed months ago. Detection is a
point-in-time observation, and the observation date matters as much as the value.

- **State the observation date** wherever a technographic signal is used.
- **Apply a decay** or a staleness cut-off — a detection older than roughly two
  quarters is weak evidence. Make the half-life explicit and sensitivity-test it.
- **Absence of detection is not absence of the technology.** Detection methods
  miss server-side and internally-hosted tools entirely. "Not detected" and "not
  present" are different states — the same distinction `answer-contract` draws
  between missing and observed zero.
- **Beware the tautology:** detecting a competitor's product predicts that they
  are a prospect *and* that they are hard to win. Which one dominates is a
  question for the outcome data, not for intuition.

---

## 6. Grade distribution is checked against capacity

**A model that grades 60% of the database A is not a filter.**

```sql
select fit_grade, count(*) as n,
       count(*)::float / sum(count(*)) over () as share,
       avg(is_won::int) filter (where stage in ('closed_won','closed_lost')) as win_rate
from   scored_accounts group by 1 order by 1;
```

Two checks:

1. **Does the distribution match capacity?** If A-grade volume exceeds what the
   team can work, the grade is not doing its job and the cut points need
   tightening — see `segmentation-model-support` §1.
2. **Do the grades separate outcomes?** A-grade win rate must materially exceed
   B, with non-overlapping intervals. If it does not, the grades are a label, not
   a filter, and `scoring-model-evaluation` is the skill that proves it.

**Grade inflation is the drift to watch.** A distribution shifting towards A over
time without a corresponding win-rate shift means the criteria have loosened or
the population changed — a definition problem, not an improvement in lead
quality.

---

## 7. Criteria are versioned

Fit criteria change: a new segment, a pricing change, a product launch, a
strategy shift. Every change is a version.

```yaml
fit_criteria:
  version: "fit-v4"
  effective_from: "2026-09-01"
  attributes:
    - {name: employee_band, weight: 0.30, evidence: "win rate 2.4x in 200-500, n=180",
       provider: <provider A>, coverage: 0.81}
    - {name: industry_norm, weight: 0.25, evidence: "services retains at 0.89 vs 0.71",
       provider: <provider B>, taxonomy_version: "tax-v2", coverage: 0.74}
    - {name: tech_detected_x, weight: 0.15, evidence: "1.9x win rate, n=64",
       decay_half_life_days: 180, coverage: 0.42}
  missing_handling: "score on present attributes, normalise, carry a confidence flag"
  grade_cuts: {A: 0.75, B: 0.55, C: 0.35}
  capacity_check: "A-grade volume 190/week vs capacity 200"
  supersedes: "fit-v3"
```

**A trendline crossing a criteria change is not a trend.** Mark it, and
`comparability-rules` forbids comparing grade distributions across the seam
without saying so.

---

## 8. Output

```yaml
evidence:
  window, opportunities, wins, losses
  by_attribute: [{attribute, level, n, win_rate, ci, mean_amount, cycle_days,
                  retention_12m, below_volume_floor: bool}]
  multivariate: {method, top_criteria, note_on_confounding}
stated_icp:
  source: "<where it came from>"
  attributes: {...}
disagreements:
  - {attribute, stated, evidence, n, verdict, possible_strategic_intent: bool}
coverage:
  by_attribute: {attribute: {overall, by_segment}}
  bias_statement: "understates for small, non-US and privately held companies"
  providers: [{attribute, provider, observation_date_available: bool}]
  conflicts_detected: [...]
model:
  version, weights, derivation, missing_handling, decay_rules
grades:
  distribution: [{grade, n, share, win_rate, ci}]
  separation: {a_vs_b_significant: bool, interval_overlap: bool}
  capacity_check: {a_volume, capacity, verdict}
  inflation_check: {distribution_trend, win_rate_trend, verdict}
axis_separation:
  fit_and_behaviour_separate: true
  grid: "<A1-D4 or equivalent>"
```

---

## 9. Answering

**Answer first: the grade, the evidence, and the disagreement.**

> **Your evidence-derived ICP is mid-market services, not enterprise
> manufacturing — and the gap is large enough to be the main finding.**
>
> On 1,840 closed opportunities over 24 months: the 200–500 employee band wins at
> 31% (n=180, 95% CI 24–38%) against 13% for 1,000+ (n=412, CI 10–16%). The
> intervals do not overlap. Services accounts also retain better at 12 months
> (0.89 vs 0.71). Deal sizes in the enterprise band are larger, so if the
> strategy is deliberately enterprise, the trade is real — but it is a trade, and
> it should be an explicit one.
>
> **Two caveats, one sentence each.** Firmographic coverage is 81% overall but
> only 58% outside the US, so **fit scores understate for non-US accounts** —
> they are scored on fewer known attributes, and I have normalised for that and
> attached a confidence flag rather than scoring the gaps as zero. And employee
> counts come from two providers with different entity definitions; I used one
> throughout and banded the values, which removes most of the conflict.
>
> **On the current grades:** 47% of the database is graded A, against a team
> capacity of about 200 accounts a week. That is not a filter. Tightening the A
> cut to the top 200 by fit score is in the output, and the A/B win-rate
> separation at that cut is 2.6× rather than the current 1.3×.
>
> **Fit stays on its own axis.** A high-fit account with no engagement is an
> outbound target; a low-fit account working hard is a disqualification
> conversation. A blended number makes those identical, so they are reported as a
> grid.
>
> Does not claim causality: these attributes predict wins in your history; they
> do not cause them, and a segment you have never sold into cannot appear here at
> all.

**Withhold only** what cannot be computed: a win rate for a level below the
volume floor (give the count and say the evidence is insufficient), a fit grade
for an account with no known attributes (say `unavailable`, and route to
enrichment), and a coverage-corrected comparison where coverage is unknown. Never
withhold the grade distribution or the disagreement report.

---

## Calls

- `answer-contract` — every win rate, grade and disagreement; `unavailable` where
  no attributes are known
- `provenance-block` — provider, observation date, taxonomy version and criteria
  version on every enriched attribute; currency on deal amounts
- `comparability-rules` — before comparing grades across criteria versions,
  providers or periods; provider differences make two grades incomparable
- `warning-field-reader` — enrichment coverage and extract caveats surface as
  coverage numbers, not as silent gaps

## References

- `references/evidence-derivation.md` — the win-rate analysis with volume floors
  and intervals, multivariate derivation, and the disagreement report
- `references/enrichment-reality.md` — coverage bias, provider normalisation,
  technographic decay and the missing-data handling rules

## Related skills

- `behavioural-activity-scoring` — the other axis; never collapsed into this one
- `ml-lead-scoring` — combines both axes in a model, and must still surface them
  separately
- `scoring-model-evaluation` — proves whether the grades actually separate
- `win-loss-analysis` — the outcome evidence this scoring is derived from
- `account-based-analytics` — account-level fit in an ABM motion
- `identity-resolution` — contact-to-account linkage, without which account-level
  fit cannot be applied to a lead
