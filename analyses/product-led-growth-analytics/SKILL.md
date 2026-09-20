---
name: product-led-growth-analytics
description: Use for product-led growth analysis — signup-to-activation, time-to-value, feature adoption, usage-based expansion signals, free-to-paid conversion, or connecting product behaviour to revenue outcomes. Defines activation as a measurable milestone tied to retention evidence rather than a guess, handles the identity bridge between anonymous product users and CRM records, and separates usage from value. Prevents an activation metric chosen because it was easy to instrument rather than because it predicts retention.
---

# Product-Led Growth Analytics

Most PLG reporting fails in the same place: **the activation metric was chosen
because someone could instrument it in an afternoon**, and every number
downstream inherits that choice. This skill makes the choice evidence-based, and
is explicit that the evidence is correlational.

The second failure is quieter. Product analytics resolves identity its own way,
your warehouse resolves it another way, and **the two do not match.** Every
product-to-revenue number depends on a join whose match rate is almost never
reported.

---

## 1. Activation is defined by evidence, not convenience

### The procedure

1. **Enumerate candidate milestones.** Real actions, at the grain the business
   cares about (account, not user, for B2B). "Invited a teammate", "connected a
   data source", "created three projects", "sent a first campaign".
2. **Fix a qualification window** — did the account do this within N days of
   signup? 7 or 14 is typical. The window is part of the definition.
3. **Fix an outcome** — retained at day 30, 60 or 90, or converted to paid. State
   which; they give different winners.
4. **For each candidate, compute the separation:**

```
retention_rate(did milestone)  vs  retention_rate(did not)
lift        = rate_did / rate_did_not
separation  = rate_did − rate_did_not          (percentage points)
coverage    = share of signups that did the milestone
```

5. **Pick on separation AND coverage together.** A milestone with enormous
   separation reached by 3% of signups is not an activation metric — it is a
   description of your power users. A useful activation milestone is typically
   reached by a substantial minority and separates strongly.
6. **Check it is not a restatement of "was active".** Any milestone correlates
   with retention if it requires returning to the product. **Test the candidate
   against a pure-activity control** — for example "logged in twice in week one".
   If the candidate does not beat that control, it is measuring activity, not
   value.
7. **Check stability over cohorts.** Re-run on three separate signup cohorts. A
   milestone whose separation swings wildly is fitting noise.

### The caveat that ships with it, every time

**The relationship is correlational.** Accounts that invite a teammate retain
better; that does not mean prompting accounts to invite a teammate causes
retention. The people who invite teammates were more committed to begin with.

**This matters the moment someone builds an onboarding flow to push the
milestone**, which is always the next step. Say it before they do, and name the
resolving evidence: an experiment on the onboarding change, run through
`experiment-design-readout`. A milestone is a **proxy and a leading indicator**,
not a lever, until a test says otherwise.

---

## 2. Time to value uses median and p90

**Never the mean.** Every GTM duration distribution is right-skewed, and a
handful of accounts that activated after 90 days will drag the mean past the
point of meaning anything.

```
TTV_p50 = median days from signup to milestone, among accounts that reached it
TTV_p90 = 90th percentile
```

Three requirements:

- **Report the share that never reached the milestone**, separately. Excluding
  them and reporting "median time to value: 4 days" describes the successful
  minority and reads as though it describes everyone.
- **Censor honestly.** Accounts that signed up 10 days ago cannot have a 30-day
  time to value. Restrict the cohort to those with a full observation window, or
  report a Kaplan-Meier style curve that handles censoring properly.
- **Segment before comparing.** Self-serve and sales-assisted accounts have
  different TTV distributions by construction, and a blended median moves with
  the mix rather than with the product.

---

## 3. Feature adoption needs a declared denominator

Three defensible denominators, wildly different numbers, routinely quoted
interchangeably.

| Denominator | Adoption means | Use when |
|---|---|---|
| **All accounts** | share of the whole base using it | sizing the feature's overall footprint |
| **Accounts on a plan that includes it** | share of those who *can* use it | judging the feature itself |
| **Accounts who reached the surface** | share who used it once they saw it | judging discoverability versus the feature |

The same feature can be at 8%, 34% and 71% under the three. **A number without
its denominator is not an adoption rate**, and an adoption trend that crosses a
packaging change has silently changed denominators mid-series.

Two further traps:

- **Adoption is not usage depth.** "Used once, ever" and "uses weekly" are
  different metrics. Declare which, and prefer a recency-bounded definition
  ("used in the last 30 days") for anything presented as current.
- **Per-user versus per-account adoption.** In B2B, one admin using a feature
  makes the account an adopter under one definition and 3% adopted under the
  other. Pick the grain the decision needs.

---

## 4. The identity bridge is the structural problem

Product analytics resolves identity its own way, and **those resolutions do not
match your warehouse's.**

| Platform | How identity resolves | The specific trap |
|---|---|---|
| **PostHog** | `person_id` from identity merging; `distinct_id` per device or session | **`person_id` is re-resolved when an anonymous session merges into an identified user, so a HogQL distinct-person count for a past window can change after the fact.** Deleted persons are soft-deleted and their event rows persist, so events survive the person |
| **Amplitude** | user merging on identify | **merging rewrites history** — previously-exported rows can become inconsistent with new queries, so re-exports are not idempotent across a merge |
| **Mixpanel** | ID Merge, v2 and v3 semantics differ | **the `distinct_id` in the raw export is not necessarily the canonical ID the UI uses.** Check which ID-merge version the project is on before writing join logic |

### The rule

**Reconcile explicitly and report the match rate.** Every product-to-revenue
number carries a join, and the join carries a coverage figure:

```
product_accounts_total
matched_to_crm
unmatched:        n, and their share of product usage
ambiguous:        n  (one product account → several CRM records, or the reverse)
match_rate
```

Unmatched accounts are a number, not a footnote. **If 22% of product accounts do
not match a CRM record, every revenue-per-usage figure is computed on 78% of the
base** — and the unmatched 22% are systematically different, usually smaller,
newer or self-serve.

---

## 5. Person properties are latest-value-wins

**On PostHog, Amplitude and Mixpanel alike, querying a person property returns
its current value, not its value at event time.**

```sql
-- wrong: gives the account's plan TODAY, applied to events from six months ago
select person.properties.plan, count()
from events where event = 'feature_used' group by 1

-- right: the plan captured on the event itself
select properties.plan_at_event, count()
from events where event = 'feature_used' group by 1
```

Any cohort analysis that assumes historical person state is wrong, and it is
wrong in a specific direction: **accounts that upgraded look as though they were
always on the higher plan**, which inflates the higher plan's historical usage
and deflates the lower plan's. This is the single most common silent defect in
PLG cohort reporting.

The fix is one of: capture the attribute as an event property at event time,
maintain a daily snapshot table in the warehouse, or model the plan as a slowly
changing dimension — see `data-model-designer`.

---

## 6. PQL definitions are a local business rule

A product-qualified lead combines usage **depth**, usage **breadth** and
**account context** — firmographic fit, seat count, plan.

```
PQL = (depth signal)  AND  (breadth signal)  AND  (fit signal)
      e.g. ≥ N core actions in 14 days
       AND ≥ 2 distinct feature areas touched
       AND account matches ICP or has ≥ M seats
```

**Like MQL, there is no industry standard, and yours is not comparable to anyone
else's.** Therefore:

- **Version it.** `pql_definition_v3`, with the date it took effect. Every
  trendline that crosses a version change needs a marker.
- **Validate it against the outcome it claims to predict** — conversion to paid,
  or to opportunity — with the same separation and coverage arithmetic as §1.
- **Report its precision.** If 60% of PQLs never convert, sales needs to know
  that before the third week of following up on them.
- **Do not name it identically to a vendor's PQL score** and then chart the two
  together. See `comparability-rules` on metric-name collision.

---

## 7. Usage is not value

**Heavy usage can indicate struggle as easily as success.** A user running the
same search forty times has not found what they need. A team exporting data
daily may be working around a missing feature. High support-ticket volume from a
high-usage account is the signature.

Pair usage with an outcome signal before narrating:

| Usage signal alone | Paired with | Then you can say |
|---|---|---|
| Sessions per week | retention, expansion, NPS, ticket volume | whether the usage is productive |
| Feature invocations | task completion, error rate, time-to-complete | whether the feature works |
| Seats active | seat expansion, renewal | whether the usage is valued |

And the expansion claim specifically: **"high usage predicts expansion" is
correlational.** Accounts that expand were growing anyway. Report the
relationship, report its strength, and state that no causal claim is made unless
an experiment or a holdout backs it.

---

## 8. Event taxonomy drift is the silent killer

The same action firing under three names across two years makes any long-range
adoption trend meaningless — and the chart will look perfectly smooth, because
each rename produces a decline in one series and a rise in another that nobody
is plotting together.

**Check before trending, every time:**

```sql
-- first and last occurrence of every event name, plus volume
select event, min(timestamp), max(timestamp), count()
from events group by event order by 2 desc
```

Read it for:

- **Events whose `max(timestamp)` is old** — renamed or removed.
- **Events whose `min(timestamp)` is recent** — the new name of an old thing.
- **Near-duplicate names** — `file_uploaded`, `upload_file`, `File Uploaded`.
- **Volume step changes** at a release date.

Where a rename is found, either union the names with a documented mapping, or
**start the trend at the rename and say why.** A four-year adoption chart across
two renames is not a finding.

Two platform-specific additions:

- **Mixpanel computed/custom properties defined in Lexicon are evaluated at query
  time and do not exist in the raw export.** A board that uses one cannot be
  reproduced from exported data; the warehouse model must recreate the formula.
- **`$`-prefixed Mixpanel properties are reserved** and behave differently from
  custom ones; some are not exportable.

---

## 9. Output

```
activation:
  milestone, window_days, outcome_metric, grain
  separation_pp, lift, coverage, control_comparison, cohort_stability
  claim: correlational
time_to_value: { p50, p90, never_reached_share, censoring_treatment, segments[] }
adoption[]:
  feature, denominator: all | entitled | reached_surface, recency_bound, grain, rate
identity_bridge:
  product_platform, id_field, merge_semantics_version
  matched, unmatched, ambiguous, match_rate, unmatched_usage_share
pql: { definition_version, effective_date, precision, coverage, validated_against }
usage_to_outcome: { relationship, strength, causal_claim: none }
taxonomy: { events_checked, renames_found[], trend_start_date, mapping_applied }
```

---

## 10. Answering

**Answer first**, and be specific about which of the several possible numbers you
gave.

> **34% of accounts activate within 14 days, where activation is "connected a
> data source and invited one teammate".** That milestone separates 30-day
> retention by 41 points and is reached by a bit over a third of signups, which is
> the best combination among the six candidates tested — and it beats a pure
> "logged in twice" control by 18 points, so it is measuring something beyond
> plain activity.
>
> It is correlational. Accounts that invite a teammate retain better; that is not
> the same as inviting a teammate causing retention, and if the plan is to push
> this milestone in onboarding, that change needs its own test.
>
> The 34% is computed on the 78% of product accounts that match a CRM record. The
> unmatched 22% skew self-serve and newer, so the true rate across all signups is
> probably a little lower.
>
> For tracking onboarding health quarter to quarter, this figure is fine. For
> setting a target that compensation depends on, fix the identity join first.

**Withhold only:** an activation rate where no candidate milestone beats the
activity control (say that no milestone in the set carries signal, and name the
candidates worth instrumenting next), and a product-to-revenue figure where the
identity match rate is unknown — not where it is low. **A low match rate is a
number with a named gap; an unknown match rate is a number with no floor.**

---

## References

- `references/activation-validation.md` — the candidate-milestone procedure with the separation arithmetic, the activity control, and a worked selection across six candidates
- `references/identity-bridge.md` — per-platform merge semantics, the reconciliation query shape, and how to report and use an imperfect match rate

## Core contracts called

- **`answer-contract`** — the two withholds above and the correlational claim on every activation and expansion statement
- **`provenance-block`** — product platform, project timezone (day bucketing differs per project), identity basis and merge-semantics version
- **`comparability-rules`** — before adoption rates with different denominators share a chart, and before a PQL is charted against a vendor's same-named score
- **`warning-field-reader`** — product-platform query caps, sampling and the free-plan data-read limits that silently truncate wide scans
- **`pagination-patterns`** — PostHog rejects `OFFSET` for personal API keys with a 400 and requires keyset pagination on `timestamp`; an agent that improvises will report a failed query instead of paginating

## Related skills

- `funnel-model-designer` — define the funnel before measuring it.
- `identity-resolution` — the product-to-CRM spine this skill reports the coverage of.
- `cohort-and-ltv` — retention curves compared at the same horizon.
- `churn-retention-analysis` — the other side of the retention question.
- `experiment-design-readout` — required before any activation milestone is claimed as a lever.
