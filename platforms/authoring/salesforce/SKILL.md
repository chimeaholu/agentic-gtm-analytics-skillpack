---
name: salesforce
description: Use for any Salesforce reporting, pipeline, opportunity or CRM-data request — running reports, creating a report, extracting opportunity or activity data, or explaining why the API and the Salesforce UI show different numbers. Salesforce is the only platform where an agent can create a real saved report object via REST. It is also the platform with the harshest read cap: 2,000 rows, no pagination, with correct grand totals over silently truncated detail rows. Always check `allData` before trusting detail data; for real extraction use Bulk API 2.0, not the report API.
---

# Salesforce

**Capability class: authoring-capable, with one specific asymmetry that is frequently
misreported.** `POST /services/data/vXX.X/analytics/reports` with a `reportMetadata` body
creates a **real, saved, persistent report object** a human opens in Salesforce. Dashboards
over the same API are **clone only** (`POST /analytics/dashboards?cloneId=`). Authoring a
dashboard from nothing requires the Metadata API and is out of scope for this module. Do
not promise a dashboard built from a description.

**Core contracts this module must call:** `provenance-block` (org, running user, running
user's timezone, currency basis, report id, `allData` state), `warning-field-reader`,
`comparability-rules`, `rate-limit-governor`, `pagination-patterns`, `mcp-detect-fallback`,
`write-gate` before creating or editing any report, and `answer-contract` on the way out.

**Treat "run the report" and "get the data" as two different jobs.** The report API answers
"what does this saved report say". Bulk API 2.0 answers "give me the rows". Using the first
for the second is the origin of most confidently wrong Salesforce answers.

**Answer-first discipline for this platform.** Salesforce aggregates are usually
computable and usually correct even when the detail is truncated, so give the aggregate
and name what is missing underneath it: "the grand total 4.2M is computed over all matching
rows; only the first 2,000 detail rows came back, so any breakdown I compute from the rows
is incomplete." Withhold only what is genuinely unavailable: a field the running user has
no FLS on is not null, it is absent, and reporting it as zero is the failure this module
exists to prevent.

---

## (a) Auth setup — high burden, and one step that silently breaks everything

Time to first query: one to four hours, because an admin must be involved.

1. **Create a Connected App** (or an External Client App on newer orgs) in the target org.
   The Reports and Dashboards REST API requires an OAuth-authenticated session.
2. **Pick the flow.** **JWT Bearer** for server-to-server: generate a self-signed
   certificate, upload it to the connected app, and pre-authorize the integration user
   ("Admin approved users are pre-authorized" plus a permission set). **Client
   Credentials** is simpler and requires designating a run-as user on the app. **Web
   Server / authorization code** for human-in-the-loop work.
3. **Scopes:** `api`, plus `refresh_token offline_access` for anything long-lived. `web`
   only if you need a UI redirect.
4. **Permission the integration user properly.** It needs **API Enabled**, read access to
   the report folders, and **field-level security on every field in the report**. Missing
   FLS does not error; the field simply is not in the response.
5. **Pin and document the integration user's timezone.** Every relative date filter and
   every date grouping evaluates in the running user's timezone at run time. An
   undocumented integration-user timezone makes month totals irreproducible.
6. **Use the `instance_url` from the token response as the API host. This is the step
   everyone misses.** Never hard-code `login.salesforce.com`. Sandboxes authenticate
   against `test.salesforce.com` and return a different instance host again.
7. **Pin the API version** (`/services/data/vXX.X/`) in configuration, not in code, and
   record which version produced a number.

Verify before planning work:

```bash
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports"
```

A 401 usually means the token was minted against the wrong host. An empty or near-empty
list is **not** an empty org: see the recently-viewed gotcha in (e).

---

## (b) Correct query construction — four surfaces, never conflated

**1. Reports and Dashboards REST API** — `/services/data/vXX.X/analytics/`

| Operation | Call | Class |
|---|---|---|
| List reports | `GET /analytics/reports` | READ, **only up to 200 recently-viewed** |
| Describe a report | `GET /analytics/reports/{id}/describe` | READ — returns `reportMetadata`, `reportExtendedMetadata`, `reportTypeMetadata` |
| Run synchronously | `GET /analytics/reports/{id}`, or `POST` the same URL with a `reportMetadata` body to override filters and groupings **for that run only** | RUN |
| Run asynchronously | `POST /analytics/reports/{id}/instances` then `GET .../instances/{instanceId}` | RUN |
| **Create a report** | **`POST /analytics/reports`** with a `reportMetadata` body; minimum viable body is `name` + `reportType` | **CREATE, persistent** |
| Clone a report | `POST /analytics/reports?cloneId={reportId}` | CREATE (copy) |
| Edit / delete | `PATCH` / `DELETE /analytics/reports/{id}` | UPDATE / DELETE |
| Dashboards | `GET /analytics/dashboards`, `GET /analytics/dashboards/{id}/results`, `PUT` to refresh | READ / RUN |
| **Clone a dashboard** | `POST /analytics/dashboards?cloneId={dashboardId}` | **CREATE, copy only** |

**`Content-Type: application/json` is mandatory on POST run bodies.** The official
limitations page calls this out: omit it and you get silently unexpected results rather
than an error.

Report authoring payloads, the `factMap` response shape and how to read aggregates versus
detail rows are in `references/reportmetadata-authoring.md`. **Always
`GET /analytics/reports/{id}/describe` on an existing report of the same report type
before authoring one**, because that response gives you the exact column API names,
filterable columns and operators that type supports. Guessing column names produces a
report that saves and returns nothing.

**2. Metadata API** — `Report` and `Dashboard` are first-class metadata types with full
create, update and deploy, including dashboard layout and components, as XML in an
asynchronous deploy package (deploy, then poll `checkDeployStatus`). This is the only
fully-general dashboard-authoring path. **Out of scope for this module**; name it as the
route when a user asks for a dashboard built from a description.

**3. SOQL** — `SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate FROM Report`
enumerates the full catalogue and is how you get past the 200-recently-viewed cap. The same
works `FROM Dashboard`. **SOQL cannot run a report and cannot return report output.** For
the underlying rows you query the objects and re-implement the report logic yourself, which
means you own the metric definition and must say so.

**4. CRM Analytics** — `/services/data/vXX.X/wave/`. `POST /wave/dashboards` genuinely
creates a dashboard and `POST /wave/query` runs SAQL or SQL against datasets.
**Separately licensed; most orgs do not have it. Do not design around it.** Check for the
licence before mentioning it as an option.

---

## (c) Pagination, bulk and cost

**The report API returns up to the first 2,000 report rows and there is no pagination.**
This is the single most important number on the platform. You narrow with filters or you do
not get the data.

Other report API limits:

| Limit | Value |
|---|---|
| Report rows returned | **2,000, no pagination** |
| Columns processed | 100 |
| Custom field filters per run | 20 |
| Synchronous report runs | 500 per org per hour, 20 concurrent |
| Asynchronous requests | 1,200 per org per hour, 200 concurrent result reads |
| Async instance results | live in a **24-hour rolling window**, up to 2,000 listable |
| Dashboard refreshes | 200 per hour per org |

**Sync runs are subject to the 2-minute Salesforce API timeout; async runs are not.** A
heavy report simply times out synchronously. Use `POST /analytics/reports/{id}/instances`
and poll for anything large or slow.

**For real extraction, abandon the report API and use Bulk API 2.0.** Full procedure in
`references/bulk-extraction.md`. The shape:

1. `POST /services/data/vXX.X/jobs/query` with `operation: "query"` (or `"queryAll"` to
   include soft-deleted and archived records) and a SOQL body.
2. Poll `GET /jobs/query/{id}` until the state is `JobComplete`.
3. `GET /jobs/query/{id}/results` for CSV, and **loop on the `Sforce-Locator` response
   header**, passing it back as the `locator` parameter, until the header is absent or
   null.

Bulk 2.0 query limits: around 15 GB per query job, 10,000 query jobs per rolling 24 hours,
1 GB maximum retrieved file size, results retrievable for 7 days. **Query jobs do not
consume ingest batches**, so the 10,000-records-per-batch ingest limits do not apply.
Standard org-wide daily API request allocations apply on top of everything above.

There is no cost meter here, but there is a shared allocation: an agent that burns the
org's hourly synchronous run budget degrades scheduled jobs and other integrations. Plan
the query budget with `rate-limit-governor` before the first call.

---

## (d) Preferred MCP server and fallback

**There is no MCP server, official or community, that wraps the Salesforce Reports and
Dashboards REST API.** This is a real gap, not an oversight in this module, and it means
the fallback is the default path rather than a degraded one.

What exists and what it actually covers:

- **`salesforcecli/mcp` (official, Developer Preview)** is a **developer-tooling** server.
  Its toolsets are core, orgs, data, metadata, users, devops, testing, code-analysis and
  similar. The only data-retrieval tool is `run_soql_query`. **There is no `run_report`, no
  `create_report` and no dashboard tool.** It authenticates by reusing orgs already
  authorised locally through the `sf` CLI.
- **Data 360 MCP (Developer Preview)** wraps Data Cloud, not CRM reporting. Relevant only
  if the data lives in Data 360.
- **`tsmztech/mcp-server-salesforce`** is the healthiest community option: record queries,
  `salesforce_aggregate_query` (SOQL `GROUP BY`, the closest thing to reporting it offers),
  DML, object and field management, Apex. **No Reports API coverage.**
- **`KirtiJha/salesforce-mcp-server` advertises dashboard and report management. Do not
  rely on it:** one star, created and last pushed the same day, untouched since. An
  unmaintained one-shot dump is not an integration.

**Fallback, which is the default: call the Reports and Dashboards REST API directly**, or
use the Salesforce Reports and Dashboards MCP server this pack ships. A thin direct client
needs exactly this much:

- token acquisition (JWT bearer or client credentials) and **use of `instance_url` from the
  response**
- `describe`, run-sync, run-async-and-poll, create, clone
- a `factMap` reader that returns aggregates and detail rows separately
- **a hard `allData` check that attaches a truncation flag to every result**
- a Bulk API 2.0 query path with `Sforce-Locator` looping

If a developer-tooling MCP is connected, `run_soql_query` is still useful for the catalogue
enumeration in (b3) and for raw object queries. Use it for that and do not let its presence
imply report capability.

---

## (e) Gotchas, and the specific field that reveals each one

- **`allData: false` means the 2,000-row cap was hit.** This is the platform's defining
  trap, because **aggregates and grand totals in the response are computed over the full
  result set while the detail rows are silently truncated.** The total is right, the rows
  are partial, nothing errors. Check `allData` before trusting any detail row or any
  breakdown you compute from rows. When it is false: report the aggregate, say the detail
  is capped at 2,000 rows, and offer the Bulk API path for the row-level answer.
- **A field absent from the response is an FLS omission, not a null.** Report output is
  scoped to the **running user's** sharing rules, role hierarchy and field-level security.
  A report an admin sees with 1,200 opportunities can return 340 rows to the integration
  user with no error and no warning. Compare the API result against what the requester sees
  in the UI before explaining a discrepancy as a data problem, and log which credential
  produced a number.
- **Timezone is the running user's, not the org's and not UTC.** `THIS_MONTH`,
  `LAST_N_DAYS:7` and every date grouping evaluate in the running user's locale timezone at
  run time. The same report run by a UTC integration user and a local sales ops user buckets
  records into different days and returns different month totals.
- **Multi-currency: report amounts convert at current (or dated) rates into the report's or
  user's currency.** `convertCurrency()` in SOQL **does not apply to the report API**. Bulk
  gives you `Amount` in the record currency plus `CurrencyIsoCode`, which is a different
  number from the report figure. Never mix report figures and Bulk-extracted figures in one
  calculation without normalising, and state which basis you used.
- **Custom summary formulas and `PARENTGROUPVAL` / `PREVGROUPVAL` / `ROWCOUNT` exist only
  inside reports.** They appear in report aggregates and have **no corresponding field** to
  extract by SOQL or Bulk, so they cannot be reproduced outside the report. Ordinary
  formula fields and roll-up summaries do export fine. Shield-encrypted fields come back
  masked. **Compound fields (`Address`, geolocation) are not supported by Bulk API 2.0
  query** — request the components (`BillingStreet`, `BillingCity`, …) individually.
- **Soft deletes.** Plain `query` and Bulk `query` exclude Recycle Bin and archived records.
  Use REST `/queryAll` or Bulk `operation: "queryAll"` and filter `IsDeleted` when
  reconciling counts. Recycle Bin retention is 15 days, after which period-over-period
  counts quietly shift with no event to point at.
- **Cross filters, standard report filters and row-limit filters are unavailable when
  filtering through the API.** A report that works perfectly in the UI can be
  un-runnable-as-configured over REST. Historical tracking reports are matrix-format only.
- **There is no supported "export this report to CSV" API.** The
  `?export=1&enc=UTF-8&xf=csv` URL is an undocumented UI endpoint requiring session-cookie
  auth and it breaks across releases. Do not build on it. The supported answers are the
  report API within 2,000 rows, Bulk API 2.0 on the underlying objects, or the Analytics
  Download API, which requires a CRM Analytics licence plus the Slack integration enabled.
- **`GET /analytics/reports` returns only the running user's recently-viewed reports, up to
  200.** An agent that "lists the reports" from it will describe a near-empty org. SOQL the
  `Report` object for a real inventory.
- **Lead-to-Contact conversion retires the Lead id.** Campaign member and activity history
  must be followed across the conversion or attribution breaks exactly at the point it
  becomes valuable.
- **Formula fields are not replicated by ELT connectors**, because Salesforce does not
  update `SystemModStamp` when a referenced object changes. They must be recomputed in the
  warehouse, and **formula-field history is not recoverable** after the fact.

---

## Files

- `references/reportmetadata-authoring.md` — `reportMetadata` payloads for create, clone
  and filtered runs, plus how to read the `factMap` response.
- `references/bulk-extraction.md` — Bulk API 2.0 query jobs and `Sforce-Locator` paging.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
