# Cohort construction

The cohort is the denominator. Every rate downstream inherits its definition,
so the four decisions below are made explicitly and emitted with the result.

## 1. The four decisions

### (a) Entry event

| Rule | Definition | Effect |
|---|---|---|
| **First entry** (default) | the first time the record reached stage A | stable; a record appears in exactly one cohort |
| Any entry | every time the record entered stage A | a record can appear in several cohorts; totals exceed the population |
| Current-stage-at-date | records sitting at A on the cohort date | **this is a snapshot, not a cohort** — do not label it one |

Use first entry unless the org's process genuinely recycles records through a
stage as a matter of course, in which case say so and show both.

### (b) Conversion window

```
window_days = observed p75 (or p90) duration of the A→B transition,
              measured over mature historical records
```

- p75 is the usual choice: long enough that most real conversions land inside
  it, short enough that cohorts mature within a reporting cycle.
- p90 is right where the tail matters and you can wait for maturity.
- **"Ever converted" is an unbounded window.** It never matures, so every recent
  cohort is understated and the curve always appears to be declining. If the org
  insists on it, the most recent cohorts must be marked as lower bounds
  permanently.
- Where the p75 cannot be measured (no history), say the window is assumed, give
  the assumption, and show how the rate moves at two window lengths.

### (c) Skips

A record that went A→C without a recorded B **converted A→B** for funnel
purposes under the default rule, because the funnel measures progression, not
attendance. Where the org's stages are genuinely gating (B must happen), say so
and count the skip as non-conversion — but then also report skip frequency,
because frequent skips mean the gate is not a gate.

### (d) Backwards moves and re-entry

Use **max stage reached within the window**, not current stage. A record that
reached B and returned to A has converted A→B. Re-entries are counted once
under the first-entry rule.

## 2. Maturity

```
maturity(cohort) = min(1, (today − cohort_end_date) ÷ window_days)
```

| maturity | Label | Use |
|---|---|---|
| 1.0 | final | trends, benchmarks, forecasting inputs |
| 0 < m < 1 | **lower bound** | show it, greyed or explicitly annotated; never in a trend claim |
| n/a (cohort not yet closed) | in progress | show the partial cohort size, not a rate |

**Common-horizon comparison.** To compare cohorts of different ages honestly,
truncate every cohort to the largest horizon all of them have reached:

```
horizon = min over cohorts of (today − cohort_end_date)
rate_at_horizon(cohort) = converted within `horizon` days ÷ cohort size
```

A day-30 rate across six cohorts is a genuine trend. A terminal rate across six
cohorts of different ages measures cohort age.

## 3. Per-platform stage-history register

| Source | Object / field | What it gives | What it costs you |
|---|---|---|---|
| Salesforce | `OpportunityHistory` | `OpportunityId`, `StageName`, `CreatedDate`, `Amount`, `CloseDate`, `ExpectedRevenue` at each change | only exists from the date tracking was enabled; earlier deals have no rows at all |
| Salesforce | `OpportunityFieldHistory` | `Field`, `OldValue`, `NewValue`, `CreatedDate` | only for fields explicitly tracked (20-field limit per object); subject to retention policy |
| Salesforce | `LeadHistory` | lead field changes incl. status | same enablement and retention caveats |
| Salesforce | `Opportunity.StageName` + `LastStageChangeDate` | current stage and when it last changed | one transition only — cannot reconstruct a path |
| HubSpot | `hs_v2_date_entered_<stage>` / `hs_v2_date_exited_<stage>` | entry and exit per deal stage | **overwritten on re-entry**; re-entry is undercounted and durations are wrong |
| HubSpot | `hs_lifecyclestage_<stage>_date` | lifecycle stage dates on contacts | same overwrite behaviour |
| HubSpot | `hs_date_entered_<pipeline>_<stageId>` (legacy form) | as above | stage IDs are portal-specific; resolve them from the pipeline API, never hard-code |
| Marketo | Bulk Activity Extract, activity types from `GET /rest/v1/activities/types.json` | status-change and program-status activities | activity retention is finite (commonly ~25 months, contract-dependent) — verify per subscription before a year-over-year claim |
| Warehouse | `fact_lead_stage`, `fact_opportunity_snapshot` | full daily state | nothing; this is why the snapshot table is non-optional |

**Two traps worth repeating.** Salesforce history tables are usually switched on
*after* someone first asks for this analysis, so the history is shorter than the
period requested — check the earliest row before assuming coverage. And
HubSpot's overwrite-on-re-entry behaviour is silent: the data looks complete,
and the re-entry simply is not there.

## 4. Extraction discipline

A truncated extraction biases every rate in the same direction, and it looks
like a clean result.

- **Salesforce report API caps detail rows at 2,000 with no pagination** while
  computing aggregates over the full set — so totals can be right while the
  rows behind them are incomplete. Check `allData`; for real cohort extraction
  use Bulk API 2.0 against the objects.
- **HubSpot CRM Search hard-caps at 10,000 results** regardless of paging.
  Shard by sorting ascending on `hs_lastmodifieddate` or `hs_object_id` and
  using the last value of each page as a `GT` filter for the next window.
- **HubSpot search never returns archived records**, and list endpoints exclude
  them unless `archived=true`. A cohort built from search silently shrinks as
  records are deleted, and nothing in the response says so.
- **Marketo Bulk Activity Extract caps at a 31-day range per job**; longer
  windows must be chunked, and the chunks must not overlap or records
  double-count.

## 5. Cohort validation before use

1. **Cohort sizes over time.** A step change in cohort size usually means a
   routing, import or definition change rather than demand.
2. **Sum check.** In a cohort funnel, stage counts do **not** sum to the
   population. If they do, a snapshot has been mislabelled.
3. **Window sensitivity.** Recompute at 0.5× and 2× the window. A rate that
   moves a lot is telling you the window choice is load-bearing and belongs in
   the output.
4. **Earliest-history check.** Confirm stage history exists for the whole
   requested period. If it starts partway through, the earlier cohorts are not
   "0% converting" — they are unmeasurable.
