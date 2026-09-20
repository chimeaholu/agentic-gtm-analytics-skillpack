# The test library — runnable SQL for the seven mandatory tests

Every test returns at least a `test` name and a boolean `failed`, so the runner
does not need to know anything about the test's subject. Written in BigQuery
syntax; the Snowflake differences are noted where they matter.

---

## 1. Freshness

```sql
SELECT
  'marts.fact_ad_spend.freshness' AS test,
  MAX(event_date)                 AS max_date,
  DATE_DIFF(CURRENT_DATE(), MAX(event_date), DAY) AS days_behind,
  DATE_DIFF(CURRENT_DATE(), MAX(event_date), DAY) > 2 AS failed
FROM marts.fact_ad_spend;
```

Set the threshold from the **source's** settlement behaviour, not from a wish.
A GA4-derived mart is legitimately 2 days behind; a CRM mart should be hours.
A freshness threshold tighter than the source can deliver produces a permanent
red that everyone learns to ignore.

**Freshness must be measured on the data's own date column**, not on
`_loaded_at`. A job that runs nightly and loads nothing keeps `_loaded_at`
current while the data rots.

---

## 2. Uniqueness on the declared grain

```sql
SELECT 'marts.fact_order_line.grain' AS test,
       COUNT(*) AS duplicate_groups,
       COUNT(*) > 0 AS failed
FROM (
  SELECT order_id, line_number, COUNT(*) AS n
  FROM marts.fact_order_line
  GROUP BY 1, 2
  HAVING n > 1
);
```

The grain in the test must be **the grain sentence in the table description,
verbatim**. If they differ, one of them is wrong and it is usually the
description.

---

## 3. Referential integrity

```sql
SELECT 'marts.fact_touchpoint.fk_campaign' AS test,
       COUNT(*) AS orphans,
       COUNT(*) > 0 AS failed
FROM marts.fact_touchpoint f
LEFT JOIN marts.dim_campaign d USING (campaign_id)
WHERE f.campaign_id IS NOT NULL
  AND d.campaign_id IS NULL
  AND f.event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY);
```

Two refinements that stop this test being noise:

- **Exclude nulls deliberately.** A null FK is a coverage question, not an
  integrity failure — measure it as a separate coverage metric with its own
  threshold.
- **Bound the window.** An unbounded integrity test over five years of facts is
  one of the most expensive queries in the suite and re-proves history nightly.

---

## 4. Control totals — both halves

```sql
WITH control AS (
  SELECT COUNT(*) AS rows_ctl,
         SUM(CAST(amount AS NUMERIC)) AS sum_ctl
  FROM staging.stg_crm__opportunity
  WHERE created_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
),
actual AS (
  SELECT COUNT(*) AS rows_act,
         SUM(amount_original) AS sum_act
  FROM marts.fact_opportunity
  WHERE created_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
)
SELECT 'marts.fact_opportunity.control_totals' AS test,
       rows_ctl, rows_act, sum_ctl, sum_act,
       rows_act - rows_ctl AS row_delta,
       sum_act  - sum_ctl  AS sum_delta,
       (rows_ctl <> rows_act) OR (ABS(sum_ctl - sum_act) > 0.01) AS failed
FROM control, actual;
```

Why both: a row-count test alone misses a partial fan-out that also dropped
rows; a sum test alone misses a duplication that cancels out against a loss.
The pair is the test.

**Where the mart legitimately collapses grain** (order lines into orders), the
row counts are *supposed* to differ. Then the control is the reconciliation,
stated as a ratio and asserted:

```sql
SELECT 'marts.fact_order.grain_reconciliation' AS test,
       lines, orders, SAFE_DIVIDE(lines, orders) AS lines_per_order,
       ABS(SAFE_DIVIDE(lines, orders) - 3.33) > 0.5 AS failed
FROM (SELECT (SELECT COUNT(*) FROM staging.stg_shop__order_line) AS lines,
             (SELECT COUNT(*) FROM marts.fact_order)             AS orders);
```

The sum of `amount` still has to match exactly. Grain collapse changes row
counts; it must not change money.

---

## 5. Fan-out detection

```sql
SELECT 'marts.fact_opportunity.fanout' AS test,
       MAX(n) AS max_rows_per_key,
       MAX(n) > 1 AS failed
FROM (
  SELECT opportunity_id, COUNT(*) AS n
  FROM marts.fact_opportunity
  GROUP BY 1
);
```

The general form, for joins where more than one row per key is expected:
compare rows-per-key against the previous run's distribution rather than
against 1, and fail on a **material shift** rather than on any duplication.

The known GTM fan-out sources, all of which this test catches after the fact
and `data-model-designer` §5 prevents in design: deal-to-contact and
deal-to-company associations (many-to-many), opportunity-to-contact-role,
campaign influence, a snapshot table with no date filter, an SCD Type 2 table
with no current-row filter, sessions joined to events, incompletely-merged CRM
records.

---

## 6. `dim_date` spine completeness

```sql
SELECT 'marts.fact_ad_spend.date_spine' AS test,
       COUNT(*) AS missing_days,
       COUNT(*) > 0 AS failed
FROM config.dim_date d
LEFT JOIN (SELECT DISTINCT event_date FROM marts.fact_ad_spend) f
  ON d.date_day = f.event_date
WHERE d.date_day BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
                     AND DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
  AND f.event_date IS NULL;
```

This is the test that distinguishes **"no activity"** from **"no data"**. A
missing day is a pipeline gap; a day with zero rows after a left join onto the
spine is a business zero. Charts cannot tell you which; this test can.

Exclude the trailing days inside the source's settlement window, or the test
fails every morning for a reason that is not a defect.

---

## 7. Numerator/denominator coverage matching

```sql
-- every SQL must have a corresponding MQL row, or the rate is a ratio of
-- two different populations
SELECT 'rate.mql_to_sql.coverage' AS test,
       COUNTIF(d.person_id IS NULL) AS numerator_without_denominator,
       COUNT(*)                     AS numerator_rows,
       SAFE_DIVIDE(COUNTIF(d.person_id IS NULL), COUNT(*)) AS uncovered_fraction,
       COUNTIF(d.person_id IS NULL) > 0 AS failed
FROM marts.fact_sql n
LEFT JOIN marts.fact_mql d USING (person_id);
```

The failure this catches is a conversion rate whose numerator contains people
its denominator never had — direct-to-SQL leads, imported lists, records
created by a sales rep. The rate is not "slightly high"; it is not a rate.

**Publish `uncovered_fraction` alongside the rate**, always. It is the
coverage statement `answer-contract` requires, and it is one number.

---

## 8. Snowflake differences

| BigQuery | Snowflake |
|---|---|
| `DATE_DIFF(a, b, DAY)` | `DATEDIFF('day', b, a)` — **argument order reverses** |
| `DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` | `DATEADD('day', -30, CURRENT_DATE())` |
| `SAFE_DIVIDE(a, b)` | `DIV0NULL(a, b)` or `a / NULLIF(b, 0)` |
| `COUNTIF(cond)` | `COUNT_IF(cond)` |
| `APPROX_QUANTILES(x, 2)[OFFSET(1)]` | `MEDIAN(x)` |
| `CURRENT_DATE()` is UTC | `CURRENT_DATE()` follows the **session** timezone — set it |

---

## 9. Scheduling and cost

Not every test runs at every cadence. Control totals over large facts are the
expensive ones.

| Cadence | Tests |
|---|---|
| **After every load** | freshness, uniqueness on the loaded window, spine completeness for the loaded window |
| **Daily** | referential integrity (bounded window), fan-out, coverage matching |
| **Weekly or per-release** | full-history control totals, the anchor suite |

Every test carries a `maximumBytesBilled` (BigQuery) or runs on the
statement-timeout-bounded agent warehouse (Snowflake). **A test suite that
becomes the biggest line on the invoice gets deleted**, and then nothing is
tested. See `rate-limit-governor`.
