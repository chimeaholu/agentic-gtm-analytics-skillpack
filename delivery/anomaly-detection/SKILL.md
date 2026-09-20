---
name: anomaly-detection
description: Use when setting up monitoring or alerting on GTM metrics, or when investigating whether a sudden metric movement is real. Progresses from static thresholds to seasonal baselines to robust statistical detection, uses median and MAD rather than mean and standard deviation so one prior spike cannot mask today's, and alerts on data-pipeline failure separately and louder than on metric movement. Prevents alert fatigue, and prevents "revenue dropped 90%" and "the ingest job failed" looking identical on a chart when they require opposite responses.
---

# Anomaly Detection

Two facts govern everything below. **A broken pipeline and a business collapse
produce the same chart and demand opposite responses.** And **an alert that fires
every week is furniture** — people stop seeing it, including the week it is
right.

**Core contracts this skill must call:** `answer-contract` (an alert is a number
reaching a human, under time pressure, with less context than usual),
`provenance-block` (the alert carries the window, timezone and basis it fired
on), `comparability-rules` (a baseline built across a definition change is not a
baseline), `warning-field-reader` (a source warning is a pipeline signal, not a
metric signal), `rate-limit-governor` (Tier 2 detection issues extra queries on a
schedule, which is a standing budget), `pagination-patterns` (a capped extract
produces a fake drop every single run).

---

## 1. Data-pipeline failure alerts separately, and louder

**This is the requirement almost always missed**, so it is first.

Two alert classes, two channels, two response paths:

| Class | Fires on | Goes to | Response |
|---|---|---|---|
| **Pipeline health** | no rows loaded, row count collapse, freshness breach, schema change, source error rate, extraction cap hit | on-call / data owner | **fix the pipeline** |
| **Metric movement** | the business number moved beyond its baseline | the metric owner | **investigate the business** |

**Check pipeline health first, and suppress the metric alert when the pipeline
alert fires.** A metric alert emitted while the pipeline is broken is not just
noise: it sends the metric owner to investigate a business decline that did not
happen, and they will find a plausible-looking cause, because there is always a
plausible-looking cause.

```python
def evaluate(metric, window):
    health = pipeline_health(metric.source, window)
    if not health.ok:
        return Alert(class_='pipeline', severity='high', detail=health.reason,
                     owner=metric.source_owner, action=health.runbook,
                     suppresses='metric')          # the metric alert does not fire
    return metric_alert(metric, window)
```

The pipeline checks worth running, every load:

```sql
-- 1. rows landed at all
select case when count(*) = 0 then 'FAIL: zero rows loaded' else 'pass' end from stg_source;

-- 2. row count against the prior load — order-of-magnitude changes are a data
--    quality event, not a trend
select current_rows, prior_rows,
       case when prior_rows > 0 and (current_rows::float / prior_rows < 0.5
                                  or current_rows::float / prior_rows > 2.0)
            then 'FAIL: row count moved ' || round(100.0*current_rows/prior_rows) || '% of prior load'
            else 'pass' end
from load_counts order by loaded_at desc limit 1;

-- 3. freshness on the BUSINESS date, not the load timestamp
select case when max(event_date) >= current_date - 1 then 'pass'
            else 'FAIL: latest business date is ' || max(event_date) end from fct;

-- 4. the extraction cap — a capped extract drops the same amount every run
select case when rows_returned >= row_cap then 'FAIL: extract hit the cap, figures are lower bounds'
            else 'pass' end from extract_log order by extracted_at desc limit 1;
```

Check 3 is the one people get wrong. **A model that ran successfully at 06:00
against a source that stopped delivering at midnight has a fresh load timestamp
and stale data, and the pipeline reports success.** Assert on the business date.

---

## 2. Two-tier detection

**Tier 1: compare against a baseline already stored in the semantic layer.**
Instant, no extra query, runs on every metric on every refresh. Covers the
overwhelming majority of real movements.

**Tier 2: only where Tier 1 flags, or for the handful of metrics that justify it.**
Issues a companion historical query and computes a robust statistic. Costs a
query per evaluation, so it is opt-in per metric and lives inside the
`rate-limit-governor` budget.

Never run Tier 2 on everything. A pack that issues a 90-day historical query for
every tile on every refresh has built a cost problem in the name of monitoring.

---

## 3. The progression, cheapest first

Stop at the first rung that catches the movements you care about.

| Rung | Method | Right when |
|---|---|---|
| 1 | **Static threshold** (`spend > X`, `error_rate > Y`) | the number has a hard business or contractual meaning |
| 2 | **Percentage change vs prior period** | the metric is stable and non-seasonal |
| 3 | **Seasonal baseline** — same weekday, trailing 4 weeks | any GTM metric with a weekly cycle, which is nearly all of them |
| 4 | **Robust statistical** — median/MAD z-score, STL residuals, forecast-interval breach | volatile metrics where a fixed band fires constantly |
| 5 | **Segment decomposition** of a confirmed anomaly | always, on anything that fires — this is the diagnosis |

Most teams jump to rung 4 and skip rung 3, which is backwards: **the weekly cycle
is the largest single source of false positives in GTM data**, and it is removed
by a same-weekday baseline with no statistics at all.

```sql
-- rung 3: same weekday, trailing 4 weeks
select d.metric_date, d.value,
       avg(h.value) as baseline,
       d.value / nullif(avg(h.value), 0) - 1 as pct_vs_baseline
from   daily d
join   daily h
  on   extract(dow from h.metric_date) = extract(dow from d.metric_date)
 and   h.metric_date between d.metric_date - 28 and d.metric_date - 1
group  by d.metric_date, d.value;
```

`nullif(..., 0)` is not decoration. **A ratio with a zero denominator is
`unavailable`, not infinity and not "infinite growth"** — and a baseline of zero
is exactly the case where a naive percentage-change alert emits a meaningless
enormous number at 3am.

---

## 4. Robust z-score: median and MAD, not mean and sigma

**One prior spike inflates the standard deviation enough to hide today's spike.**
That is the failure mode, it is common, and it is why the detector that most
needs to catch the second incident is the one that misses it.

```
MAD   = median( |xᵢ − median(x)| )
z_rob = 0.6745 × (x − median(x)) / MAD
```

0.6745 is the normal distribution's 0.75 quantile, so `z_rob` is on the same
scale as an ordinary z-score under normality: **|z_rob| > 3.5 is the conventional
outlier threshold** (equivalently, scale MAD by 1.4826 and use the usual z).

```python
import numpy as np

def robust_z(series: np.ndarray, x: float) -> float | None:
    med = np.median(series)
    mad = np.median(np.abs(series - med))
    if mad == 0:
        # constant or near-constant history. MAD-based z is undefined, not zero,
        # and not infinite. Fall back to an absolute rule and say so.
        return None
    return 0.6745 * (x - med) / mad
```

**`mad == 0` returns `None`, not a number.** A constant history — a metric that
has been exactly 40 every day — makes MAD zero, and dividing by it gives infinity
for any deviation at all, including 41. That produces a critical alert for a
one-unit move. On `None`, fall back to an absolute-change rule and label the
alert as using a fallback method.

### Two cases where z-scores of any kind are the wrong tool

**Low counts.** For a metric averaging 3 conversions a day, the distribution is
Poisson-ish and asymmetric; a z-score threshold fires constantly on the upside
and can never fire on the downside, because zero is less than three standard
deviations away. Use a Poisson tail probability, or aggregate to a window where
the count is large enough (roughly 30+) that normal approximations behave.

```python
from scipy.stats import poisson
p_low  = poisson.cdf(observed, mu=baseline)          # unusually low
p_high = poisson.sf(observed - 1, mu=baseline)       # unusually high
```

**Trending metrics.** A metric growing 5% a month is "anomalous" against its own
90-day median every single day by construction. Detrend first — STL on the
residual, or a z-score on the period-over-period change rather than the level.

---

## 5. Restated data is not an anomaly

Every one of these produces movement in recent windows that is *expected*, and a
detector that does not know about them fires every day:

| Source | Restatement window |
|---|---|
| Meta | settles over roughly **28 days** |
| Google Ads | back-fills conversions **up to 90 days** |
| GA4 | reprocesses over **24–48 hours** |
| Klaviyo | an attribution-window change **restates all history retroactively** |
| Bizible-style touchpoint systems | recalculate on their own schedule |
| Billing | refunds, chargebacks and credits land weeks later |
| CRM | close dates and amounts are edited after close |

**Exclude the restatement window from detection.** Evaluate day *D* only once *D*
is older than the source's settlement window.

```python
eval_date = today - timedelta(days=SOURCE_SETTLEMENT_DAYS[source])
```

The cost is honest and must be stated: **detection latency equals the settlement
window.** A 28-day settling source cannot be monitored for genuine metric
movement at one-day latency, full stop. What you can monitor at one-day latency
is *pipeline health* — did data arrive, did the row count hold, did the schema
change — which is the class that needs to be fast anyway.

Where a business genuinely needs faster ad-metric detection, monitor the
**restatement-adjusted series**: compare today's D-1 value against the historical
distribution of *D-1 values as they looked at D-1*, not against settled values.
That is a different, comparable series, and it works. Building it requires
storing every read (§6).

---

## 6. Measure the restatement instead of guessing it

Store every read. The diff between two reads of the same business date **is** the
restatement, and it is the only way to know a source's real settlement behaviour
rather than its documented one.

```sql
create table metric_reads (
  metric      text, business_date date, read_at timestamp,
  value       numeric, source text,
  primary key (metric, business_date, read_at)
);

-- how much does this source still move, by age?
select current_date - business_date as days_old,
       avg(abs(value - lag(value) over (partition by metric, business_date order by read_at))
           / nullif(value, 0)) as avg_pct_restatement
from   metric_reads
group  by 1 order by 1;
```

That query gives you the empirical settlement window for your org, your account
and your configuration, which is frequently shorter than the documented one and
occasionally much longer. Use it to set the exclusion window in §5 rather than
using the vendor's number as gospel.

---

## 7. Every alert names an owner and an action

An alert with neither is a notification, and notifications get muted.

```yaml
alert:
  id: pipeline_created_weekly_drop
  class: metric                      # metric | pipeline
  metric: pipeline_created
  definition_id: pipeline_created@v3
  grain: day
  method: seasonal_baseline          # + robust_z on escalation
  baseline: same_weekday_trailing_4w
  threshold: { direction: down, pct: 30 }
  evaluate_on: D-2                   # CRM close-date edits settle by then
  min_volume: 30                     # below this, the rate is too noisy to alert on
  owner: "demand generation lead"    # a role, never a person's name
  action: |
    1. Check the pipeline-health channel first — is the CRM extract green?
    2. Segment by source, segment and owner (§8) before escalating.
    3. If it is one channel, route to that channel owner with the decomposition.
  suppression:
    - { reason: "quarter-end", cron: "last 3 business days of quarter" }
    - { reason: "company holiday", calendar: "gtm_holidays" }
    - { reason: "known migration", window: ["2026-11-02", "2026-11-09"] }
  escalation_after: 2                # consecutive fires before paging
  auto_retire_if: "fires more than 4 times in 8 weeks with no action taken"
```

Four fields earn their place:

- **`min_volume`.** A conversion-rate alert on 4 sessions will fire. Suppress
  below a volume floor and say the floor exists, otherwise small segments generate
  most of the alert traffic and none of the value.
- **`suppression`, declared in advance.** Launches, sales, holidays, migrations,
  quarter-end. **Declared beforehand, not explained afterwards** — an explanation
  after the fact is indistinguishable from an excuse.
- **`escalation_after`.** One anomalous day is usually noise; two consecutive is
  usually real.
- **`auto_retire_if`.** An alert that fires repeatedly with no action taken is
  measurably furniture. Review it, retune it or delete it. **Deleting an alert
  nobody acts on is an improvement**, and saying so out loud is how an alert estate
  stays small enough to be read.

---

## 8. Segment decomposition turns an alert into a diagnosis

"Conversions fell 30%" is an alert. "Conversions fell 30%, entirely in paid
search on mobile, and organic and desktop are flat" is a diagnosis with an owner
already attached. **Run the decomposition automatically on every confirmed
anomaly, before a human reads it.**

```sql
with cur as (select segment, sum(value) v from f where d between :s2 and :e2 group by 1),
     pri as (select segment, sum(value) v from f where d between :s1 and :e1 group by 1)
select coalesce(cur.segment, pri.segment) as segment,
       pri.v as prior, cur.v as current,
       coalesce(cur.v,0) - coalesce(pri.v,0)                       as abs_change,
       (coalesce(cur.v,0) - coalesce(pri.v,0))
         / nullif(sum(coalesce(pri.v,0)) over (), 0)               as share_of_total_change
from cur full outer join pri using (segment)
order by abs(coalesce(cur.v,0) - coalesce(pri.v,0)) desc
limit 5;
```

Three rules that keep the decomposition honest:

1. **Rank by absolute contribution, not by percentage change.** A segment that
   fell 80% from a base of 12 is not the story; one that fell 9% from a base of
   40,000 is.
2. **`full outer join`, not `inner`.** A segment that disappeared entirely is the
   most informative result available, and an inner join deletes it.
3. **Check whether the segment *definition* changed** before concluding the
   segment moved. A renamed channel, a retired campaign taxonomy or a new UTM
   convention produces a segment that "fell 100%" while nothing happened. This is
   the most common false diagnosis at this step.

Stop at two levels of decomposition. Three levels of cross-segmentation produces
cells small enough that something always looks anomalous — that is multiple
comparisons, not insight.

---

## 9. Answering

**Answer first**, even at 3am, even with a caveat:

> **Pipeline created is down 34% against the same weekday over the last four
> weeks** — 88 opportunities against a baseline of 133. The CRM extract is green
> and row counts are normal, so this is not a pipeline failure. It is
> concentrated: one segment accounts for 29 of the 45 missing opportunities, and
> the rest of the business is within normal range. The last two days sit inside
> the CRM's close-date edit window, so the figure will move slightly upward; the
> direction and magnitude will not change. Owner: demand generation lead.

Note the order: the number, the pipeline-versus-business determination, the
decomposition, the direction of the remaining error, the owner.

**Withhold only what cannot honestly be computed.** If the pipeline is broken,
the metric movement is genuinely unknown — say that plainly, do not report the
observed drop as a business result, and do not report it as zero:

> The ingest job has not run since Tuesday 06:00, so today's figure reflects two
> days of missing data rather than a business change. The metric is
> **unavailable** until the backfill completes. Yesterday's last good value was
> 131, in line with baseline. Pipeline owner has been paged; expected resolution
> after the next successful load.

**Never** report the drop caused by a broken pipeline as a business movement. That
is the single failure this skill exists to prevent, and it is the one that sends a
team into a week of investigating something that did not happen.

---

## Files

- `references/detection-methods.md` — the statistical methods with runnable
  implementations, threshold selection, and what each one cannot detect
- `references/alert-design.md` — the alert registry schema, suppression
  calendars, alert-estate review, and the pipeline-health check suite
- `evals/cases.json` — behavioural cases including the honest-limit cases

## Related skills

- `data-quality-harness` owns the pipeline-health assertions this skill alerts on
- `temporal-integrity-audit` for restatement windows and coverage gaps
- `timeseries-forecasting-models` for forecast-interval breach as a detector
- `model-evaluation-monitoring` for drift on scored metrics
- `gtm-metric-dictionary` for the definition the baseline is built on
- `report-generator` — a daily report is usually an alert in the wrong clothes
