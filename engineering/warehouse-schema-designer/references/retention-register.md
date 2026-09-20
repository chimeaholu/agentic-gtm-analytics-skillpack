# Retention register — what the platform drops, and what you must land to survive it

The design question this file answers: **if I land only what I need today, what
question becomes permanently unanswerable in eighteen months?**

Retention is the one warehouse decision with no remedy. A partition key can be
changed by rebuilding a table. A missing year cannot be bought.

---

## 1. The register

| Source | Known limit | What to land, at what cadence | What is lost if you do not |
|---|---|---|---|
| **Marketo** activity data | roughly 25 months, contract-dependent | daily incremental pull of activity types you report on, into `raw`, keyed by activity id | any activity-based trend older than the horizon; lead-scoring history; email engagement history |
| **LinkedIn Ads** demographic reporting | 2 years | monthly demographic pull per campaign | audience-composition trend and year-over-year demographic comparison |
| **LinkedIn Ads** daily granularity | 6 months | **daily** pull, not monthly rollup | any day-level analysis older than 6 months, including day-of-week effects and burst diagnosis |
| **Meta** unique metrics (reach, unique clicks) | 13 months | daily pull at the grain you will report | year-over-year reach and frequency comparison — and these are **not reconstructable** from impressions, because uniques are not additive |
| **Meta** frequency metrics | 6 months | daily pull | frequency trend |
| **GA4** event-level data | a property setting, commonly 2 or 14 months — **read the property's data-retention setting, do not assume** | the BigQuery export daily, or a daily Data API pull at your reporting grain | exploration-level and event-level history beyond the setting; standard aggregate reports are retained differently from event-level data |
| **Salesforce** field history | tracked fields only, with retention limits, **and only from the date tracking was enabled** | your own daily `fact_opportunity_snapshot` | pipeline movement, slippage, stage duration — see `data-model-designer` §2 |
| **HubSpot** lifecycle-stage date properties | **overwritten on re-entry** | daily snapshot of the properties you trend | the first journey of any contact that cycles through a stage twice |
| **Segment** Delivery Overview / observability | materially shorter than event retention | daily pull of delivery metrics if you do pipeline forensics | ability to answer "when did this destination start failing" beyond the window |
| **Amplitude / Mixpanel** after a GDPR deletion | removed from future queries, retained in prior exports | replay deletions against your warehouse copy | **compliance drift in the other direction** — your copy keeps what the source deleted |

---

## 2. Two rules that follow from the table

### Non-additive metrics are the ones you truly cannot reconstruct

A daily sum can be rebuilt from daily rows. **A unique count cannot.** Reach,
unique clicks, unique users and any distinct-count are not summable across
days, so a monthly rollup you kept does not let you answer a weekly question,
and yesterday's daily uniques do not let you compute this month's uniques.

Consequence: **for non-additive metrics, land every grain you will ever report
at.** For additive metrics, the finest grain you land is enough, because
everything coarser is derivable.

### Retention settings delete silently and on a timer

`partition_expiration_days` in BigQuery and a `DATA_RETENTION_TIME_IN_DAYS`
change in Snowflake are writes with a delayed, irreversible effect. They go
through `write-gate` with the blast radius stated as *"this deletes N
partitions on <date> and they are not recoverable after the time-travel
window"*, not as a config tweak.

Default to no expiration on `raw` and on facts. Set expiration deliberately on
scratch, intermediate and profiling tables, where rebuilding is cheap.

---

## 3. The first-landing date is an answer, not an apology

Every warehouse has a date before which it holds nothing. Publish it per
source, in `config.source_register`:

```
source, first_landed_date, cadence, grain, retention_policy, backfill_possible_until
```

`backfill_possible_until` is the important column: it is the earliest date the
*source* can still serve, which for Marketo is roughly 25 months back and for
LinkedIn daily data is 6 months back. **The gap between `first_landed_date` and
`backfill_possible_until` is the window you can still rescue** — and it shrinks
every day.

When asked for a trend that predates `first_landed_date`:

1. Give the trend you **do** have, with its start date stated.
2. Name the missing period explicitly as `unavailable`, not as zero.
3. Say whether a backfill is still possible from the source and until when. If
   it is, that is an action worth taking this week rather than an explanation.
4. If a coarser series exists for the missing period (a monthly rollup someone
   exported, a screenshot-era spreadsheet in `config`), offer it labelled as a
   different series that will not reconcile with the fine-grained one.
