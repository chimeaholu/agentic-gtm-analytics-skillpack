---
name: tableau
description: Use for any Tableau request — querying a published data source headlessly, reading calculated-field formulas and lineage, refreshing extracts, managing subscriptions, or creating Tableau Pulse metric definitions. Tableau has the best column-level lineage graph in the stack and a genuinely good headless query API in VizQL Data Service, but content creation is publish-a-file, not compose-an-object: there is no programmatic dashboard-composition API, and agent-generated .twb XML is a high-maintenance technique, not a product capability. Always report extract freshness alongside any Tableau number.
---

# Tableau

**Capability class: query-compose, with one real authoring exception.**

**There is no `POST /worksheets` that composes a viz from a spec. Say that plainly.**
Content creation on Tableau is publish-a-file, not compose-an-object. Generating `.twb`
XML with an agent is a high-maintenance technique, not a product capability, and a
skillpack should not present it as one.

**The exception is Tableau Pulse, and it is genuinely full CRUD** — metric definitions,
metrics, insights and digest subscriptions. An agent can define a GTM metric and subscribe
humans to it. That is real authored content a human opens.

**The rule that follows from both facts: adopt Tableau metrics by calling them through
VizQL Data Service, never by re-implementing the formula.** VDS respects the published data
source's calculated fields, so calling a measure gets you the customer's actual metric
logic. Re-implementing it is worse than it looks, because **join conditions, cardinality
and referential-integrity settings are not reliably exposed** — the Metadata API tells you
*which* tables join, not *how*. A reimplemented metric that double-counts across a
one-to-many join is the predictable result.

**Core contracts this module must call, every time:** `provenance-block` (site, data
source, **extract-versus-live state and `extractLastRefreshTime`**, the identity in the
PAT or JWT, row limit applied), `warning-field-reader`, `comparability-rules`,
`rate-limit-governor`, `pagination-patterns`, `mcp-detect-fallback`, `write-gate` before
any Pulse definition, extract refresh, subscription or publish, and `answer-contract` on
the way out.

**Answer-first discipline for this platform.** VDS answers most questions. Give the number,
then **always report extract freshness alongside it** — that is the single most common
cause of "the API disagrees with the UI", and it is one field. Withhold only where the
identity genuinely cannot see the rows: **RLS silently changes every number depending on
who the token belongs to**, and a filtered number presented as a total is the failure this
module exists to prevent.

---

## (a) Auth setup

1. **Create a Personal Access Token** — the default for scripts. `POST /api/3.x/auth/signin`
   with `personalAccessTokenName`, `personalAccessTokenSecret` and `site.contentUrl`
   returns an `X-Tableau-Auth` token good for roughly 240 minutes idle.
2. **Plan for PAT death. This is the step everyone misses, and it kills scheduled agents
   specifically.** **PATs expire after 15 consecutive days of non-use**, and have a hard
   expiry — one year by default on Cloud. **A monthly-cadence agent will find its token
   dead every time.** Anything scheduled on a PAT needs a keepalive, a rotation plan and an
   auth-failure alert, not a retry.
3. **Give each concurrent worker its own PAT.** **A PAT session is single-use-ish: signing
   in again with the same PAT invalidates the prior session**, so two parallel agents on
   one PAT knock each other out in a way that looks like random auth failures.
4. **Everything is per-site.** `contentUrl` scopes the sign-in, and a multi-site customer
   needs **one credential per site**.
5. **The enterprise path is Connected Apps with JWT**, carrying scopes such as
   `tableau:content:read`, `tableau:viz_data_service:read` and
   `tableau:insight_definitions_metrics:read`. More setup, far better lifecycle — prefer it
   for anything scheduled.
6. **OAuth 2.1** is what the hosted MCP uses.

**Choose the query identity deliberately and state it in the output**, because row-level
security follows it.

---

## (b) Correct query construction

**Four APIs. Never confuse them.**

| API | Use |
|---|---|
| **VizQL Data Service (VDS)** | **the correct agent entry point for data** |
| REST API | content management, view data and images, extract refresh, subscriptions |
| Metadata API | read-only GraphQL lineage at `POST /api/metadata/graphql` |
| **Tableau Pulse** | **the one place agent-created content is real** |

**VDS: `query-datasource` and `read-metadata`** against a `datasourceLuid` (or
`workbookDatasourceId`). The body is a real semantic query, not SQL:

- **`fields[]`** — dimensions and measures, each measure carrying a `function`:
  `SUM`, `AVG`, `MEDIAN`, `COUNT`, `COUNTD`, `MIN`, `MAX`, `STDEV`, `VAR`, `COLLECT`, plus
  temporal `YEAR`, `QUARTER`, `MONTH`, `WEEK`, `DAY`, `TRUNC_*`
- ad-hoc **`calculation`** fields in Tableau calculation syntax
- **`filters[]`** — `SET`, `QUANTITATIVE_NUMERICAL`, `QUANTITATIVE_DATE`, `RELATIVE_DATE`,
  `TOP_N`, `MATCH`
- `parameters`
- **`options`** — `returnFormat` (`OBJECTS` or `ARRAYS`), **`rowLimit`**, `debug`,
  `disaggregate`, `bypassMetadataCache`, `returnServerSentEvents`

**VDS respects the published data source's calculated fields.** That is the whole argument
for using it: the customer's metric logic comes along for free. Call the measure; do not
read its `formula` and rebuild it.

**REST API, for the things VDS does not do:** `Query View Data` (CSV of a view's
**summary** data), `Query View Image` / `PDF` / `Crosstab`, extract-refresh tasks plus
`Query Job`, and full subscription CRUD.

**Metadata API** is the lineage graph — the best column-level lineage in the pack. Use it
to find the upstream warehouse tables, then consider querying the warehouse directly for
volume.

**Tableau Pulse is full CRUD** on metric definitions, metrics, insights and digest
subscriptions, plus `Generate Insight Bundle`. A metric definition specifies a data source,
a measure, a time dimension and filterable dimensions. Creating one is a Tier C write under
`write-gate` because it becomes a shared definition; subscribing humans to a digest is
Tier E because it sends.

---

## (c) Pagination, bulk and cost

| Bucket | Limit |
|---|---|
| Concurrent requests to endpoints that start long-running jobs (Cloud) | **20**, then 429 |
| Extract refreshes (new sites, from 2026.1) | 10 concurrent by default |
| Queries against **interactive workbook data sources** | **time out at 30 seconds** |
| General VDS timeout | 30 minutes, then **HTTP 408** |
| **Metadata API node limit** | **20,000 nodes** |
| Max page size (offset and cursor) | 1,000 |

**VDS streams as of 2026.1 and the previous 1 GB response cap was removed. An unbounded
query can now genuinely flood the agent — always set `rowLimit`.** The removal of a cap is
not permission to omit a limit; it is the reason to set one.

**`NODE_LIMIT_EXCEEDED` on the Metadata API returns partial results with a warning.** **An
agent that ignores the `errors` block silently truncates its lineage graph** and then
reasons confidently about an incomplete model. Read `errors` before reading `data`.

**REST pagination:** `pageSize` (max 1000) plus `pageNumber`, with a `<pagination>` element
carrying `totalAvailable`. Use `totalAvailable` to know when to stop rather than guessing
from a short page.

**Bulk, in order of preference:** VDS with `returnFormat: ARRAYS` and SSE streaming;
`Query View Data` CSV per view; or — **for real volume, skip Tableau and query the
warehouse directly, using the lineage the Metadata API gave you.** That last route is the
right answer more often than people expect, and the Metadata API exists to make it
possible.

**Cost lands on the customer's warehouse for live connections and on Tableau's capacity for
extracts.** A wide VDS sweep against a live connection is a warehouse bill; say so before
starting one.

---

## (d) Preferred MCP server and fallback

**Preferred: the official `tableau/tableau-mcp`, badged "Tableau Supported"** — a stronger
posture than Google's "as-is" on the Looker toolbox. npm `@tableau/mcp-server`.

**The managed hosted service at `https://mcp.tableau.com` uses OAuth 2.1, so every user
signs in with their own Tableau Cloud identity and existing per-user permissions are
enforced automatically. This is the cleanest security story of any MCP in the pack**, and
it is worth citing when explaining why identity matters on a platform where RLS silently
changes numbers.

Self-host with `npx -y @tableau/mcp-server@latest` and `SERVER`, `SITE_NAME`, `PAT_NAME`,
`PAT_VALUE`. Docker and Heroku are supported. Node 22.7.5 or newer.

**Tools are a deliberate read-only subset:** `list-datasources`, `list-fields`,
`read-metadata`, `query-datasource`, `search-content`, `generate-pulse-insight-brief`, and
view-image retrieval in recent versions.

**There are no create or publish tools. The MCP does not expose `Publish Workbook`, Pulse
metric creation or extract refresh.** That is a design choice, not an omission to work
around — but it means **every write goes to the REST API directly**, and every one of those
writes routes through `write-gate` first.

**Fallback: the REST, VDS, Metadata and Pulse APIs directly**, which cover everything.
Community options exist — `TheInformationLab/tableau-mcp`;
`wjsutton/tableau-public-mcp` (Tableau Public only); `Evgenzh2007/tableau-local-mcp`, which
parses local `.twb`/`.twbx` XML offline and is genuinely interesting for workbook forensics
including the join conditions the Metadata API withholds; and `tdries/tableau-graphQL-mcp`.
**Commit recency on all of these was unverified in the research — check before adopting.**

---

## (e) Gotchas, and the specific field that reveals each one

- **Extract versus live is invisible to the caller.** **`hasExtracts` and
  `extractLastRefreshTime` in the Metadata API are the only way to know whether the numbers
  are hours stale. Always report extract freshness alongside any Tableau number.** This is
  the number-one "the API disagrees with the UI" cause: **the UI user refreshed, and you
  hit the extract.**
- **The VDS categorical-filter defect.** A **`SET` filter on a calculated field returns
  empty results when the filter contains 10 or more string values.** Nine or fewer works.
  **Chunk large `SET` filters or filter post-query.** This is exactly the silent
  wrong-answer shape that destroys trust in an agent — no error, just nothing.
- **"Summary data" is not "underlying data".** `Query View Data` returns the aggregated
  summary behind a view, not row-level detail, and there is no clean REST equivalent of the
  full-data download for arbitrary views.
- **Hidden sheets.** Workbooks routinely contain hidden worksheets backing dashboards, and
  **`List Views` returns them.** An agent inventorying "reports" will wildly over-count
  unless it filters.
- **Metadata API indexing is asynchronous.** Freshly published content is not immediately
  in the graph, so an agent that publishes and then immediately queries lineage gets
  nothing and concludes the publish failed.
- **Metadata API results are permission-filtered with no error**, and on Tableau Server the
  Metadata API must be **explicitly enabled** (`tsm maintenance metadata-services enable`).
  On a Server customer it may simply be off, with an unhelpful error.
- **Join logic is largely opaque. This is Tableau's single biggest introspection gap.**
  `upstreamTables` tells you *which* tables, but **join keys, cardinality and
  referential-integrity settings are not reliably exposed.** This is the concrete reason to
  call metrics rather than re-implement them. `.twbx` is a zip, and parsing the `.twb` XML
  is how you get at join conditions the Metadata API withholds — a forensic technique, not
  a production path.
- **LOD expressions and table calcs return as `formula` text but their semantics depend on
  viz context.** `{FIXED [Customer]: SUM([Sales])}` is portable; `WINDOW_SUM` is not,
  because it depends on the partitioning of a sheet you are not looking at.
- **Timezone: Tableau computes dates in the data source's or server's timezone, and
  extracts bake in whatever the refresh ran under. There is no per-query timezone override
  in VDS.** `TRUNC_WEEK` additionally depends on the site's start-of-week setting and, for
  Pulse, on the `custom_calendar` fiscal config — **two users can legitimately see a
  different "this week".**
- **No currency type.** Currency is a number-format string. Multi-currency correctness is
  entirely the modeller's problem and invisible to the API.
- **Field-level permissions barely exist.** Security is row-level (user filters, RLS data
  policies) and object-level. **RLS silently changes every number depending on the identity
  in the PAT or JWT. Run agent queries under a deliberately chosen identity and say which
  one in the output.**
- **Soft deletes.** Newer versions have a 30-day Recycle Bin. REST list calls exclude
  deleted content, but **content IDs stay resolvable for a window**, so a cached LUID can
  resurrect a reference to deleted content.
- **There is no `POST /worksheets` that composes a viz from a spec.** Say it plainly, every
  time it comes up.

---

## Files

- `references/vds-query-construction.md` — the VDS body shape, the `SET`-filter defect and
  its workaround, `rowLimit` discipline, and why you call a measure rather than rebuild it.
- `references/pulse-and-lineage.md` — what Pulse can genuinely author, and how to use the
  Metadata API lineage to decide when to leave Tableau for the warehouse.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
