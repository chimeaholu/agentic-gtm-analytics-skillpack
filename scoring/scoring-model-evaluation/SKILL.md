---
name: scoring-model-evaluation
description: Use when evaluating any lead, account or health score — rule-based or predictive, in-house or vendor — including when sales says the leads are bad or marketing says sales is not working them. Measures whether the score actually separates outcomes, whether the tiers have meaningfully different conversion rates, whether score movement precedes outcomes, and whether the scored records are being acted on differently at all. Prevents a scoring debate conducted entirely on opinion when the data can settle it in an afternoon.
---

# Scoring Model Evaluation

The marketing-versus-sales scoring argument is one of the most durable disputes in
GTM, and it is almost always conducted on opinion. **The data settles it in an
afternoon**, and the analysis that settles it is not the one people reach for.

Four tests, in order. **The fourth is the one nobody runs and it is the one that
usually decides the answer.**

1. Does the score separate outcomes?
2. Do the tiers differ from each other?
3. Does score movement *precede* the outcome, or follow it?
4. **Are high-scored records actually worked differently?**

---

## 1. Conversion lift by tier, with confidence

The primary test.

```sql
select score_tier,
       count(*)                                                 as n,
       count(*) filter (where converted)                        as conversions,
       avg(converted::int)                                      as conv_rate,
       1.96 * sqrt(avg(converted::int) * (1 - avg(converted::int))
                   / nullif(count(*), 0))                       as ci_halfwidth,
       avg(converted::int)
         / nullif((select avg(converted::int) from scored_cohort), 0) as lift
from   scored_cohort
where  scored_at between :start and :end
group by 1
order by 1;
```

**Rules that make it honest:**

- **Cohort by scoring date, not by outcome date.** Scoring records that have
  already converted measures the past, not the score.
- **Allow the full outcome horizon to elapse.** Records scored last week cannot
  have converted in a 90-day window. Cohort on resolved records only, and report
  how many were excluded as unresolved.
- **Confidence interval on every tier.** `p ± 1.96·sqrt(p(1−p)/n)`.
- **If tier A and tier B do not differ significantly, the tiers are a label, not
  a filter.** Say it in those words.

### The monotonicity check

```
A: 12.4% (CI 10.1–14.7, n=780)
B:  8.1% (CI  6.9– 9.3, n=1,940)
C:  6.9% (CI  5.8– 8.0, n=2,210)   ← B and C overlap
D:  2.1% (CI  1.6– 2.6, n=3,100)
```

**A non-monotone tier ladder is a defect.** If C converts better than B, either
the cut points are wrong or the score is not ordering records. Here B and C
overlap, which means **four tiers are doing the work of three** — merging them
loses nothing and makes the system more honest.

---

## 2. Separation, not accuracy

**A score's job is to sort.** Measure it as such.

| Measure | Definition | Use |
|---|---|---|
| **Top-decile lift** | `precision@10% / base_rate` | **The business-facing number** |
| **Lift at list length** | `precision@k / base_rate`, k = capacity | The operationally relevant one |
| Gini / ROC-AUC | Ranking quality across all cuts | Comparing scores; never the headline |
| **Cumulative gains** | Share of conversions captured in the top k% | **The chart executives understand** |
| **Accuracy** | — | **Rejected.** On a 4% base rate, "no" scores 96% |

```
top-decile lift = (conversions in top decile / records in top decile) / overall rate
```

**Report lift with its interval.** A decile holding 31 positives gives roughly
±18% relative precision, so "3.1×" is really "3.1 (2.5–3.7)" — and that changes
what a reasonable person concludes.

**The cumulative gains sentence is the one that lands:** *"the top 20% of scored
leads contains 54% of the conversions"*. It is the same information as lift,
stated in a form a revenue leader acts on.

---

## 3. Lead time: does the score move before the outcome?

**A score that rises only after the opportunity is created is a lagging
confirmation, not a prioritisation tool.** It will look excellent in every
retrospective analysis and be useless for deciding who to call this morning.

```sql
-- interval between the score crossing the tier threshold and the outcome
select percentile_cont(0.25) within group (order by lead_days) as p25,
       percentile_cont(0.50) within group (order by lead_days) as median,
       percentile_cont(0.75) within group (order by lead_days) as p75,
       avg((lead_days <= 0)::int)                              as share_at_or_after
from  (select s.person_id,
              date_diff('day', min(s.crossed_at), o.outcome_at) as lead_days
       from   score_threshold_crossings s
       join   outcomes o using (person_id)
       where  o.converted
       group by 1, o.outcome_at) x;
```

| Median lead time | Reading |
|---|---|
| Weeks before the outcome | **Genuinely predictive.** Prioritisation works |
| Days before | Useful for timing, marginal for prioritisation |
| **At or after the outcome** | **Lagging.** The score is confirming what already happened |

**`share_at_or_after` is the diagnostic number.** If 40% of conversions had their
score crossing on or after the outcome date, the score is substantially recording
rather than predicting — usually because a scored action (a demo request, a
pricing enquiry) is part of the conversion process.

**Fix:** find the actions with near-zero lead time, and either remove them from
the score or split the score into an early-intent component and a
late-confirmation component. The early one is the prioritisation tool.

---

## 4. Action coverage — the analysis that settles the argument

**If tier A leads are not worked faster or more thoroughly than tier C, the
score's poor performance may be an adoption failure rather than a model failure.
Almost nobody runs this.**

```sql
select s.score_tier,
       count(*)                                                  as leads,
       avg((a.first_touch_at is not null)::int)                   as touched_rate,
       percentile_cont(0.5) within group (
         order by date_diff('hour', s.scored_at, a.first_touch_at)
       ) filter (where a.first_touch_at is not null)              as median_hours_to_touch,
       avg(a.touch_count)                                         as mean_touches,
       avg((a.touch_count >= 3)::int)                             as worked_properly_rate
from   scored_cohort s
left join activity_rollup a using (person_id)
group by 1 order by 1;
```

### The four diagnoses

| Tier A touched rate | Tier A conversion vs C | Diagnosis |
|---|---|---|
| High (>80%) | Materially higher | **The score works and is used.** Nothing to fix |
| **Low (<50%)** | Similar to C | **Adoption failure.** The score is untested — nobody worked the list |
| High | Similar to C | **Model failure.** The list was worked and did not convert better |
| Low | **Higher anyway** | **The score works and is under-used.** The largest available win in the whole analysis |

**That table is the answer to the marketing-versus-sales argument**, and it costs
one query. The fourth row in particular — a score that works despite being
ignored — is common and is the cheapest revenue available, because the fix is
process, not modelling.

**Also check consistency:** if touch rate varies by rep or region far more than
by tier, the routing or the rep behaviour dominates the score, and no amount of
model improvement will change the outcome.

---

## 5. The self-fulfilling prophecy

**High-scoring leads get worked harder, so they convert better partly because of
the score.** Some of every measured lift is the follow-up, not the lead.

**State it, always.** Then bound it where possible:

| Route | What it gives |
|---|---|
| **Randomised holdout** — a share of high-scoring leads deliberately not prioritised | The clean answer. Route to `experiment-design-readout` |
| **Natural experiment** — capacity gaps, vacations, territory transitions where high scorers went unworked | Quasi-experimental evidence. Look for it; it usually exists in the data |
| **Condition on action** — compare conversion within equally-worked records across tiers | Removes the effort difference, though confounded by *why* those records were worked |
| **Threshold discontinuity** — records just above and below the routing cut | A local estimate with real credibility, where a hard rule exists |

**The conditioned comparison, which is cheap and usually available:**

```sql
select score_tier,
       count(*)                     as n,
       avg(converted::int)          as conv_rate
from   scored_cohort
where  touch_count between 3 and 5        -- comparable effort
group by 1 order by 1;
```

If tiers still separate within an equally-worked population, **the score is
carrying real signal beyond the effort** — that is a meaningful finding and it is
achievable without an experiment.

---

## 6. Score-version awareness

**Comparing performance across a scoring-rule change compares two different
models.** The score is a different quantity on each side of the seam.

```sql
select v.version,
       min(s.scored_at) as from_date,
       max(s.scored_at) as to_date,
       count(*)         as scored,
       avg(s.score)     as mean_score,
       avg(o.converted::int) as conv_rate
from   scored_cohort s
join   score_versions v on s.scored_at between v.effective_from
                                           and coalesce(v.effective_to, current_date)
left join outcomes o using (person_id)
group by 1 order by 2;
```

- **Mark the change on every trendline** that crosses it.
- **Evaluate within a version**, or re-score the earlier period under the current
  rules and say that you did.
- Threshold changes are version changes. So are new actions, changed weights and
  a new decay half-life.

`comparability-rules` forbids the cross-version comparison without disclosure;
this skill is where the disclosure gets produced.

---

## 7. Distribution drift is a finding in itself

**A score distribution shifting right without a corresponding outcome shift is
inflation.**

```sql
select date_trunc('month', scored_at)                          as month,
       count(*)                                                as scored,
       avg(score)                                              as mean_score,
       avg((score >= :threshold)::int)                         as above_threshold_rate,
       avg(converted::int)                                     as conv_rate,
       avg(converted::int) filter (where score >= :threshold)  as converted_above
from   scored_cohort group by 1 order by 1;
```

| Distribution | `converted_above` | Verdict |
|---|---|---|
| Rising | Rising | Genuine improvement |
| **Rising** | **Flat or falling** | **Inflation — a definition problem** |
| Flat | Rising | The score is not capturing the improvement; criteria may be stale |
| Sharp single-month move | Any | **Check for a rules, tracking or integration change first** |

**`converted_above` is the number that matters** — more leads crossing the line
while the leads above the line convert worse is the definition of a loosened
threshold. `behavioural-activity-scoring` §5 owns the fix; this skill owns the
detection.

---

## 8. Output

```yaml
cohort:
  window, scored_records, resolved, unresolved_excluded, outcome_horizon_days
  score_versions_in_window: [...]
separation:
  by_tier: [{tier, n, conversions, conv_rate, ci, lift}]
  monotonic: bool
  tiers_that_do_not_differ: [[B, C]]
  top_decile_lift: {value, ci, positives_in_decile}
  lift_at_capacity: {value, ci, k}
  cumulative_gains: [{top_pct, share_of_conversions}]
  gini: <v>
  accuracy_reported: false
lead_time:
  median_days, p25, p75
  share_at_or_after_outcome: <v>
  verdict: predictive | timing_only | lagging
  actions_with_zero_lead_time: [...]
action_coverage:
  by_tier: [{tier, touched_rate, median_hours_to_touch, mean_touches,
             worked_properly_rate}]
  diagnosis: score_works_and_used | adoption_failure | model_failure
             | works_but_underused
  variation_by_rep_vs_by_tier: "<which dominates>"
self_fulfilling:
  stated: true
  bounded_by: none | conditioned_on_action | natural_experiment
               | threshold_discontinuity | randomised_holdout
  conditioned_result: [{tier, n, conv_rate}]
drift:
  distribution_trend, converted_above_trend, verdict
recommendation:
  primary: "<one specific action>"
  evidence: "<the number behind it>"
  secondary: [...]
```

---

## 9. Answering

**Answer first: whose problem it is, with the number that proves it.**

> **The score works. Nobody is working the list. That is the whole finding.**
>
> Tier A converts at 12.4% against tier D's 2.1% — a 3.1× top-decile lift
> (2.5–3.7 on 31 positives in the decile), and the top 20% of leads contains 54%
> of all conversions. That is a functioning score.
>
> **But only 41% of tier A leads are ever touched**, against 38% of tier C. There
> is no meaningful difference in how the tiers are worked: median time to first
> touch is 31 hours for A and 34 for C. **The score is not failing; it is not
> being used.** And tier A converts better anyway, despite being worked no harder
> — which is the strongest version of this result and the cheapest revenue
> available here.
>
> **Two things the data also says.** Tiers B and C do not differ significantly
> (8.1% vs 6.9%, overlapping intervals) — four tiers are doing the work of three,
> and merging them would make the system more honest. And median lead time is 19
> days, so the score genuinely precedes the outcome rather than confirming it;
> 11% of conversions had their crossing on or after the outcome date, which is
> low enough not to worry about.
>
> **One caveat, in one sentence:** high-scoring leads generally do get worked
> harder in most organisations, so some measured lift is follow-up rather than
> lead quality — here that effect is unusually small precisely because the tiers
> are worked about equally, which makes this lift more credible than it would
> normally be.
>
> **The recommendation is routing, not modelling.** Route tier A to a guaranteed
> touch within 24 hours, merge B and C, and re-measure in one full outcome
> horizon. Rebuilding the model would be work on the half of this that is not
> broken.

**Withhold only** what cannot be computed: a tier conversion rate where the tier
has too few resolved records (give the count and the detectable difference), a
causal claim about the score's effect with no holdout or natural experiment (give
the conditioned-on-action comparison and name what would settle it), and a
cross-version comparison where the versions cannot be separated. Never withhold
the lift table or the action-coverage diagnosis.

---

## Calls

- `answer-contract` — every rate, lift, interval and diagnosis
- `provenance-block` — score version, scoring window, outcome window, timezone
- `comparability-rules` — **before any comparison crossing a score-version
  boundary**, a tier redefinition or an unequal list length
- `warning-field-reader` — activity-capture caveats materially affect the
  action-coverage analysis; incomplete logging looks like leads not being worked

## References

- `references/separation-tests.md` — lift, gains, monotonicity, intervals and the
  statistical tests with multiple-comparison handling
- `references/action-coverage.md` — the coverage analysis, the four diagnoses,
  and the self-fulfilling-prophecy bounds

## Related skills

- `demographic-fit-scoring`, `behavioural-activity-scoring` — the rule-based
  scores this evaluates, and where the fixes are applied
- `ml-lead-scoring` — the predictive score, including vendor scores
- `churn-prediction-models` — health scores, which are rules being used as
  predictions and get this same treatment
- `model-evaluation-monitoring` — the ongoing monitoring this feeds
- `sales-activity-analytics` — the activity data behind action coverage, with the
  same capture caveats
- `experiment-design-readout` — the randomised holdout that settles the
  self-fulfilling-prophecy question
- `funnel-conversion-analysis` — where a scoring problem often surfaces first
