# Salesforce Reports & Dashboards MCP server

An MCP server wrapping the Salesforce **Reports and Dashboards REST API** —
report execution, report metadata, **report creation**, dashboard clone, and Bulk
API 2.0 as the escape hatch from the 2,000-row ceiling.

## Why this exists

Salesforce's own DX MCP server is a *developer-tooling* server: its only
data-retrieval tool is `run_soql_query`. There is **no `run_report`, no
`create_report`, no dashboard tool**. The healthiest community server has no
Reports API coverage either.

Meanwhile Salesforce is the one major GTM platform where an agent can create a
**real, saved, persistent report object** with a single REST call. That
capability exists in the API and, as of this writing, in no other MCP server.

Thirteen tools, deliberately not fifty. A small set of well-described tools over
a generic surface beats a large hand-wrapped catalogue, and high tool counts
measurably degrade agent tool selection.

## The one thing to understand before using it

**The report API returns at most 2,000 detail rows, with no pagination — but the
aggregates and grand totals in the same response are computed over the FULL
result set.**

The total is right. The rows are partial. Nothing errors.

`allData` is the only signal, so **every run result from this server carries
`all_data` at the top level of the payload**, plus a `truncated` flag and a note
naming the supported route to the complete row-level answer. The server will not
strip it, and it does not bury it inside the raw response.

```jsonc
{
  "all_data": false,
  "truncated": true,
  "truncation_note": "allData is false: the report returned the first 2000 detail rows ...",
  "grand_total": [{ "label": "$4,200,000", "value": 4200000 }],   // exact — report it
  "detail_row_count": 2000,                                       // a lower bound
  "detail_rows": [ /* ... */ ]
}
```

The honest answer when you see that: *"the grand total of 4.2M is computed over
all matching rows; only the first 2,000 detail rows came back, so any breakdown I
compute from the rows is incomplete."* Then reach for `bulk_query`.

## Install

```bash
npm install
npm run build
npm test          # 42 tests, no org required
```

Requires Node 20.11+. Add it to your MCP client with
[`examples/claude-config.json`](examples/claude-config.json).

## Auth setup

Time to first query is one to four hours, because an admin must be involved.

### 1. Create a Connected App (or External Client App on newer orgs)

Setup → App Manager → New Connected App → Enable OAuth Settings.

**Scopes:** `api`, plus `refresh_token offline_access` for anything long-lived.
`web` only if you need a UI redirect.

### 2. Pick a flow

| Flow | `SF_AUTH_FLOW` | Use for |
|---|---|---|
| **JWT bearer** | `jwt` | **Recommended.** Unattended server-to-server. No interactive login, no refresh-token rotation. |
| Client credentials | `client_credentials` | Simpler org-level alternative. Requires a designated run-as user on the app. |
| Refresh token | `refresh_token` | Human-in-the-loop, from an authorization-code grant. |

**JWT setup:**

```bash
# 1. Generate a key pair
openssl req -x509 -sha256 -nodes -days 3650 -newkey rsa:2048 \
  -keyout server.key -out server.crt -subj "/CN=salesforce-reports-mcp"

# 2. Upload server.crt to the connected app (Use Digital Signatures)

# 3. Pre-authorize the integration user:
#    App Manager → Manage → Edit Policies → Permitted Users:
#    "Admin approved users are pre-authorized", then assign a profile or permission set.

# 4. Base64-encode the private key for the environment
base64 -w0 server.key   # → SF_PRIVATE_KEY_B64
```

**Base64 is not optional advice.** Newlines in a PEM pasted into an environment
variable arrive as the two characters `\` and `n`, and the resulting signature
failure names neither newlines nor the variable. The server rejects a value that
does not decode to a PEM, at startup, with a message that says so.

**Client credentials note:** Salesforce serves that flow from the org's My Domain
token endpoint, not from `login.salesforce.com`. Set `SF_LOGIN_URL` to the My
Domain URL for that flow.

### 3. Permission the integration user

It needs **API Enabled**, read on the relevant report folders, read on the `User`
object (for the identity and timezone echo), and **field-level security on every
field in the report**.

**Missing FLS does not error. The field simply is not in the response.** A report
an admin sees with 1,200 opportunities can return 340 rows to the integration user
with no error and no warning.

### 4. Sandboxes

`SF_LOGIN_URL=https://test.salesforce.com`, and the username usually carries the
sandbox suffix. **The API host always comes from `instance_url` in the token
response** — this server never hard-codes it and never derives it from the login
host. A 401 on the first call is almost always a token minted against the wrong
host.

### 5. Pin the API version and record the timezone

`SF_API_VERSION` is configuration, not code, and every result reports which
version produced it.

The integration user's timezone is read at startup and **echoed in every result**,
because `THIS_MONTH`, `LAST_N_DAYS:7` and every date grouping evaluate in the
running user's timezone at run time. An undocumented integration-user timezone
makes month totals irreproducible.

## Tools

### Read (always available)

| Tool | Maps to | Notes |
|---|---|---|
| `list_reports` | **SOQL `SELECT … FROM Report`** | Deliberate. `GET /analytics/reports` returns only up to **200 recently-viewed** reports for the running user, so an agent using it reports a near-empty org. |
| `describe_report` | `GET /analytics/reports/{id}/describe` | Returns `reportMetadata`, `reportExtendedMetadata`, `reportTypeMetadata`. **Call before overriding filters or authoring** — column API names are report-type and org specific and cannot be guessed. |
| `run_report` | `GET /analytics/reports/{id}` | Surfaces `all_data` at the top level. Dies at the 2-minute platform timeout if the report is heavy. |
| `run_report_with_filters` | `POST /analytics/reports/{id}` with a `reportMetadata` body | Overrides apply **to that run only**; nothing is saved. Enforces the 20-custom-filter cap and rejects filter types the API cannot apply. |
| `run_report_async` | `POST …/instances` → `GET …/instances/{id}` | For reports past the 2-minute sync timeout. Surfaces the **24-hour result window**. |
| `list_dashboards` | `GET /analytics/dashboards` | |
| `get_dashboard_results` | `GET /analytics/dashboards/{id}/results` | Last-refreshed values, not a live query. `all_data` is `null` here because the surface does not expose it per component — stated, not implied away. |
| `bulk_query` | Bulk API 2.0 job → poll → **`Sforce-Locator`** loop | The escape hatch from the 2,000-row ceiling. Supports `query` and `queryAll`. |
| `describe_org_limits` | `GET /limits` + the documented analytics ceilings | So work can be planned against the 500 sync runs/hour and 1,200 async requests/hour before the first call. |

### Write (gated — off by default)

| Tool | Maps to | Notes |
|---|---|---|
| `create_report` | **`POST /analytics/reports`** | The headline capability. Minimum body is `name` + `reportType`. |
| `update_report` | `PATCH /analytics/reports/{id}` | Changes the report for everyone who uses it. |
| `clone_report` | `POST /analytics/reports?cloneId={id}` | |
| `clone_dashboard` | `POST /analytics/dashboards?cloneId={id}` | **Clone only.** See below. |

### Creating a report

```jsonc
{
  "report_metadata": {
    "name": "Open pipeline by stage, this quarter",
    "reportType": { "type": "Opportunity" },
    "reportFormat": "SUMMARY",
    "folderId": "00l000000000000AAA",
    "detailColumns": ["OPPORTUNITY_NAME", "ACCOUNT_NAME", "AMOUNT", "CLOSE_DATE"],
    "groupingsDown": [{ "name": "STAGE_NAME", "sortOrder": "Asc", "dateGranularity": "None" }],
    "aggregates": ["s!AMOUNT", "RowCount"],
    "standardDateFilter": { "column": "CLOSE_DATE", "durationValue": "THIS_QUARTER" },
    "reportFilters": [{ "column": "STAGE_NAME", "operator": "notEqual", "value": "Closed Lost" }],
    "showGrandTotal": true
  }
}
```

- `reportFormat` is `TABULAR`, `SUMMARY` or `MATRIX`. `groupingsDown` needs at
  least `SUMMARY`; `groupingsAcross` needs `MATRIX`.
- Aggregate naming is prefix-coded: `s!` sum, `a!` average, `mx!` max, `mn!` min,
  plus the bare `RowCount`.
- `folderId` decides who can see it. Omit it and the report lands in the running
  user's private folder, where the requester probably cannot find it.
- Prefer explicit `startDate`/`endDate` over relative tokens for anything you will
  quote later, because the relative tokens evaluate in the running user's timezone.

## What it refuses

### Hard refusals — no configuration flag enables these

1. **Any DML against business records.** No create, update, delete, upsert or
   merge on Accounts, Contacts, Leads, Opportunities or anything else. This is a
   reporting and extraction server, not a CRM write tool.
2. **Apex execution.** No anonymous Apex, no Apex REST, no Tooling API execution.
3. **The undocumented CSV export URL.** `?export=1&enc=UTF-8&xf=csv` needs
   session-cookie auth and breaks across releases. Not implemented; requests for
   it return a typed refusal naming Bulk API 2.0.
4. **Metadata API deploys.** Authoring a dashboard from nothing requires the
   Metadata API, which is an org-changing deployment path and out of scope. The
   server says so rather than half-implementing it.
5. **Returning detail rows without `allData`.** Every report result carries the
   flag, and a result with `allData: false` is labelled a truncated extract in the
   payload itself.
6. **Mixing report-API and Bulk-extracted figures in one result.** They use
   different currency conversion paths — report amounts convert at current or
   dated rates into the report's currency, `convertCurrency()` does not apply to
   the report API, and Bulk returns `Amount` plus `CurrencyIsoCode`. Separate
   result objects, separate provenance.
7. **Credentials in tool arguments.** Auth is configured at startup. Any
   credential-shaped argument is rejected **before** the handler runs, so it never
   reaches a code path that might log it.

### Gated writes — off by default

`SF_ENABLE_REPORT_WRITES` gates `create_report`, `update_report`, `clone_report`
and `clone_dashboard`. **Default off. With writes off those tools are not
advertised at all** — the agent cannot attempt what it cannot see — and the
handlers refuse independently, because a gate that exists only in the tool listing
is not a gate.

`SF_WRITE_FOLDER_ALLOWLIST` bounds the blast radius of an approved capability to
named folders. With an allowlist configured, omitting `folderId` is refused rather
than defaulting to the private folder.

### Soft guards

- Bulk jobs above `SF_LARGE_EXTRACT_ROWS` require `confirm_large_extract: true`.
- `queryAll` (soft-deleted and archived records) is opt-in per call, and the
  result states in both directions whether deleted records are included.
- Client-side hourly budgets, deliberately below the org ceilings, because the org
  analytics budget is shared with scheduled jobs and other integrations.
- Every response carries a provenance block: running user, timezone, locale, API
  version, `allData`, row count, cap-hit flag, and remaining budget.

## Gotchas this server encodes so you do not have to remember them

- **`allData: false` means the 2,000-row cap was hit** — aggregates exact, rows
  truncated, nothing errors.
- **A field absent from a response is an FLS omission, not a null.** Reporting it
  as zero is the failure mode this matters most for.
- **Timezone is the running user's**, not the org's and not UTC.
- **`Content-Type: application/json` is mandatory on POST run bodies.** Omit it
  and you get silently unexpected results rather than an error. The client sets it
  on every request.
- **Custom summary formulas — `PARENTGROUPVAL`, `PREVGROUPVAL`, `ROWCOUNT` —
  exist only inside reports** and have no corresponding field to extract. They
  cannot be reproduced through `bulk_query` at all, and the truncation note says
  so rather than implying Bulk is a complete substitute.
- **Cross filters, standard report filters and row-limit filters cannot be applied
  when filtering through the API**, even though the report uses them fine in the
  UI. Refused explicitly.
- **The 20-custom-filter cap is ignored silently by Salesforce, not rejected.**
  Enforced client-side, because a run that looks correct and is wrong is worse
  than an error.
- **The `Sforce-Locator` header ends with the literal string `"null"`.** A
  truthiness check on it is an infinite loop; the locator loop handles it, and a
  test pins the behaviour.
- **Compound fields (`Address`, geolocation) are not supported by Bulk API 2.0
  query.** Request the components individually.
- **Soft deletes.** Plain `query` excludes the Recycle Bin and archived records;
  Recycle Bin retention is 15 days, after which period-over-period counts shift
  with no event to point at.

## Non-goals

- **Not a general Salesforce MCP server.** No CRM record writes, no Apex, no
  metadata deployment.
- **Not a replacement for the DX MCP server** for development workflows.
- **Does not wrap CRM Analytics (`/wave/`)**, which is a separately licensed SKU
  most orgs do not have. `POST /wave/dashboards` genuinely creates a dashboard —
  if your org has the licence, that is a different tool for a different product.
- **No dashboard authoring.** The Reports and Dashboards REST API cannot create a
  dashboard from a specification, and cannot edit a clone's components. That is an
  API limitation, not a scoping choice, and the server refuses rather than
  producing an approximation.
- **No Marketo Measure / Bizible semantics.** Usefully, though, Bizible touchpoint
  objects are ordinary Salesforce custom objects — so `bulk_query` and
  `create_report` reach them, which is the one genuinely non-obvious route to
  programmatic attribution reporting.

## Tests

```bash
npm test
```

42 tests, no org and no network required.

`test/server.test.ts` drives the **real server through a real MCP client** over an
in-memory transport, with only the Salesforce HTTP layer faked — so the write
gate, the refusals, the `allData` surfacing and the locator loop are exercised
through the same path a client uses, not by calling handlers directly.
`test/units.test.ts` covers JWT assembly and signature verification, the rolling
rate budget, the `factMap` reader and the guards.

## Layout

```
src/
  index.ts        MCP server wiring; tool listing respects the write gate
  config.ts       startup configuration; the write gate is exact-match "true"
  auth.ts         JWT / client-credentials / refresh-token, instance_url, running user
  client.ts       HTTP transport, retry with Retry-After, rolling hourly budget
  guards.ts       hard refusals, write gate, folder allowlist, filter validation
  factmap.ts      run-response reader; allData, aggregates vs truncated detail rows
  provenance.ts   the block attached to every result
  tools/          reports, dashboards, bulk, and the tool registry
test/
  server.test.ts  end-to-end through an MCP client
  units.test.ts   auth, budget, factMap, guards, errors
  fake-salesforce.ts
```

## Licence

MIT.
