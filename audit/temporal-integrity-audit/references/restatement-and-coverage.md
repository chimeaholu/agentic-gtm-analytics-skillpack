# Restatement windows and coverage checks

---

## 1. The restatement map

| Source | Window | Mechanism |
|---|---|---|
| **Meta** | ~28 days | attribution settlement; conversions attributed back to earlier clicks as they occur |
| **Google Ads** | up to 90 days | conversion backfill, including store visits and offline conversion imports |
| **GA4** | 24-48 hours | reprocessing; data is explicitly provisional inside it |
| **Klaviyo** | unbounded on a setting change | **an attribution-window change restates all history retroactively** |
| **Bizible-style touchpoint systems** | on their own schedule | touchpoints recalculated, which restates attributed pipeline |
| **Billing / payments** | weeks | refunds, chargebacks, credits, failed-payment retries |
| **CRM** | unbounded | humans edit close dates and amounts after close |
| **Warehouse late-arriving facts** | depends on ingestion | events landing after their partition was built |

**There is no date on which all sources are simultaneously final except
roughly 90 days back.**

Practical consequence: **any answer about a recent window is labelled
provisional**, with the settlement window named. Not hedged, labelled: "Meta's
figure for the last four weeks will rise as attribution settles."

---

## 2. Measuring restatement directly

For a source that does not publish its behaviour, measure it. Store every read
and diff reads of the same business window.

```sql
create table metric_reads (
  source          text,
  metric          text,
  business_date   date,
  read_at         timestamp,
  value           numeric,
  primary key (source, metric, business_date, read_at)
);

-- the restatement curve for a source
select
  business_date,
  read_at,
  value,
  value - first_value(value) over (partition by business_date order by read_at)
    as cumulative_restatement,
  date_diff('day', business_date, read_at::date) as days_after
from   metric_reads
where  source = :source and metric = :metric
order by business_date, read_at;
```

Aggregate across business dates to get the settlement curve: what share of the
final value is visible at day 1, day 3, day 7, day 28. **That curve is the
input to correctly reading a provisional number**, and it is also the honest
basis for a maturity-adjusted estimate, which must be labelled modelled.

---

## 3. Comparing at equal maturity

A settled period compared to an unsettled one compares a final number to a
partial one.

Two correct approaches:

**Wait.** Compare only periods that are both past the settlement window. Simple
and often unacceptable, because people want this week's number.

**Compare at equal maturity.** Measure both periods **N days after their
close**, using the stored reads.

```sql
-- both sides measured 7 days after period end
select
  period,
  value
from   metric_reads
where  read_at::date = period_end + interval '7 days';
```

This is a genuinely comparable pair even when neither is final. Say which N you
used.

**The failure this prevents:** restated ad data read as a trend. Conversions
backfilled into last month make last month look better than it did at the time,
so "we improved" is partly "last month's number grew after we looked at it".

---

## 4. Equal window is not equal coverage

### The check

```sql
with spine as (
  select date_day from dim_date
  where date_day between :window_start and :window_end
),
observed as (
  select distinct date_day from fact where date_day between :window_start and :window_end
)
select
  count(*) as window_days,
  (select count(*) from observed) as covered_days,
  count(*) - (select count(*) from observed) as missing_days,
  array_agg(s.date_day) filter (where o.date_day is null) as missing_dates
from spine s left join observed o using (date_day);
```

**Join to `dim_date`, not to the fact's own distinct dates.** Without a spine a
missing day does not render as zero; it does not render at all, and the line
connects across the gap.

### When coverage differs

| Treatment | When |
|---|---|
| **per-covered-day rate** | the metric is a flow and a rate is meaningful |
| **suppress the comparison** | the gap is large or its cause is unknown |
| **as-is with a stated caveat** | the gap is one day out of ninety and the direction is named |

Never silently compare 90 covered days to 87.

### Partial days count as gaps

A day where the pipeline ran at 14:00 and captured 14 hours is not a covered
day. Check row counts per day against a rolling median, not just presence:

```sql
select date_day, rows,
       rows / nullif(median(rows) over (order by date_day
                       rows between 14 preceding and 1 preceding), 0) as vs_median
from   daily_counts
qualify vs_median < 0.5;   -- any row here is a partial day
```

---

## 5. The incomplete last bar

**Exclude it or mark it. On every trend. No exceptions.**

```sql
select case
  when :last_bucket_end <= :data_as_of then 'pass'
  when :last_bucket_marked_incomplete  then 'pass'
  else 'FAIL: last bucket ends ' || :last_bucket_end
       || ' but data is only complete to ' || :data_as_of
  end;
```

Three acceptable treatments:

1. **Drop it.** Cleanest for an exec chart.
2. **Render it distinctly and label it.** Hatched, lighter, or "partial".
3. **Prorate and label it as prorated.** Only when the within-period
   distribution is reliably even, which it is not for B2B bookings (quarter-end
   loading) or B2C (weekend and promotion effects).

Combined with a settlement window, the last bar is both incomplete and still
rising, so it will be revised upward twice. Say so once rather than explaining
it every month.

---

## 6. Hardcoded comparison endpoints

```sql
-- WRONG: correct the day it was written, quietly wrong forever after
where event_date between '2026-01-01' and '2026-06-30'

-- RIGHT: parameterised
where event_date >= :period_start and event_date < :period_start + interval '6 months'

-- RIGHT: derived per row
select event_date, value,
       lag(value, 365) over (order by event_date) as value_prior_year
from daily
```

**A hardcoded endpoint silently invalidates every record added after it was
chosen.** The query still runs and still returns rows, which is why it survives.

Lint for it: date literals in a `WHERE` clause on a scheduled query are a
finding unless they are a deliberate historical boundary (a migration date, a
definition change) and are commented as such.

---

## 7. Three clocks, asserted separately

```sql
-- source data freshness: the BUSINESS date, which is the one that matters
select case when max(event_date) >= current_date - 1 then 'pass'
       else 'FAIL: latest business date ' || max(event_date)
            || ' but model last ran ' || :last_run_at end
from fact;
```

**Object metadata is not data recency.** A table's `last_modified` timestamp
says the object changed, not that the business dates inside it advanced. A
model that ran successfully at 06:00 against a source that stopped delivering
at midnight has a fresh bake time, stale data, and a green pipeline.

The three, displayed separately wherever freshness is shown:

```
deployed:        2026-09-18 14:02
last extract:    2026-09-20 06:00
data complete to: 2026-09-18       <- the one people actually need
```

**A fresh deployment serving a stale artefact** is the related failure: the
deploy succeeded, the cache or CDN did not invalidate, and the page carries
today's deploy timestamp over yesterday's numbers. Assert the rendered number's
data date, not the deploy's.

---

## 8. Week and fiscal conventions, in output

Any answer containing "this week", "last quarter" or "YTD" states its
convention:

```
Week of 2026-09-14 (Monday start, ISO 8601)
Q3 FY2026 (fiscal year ending 31 January; Q3 = Aug 1 - Oct 31)
YTD as of 2026-09-19, fiscal basis
```

Three lines, and they remove an entire class of argument. Particularly for
4-4-5 fiscal calendars, where periods have different lengths and a
period-over-period comparison is comparing a four-week period to a five-week
one unless it is normalised.
