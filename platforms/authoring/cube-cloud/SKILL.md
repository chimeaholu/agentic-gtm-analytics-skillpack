---
name: cube-cloud
description: Use for any Cube semantic-layer request — querying measures and dimensions, discovering what a model contains, authoring data-model files, or creating Cube Cloud reports, workbooks and dashboards. Cube is the most agent-native platform in the stack: a searchable semantic model, a Postgres-wire SQL API, and an MCP server that can edit the model on a dev branch with approval prompts. The defining integration bug is that a long query returns HTTP 200 with `{"error": "Continue wait"}` — an agent that treats 200 as success silently produces nothing. Cube Core users get no dashboards and no MCP server.
---

# Cube Cloud

**Capability class: authoring-capable on Cube Cloud Premium and Enterprise. Extract-only on
Cube Core.** This is a hard line and it is the first thing to establish. Dashboards,
workbooks, reports, model branching and the MCP server are **Cube Cloud Premium/Enterprise
features**. A Cube Core user gets `/v1/meta`, `/v1/load` and the SQL API, and nothing else.
**Do not promise dashboard authoring to a Cube Core user.**

Where the tier supports it, `createReport`, `createWorkbook` and `publishDashboard` create
real objects a human opens, so "the agent built you a dashboard" is truthful here in the
same way it is on PostHog and Looker.

**Core contracts this module must call, every time:** `provenance-block` (deployment,
view, `timezone`, security-context identity, pre-aggregation freshness), `warning-field-reader`,
`comparability-rules`, `rate-limit-governor`, `pagination-patterns`, `mcp-detect-fallback`,
`write-gate` before any data-model edit, report, workbook or dashboard publish, and
`answer-contract` on the way out.

**Answer-first discipline for this platform.** Cube numbers are governed and cheap —
pre-aggregations make it the least expensive place in the pack for an agent to ask many
small questions. Compute the number, give it, then name the two things that change it
without erroring: the **`timezone`** you queried in, and whether a **pre-aggregation**
served a stale rollup. Withhold only where the JWT's security context genuinely hides the
data — and say it is a visibility boundary, not an absent measure, because `query_rewrite`
can inject mandatory filters you will never see in the response.

---

## (a) Auth setup — low burden, and the cleanest multi-tenant story in the pack

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

Time to first query: minutes.

1. **Get the API URL and the deployment.** Cube Cloud gives each deployment its own REST
   base (`https://<deployment>.cubecloud.dev/cubejs-api/v1`). Self-hosted Cube Core is
   wherever the user runs it. Never hard-code.
2. **Sign a JWT with `CUBEJS_API_SECRET`** and send it in the `Authorization` header.
   Tokens are optional in dev mode, which is why a working local setup often fails on the
   first real deployment.
3. **Put the security context in the JWT payload. This is the step everyone misses, and on
   Cube it is a design feature rather than a chore.** Cube injects the token payload into
   `query_rewrite` and `COMPILE_CONTEXT`, so **the agent's identity determines its
   row-level visibility by construction.** A token minted with the wrong tenant claim
   returns a complete, well-formed, entirely wrong answer. Decide the identity
   deliberately, and record it in the provenance block.
4. **For the MCP path, Cube Cloud supports OAuth 2.0 (Authorization Code with PKCE)** via
   `cube-mcp-client`, scope `mcp-agent-access`.
5. **Establish Core versus Cloud, and on Cloud the plan tier**, before promising anything
   from (d).

Verify before planning work:

```bash
curl -s -H "Authorization: $CUBE_JWT" \
  "$CUBE_API_URL/meta" | head -c 400
```

An empty or suspiciously small model is usually the security context, not an empty
deployment — see the `/v1/meta` gotcha in (e).

---

## (b) Correct query construction

**`POST /cubejs-api/v1/load`** with a JSON query:

```json
{
  "query": {
    "measures": ["opportunities.total_amount"],
    "dimensions": ["opportunities.stage"],
    "timeDimensions": [{
      "dimension": "opportunities.close_date",
      "granularity": "month",
      "dateRange": ["2026-01-01", "2026-09-01"]
    }],
    "filters": [{"member": "opportunities.is_internal", "operator": "equals", "values": ["false"]}],
    "order": {"opportunities.close_date": "asc"},
    "limit": 5000,
    "timezone": "America/New_York"
  }
}
```

**Point agents at views, not cubes.** Views are the curated, joined, user-facing layer;
cubes are the building blocks. Querying cubes directly is how an agent reinvents a join the
modeller already resolved.

**The introspection and transparency surfaces, which are unusually good here:**

| Endpoint | What it gives you |
|---|---|
| `GET /v1/meta` | the model as visible to your security context — cubes, views, measures, dimensions, types |
| **`POST /v1/sql`** | **the SQL Cube *would* generate, without running it** |
| `/v1/dry-run` | validates a query and tells you **which pre-aggregation would serve it** |

`/v1/sql` and `/v1/dry-run` together let an agent show its work and predict its cost before
spending anything. Use them; they are free relative to the query.

**The SQL API over the Postgres wire protocol is the single easiest integration point for
an agent that already knows SQL** — connect with any Postgres client and query Cube views
as if they were tables. GraphQL, MDX and DAX endpoints also exist.

**Authoring, all Cube Cloud Premium/Enterprise and all routed through `write-gate`:**
workbooks, reports and published dashboards through the MCP (see (d)), and data-model file
edits confined to a personal dev branch.

---

## (c) Pagination, bulk and cost

**`limit` and `offset` on the query. The default limit is 10,000 in most versions with a
configurable maximum.** Ordinary offset paging works here; there is no keyset requirement.

**`Continue wait` is the async idiom and it is the number-one integration bug on this
platform.** A long-running query returns **HTTP 200** with a body of
`{"error": "Continue wait"}`. The client must **re-send the identical query** until results
arrive. Two consequences:

- **An agent that treats HTTP 200 as success silently produces nothing.** Check the body
  for the `error` key before reading `data`.
- **Unpolled queries are marked orphaned and dropped.** Abandoning a query and starting a
  different one does not queue the first; it discards it.

**Concurrency is bounded by `CUBEJS_CONCURRENCY` and the warehouse driver pool.** Hitting
it does not produce a 429 — it produces **more `Continue wait`**. A burst of parallel agent
queries looks like slowness, not like throttling.

**Pre-aggregations are the rollup layer and they are the reason Cube is cheap.** A query
matching a pre-aggregation is served from Cube Store in milliseconds and **never touches
the warehouse**. This makes Cube the least expensive place in the pack for a chatty agent
to ask many small questions — use `/v1/dry-run` to check whether your query will be served
by one before issuing a wide sweep.

**For very large results, use the SQL API or a pre-aggregation export** rather than paging
`/v1/load`.

**Cost lives in the customer's warehouse**, except where a pre-aggregation absorbs it. An
agent that writes `ungrouped: true` queries disables most pre-aggregations and pushes the
cost straight through to the warehouse — see (e).

---

## (d) Preferred MCP server and fallback

**Preferred: the official Cube MCP at `https://cubecloud.dev/mcp`.** The same URL for every
account, deployment and region; OAuth 2.0 with PKCE. **Premium and Enterprise plans only.**

Roughly 30 tools, and the coverage is genuinely broad:

- **Query and discovery:** `listDeployments`, `chat`, `loadQueryResults`, `runQuery`, and
  **`searchDataModel`** — semantic similarity search over views, measures and dimensions,
  which solves the real problem of "which of four hundred measures means revenue?"
- **Dashboard authoring:** `readWorkbook`, `createWorkbook`, **`createReport`**,
  `readReport`, `updateReport`, `deleteReport`, `manageFolders`, `updateDashboard`,
  **`publishDashboard`**.
- **Data-model editing:** `listDataModelFiles`, `readDataModelFile`,
  **`startDataModelEdit`**, `writeDataModelFile`, `deleteDataModelFile`,
  `getDataModelChanges`, `getBranchDiff`, `getDeploymentEnv` (with secrets redacted).
- **Commit and publish:** `getBranchState`, `commitDataModelChanges`, `commitToNewBranch`
  **with an optional pull request**, `mergeToDefaultBranch`, `discardDataModelChanges`,
  `switchUserBranch`.
- **Pre-aggregations:** `getPreAggregationStatus`, `buildPreAggregation`.

**The safety model is the best in the research and this pack copies it.** Model writes are
confined to personal dev branches named `dev-<user>-<hash>`; **nine tools are marked
destructive and always prompt for approval**; production commits require confirmation; RBAC
and row-level security apply throughout. When explaining `write-gate` to a customer, this
is the working example to point at.

**Fallback, and it is the only option on Cube Core: `/v1/meta` plus `/v1/load` plus the SQL
API — and nothing else.** There is no REST authoring path, so on Core the honest
deliverable is the analysis plus a link, not a dashboard. Community wrappers
(`isaacwasserman/mcp_cube_server`, `SIXMON/mcp_cube_server`) are unverified and wrap only
those same two endpoints, so they add risk without adding capability.

---

## (e) Gotchas, and the specific field that reveals each one

- **`{"error": "Continue wait"}` arrives with HTTP 200.** The number-one integration bug.
  **Read the `error` key in the body before reading `data`.** Re-poll the identical query;
  changing it starts a new one and orphans the first.
- **`timezone` is a first-class query parameter and Cube returns different results for the
  same query with a different timezone**, because it shifts time-dimension truncation. The
  default is UTC. **Always set it explicitly.** This is the cleanest timezone handling of
  any platform in the pack, but only if you use it.
- **Pre-aggregations can be stale, and the response does not say so.** A query served from
  an hour-old rollup returns an hour-old answer with **no indication in the response**.
  Check `getPreAggregationStatus` or `lastRefreshTime` before claiming freshness.
- **`ungrouped: true` bypasses aggregation and returns raw rows.** Powerful, easy to
  misuse, and **it disables most pre-aggregations**, so a query that used to be free now
  bills the warehouse.
- **Measure type `countDistinctApprox` is an HLL estimate.** **The type is in `/v1/meta` —
  check it.** Reporting "1,247 accounts" from an approx measure is reporting an estimate as
  a count, and nothing in the result flags it.
- **`format: currency` is presentation only.** No conversion, no unit enforcement.
- **`/v1/meta` returns the model as visible to the JWT's security context.** Cubes marked
  `public: false` and anything filtered by `query_rewrite` are **invisible**. Worse,
  **`query_rewrite` can inject mandatory filters the agent never sees, changing every
  number returned.** The response cannot tell you this happened. **Read the model files to
  know**, and state the identity you queried under.
- **Dynamic and templated data models are returned resolved for the current context.** The
  generating logic lives only in the source files, so `/v1/meta` shows you the output of a
  template, not the template.
- **Cube Core versus Cube Cloud is a hard capability line, and within Cloud the plan tier
  is a second one.** Dashboards, workbooks, reports, branching and the MCP server are Cloud
  Premium/Enterprise. Establish both before promising authoring.

---

## Files

- `references/continue-wait-and-polling.md` — the `Continue wait` loop written out, the
  orphaning rule, and how concurrency exhaustion disguises itself as slowness.
- `references/model-and-security-context.md` — what `/v1/meta` hides, how `query_rewrite`
  changes numbers invisibly, and the pre-aggregation freshness check.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
