---
name: mixpanel
description: Use for any Mixpanel request — segmentation, funnels, retention, flows, cohorts, raw event export, or creating dashboards and reports through Mixpanel's MCP server. Mixpanel is the only platform besides PostHog where an agent can author a reporting artifact a human opens in the product, but that capability lives behind a beta MCP, not the documented REST API — treat it as a bonus path with a documented fallback. The binding constraint is 60 Query API calls per hour, which Mixpanel states cannot be raised: batch, never iterate.
---

# Mixpanel

**Capability class: authoring-capable via MCP only.** The MCP server can create dashboards
with text cards and reports, create cohorts and custom properties, and manage feature flags
and experiments. **The documented REST API has no authoring path at all.** So the honest
framing is: authoring is a bonus route that depends on a beta server being enabled for this
account, with a well-documented read-only fallback underneath it. Where the MCP is
unavailable, **the deliverable is the analysis plus a link, not a dashboard**, and you say
so up front rather than at the end.

**The binding constraint is 60 Query API calls per hour, and Mixpanel states it cannot be
raised.** This is not a throttle to back off from; it is the architecture. An agent that
explores conversationally — "let me check that segment… and that one… now break it by
platform…" — **exhausts an hour's entire budget in a few minutes.** Design one wide
grouped query. Never iterate.

**Core contracts this module must call, every time:** `provenance-block` (project, region,
project timezone, counting method, ID-merge version), `warning-field-reader`,
`comparability-rules`, **`rate-limit-governor` before the first call — non-optional here**,
`pagination-patterns`, `mcp-detect-fallback`, `write-gate` before creating any dashboard,
report, cohort, custom property, feature flag or experiment, and `answer-contract` on the
way out.

**Answer-first discipline for this platform.** Mixpanel answers almost any behavioural
question, and the answer is usually cheap in tokens and expensive in call budget. Give the
number, then name the one thing that makes it differ from the UI: counting method,
project timezone, a board-level filter you did not replicate, or sampling on a very large
project. Withhold only where the data genuinely is not there — a Lexicon computed property
that does not exist in the raw export, or a window that predates the project. Never
withhold a number to save a call; say what the call budget cost instead.

---

## (a) Auth setup — minutes, with one regional trap

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

1. **Establish data residency before anything else. This is the step everyone misses.**
   Mixpanel runs regional stacks: EU at `eu.mixpanel.com` / `data-eu.mixpanel.com`, India
   at `in.mixpanel.com` / `data-in.mixpanel.com`, and the default US hosts otherwise.
   **Using the wrong regional host against an EU project silently returns empty results
   rather than an error.** Ask which region the project lives in, and never hard-code.
2. **Create a Service Account.** This is the modern credential — created at org or project
   level with a role (Consumer, Analyst, Admin) and used with **HTTP Basic auth as
   `{username}:{secret}`**.
3. **Know which credential you are holding.** The **Project Token is ingestion-only and
   will not authenticate a query** — a very common and confusing first failure. The
   **Project Secret** is the legacy per-project credential and is deprecated in direction;
   prefer a service account.
4. **Get the numeric project ID**, which most Query API calls require as a parameter.
5. **For the MCP path:** OAuth (Authorization Code with PKCE S256) for interactive use, or
   Service Accounts (beta) for headless use.
6. **Check MCP enablement, because this is the first support question from any existing
   customer.** **Accounts created after 2026-08-01 have MCP on by default. Older accounts
   need an org admin to enable it** in Settings → Org → Overview.

No app review, no approval queue. Time to first query: minutes.

Verify before planning work:

```bash
curl -s -u "$MIXPANEL_SA_USERNAME:$MIXPANEL_SA_SECRET" \
  "https://mixpanel.com/api/query/cohorts/list?project_id=$MIXPANEL_PROJECT_ID"
```

An empty result on a project the user says is busy is a region mismatch far more often than
it is an empty project. A 401 means the credential; a `phc`-style ingestion token would
also fail here.

---

## (b) Correct query construction

**The Query API** lives at `mixpanel.com/api/query/...` (regional host as established
above):

| Endpoint | Use |
|---|---|
| **`insights`** | **run a saved report by `bookmark_id`** — the way to match the UI |
| `segmentation` | arbitrary event segmentation with a `where` expression and `on` breakdown |
| `funnels` | funnel conversion |
| `retention` | retention and cohort-retention |
| `frequency` | frequency distributions |
| `engage` | user profiles |
| `cohorts/list` | cohort discovery |

**Raw Data Export** is a separate host: `data.mixpanel.com/api/2.0/export`, returning
newline-delimited JSON. **Lexicon Schemas API** carries the definitions.

**Mixpanel's own design guidance, and it is the rule that keeps this module inside its call
budget: consolidate several filtered queries into one `segmentation` query rather than
issuing them separately.** One call with an `on` breakdown replaces ten calls with
different `where` clauses, and on a 60-per-hour budget that is the difference between an
analysis and a rate-limit error.

**JQL is retired.** Any tutorial, blog post or MCP server offering a JQL tool is out of
date, and a JQL-based plan should be rewritten rather than attempted.

**When you must match a Mixpanel board, run the saved report by `bookmark_id` through
`insights`.** Do not rebuild the query — see the UI-versus-API gotcha in (e).

---

## (c) Pagination, bulk and cost

| Bucket | Limit |
|---|---|
| **Query API** | **5 concurrent, 60 queries per hour** |
| Raw Data Export | 100 concurrent, 60 queries/hour, 3/second |
| Lexicon | 5 requests/minute |

**Mixpanel states the Query API limits cannot be raised.** Exceeding returns **429**.
Treat 60/hour as a fixed budget to be spent deliberately, announce the spend before a
multi-query analysis, and cache aggressively — for hours, not minutes.

**There is no async job-and-poll pattern for bulk.** Raw Export is a **long-running
streaming GET** over a `from_date`/`to_date` day range that returns NDJSON. Plan for a
connection held open, not a job handle.

**Pagination:** `engage` pages with `session_id` plus `page`. The analytics endpoints do
not page — they constrain by date range and breakdown limit instead. So "get me everything"
on `segmentation` is answered by narrowing the range, not by turning a page.

**For genuine volume, Mixpanel's own answer is Data Pipelines** — scheduled export to
BigQuery, Snowflake, S3 or GCS. It is a **paid add-on**. This is a strong argument for
exporting once to a warehouse and querying there, rather than re-querying Mixpanel, and
the 60/hour ceiling is the reason.

---

## (d) Preferred MCP server and fallback

**Preferred: the official Mixpanel MCP, which was the most capable analytics MCP in the
research.**

- Remote endpoints: `mcp.mixpanel.com/mcp` (US), `mcp-eu.mixpanel.com/mcp`,
  `mcp-in.mixpanel.com/mcp`.
- Auth: OAuth with PKCE S256 for interactive use; Service Accounts (beta) headless.
- **Users reach only the projects they already have access to, and existing roles and
  project permissions are enforced.**

**60-plus tools across eight functional areas — a genuinely broad wrap rather than a token
subset.** Reads cover insights, funnels, flows and retention; discovery of events,
properties, cohorts and metrics; session replays; and experiment results. **Writes cover
creating dashboards with text cards and reports, creating cohorts and custom properties,
managing feature flags and experiments, and full Lexicon operations.** Every write routes
through `write-gate` — dashboards and reports are Tier D; Lexicon and cohort definitions
are Tier C because they change what everyone's numbers mean.

**Stated limitations to quote to the customer, not to discover mid-build:**

- **Experiments and Feature Flags tools are open beta.**
- **"Audience targeting and cohort editing are not yet supported via MCP — use the Mixpanel
  UI instead."**
- **The MCP server does not currently support HIPAA requirements**, which is a real blocker
  for a healthcare client and needs saying before any integration work starts.

**Enablement is the practical first hurdle: accounts created after 2026-08-01 have MCP on
by default; older accounts need an org admin to enable it.**

**Fallback: the Query API for reads. There is no REST authoring path.** Where the MCP is
unavailable, the honest deliverable is the analysis plus a link to a query, and you say
that at planning time rather than after the work.

---

## (e) Gotchas, and the specific field that reveals each one

- **Project timezone governs everything, and changing it retroactively re-buckets
  historical reports.** A number you quoted last month may not reproduce, with nothing in
  the response explaining why. **There is no per-query timezone override.** Record the
  project timezone in the provenance block on every answer.
- **Late-arriving events are inserted retroactively, so exports are not immutable.**
  Re-exporting the same day later returns **more rows**. An export is a snapshot of what
  had arrived at the time you took it, and a diff between two exports of the same day is
  not evidence of a bug.
- **Identity Management v2/v3 merge semantics changed how `distinct_id` resolves.** On
  ID-Merge projects, **the raw-export `distinct_id` is not necessarily the canonical ID
  used in the UI.** **Check which ID-merge version a project is on before writing any join
  logic**, because the failure is silent and produces plausible, wrong user counts.
- **`$`-prefixed properties are reserved and behave differently** from custom properties.
- **Lexicon computed and custom properties are evaluated at query time and do not exist in
  the raw export.** If a board uses one, **the export will not contain it** and a warehouse
  model must recreate the formula. This is the most common "the warehouse can't reproduce
  the board" cause on Mixpanel.
- **Cohorts are query-time constructs.** Exporting "users in cohort X" gives a snapshot,
  not a stable set, and re-running it tomorrow legitimately returns different members.
- **GDPR deletion removes profiles and events from queries going forward; prior exports
  retain them.** A warehouse copy drifts out of compliance unless deletions are replayed.
- **UI-versus-API disagreement traces to four things:** the counting method (total versus
  unique versus DAU), the project's session definition, a board-level filter you did not
  replicate, or sampling on very large projects. **When you must match the UI, query the
  saved report by `bookmark_id` rather than rebuilding the query.** Rebuilding reproduces
  the question, not the report.
- **No currency handling whatsoever.** Revenue is a numeric property; Mixpanel does not
  know or convert currencies, so a multi-currency product produces a silently summed
  number that means nothing.
- **Free-plan and older-plan restrictions apply to some endpoints and to MCP enablement.**
  **"The API exists" and "your account can call it" are different claims** — verify the
  tier before promising.

---

## Files

- `references/call-budget-planning.md` — how to fit an analysis inside 60 calls per hour,
  the consolidation rule, and the caching policy.
- `references/matching-the-ui.md` — counting methods, session definitions, board filters,
  and why `bookmark_id` beats rebuilding a query.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
