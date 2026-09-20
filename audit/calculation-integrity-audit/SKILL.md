---
name: calculation-integrity-audit
description: Use when auditing whether reported numbers are actually computed correctly — reviewing a dashboard, a report, a warehouse model or an inherited analysis. Checks denominators against the claim being made, tests for fan-out and double-counting, validates that rates share a numerator and denominator population, and writes out the sentence a stakeholder would say to check it against what the calculation actually does. Prevents a correct calculation of a mis-scoped metric, which is still a wrong claim.
---

# Calculation Integrity Audit

Almost every wrong number in production is arithmetically correct. The sum
added up. The division divided. The metric was scoped to the wrong population,
or the same row was counted twice, or a mean described a distribution it cannot
describe.

**Findings ship as runnable assertions, not prose**, so the fix is verifiable
and the regression is prevented.

---

## 1. The sentence check

> **Write the sentence a stakeholder would say out loud, then check it against
> the actual denominator.**

**This is the single most transferable check in the audit tier.**

A visibility metric computed over "responses where some entity was named"
rather than "responses run" matches its own definition exactly and is still a
wrong claim, by a wide margin, because the sentence people hear is "of the
times we ran this, X%" and the denominator is something else entirely.

**Procedure:**

1. Write the claim as one sentence, the way it would be said in a meeting.
2. Open the query and enumerate **every predicate** in the denominator.
3. Any predicate not present in the sentence is either a bug in the query or a
   missing clause in the sentence. There is no third option.
4. Rewrite whichever one is wrong.

```
claim:  "12% of the leads we generated last quarter became opportunities."
query denominator predicates:
  created_at in Q3                        <- in the sentence
  email is not null                       <- NOT in the sentence
  source not in ('list_purchase','event') <- NOT in the sentence
  owner_is_active                         <- NOT in the sentence
finding: the denominator is "leads with an email, from non-list sources,
         owned by an active user", which is 61% of leads generated. The true
         rate on the claimed denominator is 7.3%, not 12%.
```

---

## 2. Numerator and denominator must cover the same window from the same load

Where they cannot, **the rate is `unavailable`.** This is one of the few
genuine withholds in the pack.

**The canonical worked example:** a partial export populates numerator rows and
not denominator rows. Every rate rises. It looks like an improvement, and it is
an improvement that was **arithmetically impossible to earn**, because the
denominator could not grow.

```sql
-- the assertion
assert max(numerator.loaded_at) = max(denominator.loaded_at);
assert numerator.window_start   = denominator.window_start;
assert numerator.window_end     = denominator.window_end;
```

The signature to look for in a dashboard review: **every rate moved in the same
direction on the same day.** Real behaviour change does not do that. A load
problem does.

---

## 3. Fan-out and double counting

### 3.1 One-to-many and many-to-many joins

The silent revenue multiplier. Joining a fact to a many-side table multiplies
its measures, producing a number that is larger, plausible, and never errors.

| Join | Shape |
|---|---|
| HubSpot deal → contact → company | many-to-many associations |
| Salesforce opportunity → `OpportunityContactRole` | one-to-many |
| opportunity → campaign influence | one-to-many |
| account → contacts, then summing account ARR | one-to-many |
| order → order lines, then summing order total | one-to-many |

**Detection:**
```sql
-- before the join
select count(*) rows, count(distinct k) keys, count(*) - count(distinct k) dupes
from   right_table;

-- across the join
select (select count(*) from l) as before,
       (select count(*) from l join r on l.k = r.k) as after;
```
`after > before` is fan-out. `after < before` is an inner join dropping
unmatched rows, which is a different bug that looks the same to a stakeholder.

**Prevention:** row-count **and** sum-total tests against a declared control on
every mart. Both. A row-count test alone misses a partial fan-out that also
dropped rows; a sum test alone misses a duplication that cancels against a
filter.

### 3.2 Snapshot tables queried without a snapshot filter

Every number comes out roughly `N × days_in_range` too large.

```sql
assert query_on(fact_opportunity_snapshot) implies
       snapshot_date = :one_date or snapshot_date in (:d1, :d2);
```

### 3.3 dbt snapshots without `dbt_valid_to IS NULL`

The most common dbt-specific double count. Omitting it returns every historical
version of every row.

```sql
select * from snapshots.opportunity where dbt_valid_to is null;  -- current state
```

### 3.4 Session-to-event joins

```sql
-- WRONG: neither a session count nor an event count
select count(*) from sessions join events using (session_id);
```
Aggregate each separately, join the aggregates on a shared grain, and declare
which filters move which number.

### 3.5 Cross-platform conversion sums

Each ad platform independently claims conversions it touched. Sums routinely
explain 130-160% of actual revenue. **Do not suppress the sum: annotate it**,
and put the blended figure that reconciles to the books next to it.

---

## 4. Average of averages

`AVG(AVG(x))` is not `AVG(x)` unless every group is the same size, and groups
are never the same size.

```sql
-- WRONG: every region weighted equally regardless of order count
select avg(region_aov) from (select region, avg(order_value) region_aov
                             from orders group by 1);

-- RIGHT: weighted by the underlying population
select sum(order_value) / count(*) from orders;

-- RIGHT, if a per-region figure is genuinely wanted, weight explicitly
select sum(region_aov * region_orders) / sum(region_orders)
from   (select region, avg(order_value) region_aov, count(*) region_orders
        from orders group by 1);
```

**Where it hides:**
- a BI tool aggregating a pre-aggregated measure
- a percentage column averaged down a table
- a monthly rate averaged to get an annual rate, when months have different
  denominators
- a rate computed per segment then averaged to a total

**Assertion:**
```sql
assert abs(avg_of_avgs - true_avg) < tolerance
-- if it fails, the report is weighting groups, not observations
```

## 5. Wrong aggregation order

`SUM(a) / SUM(b)` and `AVG(a/b)` are different numbers and both appear on
dashboards labelled the same way.

| Metric | Correct order |
|---|---|
| Conversion rate over a period | `SUM(conversions) / SUM(sessions)` |
| ROAS over a period | `SUM(revenue) / SUM(spend)` |
| Win rate over a period | `SUM(won) / SUM(closed)` |
| "Average daily conversion rate" | `AVG(daily_rate)`, and it is a different metric |

The rule: **a rate over a period is computed on the period's totals, not as the
average of the period's daily rates.** The two agree only when the daily
denominators are equal.

The related failure: **filtering after aggregating.** A filter applied to an
aggregated result changes the denominator of everything computed from it. Order
of operations in a BI tool (row filters, then aggregation, then having-clause
filters, then visual filters) is not obvious from the chart and must be read
from the definition.

---

## 6. Rounding drift

Small, real, and embarrassing in front of a CFO.

- **Percentages rounded then summed** do not total 100. Use largest-remainder
  apportionment if the total must be exactly 100, and say you did.
- **Currency rounded at each step** accumulates. Round once, at display.
- **Rounding then multiplying** is worse than multiplying then rounding: a
  0.5% rounding on a unit price, multiplied by 10,000 units, is a visible
  number.
- **Floating-point money.** Use a decimal or integer-minor-unit type. A
  reconciliation that is off by 0.0000001 per row and a million rows is off by
  a real amount.
- **Rate limits and percentage points.** "Up 5%" and "up 5 percentage points"
  differ. State which.

```sql
assert sum(rounded_share) between 0.995 and 1.005;
assert round(sum(amount), 2) = sum(round(amount, 2))    -- fails: round once
```

---

## 7. GA4 sampling and thresholding

Three response fields that make certain GA4 calculations invalid, and they are
read by `warning-field-reader` and must be honoured here.

| Field | Meaning | Effect on a calculation |
|---|---|---|
| `samplingMetadatas[]` | the number is estimated from a sample; rate = `samplesReadCount / samplingSpaceSize` | the figure has sampling error; small segments are unreliable; shorten the range, drop dimensions, or use the BigQuery export |
| `subjectToThresholding: true` | rows suppressed for privacy, typically on demographic and interest dimensions | **totals will not add up.** Never present a segment sum as the total, and never compute a residual "other" from total minus segments |
| `dataLossFromOtherRow: true` | high-cardinality values rolled into `(other)`, above roughly 500 daily uniques on a dimension | there is no long tail; do not present one, and name the dimension |
| `emptyReason` | an empty report is not always "no data" | read it and report it |
| `schemaRestrictionResponse` | field-level permissions changed the numbers without erroring | log the credential; flag restricted metrics |

**The specific wrong calculations these produce:**

- A segment breakdown that sums to less than the total, with the difference
  reported as an "unknown" segment. The difference is suppression, not a
  segment.
- A "long tail" analysis on a dimension that rolled into `(other)`. The tail
  is not in the data.
- A small-segment rate computed from a sampled report, where the sample
  contains a handful of rows.
- A month-over-month comparison where one month was sampled and the other was
  not.

**Assertion:**
```sql
assert not (integrity_flags contains 'thresholded'
            and calculation_type = 'segment_sum_as_total');
assert not (integrity_flags contains 'other_row'
            and calculation_type = 'long_tail');
```

---

## 8. Counts of absences

**Any count-of-absences must be normalised by observation count or computed
over a fixed-length window**, otherwise the metric improves simply because time
passed.

"We had 47 failures" is not a metric. "47 failures in 12,400 runs" is.

```sql
assert metric_is_rate or window_length_is_fixed;
```

---

## 9. Status flags and values must agree

Where a flag says data is absent, the dependent numeric fields must be null.

**Assert it as a warehouse test, not a renderer guard**, because a renderer
guard hides the symptom on one surface and does not repair the underlying
behaviour, and the next consumer of that table gets the contradiction.

```sql
assert count(*) filter (where data_status = 'unavailable' and value is not null) = 0;
```

---

## 10. Fractional credit is not a count of people

Attributed credit of 0.33 deals is not a deal, and 12.7 attributed customers
are not customers. Render fractional credit as a share or a weighted value,
never as a count, and never round it to a count.

**An attributed flow diagram is an aggregate flow, explicitly not an ordered
user journey.** A Sankey of channel-to-channel credit does not mean anyone
followed that path.

---

## 11. Mean where median belongs

Right-skewed, every one of them: sales cycle length, AOV, LTV, time to value,
deal size, time to second order, stage duration, session duration.

```sql
assert not (distribution_skew > threshold and statistic = 'mean');
-- practical heuristic: if mean / median > 1.3, the mean is not describing
-- the typical case
```

Report median and p90. Give the mean if asked, and say why it differs.

---

## 12. Findings ship as runnable assertions

Not prose. A finding that ships as a sentence gets read once. A finding that
ships as a test fails in CI the next time someone reintroduces it.

```yaml
- finding: "mart_revenue fans out through the deal-contact association"
  severity: critical
  evidence: "row count 18,402 vs control 12,034; amount total 4.2M vs 2.8M"
  corrected_computation: "aggregate assoc_deal_contact to one row per deal
                          before joining"
  assertion: |
    -- fails if the fan-out returns
    select case when abs(
      (select sum(amount) from mart_revenue) -
      (select sum(amount) from stg_crm__opportunity)) < 0.01
    then 'pass' else 'FAIL' end;
```

---

## 13. Answering

**Answer first.** Lead with the corrected number where you can compute one:
"Reported 4.2M, actual 2.8M; the difference is a fan-out through the
deal-contact association." Then the evidence and the assertion.

**Where the calculation is wrong but the correct value is computable, compute
it.** A finding without a corrected number leaves the user with a broken
dashboard and no replacement.

Withhold only: a rate whose numerator and denominator cannot be brought to the
same window and load. That is `unavailable`, and the resolving change is a
complete load, stated plainly.

## References

- `references/assertion-library.md` — the runnable checks, by failure class
- `references/aggregation-traps.md` — average of averages, aggregation order,
  rounding drift and sampling, worked

## Related skills

- `gtm-metric-dictionary` for the denominator traps and the pre-flight checks.
- `metric-definition-audit` when the definition, not the arithmetic, is the
  problem.
- `relationship-discovery` for join cardinality and coverage.
- `data-quality-harness` for turning these assertions into scheduled tests.
