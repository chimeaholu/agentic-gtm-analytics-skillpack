# Cohort versus snapshot, computed side by side

The two produce different numbers from the same data and only one of them is a
conversion rate. Conflating them is described in the domain research as the
most expensive single error in GTM analytics, because the wrong one is easier
to compute and looks identical in a chart.

---

## 1. The two computations

### Snapshot: where is everything right now

```sql
select current_stage, count(*) as units
from   fact_lead_current
group by 1;
```

Then someone divides adjacent stages and calls it a conversion rate:

```sql
-- THIS IS NOT A CONVERSION RATE
select
  count(*) filter (where current_stage = 'SQL') * 1.0
  / nullif(count(*) filter (where current_stage in ('MQL','SAL','SQL')), 0)
from fact_lead_current;
```

What it actually measures: the **shape of the current pipeline**. It moves when
volume at the top changes, when sales capacity changes, when anything sits
longer in one stage, and when nothing about conversion changed at all.

**What it is genuinely good for:** capacity planning, coverage, spotting where
volume is piling up, and staffing decisions. Those are real questions. Give the
snapshot for them and name it a snapshot.

### Cohort: of the units that entered, how many reached the next stage

```sql
with cohort as (
  select person_id, date_trunc('month', entered_at) as cohort_month
  from   fact_lead_stage
  where  stage = 'MQL'
),
reached as (
  select distinct s.person_id
  from   fact_lead_stage s
  join   cohort c using (person_id)
  where  s.stage = 'SQL'
    and  s.entered_at <= c.cohort_month + interval '90 days'   -- the window IS the metric
)
select
  c.cohort_month,
  count(*)                                        as cohort_size,
  count(r.person_id)                              as converted,
  1.0 * count(r.person_id) / count(*)             as conversion_rate,
  current_date - (c.cohort_month + interval '90 days')::date as days_past_window
from   cohort c
left join reached r using (person_id)
group by 1
order by 1;
```

Three things this version does that the snapshot cannot:

- It has a **direction in time**.
- It has an explicit **conversion window**, which is part of the metric rather
  than a display option.
- `days_past_window` makes truncation visible: any cohort with a negative value
  is incomplete.

---

## 2. Truncation, and what to do about it

A cohort measured before its window has fully elapsed shows a structurally low
rate. Three handlings, in order of preference:

**1. Mark and report as a lower bound.**
```
Aug cohort: 18.2% (complete)
Sep cohort: 11.4% (incomplete, 34 of 90 days elapsed) - lower bound
```
Best default. The recent cohort carries the freshest signal and hiding it
throws away the information people most want.

**2. Report at a shorter common horizon.**
Compare every cohort at day 30 instead of day 90. All cohorts are then complete
at day 30 and comparable. Rates are lower across the board but the comparison
is valid. This is the right move when the question is "is the recent cohort
different", because it isolates the comparison from the truncation.

**3. Estimate the completion, clearly labelled as an estimate.**
Apply the prior cohorts' day-34-to-day-90 uplift to the incomplete cohort. This
is a **model**, it assumes the shape is stable, and it must be labelled modelled
at the point of display. Useful for a forecast, not for a report of what
happened.

**Never silently drop incomplete cohorts.** The chart then ends two months ago
and nobody notices that the most recent data is missing.

---

## 3. The signature of the conflation

Symptoms that a "conversion rate" on a chart is actually a snapshot ratio:

- It is available instantly for the current month, with no lag.
- It moves when top-of-funnel volume changes, in the opposite direction.
- Nobody can say what its conversion window is.
- It goes **up** when sales stops working leads, because the middle stage
  drains.
- The sum of units across stages equals the total population, which only
  happens when every unit is counted exactly once, at its current stage.

That last one is the cheapest test. In a cohort funnel a unit appears at every
stage it passed through, so stage counts do not sum to the population.

---

## 4. Re-entry, which breaks naive cohort counts

A person who enters MQL, is recycled, and enters MQL again is one person and
two entries. Decide which:

| Rule | Effect |
|---|---|
| First entry only | undercounts activity, stable denominators, usually right for cohort rates |
| Every entry | a person can appear in two cohorts; rates become entry-rates, not person-rates |
| Latest entry only | history restates every time someone re-enters. **Avoid.** |

Whichever you choose, it goes in the metric contract register, and note that
**HubSpot overwrites the stage-entry date on re-entry**, so with HubSpot as the
source the "first entry only" rule is often not implementable from the
lifecycle date fields alone. You need either the property history API or your
own snapshot.

---

## 5. Backward moves

A funnel that ignores regression reports a higher forward rate than reality.

```sql
-- transitions, including backward, from a snapshot table
select
  opportunity_id,
  snapshot_date                                  as changed_on,
  lag(stage) over w                              as from_stage,
  stage                                          as to_stage,
  case when stage_order(stage) < stage_order(lag(stage) over w)
       then 'regression' else 'progression' end  as direction
from   fact_opportunity_snapshot
qualify stage is distinct from lag(stage) over w
window w as (partition by opportunity_id order by snapshot_date);
```

`is distinct from` rather than `<>`, so transitions into or out of null are
caught. Nulls in stage fields are far more common than anyone expects.

Regression rate per stage is a useful metric in its own right: a stage with a
high regression rate is usually a stage whose entry criteria are not being
applied.

---

## 6. Which to use, by question

| Question | Basis |
|---|---|
| "How well are we converting?" | cohort |
| "Is conversion getting better or worse?" | cohort, at a common horizon |
| "Where is our pipeline sitting?" | snapshot |
| "Do we have enough coverage for the quarter?" | snapshot |
| "How many SDRs do we need?" | snapshot for the queue, cohort for the rate |
| "What happened to leads from the September campaign?" | cohort |
| "Why did MQL→SQL drop?" | cohort, then check the definition register for a threshold change before concluding anything |

That last row is worth its own note: a drop in a cohorted conversion rate is a
real finding **unless** the stage definition changed inside the window, in
which case it is an artefact. Check the register first, every time.
