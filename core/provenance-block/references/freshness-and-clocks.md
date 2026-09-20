# Freshness, settling windows and the three clocks

## The three clocks

| Clock | Answers | Read from |
|---|---|---|
| **Deployment time** | when did the definition last change | version control, the BI object's `updated_at`, the deploy log |
| **Bake / extract time** | when was this data last materialised | extract refresh timestamp, pre-aggregation refresh, PDT build time, materialisation run |
| **Source data freshness** | how recent is the newest fact the source holds | the max event timestamp, the pipeline watermark |

They move independently. The failure mode is assuming one implies another:

- **A fresh deployment serving a stale artefact.** The dashboard shipped an hour
  ago; the extract behind it ran yesterday; the source has today's data. The
  chart is wrong and everything about it looks current.
- **Object metadata mistaken for data recency.** `manifest.json`'s
  `metadata.generated_at`, a report's `updated_at`, a dataset's modified time.
  These describe the **object**, not its contents. A dbt manifest generated five
  minutes ago can describe a model that last ran a week ago, or that no longer
  exists.
- **A cache serving pre-change rows.** The filter changed, the definition
  changed, the model changed. The cache did not. The number is internally
  consistent and answers the previous question.

**Rule.** Report the clock the question depends on. Where the gap between clocks
is material to the answer, report all three. "Dashboard updated today" is not an
answer to "is this data current".

## Settling windows

A settling window is the period during which a platform will still change
already-reported numbers, with no error and no notification.

| Platform | Window | Mechanism |
|---|---|---|
| **Google Ads** | up to 90 days | conversions back-fill onto the original **click date**. A completed day's conversions keep rising for weeks |
| **Meta** | 28 days | restatement as attribution resolves and modelled conversions are estimated |
| **GA4** | 24 to 48 hours | processing lag on standard properties. Also: data-deletion requests silently change historical numbers for reports already run |
| **LinkedIn** | short | reports on conversion date, so less back-fill. Daily granularity is only available for the trailing 6 months |
| **Email and lifecycle** | days | opens, clicks and conversions accrue after send. Attribution basis choice (send time versus conversion time) changes which day they land on |
| **CRM** | unbounded | records are edited. A closed-won deal can be reopened, re-amounted, or re-dated. Point-in-time is only recoverable from field history or a snapshot |
| **Mixpanel** | unbounded in a different way | a project timezone change **retroactively re-buckets historical reports**. The data did not change; the answer did |

### The consequence to state out loud

> There is no date on which the major ad and analytics platforms are
> simultaneously final, except roughly 90 days back.

Which means:

- A week-over-week comparison where this week is inside a settling window and
  last week is not compares a provisional number to a settled one. The
  provisional one is low. **The trend will look worse than it is.**
- A month-end report run on the 1st is not the same report run on the 15th, for
  Google Ads and Meta, with no error in either.
- If a stakeholder disputes a number you gave three weeks ago, check
  restatement before checking your query.

### The rule

Mark `provisional: true` whenever `data_as_of` falls inside `settles_after`.
When it is true and the comparison crosses the boundary, either:

1. shift both windows outside the settling period, or
2. compare like-for-like by re-querying the prior period as-of the same lag, or
3. state the direction: "the current period is provisional and will revise
   upward, so the decline shown here is partly an artefact of timing".

Option 3 is usually right, because 1 and 2 cost a query budget and the user
asked about this week.

## Detecting staleness per platform

| Platform | Field or signal |
|---|---|
| Tableau | `hasExtracts`, `extractLastRefreshTime` — the only way to know the number is hours stale |
| Power BI | dataset refresh history; note that a 200 response can carry an `error` object in the body |
| Looker | PDT build time; `query_timezone` on the query |
| Cube | pre-aggregation refresh key and last refresh |
| dbt | `metadata.generated_at` on `manifest.json` — always check, and remember it describes the artefact |
| Snowflake, BigQuery | your own pipeline watermark table; the warehouse will not tell you the source is behind |
| GA4 | no explicit field. Infer from the window: anything inside 48 hours is provisional |
| Meta, Google Ads | no explicit field. Infer from the settling windows above |

Where there is no field, the settling window **is** the mechanism. Infer and
label rather than staying silent, because silence reads as "settled".
