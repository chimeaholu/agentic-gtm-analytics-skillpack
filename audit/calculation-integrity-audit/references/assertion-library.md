# The assertion library

Findings ship as these, not as prose. Each is written to fail loudly when the
defect is present or reintroduced.

Dialect note: `filter (where ...)` is Postgres and Snowflake; use
`count(case when ... then 1 end)` on dialects without it.

---

## A. Denominator and scope

### A1. Sentence-to-predicate parity

Not automatable. Run it by hand at review time, and record the result.

```
claim_sentence:        "..."
denominator_predicates: [...]
unaccounted_predicates: [...]     # must be empty, or the sentence is rewritten
```

### A2. Numerator and denominator from the same window and load

```sql
select case when
   (select max(loaded_at) from numerator_src) =
   (select max(loaded_at) from denominator_src)
  and :num_window_start = :den_window_start
  and :num_window_end   = :den_window_end
then 'pass' else 'FAIL: numerator and denominator not aligned' end;
```

### A3. Every rate moved together (the partial-load signature)

```sql
-- flags a day where every rate in the report moved >5% in the same direction
with d as (
  select report_date, metric, value,
         value / nullif(lag(value) over (partition by metric order by report_date),0) - 1 as chg
  from   reported_rates
)
select report_date, count(*) as metrics_moved, avg(chg) as avg_move
from   d
where  abs(chg) > 0.05
group by 1
having count(*) = (select count(distinct metric) from d)
   and abs(avg(chg)) > 0.05;
-- any row returned is a load problem until proven otherwise
```

### A4. Count of absences is normalised

```sql
select case when :metric_is_rate or :window_length_is_fixed
       then 'pass'
       else 'FAIL: unnormalised count improves as time passes' end;
```

---

## B. Fan-out and double counting

### B1. Mart control totals (row count AND sum)

```sql
with mart as (select count(*) n, sum(amount) s from mart_opportunity),
     ctrl as (select count(*) n, sum(amount) s from stg_crm__opportunity)
select
  case when mart.n = ctrl.n then 'pass'
       else 'FAIL rows: ' || mart.n || ' vs ' || ctrl.n end as row_check,
  case when abs(mart.s - ctrl.s) < 0.01 then 'pass'
       else 'FAIL sum: moved by ' || (mart.s - ctrl.s) end as sum_check
from mart cross join ctrl;
```

Both, always. Each catches what the other misses.

### B2. Right-side uniqueness before a many-to-one join

```sql
select case when count(*) = count(distinct join_key) then 'pass'
       else 'FAIL: ' || (count(*) - count(distinct join_key)) ||
            ' duplicate keys; this join is not many-to-one' end
from right_table;
```

### B3. Post-join row delta

```sql
select case
  when a.n > b.n then 'FAIL fan-out: ' || (a.n - b.n) || ' rows added'
  when a.n < b.n then 'FAIL drop: '    || (b.n - a.n) || ' rows lost'
  else 'pass' end
from (select count(*) n from l join r on l.k = r.k) a
cross join (select count(*) n from l) b;
```

### B4. Snapshot filter present

```sql
-- lint the query text before execution
select case when :query_text ilike '%fact_opportunity_snapshot%'
             and :query_text not ilike '%snapshot_date%'
       then 'FAIL: snapshot table queried with no snapshot_date filter'
       else 'pass' end;
```

### B5. dbt snapshot current-state filter

```sql
select case when :query_text ilike '%snapshots.%'
             and :query_text not ilike '%dbt_valid_to%'
       then 'FAIL: dbt snapshot queried without dbt_valid_to is null'
       else 'pass' end;
```

### B6. Session-to-event join

```sql
select case when :query_text ~* 'sessions.*join.*events|events.*join.*sessions'
       then 'FAIL: sessions joined to events; aggregate each separately'
       else 'pass' end;
```

---

## C. Aggregation

### C1. Average of averages

```sql
with per_group as (
  select grp, avg(x) as gavg, count(*) as n from t group by 1
)
select case when abs(
         (select avg(gavg) from per_group) -
         (select sum(x)/count(*) from t)
       ) < :tolerance
       then 'pass'
       else 'FAIL: average of averages weights groups, not observations. '
            || 'avg-of-avgs=' || (select avg(gavg) from per_group)
            || ' true=' || (select sum(x)/count(*) from t) end;
```

### C2. Rate computed on period totals, not as an average of daily rates

```sql
with daily as (select d, sum(num) n, sum(den) dn from t group by 1)
select
  sum(n)/nullif(sum(dn),0)            as correct_period_rate,
  avg(n/nullif(dn,0))                 as average_of_daily_rates,
  case when abs(sum(n)/nullif(sum(dn),0) - avg(n/nullif(dn,0))) < :tolerance
       then 'pass'
       else 'FAIL: these are different metrics; label which one is shown' end
from daily;
```

### C3. Mean where median belongs

```sql
select case when avg(x) / nullif(percentile_cont(0.5) within group (order by x),0) > 1.3
       then 'FAIL: mean/median = ' ||
            round((avg(x)/percentile_cont(0.5) within group (order by x))::numeric,2)
            || '; report median and p90'
       else 'pass' end
from t;
```

---

## D. Rounding

### D1. Shares sum to one

```sql
select case when abs(sum(rounded_share) - 1.0) < 0.005 then 'pass'
       else 'FAIL: rounded shares sum to ' || sum(rounded_share)
            || '; use largest-remainder apportionment and say so' end
from t;
```

### D2. Round once, at display

```sql
select case when round(sum(amount), 2) = sum(round(amount, 2)) then 'pass'
       else 'FAIL: rounding applied per row then summed; drift = '
            || (sum(round(amount,2)) - round(sum(amount),2)) end
from t;
```

### D3. Money is not a float

```sql
select case when data_type in ('numeric','decimal','bigint') then 'pass'
       else 'FAIL: monetary column typed ' || data_type end
from information_schema.columns
where table_name = :t and column_name in ('amount','revenue','price','arr','mrr');
```

---

## E. Integrity flags

### E1. Thresholded data not summed to a total

```sql
select case when 'thresholded' = any(:integrity_flags)
             and :calculation_type = 'segment_sum_as_total'
       then 'FAIL: GA4 subjectToThresholding suppresses rows; segment sums '
            || 'do not equal the total and the difference is not an "other" segment'
       else 'pass' end;
```

### E2. Rolled-up data not presented as a long tail

```sql
select case when 'other_row' = any(:integrity_flags)
             and :calculation_type = 'long_tail'
       then 'FAIL: dataLossFromOtherRow means the tail is not in the data'
       else 'pass' end;
```

### E3. Sampled comparison across periods

```sql
select case when :period_a_sampled <> :period_b_sampled
       then 'FAIL: one period sampled and the other not; the comparison '
            || 'includes a sampling artefact'
       else 'pass' end;
```

---

## F. Consistency

### F1. Status flag agrees with the value

```sql
select case when count(*) = 0 then 'pass'
       else 'FAIL: ' || count(*) || ' rows flagged unavailable with a non-null value' end
from t where data_status = 'unavailable' and value is not null;
```

Assert it in the warehouse, not in the renderer. A renderer guard hides the
symptom on one surface and leaves the next consumer with the contradiction.

### F2. Zero is not missing

```sql
select case when count(*) = 0 then 'pass'
       else 'FAIL: ' || count(*) || ' rows rendered 0 where the source row was absent' end
from fact f
right join dim_date d on f.date_day = d.date_day
where f.date_day is null and f.value = 0;
```

The general rule, asserted structurally: an observed zero stays 0; a missing
source row is `unavailable` and is never rendered as zero; a rate with a zero
or absent denominator is `unavailable`, not infinite improvement.

### F3. Fractional credit not rendered as a count

```sql
select case when :metric_is_fractional_credit and :render_type = 'count'
       then 'FAIL: attributed credit is a share, not a count of people'
       else 'pass' end;
```

---

## G. Packaging a finding

```yaml
- finding: short statement of the defect
  severity: critical | high | medium | low
  location: file path, model name, dashboard tile
  evidence: the two numbers and the query that produced them
  corrected_computation: the fixed SQL, and the corrected value
  assertion: the runnable check above, parameterised for this case
  prevents_recurrence: where the assertion should live (dbt test, CI, scheduled)
```

**A finding with no corrected value leaves the user with a broken dashboard and
no replacement.** Compute it wherever it is computable.
