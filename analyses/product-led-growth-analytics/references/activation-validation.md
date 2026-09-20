# Validating an activation milestone

The output of this procedure is a milestone, its separation, its coverage, and
an explicit statement that the relationship is correlational. Anything less is
a guess with a dashboard.

---

## 1. Fix the frame first

| Decision | Options | Consequence |
|---|---|---|
| **Grain** | user / account | B2B activation at user grain rewards products with many seats per account, independent of value |
| **Qualification window** | 7 / 14 / 30 days from signup | part of the definition; a longer window raises coverage and weakens separation |
| **Outcome** | D30, D60, D90 retention; free-to-paid conversion | different outcomes select different winners; a milestone tuned to D30 may not predict paid conversion |
| **Cohort** | signup month | needs to be old enough that the outcome window has fully elapsed |

**All four go in the metric name.** `activation_d14_account_retained_d30_v2` is
ugly and unambiguous. `activation_rate` is neither.

---

## 2. The arithmetic

For each candidate milestone `m`:

```sql
with cohort as (
  select account_id, signup_ts
  from accounts
  where signup_ts between :cohort_start and :cohort_end
    and signup_ts < :now - interval '30 days'        -- outcome window elapsed
),
did as (
  select c.account_id,
         max(case when e.ts <= c.signup_ts + interval '14 days' then 1 else 0 end) as did_m
  from cohort c
  left join events e
    on e.account_id = c.account_id and e.event = :milestone
  group by 1
),
outcome as (
  select c.account_id,
         max(case when a.ts between c.signup_ts + interval '30 days'
                                and c.signup_ts + interval '37 days'
                  then 1 else 0 end) as retained_d30
  from cohort c
  left join activity a on a.account_id = c.account_id
  group by 1
)
select did_m,
       count(*)                      as n,
       avg(retained_d30)             as retention_rate
from did join outcome using (account_id)
group by 1;
```

From the two rows:

```
separation_pp = (rate_did − rate_did_not) × 100
lift          = rate_did / rate_did_not
coverage      = n_did / (n_did + n_did_not)
```

**Report the `n` on both sides.** A 60-point separation built on 14 accounts is
not a finding, and the decision rule is the same small-n discipline used
everywhere else in the pack.

---

## 3. The activity control — the step that is always skipped

**Any milestone requiring a return visit correlates with retention.** To know
whether a candidate carries real signal, compare it against a milestone that is
pure activity and nothing else.

```
control = "logged in at least twice in the first 7 days"
```

Then:

```
excess_separation = separation(candidate) − separation(control)
```

**A candidate that does not clearly beat the control is measuring activity, not
value.** Instrumenting it, building onboarding around it and reporting it as
activation will produce a metric that goes up when people visit more and tells
you nothing about whether the product worked.

This single check disqualifies more candidate milestones than every other
criterion combined.

---

## 4. Worked selection

Six candidates, one cohort, D30 retention as the outcome, 14-day qualification
window, account grain. Baseline retention across the cohort: 38%.

| Candidate | Coverage | Retention if did | if not | Separation | vs control | Verdict |
|---|---|---|---|---|---|---|
| Logged in ≥2× in week 1 **(control)** | 64% | 47% | 22% | 25pp | — | baseline for comparison |
| Completed profile | 81% | 41% | 26% | 15pp | **−10pp** | below control — measuring activity, and less of it |
| Connected a data source | 52% | 58% | 16% | 42pp | **+17pp** | strong, good coverage |
| Invited a teammate | 37% | 64% | 23% | 41pp | **+16pp** | strong, thinner coverage |
| **Connected a source AND invited a teammate** | 34% | 71% | 30% | 41pp | **+16pp** | strong; conjunction keeps separation at usable coverage |
| Reached 50 API calls | 6% | 89% | 35% | 54pp | +29pp | **describes power users, not activation** |

**Selected: "connected a data source and invited a teammate", 34% coverage,
41-point separation, 16 points above the activity control.**

Why not the 50-API-calls milestone with its 54-point separation? **6% coverage.**
It identifies accounts that were already succeeding; it cannot function as an
onboarding target because 94% of the base will never be measured by it. An
activation metric needs to describe a path most accounts could plausibly take.

Why the conjunction rather than "connected a data source" alone? Nearly identical
separation at slightly lower coverage, and it is more robust: the single-action
version is easier to satisfy incidentally, and the conjunction held its
separation more stably across the three cohorts tested (§5).

---

## 5. Stability across cohorts

Re-run on three separate signup cohorts, ideally spanning a quarter or more.

| Cohort | Coverage | Separation |
|---|---|---|
| Month 1 | 33% | 39pp |
| Month 2 | 34% | 41pp |
| Month 3 | 36% | 43pp |

A candidate whose separation swings by 20 points across adjacent cohorts is
fitting noise, or the product changed under it. **A drifting coverage figure is
also informative** — rising coverage with stable separation is onboarding
improving; rising coverage with falling separation means the milestone is
getting easier and is decaying as a signal.

---

## 6. What this never claims

- **Not causal.** Accounts that invite a teammate retain better. Inviting a
  teammate does not cause retention; the accounts that do it were more committed
  already. **The moment anyone builds an onboarding flow to push the milestone,
  that flow needs its own experiment** — the correlation gives no evidence about
  what the push will do.
- **Not stable across product changes.** Re-validate after any significant
  onboarding or packaging change. A milestone validated two years ago is a
  historical artefact.
- **Not transferable.** Another company's activation milestone tells you nothing
  about yours, and a benchmark activation rate is comparing two different
  definitions.
- **Not a target to compensate on** until the causal question is settled.
  Milestones that are easy to satisfy get satisfied — see Goodhart — and the
  separation disappears within two quarters.
