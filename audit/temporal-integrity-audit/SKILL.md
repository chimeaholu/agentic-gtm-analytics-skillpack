---
name: temporal-integrity-audit
description: Use when auditing the time dimension of any reporting — before trusting a period comparison, when day-boundary numbers disagree between systems, or when a chart's most recent point drives a decision. Checks timezone handling on every source, verifies that comparison windows have equal coverage rather than equal length, identifies restatement windows where numbers are still moving, and flags incomplete periods. Prevents the most common silent correctness bug in GTM analytics, which is a timezone assumption nobody wrote down.
---

# Temporal Integrity Audit

Time is where GTM analytics goes wrong silently. A timezone assumption nobody
wrote down produces numbers that are wrong by up to a day at every window edge,
and nothing errors.

---

## 1. Six platforms, six timezone rules, and none of them is UTC

| Platform | Rule |
|---|---|
| **Salesforce** | the **running user's** timezone. Two users run the same report and get different day boundaries. |
| **HubSpot** | date properties are **UTC midnight**; datetime properties are not |
| **Marketo** | instance timezone |
| **Pardot / MCAE** | the **export creator's** timezone |
| **Braze** | workspace timezone; revenue is already converted to USD |
| **Klaviyo** | account timezone, and **only `metric-aggregates` accepts an explicit `timezone` parameter** |
| **Amplitude** | project timezone |
| **Mixpanel** | project timezone |
| **PostHog** | project timezone |
| **GA4** | property timezone (`ResponseMetaData.timeZone`) |
| **Google Ads** | account timezone (`customer.time_zone`) |
| **Meta** | account timezone |
| **LinkedIn Ads** | account timezone |
| **Snowflake** | session `TIMEZONE` parameter, **often defaulting to America/Los_Angeles** |
| **BigQuery** | UTC |
| **Looker** | per-query `query_timezone` |
| **Tableau** | data source / server timezone, **no per-query override** |
| **Power BI** | **service UTC versus Desktop local**, which is why a report shows different days in the browser and on a laptop |
| **Cube** | explicit `timezone` query parameter |

**A stack with six of these has six different definitions of "yesterday".**

The Snowflake default is worth its own line: a session that never sets
`TIMEZONE` frequently runs in America/Los_Angeles, so a warehouse that everyone
believes is in UTC is producing Pacific day boundaries.

---

## 2. `timezoneStatus` is carried explicitly

Three values, on every source:

| Status | Meaning |
|---|---|
| `confirmed` | read from a response field or a settings API in this session |
| `assumed` | inferred from documentation or a previous session |
| `unconfirmed` | not established |

**Doing arithmetic in UTC does not establish that the source reports in UTC.**
This is the specific error: an agent converts everything to UTC, does correct
arithmetic, and reports day totals that do not match the source UI, because the
source never reported in UTC in the first place.

**Where the status is `unconfirmed`, day-boundary comparison against the source
UI is disabled or caveated, and the exact input that would resolve it is
recorded.**

```yaml
- source: crm
  timezone: unknown
  timezone_status: unconfirmed
  resolves_with: "the integration user's timezone setting, from the user
                  record; report output uses the running user's timezone"
  effect_while_unconfirmed: "day-level totals may differ from the UI by up to
                             one day's activity at each window edge"
```

Confirmable from a response field where one exists: GA4
`ResponseMetaData.timeZone`, Google Ads `customer.time_zone`, Meta account
timezone, Looker `query_timezone` on the query object.

---

## 3. Week and fiscal conventions differ too

| System | Week start |
|---|---|
| BigQuery `DATE_TRUNC(x, WEEK)` | **Sunday** (`WEEK(MONDAY)` for ISO) |
| Snowflake | `WEEK_START` and `WEEK_OF_YEAR_POLICY` session parameters |
| Tableau | a site-level start-of-week; Pulse supports custom calendars |
| Looker | configurable per model |
| Most ad platforms | account setting |
| ISO 8601 | Monday |

**A GTM agent reporting "this week's pipeline" must state its convention.**
A Sunday-start week and a Monday-start week disagree on one seventh of the
data at every boundary, and the disagreement is systematic, not random.

Fiscal calendars compound it: a fiscal quarter ending on the Saturday nearest
31 January is not any calendar quarter, and a fiscal year with 4-4-5 periods
has periods of different lengths, which breaks period-over-period comparison
unless it is handled.

---

## 4. Restatement windows, mapped per source

| Source | Restatement behaviour |
|---|---|
| **Meta** | settles over roughly **28 days** |
| **Google Ads** | back-fills conversions **up to 90 days** |
| **GA4** | reprocesses over **24-48 hours** |
| **Klaviyo** | an attribution-window change **restates all history retroactively** |
| **Bizible-style touchpoint systems** | recalculate touchpoints on their own schedule |
| **Billing systems** | refunds, chargebacks and credits land weeks later |
| **CRM** | close dates and amounts are edited after close |

**There is no date on which all sources are simultaneously final except
roughly 90 days back.**

Consequences to enforce:

- **Any answer about a recent window is labelled provisional**, with the
  settlement window named.
- A comparison between a settled period and an unsettled one is comparing a
  final number to a partial one. Either wait, or compare at equal maturity
  (both periods measured N days after their close).
- **Restated ad data read as a trend** is a specific failure: conversions
  backfilled into last month make last month look better than it did at the
  time, and the "improvement" is the backfill.

### Detecting restatement directly

Re-read the same window later and diff. That diff **is** the restatement, and
it is the only way to measure it for a source that does not publish its
settlement behaviour.

```sql
-- store every read; the diff between reads on the same business window
-- is the restatement
select business_date, read_at, value,
       value - lag(value) over (partition by business_date order by read_at)
         as restatement
from   metric_reads
order by business_date, read_at;
```

---

## 5. Equal window is not equal coverage

Two windows of the same length can contain different amounts of observed data:
a pipeline outage, a tracking gap, a source onboarded partway through, a
holiday shutdown.

**Compute and display covered-day counts on both sides.** Where they differ:

- use an **observed-day rate** (value per covered day), or
- **suppress the comparison** and say why.

```sql
select
  sum(case when side = 'a' and has_data then 1 else 0 end) as a_covered_days,
  sum(case when side = 'b' and has_data then 1 else 0 end) as b_covered_days
from window_coverage;
-- assert equality, or switch to a per-covered-day rate
```

Join to `dim_date`, not to the fact's own distinct dates, so gaps are visible
rather than silently skipped. Without a date spine a missing day does not
appear as zero; it does not appear at all, and the line connects across it.

---

## 6. Comparison endpoints are derived per row, never hardcoded

```sql
-- WRONG: silently invalidates every record added after this was written
where event_date between '2026-01-01' and '2026-06-30'
  and prior_date between '2025-01-01' and '2025-06-30'

-- RIGHT: the comparison endpoint derives from the row's own event date
select
  event_date,
  value,
  lag(value, 365) over (order by event_date) as value_prior_year
from daily;

-- RIGHT: relative to a parameter, not a literal
where event_date >= :period_start
  and event_date <  :period_start + interval '6 months'
```

A hardcoded endpoint is correct on the day it is written and quietly wrong
forever after. The failure is invisible, because the query still runs and still
returns rows.

---

## 7. The last bar is always short

**Exclude it or mark it. On every trend. No exceptions.**

The current day, week, month or quarter is partial by definition, and a partial
bar in a trend chart reads as a decline. Combined with a restatement window it
is doubly misleading: the last bar is both incomplete and still rising.

```sql
assert last_bucket_end <= data_as_of
    or last_bucket_is_marked_incomplete;
```

Three acceptable treatments: drop the bar, render it in a distinct style with a
label, or annualise/prorate it and label it as prorated. **Silently including
it is not one of them.**

---

## 8. Three clocks, shown separately

| Clock | What it is |
|---|---|
| **deployment time** | when the artefact or query was last shipped |
| **bake / extract time** | when the data was last pulled or the model last ran |
| **source data freshness** | the latest business date the source actually has |

These are independent. **Bake time is not source freshness, and neither is
deployment time.**

**Object metadata is not data recency.** A table's `last_modified` timestamp is
metadata about the object, not about the business dates inside it. A model that
ran successfully at 06:00 against a source that stopped delivering at midnight
has a fresh bake time and stale data, and the pipeline reports success.

Assert freshness on the **business date**, not on the load timestamp:

```sql
select case when max(event_date) >= current_date - 1 then 'pass'
       else 'FAIL: latest business date is ' || max(event_date)
            || ' but the model ran at ' || :last_run_at end
from fact;
```

A related failure: **a fresh deployment serving a stale artefact.** The deploy
succeeded, the cache or the CDN did not invalidate, and the page shows
yesterday's numbers with today's deploy timestamp on it.

---

## 9. Output

```
timezone_status[]:
  source, timezone, status (confirmed|assumed|unconfirmed),
  evidence, resolves_with, effect_while_unconfirmed
week_convention[]:
  source, week_start, fiscal_calendar, stated_on_output: bool
coverage[]:
  comparison_id, side_a_covered_days, side_b_covered_days,
  equal_coverage: bool, treatment (as-is | per-covered-day | suppressed)
restatement_map[]:
  source, settlement_window, currently_provisional: bool,
  measured_restatement (where re-reads exist)
incomplete_periods[]:
  artefact, period, treatment (dropped | marked | prorated)
clocks[]:
  artefact, deployment_time, bake_time, source_data_freshness
findings[]: with severity and the runnable assertion
```

---

## 10. Answering

**Answer first.** Give the period comparison, then name the temporal caveats in
one sentence each: "Q3 is up 8% against Q2. Q3's last two weeks sit inside
Meta's 28-day settlement window so the figure will rise; Q2 had a three-day
tracking gap so its base is slightly understated, which flatters the
comparison."

That is more useful than either the bare 8% or a refusal, and it names the
direction of each error.

**Withhold only** where the timezone status is unconfirmed **and** the question
is specifically a day-boundary comparison against a source UI. That is
`unavailable` for the day-level comparison, with the aggregate-level comparison
still given, and the exact input that would resolve it named.

## References

- `references/timezone-register.md` — the per-platform rules, where to confirm
  each, and the conversion patterns
- `references/restatement-and-coverage.md` — settlement windows, measuring
  restatement, and the coverage checks

## Related skills

- `provenance-block` carries `timezone`, `timezone_source`, `timezone_status`
  and `freshness` on every number.
- `comparability-rules` for what may be compared at all.
- `cross-system-reconciliation` when the timezone difference is the cause of a
  cross-system gap.
- `data-quality-harness` for scheduling the freshness assertions.
