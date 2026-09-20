# Messaging platform register

Endpoints, the fields that change the numbers, the limits that dictate
architecture, and the silent failures.

---

## Klaviyo

**Reporting surface** — the best in this domain: a query-style API where you
POST a spec and get aggregates back.

| Endpoint | What it is |
|---|---|
| `POST /api/campaign-values-reports/` | query-as-report: `timeframe`, `conversion_metric_id`, `filter`, `statistics`, `group_by` |
| `POST /api/flow-values-reports/` | same, for flows |
| `POST /api/campaign-series-reports/`, `/api/flow-series-reports/` | time series, with `interval` of daily / weekly / monthly |
| `POST /api/form-values-reports/` | `viewed_form`, `submits`, `submit_rate`, grouped by form |
| `POST /api/segment-values-reports/`, `/api/segment-series-reports/` | segment reporting |
| `POST /api/metric-aggregates` | arbitrary metric aggregation, **with an explicit `timezone`** |

**There is no saved report or dashboard object.** You can author a report
*query*, not a report *artefact*.

Request shape:

```
POST https://a.klaviyo.com/api/campaign-values-reports/
Authorization: Klaviyo-API-Key <private key>
revision: <YYYY-MM-DD>

{"data":{"type":"campaign-values-report","attributes":{
  "timeframe":{"key":"last_12_months"},
  "conversion_metric_id":"<metric id>",
  "filter":"equals(campaign_id,\"<id>\")",
  "statistics":["clicks","click_rate","conversions","conversion_value"],
  "group_by":["campaign_message_id","campaign_id","send_channel"]}}}
```

**The `revision` header is mandatory** in `YYYY-MM-DD` form, and revisions
deprecate on a roughly quarterly cadence. Omitting it fails immediately; pinning
an old one works until it abruptly does not.

**Limits — architectural, not a throttle to back off from**

- The campaign values report is documented at roughly **burst 1/s, steady
  2/minute, and 225 requests per day**, far below the account tier table.
  **Always read the per-endpoint limit in the reference for your revision**; the
  tier table is not sufficient for reporting work.
- **Design for one wide query with `group_by`**, cache for hours not minutes,
  and never let an agent loop per campaign. A naive "check each of my 40
  campaigns" pass burns a large share of the daily budget in one turn.
- **`include=` and `additional-fields[...]` consume separate, additive, global
  rate-limit buckets.** One request with both can cost three calls against three
  buckets. The instinct to fetch related data in one call is actively
  counterproductive here — fetch lean, join locally.
- `RateLimit-Limit` / `-Remaining` / `-Reset` are returned on non-429 responses
  and describe the steady window; **on a 429 they are replaced by
  `Retry-After`**, so visibility disappears exactly when it is needed. Track the
  steady window proactively.
- **No async or bulk export API.** Full event-history extraction means
  paginating `/api/events` under these limits, which for a large account is slow
  enough to be impractical. The honest answer there is a warehouse or
  reverse-ETL integration.

**Silent failures**

- **`conversion_metric_id` silently redefines every revenue and conversion
  number.** Resolve it explicitly, log it, print it.
- **Revenue attribution follows the account's attribution settings, which are
  retroactive.** Changing the window changes every historical report.
- **Blank results are well-formed.** The values-report endpoints return an empty
  response when the filter matches nothing, the conversion metric does not
  apply, or the timeframe predates the campaign. **There is no "0 rows because
  X" signal** — validate that the IDs exist before concluding zero performance.
- **403 ≠ 401.** 403 means the key is valid but lacks the required scope. Do not
  send the user to regenerate a key when they need to re-scope one.
- **Timezone is the account's**, and only `metric-aggregates` accepts an
  explicit `timezone`.
- **Open rates are unreliable and Klaviyo's own guidance has moved to click and
  conversion metrics.**

---

## Braze

**Reporting surface** — the most complete read-only analytics family here.

| Family | Endpoints |
|---|---|
| Campaign | `GET /campaigns/data_series`, `/campaigns/list`, `/campaigns/details` |
| Send-level | `GET /sends/data_series` — per `send_id`, with per-variation breakdown |
| Canvas | `GET /canvas/data_series`, `/canvas/data_summary`, `/canvas/list`, `/canvas/details` |
| Segment | `GET /segments/data_series` |
| Events / sessions | `GET /events/data_series`, `/sessions/data_series` |
| App KPIs | `/kpi/dau/data_series`, `/kpi/mau/...`, `/kpi/new_users/...`, `/kpi/uninstalls/...` |
| Purchases | `/purchases/product_list`, `/purchases/revenue_series` |

**No report or dashboard object exists.** Content assets (templates, content
blocks, media) can be created; reports cannot.

**The trap that matters most.** `/sends/data_series` returns **both**
`conversions` (conversion date) and `conversions_by_send_time` (send date).
Summing the wrong one, or mixing them in one table, produces numbers matching
neither the dashboard nor reality. **Pick one, state it, never mix.**

**Limits**

- **`length` on `data_series` must be 1–100** — a hard 100-day window per call,
  **not a page size, with no cursor.** Year-over-year means ≥8 calls stitched,
  and `ending_at` is inclusive.
- Default shared bucket of 250,000 requests/hour across most endpoints;
  `/campaigns/data_series` has its own much larger per-minute bucket;
  `/events/list` and `/purchases/product_list` share a low 1,000/hour.
- **Limits reset on the clock hour, not a rolling window.**
- `x-ratelimit-limit` / `-remaining` / `-reset` on every response, designed for
  real-time back-off.
- Braze recommends a **5-minute delay between dependent consecutive calls**,
  well beyond ordinary eventual consistency.

**Other behaviour**

- **Host is instance-specific** (`rest.iad-01`, `rest.fra-01`, …); the wrong
  cluster fails as an auth error, not a routing error.
- **`data_series` days bucket in the workspace's timezone**, and `ending_at`
  takes an ISO-8601 datetime **with offset**. A naive UTC timestamp shifts every
  bucket. Multi-workspace orgs with different timezones cannot naively sum.
- **`revenue` is documented as USD.** Braze has already converted at its own
  rates; the original amounts are not recoverable from this endpoint.
- `/users/export/segment` **does not return data** — it writes to your own
  cloud bucket, configured in advance.
- The official remote MCP server is OAuth-bound to a **dashboard user account**
  and mirrors that user's permissions, but **exposes no user-level PII tools at
  all, by design and not configurably.** If dashboard IP allowlisting is on,
  the remote MCP server cannot be used.

---

## Iterable

| Endpoint | Returns |
|---|---|
| `GET /api/campaigns/metrics` | CSV per campaign: `bounces, clicks, conversions, opens, purchases, pushBounces, pushOpens, pushSent, pushUninstalls, revenue, sent, smsBounces, smsReceived, smsSent, spams, totalClicks, totalOpens, totalPushOpens, unsubs` |
| `GET /api/experiments/metrics` | A/B analysis — **email experiments only** |
| `POST /api/export/start` → `GET /api/export/{jobId}/files` | real async bulk export |
| `GET /api/events/{email}` | per-user events, **default `limit` 30** |

**The limit that dictates architecture: `GET /api/campaigns/metrics` is capped
at 10 requests per minute, per project — and it is the only campaign-performance
endpoint there is.** It accepts multiple campaign IDs per call. **Batch
aggressively, cache, and never iterate campaign by campaign.**

- **No `RateLimit-*` headers at all.** The only runtime signal is the 429.
  Client-side rate modelling from the published per-endpoint numbers is
  mandatory, and those numbers live in the Swagger operation descriptions rather
  than one limits page.
- **Rate-limit scope varies by endpoint**: export start is per **organisation**,
  campaign metrics per **project**, archive per **API key**. Three blast radii in
  one API.
- **US and EU data centres are separate**: different hosts, non-portable keys,
  no cross-DC queries.
- Export files arrive **progressively**, capped at 10 MB each; a
  completed-looking file list mid-job is not final. Poll to terminal state and
  paginate with `startAfter`.
- Documented **60-second write-to-read consistency window** — longer than most
  platforms admit.
- `GET /api/events/{email}` defaults to 30 events; an agent asking "what has
  this user done" gets the 30 most recent and, unchecked, reports that as the
  whole history.

---

## Marketo

**There is no reporting API at all** — no create, no run, no read of an existing
report or Revenue Cycle Explorer view. What exists is excellent raw extraction.

- Email reporting is rebuilt from **Bulk Activity Extract**: `Send Email`,
  `Email Delivered`, `Email Bounced`, `Unsubscribe Email`, `Open Email`,
  `Click Email`, `Email Bounced Soft`. **Get the numeric type IDs from
  `GET /rest/v1/activities/types.json` at runtime** — custom types are
  instance-specific and hard-coding them breaks across instances.
- **`/rest/v1/stats/*` is API-usage telemetry, not marketing analytics.** The
  naming trips up agents and humans alike.
- **Marketo's own report numbers are not reproducible from the API, and never
  will be exactly.** The Email Performance Report de-duplicates opens and clicks
  per person and applies undocumented bot filtering. API-derived sums are
  **gross** and systematically higher. Say this rather than promising parity.
- **The rate limit is shared across the whole instance** — roughly 100 calls per
  20 seconds, competing with the CRM sync, the webinar connector and every
  consultant's script. Error 606 is rate limiting; 607 is the daily quota. An
  eager agent breaks *other* integrations, which is a political problem as well
  as a technical one.
- **Daily quota resets at midnight CST**, not UTC.
- **Activity retention is finite** (commonly documented around 25 months, and
  genuinely contract-dependent). A year-over-year report may find the comparison
  period absent. Verify per subscription.
- **Bulk Activity Extract caps at a 31-day range per job**; chunk without
  overlapping or records double-count.
- **Deleted leads have their own endpoint** — `GET /rest/v1/activities/deletedleads.json`
  is the only way to learn a record was removed. Without polling it, counts drift
  downward with no visible cause.

---

## MCAE / Pardot

- **No report object.** But `GET /api/v5/objects/list-emails/{id}/stats` is a
  real aggregate endpoint returning `sent, delivered, deliveryRate, hardBounced,
  softBounced, opens, uniqueOpens, opensRate, totalClicks, uniqueClicks,
  clickThroughRate, uniqueClickThroughRate, clickOpenRatio, optOuts, optOutRate,
  spamComplaints, spamComplaintRate`.
- **It is per-list-email and aggregate only.** There is no grouped or
  time-series stats call, so "email performance by month" means enumerating
  emails then one `/stats` call each — which burns the daily quota linearly in
  emails sent.
- **`opens` can legitimately read 0 while `totalClicks` is large.** Never derive
  an engagement rate that divides by opens without saying what it measures.
- **Export timestamps are frozen to the timezone of whichever user created the
  export, at the moment they created it.** Two users exporting the same data get
  differently-offset timestamps, and a user relocating changes the meaning of
  all their future exports while leaving old ones in the old zone. **Pin one
  dedicated export identity and record its timezone alongside the data.**
- **`Pardot-Business-Unit-Id` is required on every call, and the failure mode is
  data, not an error** — a wrong BU in a multi-BU org returns a valid 200 with a
  different prospect set.
- **Concurrency is 5** (error 66), and exports queue sequentially per account.
  Naive parallelism actively hurts.
- Exports expire after 7 days, max 150 fields, **collection fields cannot be
  exported at all**, and record order across files is not guaranteed.
- Prospect, Visitor and Lead/Contact are three identities; counting "people"
  across them double-counts. `crmLeadFid` / `crmContactFid` are the bridge
  fields and can be null or stale mid-sync.
