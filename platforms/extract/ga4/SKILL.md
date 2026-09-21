---
name: ga4
description: Use for any Google Analytics 4 request — traffic, acquisition, conversions, funnels, audiences, or explaining why GA4 numbers disagree with another platform or with the GA4 UI. An agent can run any GA4 query and return numbers; it cannot create a GA4 report, Exploration or dashboard, because no API for that exists. Always set `returnPropertyQuota` and read `samplingMetadatas`, `subjectToThresholding`, `dataLossFromOtherRow`, `currencyCode` and `timeZone` from `ResponseMetaData` before using the numbers — those five fields are why GA4 numbers look wrong.
---

# GA4

**Capability class: extract-only. An agent cannot create a GA4 report, Exploration or
dashboard.** `runReport` is a stateless query: nothing is saved, nothing appears in the GA4
UI. The only persistent objects the Data API creates are `audienceExports`,
`audienceLists` and `reportTasks`, which are data-extraction jobs, not UI artefacts. The
Admin API can create custom dimensions and metrics, audiences, key events, data streams and
channel groups, and **cannot create an Exploration or a dashboard. Explorations have no
public API at all.**

So the sentence "I'll build you a GA4 dashboard" is never available in this module. The
honest delivery path is: agent queries the Data API, writes the result to Sheets, BigQuery,
Looker Studio or a static artefact, and the human opens **that**.

**Core contracts this module must call:** `provenance-block` (property id, date range,
`currencyCode`, `timeZone`, sampling rate, thresholding state, `(other)` state, credential
identity), `warning-field-reader`, `comparability-rules`, `rate-limit-governor`,
`pagination-patterns`, `mcp-detect-fallback`, `answer-contract`.

**Answer-first discipline for this platform.** GA4 almost always returns a number. Give
it, then name the direction of its error from the response fields rather than hedging in
general terms: sampling makes a number noisy in both directions and worse for small
segments; thresholding removes rows, so segment totals come in **under** the unsegmented
total; `(other)` rolls tail rows together, so a long-tail breakdown **understates** the tail
and the visible rows are fine. Say when the rough figure is fine, and it often is: for
"roughly how much traffic came from organic last month", a 12 percent sampled number is
fine and you should say so rather than sending someone to BigQuery. Withhold only where the
data genuinely is not there: a thresholded demographic segment with no rows, or a window
before the property started collecting.

---

## (a) Auth setup

> **Setting this up with someone who has not done it before? `references/connect.md` is
> the same setup as a guided walkthrough — read aloud one step at a time, with the exact
> screens, the scopes to choose and why, a verification call, and the common failures.**

Time to first query: roughly 30 minutes. Scope `https://www.googleapis.com/auth/analytics.readonly`
for reads, `analytics.edit` for Admin writes.

1. **Create a Google Cloud project** (or pick an existing one).
2. **Enable the Google Analytics Data API** in that project, and the **Admin API** too if
   you need configuration objects.
3. **Create credentials:** an OAuth desktop or web client for interactive use, or a service
   account for headless use.
4. **Add the service account email as a user on the GA4 property itself**, in GA4 Admin →
   Property Access Management, with at least Viewer. **This is the step everyone misses.**
   Enabling the API in the Cloud project grants access to nothing; property-level ACL is a
   separate system. The symptom of skipping it is a 403 that reads like a billing or
   API-enablement problem.
5. **Get the numeric Property ID.** Not the Measurement ID (`G-XXXXXXX`), not a legacy
   Universal Analytics view id. Requests address `properties/{propertyId}`.

Verify:

```bash
curl -s -X POST \
  "https://analyticsdata.googleapis.com/v1beta/properties/$PROPERTY_ID:runReport" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H 'Content-Type: application/json' \
  -d '{"dateRanges":[{"startDate":"7daysAgo","endDate":"yesterday"}],
       "metrics":[{"name":"sessions"}],
       "returnPropertyQuota":true}'
```

A 403 here is nearly always step 4. Read `propertyQuota` in the response; if it is absent,
`returnPropertyQuota` was not set and you are flying blind on quota.

---

## (b) Correct query construction

**The methods, and which are stable:**

| Method | Version | Use |
|---|---|---|
| `properties.runReport` | v1beta | the workhorse ad-hoc report |
| `properties.runPivotReport` | v1beta | pivot-shaped output |
| `properties.batchRunReports` / `batchRunPivotReports` | v1beta | up to 5 reports in one call |
| `properties.runRealtimeReport` | v1beta | last 30 minutes, or 30 days on 360 |
| `properties.getMetadata` | v1beta | the dimension and metric catalogue including custom definitions |
| `properties.checkCompatibility` | v1beta | whether a dimension and metric combination is legal, **before** you run it |
| `properties.audienceExports.*` | v1beta | long-running export of users in an audience |
| `properties.runFunnelReport` | **v1alpha** | funnel steps |
| `properties.reportTasks.*` | **v1alpha** | async long-running report, higher row ceiling |
| `properties.audienceLists`, `getPropertyQuotasSnapshot`, `chat` | **v1alpha** | treat as version-dependent |

**Three rules that keep queries correct:**

1. **`"returnPropertyQuota": true` on every request. This module makes it non-optional.**
   Reading the returned `propertyQuota` object is the only reliable way for an agent to
   self-throttle, and the quota model in (c) makes blind request counting useless.
2. **Use `checkCompatibility` rather than discovering incompatibility by error.** GA4 has
   real dimension and metric combination restrictions rooted in event versus session versus
   user scope. A compatibility check is one cheap call; a failed report is a wasted one plus
   a confusing error.
3. **Use `getMetadata` before assuming a custom dimension exists.** Custom dimension API
   names are property-specific (`customEvent:<name>`, `customUser:<name>`), and a guessed
   name returns an error or, worse, an unrelated field.

A minimal correct request:

```json
{
  "dateRanges": [{"startDate": "2026-08-01", "endDate": "2026-08-31"}],
  "dimensions": [{"name": "sessionDefaultChannelGroup"}],
  "metrics": [{"name": "sessions"}, {"name": "keyEvents"}, {"name": "totalRevenue"}],
  "limit": 10000,
  "returnPropertyQuota": true
}
```

Prefer explicit `YYYY-MM-DD` dates over `NdaysAgo` for anything you will quote later, since
relative ranges resolve against the **property's** timezone and move under you.

---

## (c) Pagination, bulk and cost

**Quotas are token-based, not request-based.** A wide report with many dimensions burns far
more than a narrow one, so "requests per day" is not a planning number. Plan in tokens, and
read `propertyQuota` back from each response.

| Bucket | Standard | 360 |
|---|---|---|
| Core tokens per property per day | 200,000 | 2,000,000 |
| Core tokens per property per hour | 40,000 | 400,000 |
| Core tokens per project per property per hour | 14,000 | 140,000 |
| Concurrent requests | 10 | 50 |
| Server errors per hour | 10 | 50 |
| **Potentially thresholded requests per hour** | **120** | **120** |

Realtime and Funnel have their own separate buckets of the same shape. **An agent looping
demographic queries hits the 120-per-hour thresholded bucket fast**, and the failure looks
like an unrelated quota error.

**Row caps and pagination.** `limit` defaults to 10,000 and the maximum is **250,000 rows
per request, no matter how many you ask for**. Pagination is `offset` plus `limit`, first
row is row 0, and `rowCount` in the response gives the total matching rows so you know when
to stop. **Offset paging a large report is token-expensive because each page is a full
re-query**, so widen `limit` before adding pages, and reduce dimensions before either.

**Async:** `reportTasks` is the long-running path but is **v1alpha**. Do not put a critical
path on it without a fallback.

**For genuine bulk, the answer is not the Data API at all. It is the BigQuery Export**,
which has a free tier on standard properties, lands daily plus streaming, and gives
event-level rows with **no sampling, no thresholding and no `(other)` row**. That is the
route for anything historical, high-cardinality or reconciliation-grade. The BigQuery
schema has its own set of traps; they are in `references/bigquery-export.md` and choosing
wrong among them is the most common GA4-in-BigQuery error.

---

## (d) Preferred MCP server and fallback

**Preferred: the official `googleanalytics/google-analytics-mcp`** (PyPI `analytics-mcp`).
Auth is Application Default Credentials, which is the right default because auth is the
hard part on this platform and Google's server handles it correctly. It is read-only by
construction.

**It is self-labelled "(Experimental)" in its own README, and it exposes seven tools:**
`get_account_summaries`, `get_property_details`, `list_google_ads_links`, `run_report`,
`run_funnel_report`, `get_custom_dimensions_and_metrics`, `run_realtime_report`.

**That is a token subset, not API coverage.** There is **no `runPivotReport`, no
`batchRunReports`, no `checkCompatibility`, no `audienceExports`, no `reportTasks` and no
Admin write surface.** Do not assume the MCP can do anything beyond those seven tools.
Pivots, compatibility checks and audience exports need a direct API call.

**Fallback: the Data API directly**, which is fully documented and covers everything.
Community alternatives exist (`surendranb/google-analytics-mcp` was more actively
maintained than the official server at research time, plus TypeScript and other ports); they
add risk without adding necessary capability, so prefer the official server or a direct
call.

**One thing to check on any MCP path:** whether the server passes `returnPropertyQuota`
through and surfaces `ResponseMetaData`. If it does not, you are getting numbers without
their warning fields, which is precisely the failure this module exists to prevent. When
the warning fields are not available through the tool, **say so in the answer** and route
the query direct.

---

## (e) Gotchas, and the specific field that reveals each one

All of the first five are in `ResponseMetaData` and are free to read. An agent that does
not read them will confidently report wrong numbers. The full register, with what to do in
each case, is in `references/response-metadata-fields.md`.

- **`samplingMetadatas[]`** — one entry per date range, each with `samplesReadCount` and
  `samplingSpaceSize`. The sampling rate is the ratio. If the array is present and the
  ratio is below 1, the report is sampled. **Surface the rate, never the raw number alone.**
  Mitigate by shortening the range, dropping dimensions, or going to BigQuery.
- **`subjectToThresholding: true`** — rows were suppressed for privacy, typically when
  demographics or interests (`userAgeBracket`, `userGender`, `userInterest`) or
  Google-signals data are in the query and buckets are small. **Suppressed rows are
  silently missing and segment totals will not add up to the unsegmented total.** The gap is
  the suppression, not a calculation error.
- **`dataLossFromOtherRow: true`** — dimension combinations were rolled into an `(other)`
  bucket. A dimension with **more than 500 unique values in one day** is high-cardinality;
  classic victims are `pagePath`, `pageTitle` and any custom dimension carrying an id or a
  query string. **Standard reports and the Data API are both subject to it.** The visible
  rows are still accurate; the tail is not enumerable.
- **`currencyCode` and `timeZone`** — revenue comes back in the **property's** currency and
  dates bucket in the **property's** IANA timezone. **Two properties in one report set will
  not agree.** Cross-property roll-ups need explicit FX and timezone normalisation that GA4
  will not do for you. Never assume USD, never assume UTC.
- **`schemaRestrictionResponse`** — field-level permissions genuinely change the numbers.
  Cost-data or revenue-data restrictions on the credential's GA4 role return restricted or
  absent metrics rather than erroring loudly. **Two service accounts querying the same
  property can legitimately return different revenue. Log which credential produced a
  number.**
- **`emptyReason`** — an empty report is not always "no data". Read the reason before
  reporting absence.
- **API-versus-UI disagreement is normal, not a bug.** The UI's standard reports read
  pre-aggregated tables; the Data API computes from a different path; attribution model,
  session definition and key-event counting all differ between surfaces. **Exact
  reconciliation is often not achievable.** Say so and stop, rather than iterating forever.
  `cross-system-reconciliation` owns the decision of when to stop.
- **Freshness:** standard properties typically take 24 to 48 hours for full processing.
  "Today" and often "yesterday" return numbers that will change. Label any recent-window
  answer provisional.
- **Data-deletion requests silently change historical numbers**, so a report you ran last
  month may not reproduce and nothing in the response says why.
- **Alpha-surface risk.** `runFunnelReport`, `reportTasks` and `chat` are v1alpha and have
  changed shape without a deprecation window before. Anything built on them is
  version-dependent and needs a fallback.

---

## Files

- `references/response-metadata-fields.md` — the warning-field register: what each field
  means, what it does to the number, and what to do about it.
- `references/bigquery-export.md` — the BigQuery export schema traps, including the four
  traffic-source structures and which one reconciles with the GA4 UI.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
