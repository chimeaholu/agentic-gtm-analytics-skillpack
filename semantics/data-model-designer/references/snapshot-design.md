# Snapshot table design

The argument for daily snapshots is not elegance. It is that the history is
**unrecoverable retroactively**, so the cost of not building it is unbounded
and the cost of building it is a few cents a day.

---

## 1. What the source systems do and do not preserve

| Source | What it keeps | What it loses |
|---|---|---|
| Salesforce `OpportunityHistory` | stage and amount changes | only from when tracking was enabled; retention-limited |
| Salesforce `OpportunityFieldHistory` | changes to **tracked fields only** | untracked fields entirely; tracking is capped per object and is usually enabled after someone needed it |
| HubSpot `hs_lifecyclestage_*_date` | the date a contact entered a stage | **overwritten on re-entry**: a contact that cycles twice loses its first journey |
| HubSpot property history API | per-property change log | practical rate limits make full-object daily reconstruction expensive |
| Marketo activities | activity stream | not a state history; you must reconstruct state from it |
| Most billing systems | subscription events | the derived MRR at a point in time, unless you compute and store it |

The pattern: **event history exists where the vendor decided it should, and
state history almost never exists.** A snapshot is how you get state history.

---

## 2. What to snapshot

### `fact_opportunity_snapshot`

One row per open (and recently closed) opportunity per day.

```
snapshot_date          date      -- partition key
opportunity_id         text
account_id             text
owner_id               text
stage                  text
is_closed              boolean
is_won                 boolean
amount                 numeric
currency               char(3)
close_date             date
forecast_category      text
created_date           date
probability            numeric
next_step              text
last_activity_date     date
row_hash               text      -- hash of the tracked fields
_loaded_at             timestamp
```

`row_hash` lets you answer "did anything change" in one comparison rather than
column by column, and lets you build a change-only table cheaply if storage
ever matters.

**Retention rule:** keep closed opportunities in the snapshot for a period
after close (30 to 90 days), because deals reopen and because close-date
changes after close are themselves a finding.

### `fact_account_snapshot`

One row per active account per day, or per month if daily is not justified.
Carries ARR, segment, tier, owner, health score, contract end date. This is
what makes "NRR by the segment the customer was in at period start" possible,
which is the correct way to compute it.

### `fact_pipeline_snapshot` (derived, optional)

A daily aggregate of open pipeline by segment, stage and close-period. Cheap,
tiny, and enough for coverage trending without scanning the full snapshot.

---

## 3. What the snapshot unlocks

| Question | Needs |
|---|---|
| Pipeline created this quarter | amount at creation, from the first snapshot the opportunity appears in |
| Pipeline pushed out of the quarter | close_date moving between snapshots |
| Pipeline pulled in | close_date moving into the period |
| Amount changes on existing deals | amount diff between snapshots |
| Stage conversion, including skipped and backward moves | stage diff between snapshots |
| Stage duration | first and last snapshot per stage |
| Slippage rate | deals forecast at period start that did not close |
| Coverage on day 30 versus day 30 last quarter | the snapshot on both days |
| Forecast accuracy | the forecast category as it stood, versus the outcome |

**Every one of these is impossible from `fact_opportunity` alone**, and every
one of them is a question a VP of Sales asks in the first month.

---

## 4. Cost, which is the objection people raise

A daily full snapshot of open opportunities is, for most B2B orgs, in the low
thousands to low tens of thousands of rows per day. At 365 days that is
single-digit millions of rows: a rounding error in any warehouse.

If the volume genuinely is large:

1. **Partition by `snapshot_date`.** Every query filters on it anyway, because
   the mandatory filter rule says so.
2. **Snapshot open plus recently-closed only**, not the full historical object.
3. **Change-only rows with `row_hash`**, reconstructing the daily state with a
   window function. This costs query complexity to save storage, which is
   usually the wrong trade, so do it only if measured.
4. **Reduce cadence for low-velocity objects.** Accounts weekly is often fine.
   Opportunities daily is not negotiable, because a deal can move stage,
   change amount and slip in the same week.

Do not compress by dropping columns you do not currently use. The whole point
is the question nobody has asked yet.

---

## 5. Querying a snapshot correctly

The mandatory filter, stated in the table description in exactly these terms:

> **Always filter to one snapshot date, or join across exactly two for a
> comparison. Without a date filter you will get duplicates.**

Point-in-time state:
```sql
select * from fact_opportunity_snapshot
where snapshot_date = date '2026-09-30';
```

Period-over-period:
```sql
select
  o.opportunity_id,
  s1.amount      as amount_start,
  s2.amount      as amount_end,
  s1.stage       as stage_start,
  s2.stage       as stage_end,
  s1.close_date  as close_date_start,
  s2.close_date  as close_date_end
from fact_opportunity_snapshot s1
full outer join fact_opportunity_snapshot s2
  on s1.opportunity_id = s2.opportunity_id
 and s2.snapshot_date = date '2026-09-30'
where s1.snapshot_date = date '2026-07-01';
```

The `full outer join` matters: deals present at the end and absent at the start
are "created in period", and deals present at the start and absent at the end
are "closed or deleted in period". Both legs are findings.

Transitions:
```sql
select opportunity_id, snapshot_date as changed_on,
       lag(stage) over w as from_stage, stage as to_stage
from fact_opportunity_snapshot
qualify stage is distinct from lag(stage) over w
window w as (partition by opportunity_id order by snapshot_date);
```

`is distinct from` rather than `<>` so that transitions into or out of null are
caught. Nulls in a stage field are more common than anyone expects.

---

## 6. Gap handling

Snapshots miss days. Pipelines fail, backfills are partial, and a missing
`snapshot_date` is indistinguishable from "no opportunities existed that day"
unless you check.

Keep a `snapshot_run_log` table: one row per intended snapshot date with the
row count captured and a status. Then:

- A missing date is **`unavailable`**, not zero.
- A date with an anomalously low row count is a partial load, and any
  comparison against it is invalid. This is the same failure as the
  numerator-and-denominator-from-different-loads trap: a partial snapshot makes
  every derived rate move for no business reason.
- Join comparisons against `dim_date`, not against the snapshot's own distinct
  dates, so gaps are visible instead of silently skipped.
