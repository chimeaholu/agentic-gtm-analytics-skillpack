# The denominator-trap register, as executable checks

Each trap is written as a check that can be run against a query or a model
before the number is published. Prose is not the deliverable here; the
assertion is.

---

## T1. Snapshot presented as a cohort rate

**Symptom.** A "conversion rate" computed as `count(current_stage = 'SQL') ÷
count(current_stage IN ('MQL','SAL','SQL',...))`.

**Why it is wrong.** It divides two populations observed at the same instant.
It has no time direction. It moves when the *mix* of the pipeline moves, with
no conversion behaviour changing at all.

**Check.**
```sql
-- fails if the numerator population is not a subset of the
-- denominator population traced through time
assert exists(cohort_entry_date_column) and
       numerator_rows.cohort_id ⊆ denominator_rows.cohort_id
```
**Fix.** Define an entry cohort, follow it forward, and mark cohorts whose
cycle has not elapsed as incomplete.

---

## T2. Numerator and denominator from different loads or windows

**Symptom.** Every rate in a report improved at once, on a day nothing changed.

**Canonical case.** A partial export populates numerator rows but not
denominator rows, so every rate rises. The "improvement" was arithmetically
impossible to earn, because the denominator could not grow.

**Check.**
```sql
assert max(numerator.loaded_at) = max(denominator.loaded_at)
assert numerator.window_start = denominator.window_start
assert numerator.window_end   = denominator.window_end
```
**Fix.** Where they cannot be made to match, the rate is `unavailable`. This is
one of the few genuine withholds.

---

## T3. A denominator restriction hidden in a WHERE clause

**Symptom.** The sentence and the SQL disagree, and both look fine in
isolation.

**Example.** The claim is "12% of leads became opportunities." The query's
denominator is leads *with a non-null company field, excluding a source list,
owned by an active user*. That is a different sentence and a smaller
denominator, so the rate is higher than the claim.

**Check.** Write the stakeholder sentence, then enumerate every predicate in
the denominator query and confirm each one appears in the sentence. Any
predicate that does not appear in the sentence is either a bug or a missing
clause in the sentence.

**This is the single most transferable check in the pack.**

---

## T4. A count of absences with no observation base

**Symptom.** "We had 47 failures" or "the brand was not mentioned 312 times."

**Why it is wrong.** The count grows with time and with volume. It improves or
worsens simply because the window got longer.

**Check.**
```sql
assert metric_is_rate or window_length_is_fixed
-- count-of-absences must be ÷ observation_count, or over a fixed window
```

---

## T5. Denominator population drift

**Symptom.** A rate moved and nobody changed anything.

**Causes.** A new region onboarded, a list purchased, a segment added to the
CRM, a product line acquired, an integration backfilled historical rows.

**Check.**
```sql
-- denominator row count should not step-change without an explanation
assert abs(denominator_count_t / denominator_count_t_minus_1 - 1) < 0.25
   or documented_population_change_exists
```

---

## T6. Fan-out from a one-to-many join

**Symptom.** Revenue is higher than the CRM total, by a clean multiple or by an
untidy amount that grows with association density.

**Cause.** Deal → contact → company associations in HubSpot are many-to-many.
Joining deals to contacts multiplies deal amount by the contact count.

**Check.**
```sql
assert count(*) from mart = declared_control_row_count
assert sum(amount) from mart = declared_control_sum
```
Run both on every mart. A row-count test alone does not catch a partial
fan-out; a sum test alone does not catch a silent drop.

---

## T7. Snapshot table queried without a snapshot filter

**Symptom.** Every number is roughly `N × days_in_range` too large.

**Check.**
```sql
assert query_on(fact_opportunity_snapshot) implies
       (snapshot_date = :one_date) or (snapshot_date in (:d1, :d2))
```
For dbt snapshots, the equivalent is `dbt_valid_to IS NULL` for current state.

---

## T8. Mean where median belongs

Applies to: sales cycle, AOV, LTV, deal size, time to value, time to second
order, stage duration. All right-skewed.

**Check.** If `mean ÷ median > 1.3`, the mean is not describing the typical
case. Report median and p90, and say the mean if asked.

---

## T9. Cross-platform conversion sums

**Symptom.** Channel-level attributed revenue sums to 130-160% of actual
revenue.

**Cause.** Each ad platform independently claims conversions it touched, and
several include view-through.

**Handling.** *Do not suppress the sum.* Compute it, state that it overstates
by construction and by an unknown amount, and put the blended figure next to
it, which does reconcile to the books.

---

## T10. Small n

**Check.**
```sql
assert denominator_count >= min_cohort_size
-- default min_cohort_size for a stage-to-stage rate: 30
-- below 30, report the raw counts, not the rate
```
Below the floor, report `x of y`, never a percentage. A 2-of-3 stage
conversion is not 67%.

---

## T11. Definition drift crossing the window

**Check.** Read the metric contract register (see `semantic-layer-builder`) for
any `effective_from` inside the reporting window. If one exists, mark it on the
chart and describe the two segments separately.

---

## T12. Incomplete last period

**Check.**
```sql
assert last_bucket_end <= data_as_of
   or last_bucket_is_marked_incomplete
```
Applies to every trend chart with no exceptions, and additionally to any source
inside its restatement window (Meta ~28 days, Google Ads up to 90 days for
conversion backfill, GA4 24-48h reprocessing). See `temporal-integrity-audit`.

---

## T13. Zero, missing and unavailable conflated

Three distinct states, and a fourth awkward one:

| State | Meaning | Render as |
|---|---|---|
| observed zero | the event genuinely did not occur | `0` |
| missing source row | the source did not return a row | `unavailable`, never `0` |
| zero or absent denominator | the rate is undefined | `unavailable`, never "infinite improvement" |
| rows present, coverage unknown | partial extract | `partial`, with what is known |

**A missing row rendered as zero is the quietest wrong number in analytics.**
