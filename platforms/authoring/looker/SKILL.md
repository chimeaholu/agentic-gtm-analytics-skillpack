---
name: looker
description: Use for any Looker request — running a governed query or a saved Look, reading the LookML semantic model, creating Looks, dashboards or scheduled plans, or explaining why a Looker number disagrees with the Explore UI. Looker is the strongest platform for agentic analytics: it runs governed queries, exposes the full semantic model including an explicit join graph, and supports real content creation. Always set `query_timezone` explicitly and check whether the credential can see `sql`. Do not confuse Looker with Looker Studio, which has no data API at all.
---

# Looker

**Capability class: authoring-capable.** `create_look`, `create_dashboard`,
`create_dashboard_element` and `create_scheduled_plan` create real, persistent objects a
human opens in Looker. "I built you a dashboard" is a truthful sentence here, as it is on
PostHog and as it is not on GA4, Google Ads, HubSpot, Marketo or Amplitude.

**One hard disambiguation before anything else: Looker and Looker Studio are different
products.** Looker Studio has **no data API at all** — it cannot read report data, create
or modify a report, or read chart configuration. Its Linking API builds a pre-filled URL a
human clicks. If the user says "Looker Studio", this module does not apply and the honest
answer is that no programmatic path exists.

**Core contracts this module must call, every time:** `provenance-block` (instance, model,
explore, `query_timezone`, `force_production` state, cache state, credential identity),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor` before the first call,
`pagination-patterns`, `mcp-detect-fallback` for tool selection, `write-gate` before
creating a Look, dashboard, scheduled plan or project file, and `answer-contract` on the
way out.

**Answer-first discipline for this platform.** Looker numbers are governed and almost
always computable. Compute them, give them, then name the one thing that could make them
differ from the dashboard the user is looking at: timezone, cache, dev-versus-production
branch, or a saved Look's own row limit. Withhold only where the credential genuinely
cannot see the field — and say that it is a permission boundary, not an absent metric.
Say when the rough figure is fine: for "roughly what did we book last month", the cached
Look result is fine and you should say so rather than forcing a fresh run.

---

## (a) Auth setup

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

Time to first query: roughly 30 minutes, assuming an admin is available. Setup burden:
medium.

1. **Get the instance base URL and, specifically, the port. This is the step everyone
   misses.** Google-hosted Looker serves the API on **443**; older and customer-hosted
   instances very often put the API on **port 19999** (`https://company.looker.com:19999`).
   A correct credential against the wrong port fails in a way that reads like a network
   problem. Never assume 443, and never hard-code the host.
2. **An admin creates API credentials on a Looker user** — Admin → Users → the user → Edit
   Keys → New API3 Key. This yields a `client_id` and a `client_secret`.
3. **Create a dedicated service user with a scoped role.** Whatever that user cannot see,
   the agent cannot see. This is not a formality on Looker: field-level visibility,
   `see_lookml` and row-level `access_filter` values all follow the user, and they change
   the numbers rather than producing errors. Choose the identity deliberately and record
   which one produced a number.
4. **Log in for a token.** `POST /api/4.0/login` with `client_id` and `client_secret`
   returns an `access_token` valid roughly one hour. **There is no refresh token — you
   re-login.** Any scheduled agent needs a re-login path, not a refresh path.
5. **Send `Authorization: token <access_token>` on every subsequent call.**
6. **Pin API 4.0** (current at research time `4.0.26.x`). **API 3.x is removed**, so any
   tutorial or inherited client on `/api/3.1/` is dead code.

OAuth 3-legged exists and is what the remote MCP path uses; it is the better lifecycle
story where the instance supports it.

Verify before planning work:

```bash
TOKEN=$(curl -s -X POST "$LOOKER_BASE_URL/api/4.0/login" \
  -d "client_id=$LOOKER_CLIENT_ID&client_secret=$LOOKER_CLIENT_SECRET" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s -H "Authorization: token $TOKEN" "$LOOKER_BASE_URL/api/4.0/user"
```

A connection refused or a timeout is nearly always the port. A 404 on `/api/4.0/` is an
instance too old for API 4.0. A successful `/user` response tells you which identity you
are about to attribute every number to — read it and log it.

---

## (b) Correct query construction

**`run_inline_query` is the workhorse.** `POST /api/4.0/queries/run/{result_format}` with a
body naming `model`, `explore` (as `view`), `fields`, `filters`, `sorts`, `limit` and
**`query_timezone`**. No saved object is needed and nothing is persisted.

```json
{
  "model": "gtm",
  "view": "opportunity",
  "fields": ["opportunity.close_month", "opportunity.total_amount"],
  "filters": {"opportunity.close_date": "2026-01-01 to 2026-09-01"},
  "sorts": ["opportunity.close_month"],
  "limit": "5000",
  "query_timezone": "America/New_York"
}
```

**Query through a measure by name; never read its `sql` and re-implement it.** The whole
value of Looker is that the customer's metric logic already exists and is governed. An
agent that reads `sql` off a measure and rebuilds the arithmetic has just forked the
definition, and the fork will disagree the first time someone edits LookML.

**The other query surfaces:**

| Call | Use |
|---|---|
| `create_query` + `run_query` | a stable query handle you can re-run and reference |
| `run_look` | run a saved Look — pass `limit`, `apply_formatting`, `apply_vis`, `cache`, `force_production` |
| `run_sql_query` | **bypasses the semantic layer entirely**; needs elevated permission and forfeits governance |
| `lookml_model_explore` | the model: fields, types, joins, and `sql` where permitted |

**Result formats:** `json`, `json_detail`, `csv`, `md`, `xlsx`, **`sql`** and `png`. The
`sql` format returns the generated SQL **instead of running it**, which is the cheapest way
to show your work and to sanity-check a query before it costs warehouse time.

**Authoring surfaces, all of which route through `write-gate` first:** `create_look`;
`create_dashboard` plus `create_dashboard_element` plus `create_dashboard_filter`;
`create_scheduled_plan` — email, S3, GCS, SFTP or webhook, which is the real "deliver this
report on a schedule" path and the one most worth reaching for; and project-file CRUD plus
`deploy_to_production`.

**`create_dashboard_from_lookml` is deprecated in favour of
`import_dashboard_from_lookml`.** Which one exists is version-dependent — check the
instance rather than the docs.

**Read `references/model-introspection.md` before reasoning about the semantic model.**
Introspection depth on Looker is a function of the service account's role, not of the API,
and the failure mode is a smaller model rather than an error.

---

## (c) Pagination, bulk and cost

**Looker's data endpoints do not paginate.** There is no page cursor on
`run_inline_query` or `run_look`. You set `limit` and `offset` **inside the query body**.
An agent looking for a `next` link will not find one and must not conclude the response is
complete because of that.

Admin and metadata list endpoints do support `limit`/`offset`, and newer versions return
`X-Total-Count` and a `Link` header.

| Bucket | Limit |
|---|---|
| API requests | **60 per minute per API key** (admin-tunable) |
| Concurrent queries per connection | 75 |
| Concurrent queries per user per connection | 15 |
| Explore default row limit | 500 |
| Download row ceiling | separate admin setting, "maximum rows to download" |

**60 per minute is per credential, so parallel agents sharing one API key collide with
each other.** Give each concurrent worker its own credential or serialise them, and say
which you did.

**Bulk is `create_query_task`.** Submit the query async, poll the task, then stream
`query_task_results` as CSV. The alternative for genuine volume is a scheduled plan
writing to GCS or S3 and reading the file. **Do not page a million rows through
`run_inline_query`** — there is no paging to do it with, and the limit-plus-offset
workaround re-runs the whole query per page against the warehouse.

**Cost lives in the warehouse, not in Looker.** Every query is SQL against the customer's
database, so a careless agent burns their Snowflake or BigQuery budget rather than a
Looker quota. Prefer one well-shaped query to five exploratory ones, use `result_format:
sql` to inspect before running, and say when you are about to issue something wide.

---

## (d) Preferred MCP server and fallback

**Preferred: the Looker MCP Server inside Google's `googleapis/genai-toolbox` (MCP Toolbox
for Databases).** It was the most actively maintained data-access MCP in the research.

Tool coverage is broad and genuinely useful:

- **Semantic discovery:** `get_models`, `get_explores`, `get_dimensions`, `get_measures`,
  `get_filters`, `get_parameters`.
- **Query:** `query`, `query_sql`, and **`query_url`**, which returns a clickable Explore
  URL. `query_url` is the best human-handoff primitive in the pack — the human lands in
  their own tool, with their own permissions, on your exact query.
- **Content read:** `get_looks`, `run_look`, `get_dashboards`.
- **Content write:** `make_look`, `make_dashboard`, `add_dashboard_element`. These are
  Tier D writes under `write-gate`.
- **Project files:** create, update and delete, with `dev_mode`. These are Tier C writes.
- Instance health.

Environment: `LOOKER_BASE_URL`, `LOOKER_CLIENT_ID`, `LOOKER_CLIENT_SECRET`,
`LOOKER_VERIFY_SSL`.

**Two caveats to quote to a customer before you depend on it.** Google ships the toolbox
**"as-is"; it is explicitly not a supported Google Cloud product** and support is GitHub
Issues. And the Looker integration in the MCP Toolbox is **preview, and Google-Cloud-hosted
Looker only** — a customer-hosted instance is not covered.

**Fallback: API 4.0 directly.** It is fully documented and covers everything the MCP
exposes plus everything it omits, including scheduled plans and dashboard filters. There
is no capability that forces the MCP path. If it is absent or the customer declines an
unsupported component, degrade to direct calls with no loss of function and say that is
what you did.

---

## (e) Gotchas, and the specific field that reveals each one

- **`sql` on a field is omitted for users without `see_lookml` or `develop`.** A read-only
  role gets names and types and no metric expression. **Introspection depth is a function
  of the service account's role, not of the API.** If `sql` is absent across the board,
  that is a permission signal, not an empty model.
- **A field the service user cannot access simply is not in the explore response.** No
  error, a smaller model, and an agent that concludes the metric does not exist. Compare
  the field list against what the human says they see before reporting absence.
- **Timezone is a three-way fight** between the database timezone, the instance query
  timezone and the user timezone, with per-query `query_timezone` on top. Unset means the
  API user's setting, **frequently UTC while the UI user is local**, producing off-by-one
  day buckets against the dashboard. **Always set `query_timezone` explicitly.**
- **`force_production: true`** is what makes a query ignore your session's dev branch. Get
  it wrong and API results disagree with the UI for a reason nothing in the response
  explains. Conversely, **project-file writes without dev mode plus `deploy_to_production`
  are a silent no-op** — the call succeeds and production is unchanged.
- **`apply_formatting` changes the output type.** On, numbers come back as formatted
  strings (`"$1,234.50"`) matching the UI. Off, you get raw numerics that will not match a
  screenshot. **Type-check before doing arithmetic on a Looker response.**
- **`json` versus `json_detail`.** `json` is rows keyed by fully-qualified field name.
  `json_detail` wraps each value as `value`, `rendered` and `links`, and carries field
  metadata plus `sql`. Default to `json_detail` when you need labels or provenance, `json`
  for volume.
- **Totals and subtotals are not rows.** With `total: true` the totals live **outside** the
  row array in `json_detail`, and as an extra row in CSV. **Summing the returned rows will
  not reproduce the dashboard total**, and the difference is not a bug.
- **`run_look` without an explicit `limit` uses the Look's saved limit, often 500.** Any
  total you compute is then a total over a truncated set. Pass `limit` explicitly, every
  time.
- **`cache: true` returns cached results the UI may have refreshed past.** After timezone,
  cache is the second thing to check on an API-versus-dashboard mismatch.
- **Table calculations are computed in Looker, not in the database, and are not model
  fields.** An agent rebuilding a query from the explore field list misses them entirely.
  **Merged-result queries have no clean API equivalent** — if the dashboard tile is a
  merged result, say the API cannot reproduce it rather than approximating.
- **Soft deletes.** Looks and dashboards carry **`deleted: true`** and stay retrievable for
  roughly 90 days. `search_looks` and `search_dashboards` return them unless filtered, so a
  content inventory over-counts.
- **Liquid in `sql:` returns unrendered.** The agent sees template source, not the resolved
  expression, and row-level `access_filter` values are per-user and invisible. You cannot
  tell from the model what filter is being applied to your own results.
- **No currency conversion anywhere.** `value_format` is a formatting string, not a typed
  currency. A multi-currency model's correctness is the modeller's problem and is invisible
  to the API.
- **Looker Studio is a different product with no data API.** No report read, no report
  creation, no chart-configuration read. **Do not promise Looker Studio report
  generation.**

---

## Files

- `references/model-introspection.md` — reading the LookML model safely: what each role can
  see, the join graph, and why a missing field is usually a permission.
- `references/authoring-and-delivery.md` — create order for Looks, dashboards and elements;
  scheduled plans as the real delivery path; dev mode and `deploy_to_production`.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
