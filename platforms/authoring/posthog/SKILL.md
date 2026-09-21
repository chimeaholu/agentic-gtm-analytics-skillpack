---
name: posthog
description: Use for any PostHog request — product analytics, funnels, retention, session data, SQL over event data, or creating insights and dashboards. PostHog is the strongest programmatic reporting surface available: HogQL is real ClickHouse SQL over your events, and insights and dashboards are full CRUD, so "the agent built you a dashboard" is a truthful sentence here. Two hard edges the agent must not improvise: HogQL is ClickHouse SQL, not Postgres, and `OFFSET` pagination is rejected with HTTP 400 — use keyset pagination on `timestamp`.
---

# PostHog

**Capability class: authoring-capable.** PostHog is one of the few platforms where an
agent can run an analysis and then save it as a persistent object a human opens in the
product. Insights and dashboards are full CRUD over REST. Claiming "I built you a
dashboard" is honest here and dishonest on GA4, Google Ads, HubSpot, Marketo and
Amplitude.

**Core contracts this module must call, every time:** `provenance-block` (platform,
project, query text, timezone, freshness), `warning-field-reader`, `comparability-rules`,
`rate-limit-governor` before the first call, `pagination-patterns` for keyset paging,
`mcp-detect-fallback` for tool selection, `write-gate` before creating or editing any
insight, dashboard, cohort or feature flag, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** PostHog numbers are almost always
computable. Compute them, give them, then name the error direction in one plain sentence:
"this counts current person properties, not the value at event time, so plan-based splits
drift toward today's plan mix"; "this is HogQL-truncated in the project timezone, so it
can differ from the insight by one day at the boundary". Withhold only where the number
genuinely does not exist: a property that was never captured, a person deleted before the
window, or a project whose data-read cap is exhausted. Never withhold a number because the
user might misread it. Say when the rough figure is fine: for a "roughly how many users
activated last month" question, the current-person-property version is fine and you should
say so rather than insisting on an event-property rewrite.

---

## (a) Auth setup — the fastest in the pack

> **Setting this up with someone who has not done it before? `references/connect.md` is
> the same setup as a guided walkthrough — read aloud one step at a time, with the exact
> screens, the scopes to choose and why, a verification call, and the common failures.**

Time to first query: minutes. No app review, no approval queue, no cloud project.

1. **Get the region and base URL from the user before anything else. This is the step
   everyone misses.** PostHog Cloud US is `https://us.posthog.com` (older docs and
   installs use `https://app.posthog.com`), Cloud EU is `https://eu.posthog.com`, and
   self-hosted is whatever host they run. A US key against the EU host does not redirect;
   it fails or returns nothing useful. Never hard-code the host.
2. **Create a Personal API key.** Settings → Personal API keys → create. The key is
   user-scoped and prefixed `phx_`. Choose **granular per-resource scopes** at creation,
   and restrict it to the specific project or organization.
3. **Ship the minimal scope set.** For read-only analysis: `query:read`, `insight:read`,
   `dashboard:read`. Add `insight:write` and `dashboard:write` only when the user has
   asked for an authored artefact, and route that request through `write-gate` first.
   Scope discipline here genuinely limits blast radius in a way an all-or-nothing secret
   key cannot.
4. **Know which key you are holding.** `phx_` is the personal API key and is what queries
   the API. `phs_` is a project secret key (beta) for server-to-server use. `phc_` is the
   **project token and is ingestion only** — it will not authenticate a query. A `phc_`
   token in a query call is a common and confusing first failure.
5. **Find the numeric project ID.** Every analytics path is
   `/api/projects/{project_id}/...`. It is in Settings → Project, and
   `GET /api/projects/` lists the projects the key can reach.
6. **Verify before you plan work:**

```bash
curl -s -H "Authorization: Bearer $POSTHOG_API_KEY" \
  "$POSTHOG_HOST/api/projects/$PROJECT_ID/query/" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"kind":"HogQLQuery","query":"SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY"}}'
```

A 401 means wrong key or wrong region. A 403 means the key lacks the `query:read` scope.
An empty result with HTTP 200 means the project is real and quiet, which is a different
finding and should be reported as such.

---

## (b) Correct query construction

**The query endpoint.** `POST /api/projects/{project_id}/query/` with a body of
`{"query": {"kind": "HogQLQuery", "query": "SELECT ..."}}`. HogQL is ClickHouse SQL over
the event data: joins, CTEs, window functions, aggregates. There is no DSL, no
compatibility matrix, and no "these two dimensions cannot be combined". For an agent this
is the best-fitting interface in the whole GTM stack — which is exactly why the failure
mode is writing Postgres and getting subtly wrong results rather than an error.

**Read `references/hogql-cheatsheet.md` before writing the first query.** Do not rely on
SQL priors. The differences that bite are date functions, JSON access, array handling and
argument order.

**Every generated query carries a bounded `timestamp` range.** PostHog's own docs say the
burden of performance falls on you; HogQL is not query-planned for you, and naive SQL over
a large event table produces slow or failing queries. A bounded range is not an
optimisation, it is the default:

```sql
SELECT toStartOfDay(timestamp) AS day, count() AS pageviews
FROM events
WHERE event = '$pageview'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND timestamp < now()
GROUP BY day
ORDER BY day
```

**Prefer materialized views and materialized properties** where the project has them; a
filter on a materialized property is an ordinary column read rather than a JSON extraction
on every row.

**Other surfaces, all under `/api/projects/{project_id}/`:** `insights` (full CRUD),
`dashboards` (full CRUD), `events`, `persons`, `cohorts`, `actions`, `feature_flags`,
`experiments`, `surveys`, `session_recordings`, `batch_exports`, `annotations`.

**Authoring an insight and pinning it to a dashboard** is the end-to-end demo that is
truthful on this platform. The procedure, payload shapes and the round-trip test are in
`references/authoring-insights-dashboards.md`. Two rules from that file belong here
because skipping them produces broken artefacts:

- **Create the dashboard first, then the insight with `dashboards: [id]`**, or create the
  insight and patch it onto the dashboard. Do not assume an insight appears anywhere
  without an explicit link.
- **Round-trip test every authored insight.** The API accepts a `query` blob without the
  UI's validation, so it is possible to create an insight the UI cannot render. Re-read it
  with `GET /api/projects/{project_id}/insights/{id}/` and, where the endpoint supports
  it, refresh it. An insight that returns data over the API and renders as an error in the
  product is a failed deliverable, not a delivered one.

---

## (c) Pagination, bulk and cost

**Rate limits** (organization-wide across all team members, not per key — an agent
hammering the API degrades the humans' experience, and you should say so before starting a
wide sweep):

| Bucket | Limit |
|---|---|
| Analytics endpoints | 240/minute, 1,200/hour |
| **Query endpoint** | **2,400/hour**, plus monthly data-read caps on free plans |
| CRUD operations | 480/minute, 4,800/hour |
| Feature flag local evaluation | 600/minute |

**Row caps.** The query default is **100 rows**. With an explicit `LIMIT` you can retrieve
up to **50,000 rows per query**. A query without `LIMIT` that you assume returned
everything has quietly returned 100 rows; check the row count against your expectation
before aggregating locally.

**`OFFSET` is rejected with HTTP 400 for personal API keys.** This is not a soft
limitation and it is not negotiable by retrying. An agent that writes
`LIMIT 1000 OFFSET 1000` gets a 400 and, if it does not handle that specific case, reports
"the query failed" instead of paginating. **The documented approach is keyset pagination
on `timestamp`:**

```sql
-- page 1
SELECT timestamp, uuid, event, distinct_id
FROM events
WHERE timestamp >= {start} AND timestamp < {end}
ORDER BY timestamp ASC, uuid ASC
LIMIT 10000

-- page n+1: carry the last row's (timestamp, uuid) forward
SELECT timestamp, uuid, event, distinct_id
FROM events
WHERE timestamp >= {start} AND timestamp < {end}
  AND (timestamp, uuid) > ({last_timestamp}, {last_uuid})
ORDER BY timestamp ASC, uuid ASC
LIMIT 10000
```

Sorting on `timestamp` alone is not a stable key when many events share a millisecond;
the tuple with `uuid` is. Stop when a page returns fewer rows than the limit.

**Async execution.** The query endpoint takes a `refresh` parameter: `blocking` (default),
`async`, `force_blocking`, `force_async`, `force_cache`, `lazy_async`,
`async_except_on_cache_miss`. Async returns `query_status.id`; poll
`GET /api/projects/{project_id}/query/{query_id}/`. **Use `async` for any non-trivial
HogQL** — long queries otherwise die at the HTTP layer and look like a platform outage.

**Bulk is not the query endpoint.** For volume, use `/batch_exports` to S3, BigQuery,
Snowflake, Redshift or Postgres and query the warehouse. Paging millions of rows through
`/query` is the wrong tool and will exhaust the hourly bucket.

**Cost, which is separate from rate limits.** Free plans carry **monthly data-read caps on
the query endpoint**. Exploratory SQL with wide scans can burn a free project's monthly
allowance in one session. Warn the user before a wide scan, and prefer one well-shaped
query over five exploratory ones. The MCP path has its own cost note in (d).

---

## (d) Preferred MCP server and fallback

**Preferred: the official PostHog MCP server.**

- Remote endpoints: `https://mcp.posthog.com/mcp` (US), `https://mcp-eu.posthog.com/mcp`
  (EU). Auth routes to the correct region automatically from the key.
- Auth: personal API key as a Bearer token.
- Install: `npx @posthog/wizard@latest mcp add` configures Cursor, Claude, Claude Code,
  VS Code and Zed. This is the lowest-friction MCP install of any platform in the pack.
- Coverage is broad (roughly 80 tools): insights, dashboards, experiments, feature flags,
  notebooks, actions, cohorts, event definitions, surveys, error and issue management, SQL
  execution, CDP destinations, semantic-layer metrics. **It is write-capable**, so
  `write-gate` applies to MCP calls exactly as it applies to REST calls.

**Source-staleness note that matters for any maintainer check.** The standalone
`PostHog/mcp` repository looks around eight months stale. It is not the live code. The
server moved into the monorepo at `PostHog/posthog` under `services/mcp`, which ships
daily. This is the case where a naive "last commit date" check lies. Check where the code
actually lives before writing a server off.

**Cost caveat you must disclose before using it.** The MCP connection is free, but some
MCP tools use LLMs internally and may be billed as PostHog AI spend, which requires AI data
processing to be enabled in org settings. An agent can therefore incur charges on the
user's PostHog bill. Say this before the first MCP-mediated analysis, not after.

**Fallback: the REST and query API, which covers everything the MCP does.** There is no
capability gap that forces the MCP. If the MCP is absent, misconfigured, or the user
declines the AI-spend exposure, degrade to direct calls with no loss of function and say
that is what you are doing. Community servers (`friendlygeorge/posthog-mcp-server`,
`deadrime/posthog-toolkit-mcp`) exist and add risk without adding capability.

---

## (e) Gotchas, and the specific field that reveals each one

- **HogQL is ClickHouse SQL, not Postgres.** Symptom: a query that "works" but returns
  wrong buckets, or an error naming an unknown function. `FULL OUTER JOIN` is unavailable
  on older versions, date functions are ClickHouse-named (`toStartOfWeek`,
  `toStartOfMonth`), `dateDiff` takes the unit first, nested JSON needs
  `JSONExtract*` semantics, and arrays use array functions rather than `unnest`. Use
  `references/hogql-cheatsheet.md`; do not improvise from SQL priors.
- **`person.properties.<name>` is latest-value-wins, not point-in-time.** The field looks
  historical and is not. `person.properties.plan` returns today's plan for every event,
  including events from before the upgrade, so a cohort split by plan silently
  back-dates current state. Use the event property captured at the time
  (`properties.plan`) when the question is historical. Give the number either way and name
  which one you computed.
- **`$`-prefixed properties are PostHog-managed; custom properties are unvalidated.** A
  typo creates a sibling property rather than an error, so `properties.signup_source` and
  `properties.signup_Source` both exist with partial data. Check
  `/api/projects/{id}/property_definitions/` for near-duplicate names before trusting a
  breakdown.
- **Project timezone governs insight date truncation; HogQL lets you override it with
  `toTimeZone`.** So HogQL results and Insight results can legitimately differ at day
  boundaries and neither is wrong. **If you must match an insight, query the insight; do
  not rewrite it in SQL.**
- **Deleted persons are soft-deleted and the event rows persist.** A query against
  `events` still surfaces activity for a person who is gone from `persons`, so an
  events-based user count exceeds a persons-based one. Decide which one the question wants
  and say which you used.
- **`person_id` is resolved through identity merging, so history is not stable.** An
  anonymous-to-identified merge rewrites the mapping, which means a HogQL
  `count(DISTINCT person_id)` for a *past* window can change after the fact. A unique-user
  number you quoted last week may not reproduce. Label such numbers as subject to
  retroactive merge rather than presenting them as fixed.
- **`query_status.complete` / `query_status.error` on async runs.** An async query that has
  not completed returns a status object, not rows. Treating the status envelope as an
  empty result set reports "no data" for a query that is still running. Poll until
  `complete` is true, and read `error` before reading results.
- **HTTP 400 on the query endpoint with an `OFFSET` in the SQL is the pagination trap, not
  a broken query.** Detect the specific case and switch to keyset paging rather than
  reporting a failure.
- **HTTP 429 and the monthly data-read cap are different limits with a similar feel.** A
  429 is a rate limit and clears; an exhausted free-plan monthly read allowance does not
  clear until the billing period rolls. Read the error body rather than retrying blindly.
- **Insights created over the API bypass UI validation.** A saved insight can be
  un-renderable in the product while the API returns rows for it. Round-trip test.
- **Self-hosted and older instances lag the cloud API.** Feature availability is whatever
  version was deployed, so an endpoint that exists in the docs may not exist on the
  instance. Ask which deployment it is during auth setup, and degrade the plan rather than
  reporting a bug.

---

## Files

- `references/hogql-cheatsheet.md` — the ClickHouse-vs-Postgres content. Load before
  writing any HogQL.
- `references/authoring-insights-dashboards.md` — payload shapes, the create order, and
  the round-trip test for insight and dashboard authoring.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
