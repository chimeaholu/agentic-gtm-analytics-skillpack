---
name: snowflake
description: Use for any Snowflake request — running SQL, discovering or authoring semantic views, reading the data catalogue, or investigating column-level lineage from query history. Snowflake is the best semantic layer to both read and write, because semantic views are first-class SQL objects you can SHOW, DESCRIBE, GET_DDL and CREATE OR ALTER. Two things must be explicit every time: the session TIMEZONE (which defaults to America/Los_Angeles on many accounts) and the cost guardrails, because cost, not a rate limit, is the real constraint. Snowsight dashboards are not API-creatable — do not promise them.
---

# Snowflake

**Capability class: query-compose, with genuine semantic-layer authoring.** Semantic views
are **first-class SQL objects**: `SHOW`, `DESCRIBE`, `GET_DDL` and
**`CREATE OR ALTER SEMANTIC VIEW`** all work on them. That makes Snowflake the best
semantic layer in the pack to both read and write — a metric definition here is an object
under version control and RBAC, not a setting in a BI tool.

**Snowsight dashboards are not API-creatable. Do not promise them.** The deliverable is a
query, a view, or a semantic view — and a BI tool or a delivery surface pointed at it.

**Cost, not a rate limit, is the real constraint.** There are no published request-rate
thresholds. There is an invoice. Every guardrail in (c) is mandatory in this module rather
than advisory.

**Core contracts this module must call, every time:** `provenance-block` (account, role,
warehouse, **session `TIMEZONE`**, `WEEK_START`, query id, semantic view if used),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor`,
`pagination-patterns`, `mcp-detect-fallback`, `write-gate` before any
`CREATE OR ALTER SEMANTIC VIEW`, DDL or MCP server definition change, and `answer-contract`
on the way out.

**Answer-first discipline for this platform.** Snowflake will answer almost anything. Run
the query, give the number, then name the two things that silently changed it: the session
`TIMEZONE` and whether a masking or row-access policy applied. Withhold only where the role
genuinely lacks a grant — and say it is a grant, because **a query can succeed and return
nothing because the role lacks access to a new object**, which is indistinguishable from
"no data" unless you check.

---

## (a) Auth setup — the most agent-friendly in the pack

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

No app registration, no tenant admin, no consent screen. Time to first query: minutes.

1. **Key-pair JWT, which is the recommended path.** Generate an RSA keypair,
   `ALTER USER … SET RSA_PUBLIC_KEY='…'`, sign an **RS256 JWT with a maximum 60-minute
   lifetime and no refresh token**, and send it with
   `X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT`. A scheduled agent re-signs; it does
   not refresh.
2. **Programmatic Access Tokens (PAT)** are the simpler bearer option and **often require a
   network policy on the user** — that requirement is the usual reason a PAT that looks
   correct is rejected.
3. **Snowflake OAuth or External OAuth** for user-attributed access; this is what the
   managed MCP server uses.
4. **Do not design an agent around username and password. Snowflake is aggressively
   deprecating single-factor password auth.**
5. **Create a dedicated least-privilege role and a small dedicated warehouse for the agent.
   This is the step everyone misses, and it is two controls in one.** Every request runs as
   a **role**, which determines everything visible — so the role is your security boundary.
   And a dedicated warehouse makes the agent's compute cost **separately attributable**,
   which is your cost control. Doing this later is much harder than doing it first.

Verify before planning work:

```bash
curl -s -X POST "https://$SNOWFLAKE_ACCOUNT.snowflakecomputing.com/api/v2/statements" \
  -H "Authorization: Bearer $SNOWFLAKE_JWT" \
  -H "X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"statement":"SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_TIMEZONE()",
       "timeout":30}'
```

**Read `CURRENT_TIMEZONE()` from that response and record it.** On many accounts it is
`America/Los_Angeles`, not UTC, and it silently changes what "today" means — see (e).

---

## (b) Correct query construction

**SQL API v2:** `POST https://<account>.snowflakecomputing.com/api/v2/statements`. Sync by
default; **`async=true`** returns a `statementHandle` you poll with
`GET /api/v2/statements/{handle}`.

**Semantic views are queried with a dedicated construct, and it is not ordinary SQL:**

```sql
SELECT * FROM SEMANTIC_VIEW(
  gtm_metrics
  METRICS total_revenue, open_pipeline
  DIMENSIONS region, close_month
)
```

**You cannot `SELECT col FROM semantic_view`.** An LLM writing "normal" SQL against a
semantic view will fail. Standard SQL querying of semantic views went GA on 2026-03-02;
treat the construct above as the way in.

**Authoring semantic views:** `CREATE SEMANTIC VIEW`, and since 2026-05-04 (preview)
**`CREATE OR ALTER SEMANTIC VIEW`** — declarative, safe to re-run, **preserves grants**,
and can modify tables, relationships, facts, dimensions, metrics, comments, AI instructions
and verified queries. This is a Tier C write under `write-gate`.

**`NON ADDITIVE BY` (available from 2026-03-05) marks a metric semi-additive so it is not
summed across specified dimensions.** This is exactly the semantic nuance an agent would
otherwise get catastrophically wrong — a balance or a headcount summed across months — and
**it is machine-readable. Read it before aggregating any metric.**

**Cortex Analyst** (`POST /api/v2/cortex/analyst/message`) takes a semantic model or view
and **returns SQL plus an explanation; you execute it yourself.** The practical read: use
Cortex Analyst as a **grounding check** — "what SQL would Snowflake's own text-to-SQL write
for this metric?" — not as the primary data path. **An agent that can read the semantic
view should construct `SEMANTIC_VIEW()` queries itself, because deterministic beats a
second LLM in the loop.**

---

## (c) Pagination, bulk and cost

**There are no published request-rate thresholds. Snowflake may return HTTP 429 and does
not expose rate-limit headers. Build exponential backoff and assume nothing.**

**There is no row cap. The constraint is result-set size, handled by partitioning.** The
first response carries partition 0 plus **`resultSetMetaData.partitionInfo[]`**, and you
fetch the rest with `?partition=N`.

**Partitions are approximately fixed-size chunks, not fixed row counts. Iterate
`partitionInfo`; never guess a page size or assume uniform row counts per partition.**

**Statement timeout** is `STATEMENT_TIMEOUT_IN_SECONDS`, whose default is 172,800 seconds
and is usually set far lower. **Use `async=true` for anything over about 45 seconds.**

**Bulk export:** `COPY INTO <stage>` to an external stage, then a presigned URL. Do not
page millions of rows through the SQL API.

**Cost is the real rate limit, and these guardrails are mandatory, not advisory:**

- a **dedicated small warehouse with `AUTO_SUSPEND = 60`**
- **`STATEMENT_TIMEOUT_IN_SECONDS` and `STATEMENT_QUEUED_TIMEOUT_IN_SECONDS`** set on the
  agent's warehouse and role
- **resource monitors with a hard `SUSPEND` trigger** — a notify-only monitor does not stop
  anything
- **always `LIMIT` exploratory queries**, and **`SAMPLE` for profiling**
- attribute spend through `QUERY_HISTORY` and `WAREHOUSE_METERING_HISTORY`

**The result cache makes an identical query within 24 hours against unchanged data free.**
Deterministic agents benefit from stable SQL text — generating the same query byte-for-byte
is a genuine cost optimisation. But see the warehouse-suspension gotcha in (e), and note
that any change to the text, including whitespace, misses the cache.

---

## (d) Preferred MCP server and fallback — this is a live trap, get it right

**`Snowflake-Labs/mcp` is marked `[DEPRECATED]` and "no longer maintained" in its own
README**, which redirects to the official server. **Many blog posts and MCP directories
still recommend it. Do not ship a skill pointing at it.** Forks carry the same dead code.

**The official path is the Snowflake-managed MCP Server, which is itself a Snowflake
object.** You `CREATE MCP SERVER` with a YAML spec listing its tools, and it is served at
`https://<account_url>/api/v2/databases/{db}/schemas/{schema}/mcp-servers/{name}`.

Tool types:

| Type | What it does |
|---|---|
| `CORTEX_ANALYST_MESSAGE` | text-to-SQL grounded on a semantic view |
| `CORTEX_SEARCH_SERVICE_QUERY` | search service |
| `CORTEX_AGENT_RUN` | agent run |
| **`SYSTEM_EXECUTE_SQL`** | **arbitrary SQL, with a configurable `read_only` flag that defaults to true** |
| `GENERIC` | UDFs and stored procedures |

Auth is Snowflake OAuth by default, with External OAuth optional.

**Architecturally this is the best MCP design in the research: the customer declares which
tools exist, in SQL, under RBAC — it is not a generic API wrapper.** Creating or altering
an MCP server is itself a write and routes through `write-gate`.

**Snowflake's own warning, which you should repeat to the customer: enabling
`SYSTEM_EXECUTE_SQL` on an agent-focused server "allows the MCP client to bypass the
agent's semantic views" — you lose the governance you built the semantic view for. Default
to semantic-view tools only.**

**Fallback: the SQL API v2, which is complete and stable.** Nothing here requires an MCP.

---

## (e) Gotchas, and the specific field that reveals each one

- **`SEMANTIC_VIEW()` query syntax is not ordinary SQL.** You cannot
  `SELECT col FROM semantic_view`. **An LLM writing "normal" SQL against a semantic view
  will fail.** Use the construct in (b).
- **Everything is a string in the SQL API JSON. Cast from `rowType`.** A `NUMBER` arrives
  as a string; `TIMESTAMP_*` arrives as an epoch-seconds-with-fraction string. Summing
  strings in a client language produces either a concatenation or an error, and neither is
  the number.
- **Identifier case.** Unquoted identifiers upper-case; quoted identifiers are
  case-sensitive. `"customer_id"` against a column stored as `CUSTOMER_ID` gives "invalid
  identifier", which reads like a missing column.
- **Timezone is the classic trap here.** `TIMESTAMP_NTZ` carries no timezone and is the
  default for many loads. **`TIMESTAMP_LTZ` renders in the session's `TIMEZONE` parameter,
  which defaults to `America/Los_Angeles` on many accounts** — so the same column shows
  different dates to the agent than to a BI tool with a different session timezone. **Set
  `TIMEZONE` explicitly in the agent's session, or use `CONVERT_TIMEZONE` everywhere.**
  **`WEEK_START` and `WEEK_OF_YEAR_POLICY` change what "week 1" means**, and
  `CURRENT_DATE()` follows the session timezone, so **"today" is ambiguous** until you pin
  it.
- **Masking policies return masked values silently and row access policies silently filter
  rows. The query succeeds.** **Check `TAG_REFERENCES` and `POLICY_REFERENCES` before
  reporting a number** that could be policy-affected.
- **Time Travel means "deleted" is not deleted.** Dropped tables are `UNDROP`-able within
  retention and **appear in `ACCOUNT_USAGE.TABLES` with a `DELETED` timestamp**. An agent
  inventorying from `ACCOUNT_USAGE` **must filter `DELETED IS NULL` or it reports ghosts.**
  `INFORMATION_SCHEMA` does not show them.
- **`ACCOUNT_USAGE` views have 45 minutes to 3 hours of latency** and require access to the
  `SNOWFLAKE` database. **`INFORMATION_SCHEMA` is real-time but scoped to one database**
  with its own retention limits. Choosing the wrong one produces either stale answers or
  incomplete ones.
- **Semantic views are metadata only.** A broken underlying table errors **only at query
  time**, and `SHOW` still lists a semantic view whose base tables were dropped.
- **Zero-copy clones mean the same logical data appears under many names**, and
  `ACCESS_HISTORY` lineage shows the clone, not the origin.
- **A suspended warehouse means the first query is slow, not failed.** Agents with short
  client timeouts spuriously report errors after an idle period. Distinguish a resume from
  a failure before escalating.
- **A query can succeed and return nothing because the role lacks grants on a new object.**
  Future grants, ownership and managed-access schemas are where agent access silently
  degrades over time. An empty result is a grant question until ruled out.
- **Semantic-view adoption is low — most customers have none.** Plan the fallback: read
  `VIEW_DEFINITION` SQL and dbt models instead, and say "inferred" rather than "discovered"
  when a definition came from view SQL.
- **No currency type, no conversion.**

---

## Files

- `references/cost-guardrails.md` — the mandatory guardrail set, the dry-run equivalent,
  resource monitors, and how to attribute agent spend.
- `references/semantic-views.md` — the `SEMANTIC_VIEW()` construct, `CREATE OR ALTER`,
  `NON ADDITIVE BY`, and what to do on the majority of accounts that have no semantic views.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
