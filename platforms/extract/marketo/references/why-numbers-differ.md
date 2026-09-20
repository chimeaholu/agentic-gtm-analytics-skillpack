# Why your number will not match the Marketo report — and how to say so

This is the defining honesty requirement of this module. **Marketo's own report numbers are
not reproducible from the API and never will be exactly.** Not with more effort, not with a
better query, not ever.

## The three undocumented transformations

The Email Performance Report applies logic that is **neither documented nor exposed**:

1. **Per-person de-duplication of opens and clicks.** The UI reports **unique** opens; the
   activity stream records **every** open. One recipient opening five times is 5 in the API
   and 1 in the report.
2. **Bot filtering.** Marketo applies its own bot and scanner heuristics. You cannot see
   which activities were excluded, or on what basis.
3. **Program attribution.** Activity is attributed to programs by internal rules you cannot
   read.

**Direction of the difference: your API-derived number will be higher, sometimes by a
lot.** That is the expected result, not a defect in your extraction.

## How to present it

Give the number. Label it. Name the direction. One sentence each:

> "Across the September sends, the activity stream records 48,200 `Open Email` activities.
> That is a **gross** count, computed independently from raw activity data. The Marketo
> Email Performance Report shows **unique** opens after its own bot filtering, so its figure
> will be lower — the two are different metrics, not a discrepancy."

**What not to say:**

- "Marketo's report is wrong" — it is not
- "I'll reconcile these" — you cannot, exactly
- "Approximately 48,200 opens" — the count is exact; it is the *definition* that differs

**And never promise matching numbers up front.** A skillpack that offers "the same numbers
as the Marketo report" is promising something that cannot be delivered, and the failure
arrives at the end of the engagement rather than the start.

## Where a gross-versus-unique difference can be closed

Partially, and only by rebuilding the definition yourself:

| Metric | Reproducible? |
|---|---|
| Sends, delivered, bounces | **Usually close** — these are per-message events |
| **Unique opens** | Compute distinct lead per email per period yourself — closer, but **bot filtering still differs** |
| Unique clicks | Same |
| **Program-attributed engagement** | **No** — the attribution rules are not exposed |
| Bot-filtered anything | **No** — the heuristic is not exposed |

So the honest offer is: "I can compute a unique-open count that is *closer* to the report,
by de-duplicating per lead. It still will not match, because bot filtering is not
reproducible."

## Timezone, which adds its own gap

**A single configured instance timezone governs Smart Campaign windows and report date
boundaries. REST responses use ISO-8601 UTC.**

**Day-boundary aggregations computed in UTC will not match anything a marketer sees.** On a
US-Central instance, activity between 19:00 and 24:00 local lands on the next UTC day, so
a "Tuesday" total computed in UTC is missing five hours of Tuesday and carries five hours
of Monday.

**Pin the instance timezone at the top of any extraction job** and bucket in it. This gap
*is* closeable, unlike the de-duplication gap, so close it.

## The drift nobody sees: deleted leads

**Deleting removes a person from `/rest/v1/leads.json` entirely.**
`deletedleads.json` is the only record that they existed.

Consequence: **period-over-period counts drift downward with no visible cause.** A cohort
you reported at 4,120 last month reports at 4,088 today — not because the data changed, but
because someone ran a cleanup.

Poll `deletedleads.json` at least as often as you extract, and report the deleted count as
a number rather than letting it silently subtract.

## Retention, which can make the comparison impossible

**Activity data retention is finite and silently truncates history** — commonly about 25
months, with **shorter effective retention for some activity types and legacy contracts.**

**Verify against the specific subscription; this genuinely varies.** A year-over-year
report may find the comparison period simply absent, and the response will not say
"truncated" — it will return fewer rows.

## Bizible attribution is retroactive

**Bizible touchpoints are recalculated in bulk on Marketo Measure's own schedule**, so
**attribution weights on a given opportunity change retroactively.**

A report run today over last quarter can differ from the same report run last week, with
nothing having "changed" in the CRM.

**Snapshot attribution outputs if reproducibility matters, and never present Bizible
figures as immutable.**

And remember the route that avoids the whole problem: **Bizible data lives in Salesforce
custom objects, so you author attribution reports through Salesforce — including
`POST /analytics/reports` — not through Adobe.** For serious attribution analytics, the
Marketo Measure Data Warehouse is a **Snowflake share**, which is SQL and is the right
answer.

## Program membership is not activity

Program success, program status and acquisition program are **three different concepts with
different APIs**, and Marketo's attribution among them is computed internally with rules
you cannot read.

**Extract the field; do not recompute the concept.** An agent that derives "program
success" from activity data has invented a metric that will not match the one the marketer
uses.
