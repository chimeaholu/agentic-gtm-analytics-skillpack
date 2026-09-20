# Official MCP server register

Every entry was verified in the underlying research against vendor documentation
or a vendor-owned GitHub organisation, not a directory listing. **The ecosystem
moves weekly.** Treat hosting, tool counts and status labels as point
measurements and re-verify before depending on any of them.

---

## Tier 1: official, hosted, OAuth, actively developed

These are dependable enough to build on, with named caveats.

### Meta Ads
- **Endpoint:** `mcp.facebook.com/ads`, remote
- **Auth:** OAuth
- **Write:** **yes.** Create and edit campaigns, ad sets and ads
- **Tools:** around 29
- **Caveat:** gradual rollout. Write capability with real money attached. Every
  write routes through `write-gate` at Tier B (spends money)

### Google Ads
- **Repo:** `googleads/google-ads-mcp`, self-host Python
- **Auth:** OAuth or service account
- **Write:** **no. Strictly read-only, in Google's own words**
- **Tools:** 3, of which `search` takes arbitrary GAQL
- **Why it is the reference design:** three tools cover the entire read API
  because one of them is generic. Compare against community Meta servers with
  135 hand-wrapped tools, which are worse for an agent
- **Note:** a community Google Ads MCP is **not** read-only. The read-only
  guarantee belongs to the official server only

### GA4
- **Repo:** `googleanalytics/google-analytics-mcp`, self-host, PyPI `analytics-mcp`
- **Auth:** Application Default Credentials
- **Write:** no
- **Tools:** 7 — account summaries, property details, Ads links, `run_report`,
  `run_funnel_report`, custom dimensions and metrics, realtime report
- **Caveat:** **self-labelled experimental.** A token subset, not full coverage:
  **no `runPivotReport`, no `batchRunReports`, no `checkCompatibility`, no
  `audienceExports`, no `reportTasks`, no Admin write surface**
- **Fallback needed for:** pivots, compatibility checks, audience exports, any
  Admin API operation

### Mixpanel
- **Endpoint:** `mcp.mixpanel.com/mcp`, plus EU and IN regions
- **Auth:** OAuth PKCE; service accounts in beta
- **Write:** **yes.** Dashboards, reports, cohorts, feature flags
- **Tools:** 60+
- **Caveats:** **no HIPAA support.** No cohort editing. Accounts created before
  2026-08-01 need org-admin enablement. Experiments and feature-flag tools, and
  service-account auth, are beta

### Amplitude
- **Endpoint:** `mcp.amplitude.com/mcp`, plus EU
- **Auth:** OAuth, **honours existing Amplitude permissions**
- **Write:** no
- **Tools:** around 13
- **Caveats:** **explicit beta warning from the vendor.** No Export API access,
  so bulk work needs the direct API or S3
- **Quality note:** permission inheritance means the agent cannot exceed the
  human. This is the security tier to prefer

### PostHog
- **Endpoint:** `mcp.posthog.com/mcp`, plus EU
- **Auth:** scoped personal API key
- **Write:** **yes**
- **Tools:** around 80
- **Caveat:** **may incur PostHog AI spend**
- **Repo note:** the standalone repo looks long-dead; **the code moved into the
  monorepo and ships daily.** A clean example of signal 2

### HubSpot
- **Endpoint:** `mcp.hubspot.com`
- **Auth:** OAuth 2.0
- **Write:** **yes**, CRM objects and engagements
- **Status:** GA
- **Caveat:** **zero analytics tools.** Read-only for org context, campaigns,
  landing pages and blog posts. **No access to Sensitive Data Properties**
- **Consequence:** reporting questions do not route here. Use the direct API

### Klaviyo
- **Hosting:** remote and local
- **Auth:** OAuth
- **Write:** **yes**, campaigns and templates **as drafts**
- **Scope:** profiles, campaigns, flows, lists, segments, events, metrics.
  **Reporting is explicitly in scope**, which is unusual
- **Caveat:** send and schedule capability reportedly lands later than the rest

### Braze
- **Endpoint:** `mcp.braze.com` and `.eu`
- **Auth:** **dashboard-user-bound OAuth.** Agent permissions mirror the human's,
  and deactivating the user revokes the agent
- **Status:** GA 2026-07-23
- **Caveats:** **no user-level PII tools at all.** **Blocked entirely if
  dashboard IP allowlisting is enabled**, which is a silent total failure in
  security-conscious accounts
- **Quality note:** the credential model is the best in the register

### Iterable
- **Package:** `@iterable/mcp`, MIT
- **Hosting:** **local stdio only.** No remote endpoint
- **Write:** opt-in and off by default
- **Caveat and model to copy:** separate opt-in flags for PII access, writes and
  sends, each granted per stored key, all **off by default**. Named in the
  research as the permission model a public pack should recommend

### RudderStack
- **Hosting:** vendor-hosted
- **Auth:** OAuth, no stored credentials
- **Write:** **narrow — transformations only.** Explicitly cannot create or
  delete sources or destinations
- **Caveat:** **the transformation write is the highest-risk write capability
  found anywhere in the research.** JavaScript running on every event, silently
  and retroactively corrupting downstream numbers. Tier A in `write-gate`
- **Vendor note:** "AI documentation answers may be inaccurate"

### Inflection
- **Endpoint:** `mcp.inflection.io`
- **Auth:** OAuth 2.1 with dynamic client registration
- **Write:** **drafts only. Cannot activate.** Journeys and emails are drafted;
  a human activates them in the app
- **Why it is in here:** this is the correct design for an agent write surface
  and the pack copies it as `draft_only`

---

## Warehouse, BI and semantic layer

### Snowflake
- **Mechanism:** `CREATE MCP SERVER` in SQL. Tools declared in SQL under RBAC
- **Write:** query, per the declared tools
- **Caveat:** enabling `SYSTEM_EXECUTE_SQL` "allows the MCP client to bypass the
  agent's semantic views", per Snowflake's own warning. Default to semantic-view
  tools only
- **Separately:** the well-known community Snowflake MCP is **marked DEPRECATED
  in its own README** while still being recommended by blogs and directories

### BigQuery
- **Endpoint:** `bigquery.googleapis.com/mcp`
- **Status:** **preview**
- **Note:** prefer a parameterised, predefined SQL tool over an
  arbitrary-SQL-execution tool for anything customer-facing

### Looker
- **Where:** inside `googleapis/genai-toolbox`, self-host
- **Status:** **shipped as-is, not a supported GCP product.** Looker integration
  is **preview and Google-Cloud-hosted Looker only**
- **Consequence:** self-hosted Looker instances have no usable official server

### Tableau
- **Endpoint:** `mcp.tableau.com`, "Tableau Supported"
- **Auth:** OAuth 2.1 with per-user permission enforcement
- **Write:** **no. Read-only, with no create or publish tools**
- **Consequence:** "the agent will build you a Tableau dashboard" is not a thing
  this server can do. Tableau Pulse metric definitions are the authoring surface
  that genuinely exists

### Power BI
- **Server:** Authoring MCP
- **Status:** **public preview, write-first**, and **Microsoft says do not use it
  for consumption.** Fabric IQ is the consumption path
- **Disclosure Microsoft flags:** metadata, schemas and **query results leave the
  platform** and go to the client and its model provider

### Cube
- **Endpoint:** `cubecloud.dev/mcp`
- **Caveat:** **Premium and Enterprise plans only**
- **Posture to adopt:** verify before merging, not after. Model writes confined
  to personal dev branches; destructive tools prompt; production commits require
  confirmation

### dbt
- **Repo:** `dbt-labs/dbt-mcp`, around 50 tools
- **Caveat:** exposes `build` and `run`. An ungated `dbt build` from an agent is
  a Tier C write and the server happily offers it

### Salesforce DX
- **Repo:** `salesforcecli/mcp`, self-host stdio, 60+ tools in selectable toolsets
- **Status:** **Developer Preview, not GA**
- **Caveat:** **developer tooling. No reporting tools at all.** It is not a
  sales-analytics server and cannot be used as one

---

## Where nothing official exists

| Platform | Community reality | Correct action |
|---|---|---|
| **LinkedIn Ads** | clone farm. Identical READMEs and identical commit timestamps under different owners; a "25 tools, full write access" lead-magnet variant | thin direct client |
| **Segment** | no official server. Community projects wrap the **ingestion** API, which is a write path dressed as a read path | thin direct client |
| **Google Search Console** | no official Google server. One genuinely maintained community server exists and is the only community server in the survey worth considering | evaluate that one; otherwise direct |
| **Marketo** | 6 community repos, best at 4 stars | thin direct client |
| **Pardot / MCAE** | 4 community repos, **all 0 stars** | thin direct client |
| **Salesforce Reports and Dashboards REST API** | **no server at all, official or community.** The headline gap | thin direct client |

A thin direct client is not a consolation prize. Access is a page of query
construction plus a page of gotchas per platform, and you get versioning,
pinning and a changelog in exchange.

---

## Aggregators and unified layers

Composio, Pipedream, Zapier MCP, Nango and similar solve **auth and
tool-plumbing**: managed OAuth per user, one endpoint, progressive tool
discovery. They do **not** solve data semantics. An aggregator's "ads platform"
action is a thin proxy over the same API with the same attribution-window trap,
usually exposing less than the native API, and oriented to actions rather than
to windowed analytical queries.

Marketing-specific connector vendors come closer, with pre-mapped dimensions
across platforms, and some now ship their own MCP server. The objection for a
public pack is that they are paid, single-vendor, and **opaque about how they
reconciled incompatible attribution windows** — and that reconciliation is the
hard part, so an opaque answer is worse than no answer.

**MCP itself is the best ergonomic abstraction available and still not a sole
strategy**, for the reasons in the structural caveat.
