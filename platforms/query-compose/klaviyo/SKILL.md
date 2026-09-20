---
name: klaviyo
description: Use for any Klaviyo request — campaign, flow, form or segment performance, metric aggregates, or profile and event data. Klaviyo has the best reporting API in the stack: you POST a report spec with timeframe, statistics, filter and group_by and get aggregates Klaviyo documents as 1:1 with its UI. Two things will ruin the answer if ignored: `conversion_metric_id` is a required input that silently redefines every revenue figure, and the campaign values report allows 2 requests per minute and 225 per day. Design one wide grouped query, never a loop over campaigns.
---

# Klaviyo

**Capability class: query-compose.** You author a report **query**, not a report
**artifact**. `POST /api/campaign-values-reports/` takes a full report spec — timeframe,
statistics, filter, group_by — and returns aggregates **Klaviyo documents as 1:1 with its
UI**. That is a stronger guarantee than almost anything else in the pack. But **there is no
saved report or dashboard object**, so "I'll build you a Klaviyo dashboard" is never an
available sentence. The delivery path is: compose the query, get the aggregates, write them
somewhere a human opens.

**Core contracts this module must call, every time:** `provenance-block` (account,
**`conversion_metric_id` and the metric it resolves to**, timeframe, account timezone,
`revision` header used), `warning-field-reader`, `comparability-rules`,
**`rate-limit-governor` before the first call — non-optional given 2/minute on the main
reporting endpoint**, `pagination-patterns`, `mcp-detect-fallback`, `write-gate` before
creating a campaign, uploading profiles or uploading images, and `answer-contract` on the
way out.

**Answer-first discipline for this platform.** Klaviyo aggregates are computable and match
the UI, so give the number. Then name the one input that redefines it: **which conversion
metric you used.** Two agents reporting on the same campaign with different
`conversion_metric_id` values produce contradictory revenue, with no error and nothing in
the response explaining the difference. Print the metric you used, always. Withhold only
where the data genuinely is not there — a campaign that had not sent in the window, a
filter matching nothing — and distinguish that from zero performance, because Klaviyo
returns a well-formed empty response for both.

---

## (a) Auth setup — the lowest burden of the messaging platforms

Time to first query: minutes.

1. **Create a Private API key** in Settings → API Keys, and **tick granular scopes.** Send
   it as `Authorization: Klaviyo-API-Key pk_…`.
2. **Send the `revision` header on every single request. This is the step everyone
   misses, and it is the most common first-call failure.** It is a date string in
   `YYYY-MM-DD` form (the default at research time was `2026-07-15`). **`2024-10-15`,
   `2025-01-15` and `2025-04-15` are already deprecated**, and Klaviyo ships a new revision
   roughly quarterly, so **pin the revision in configuration and record which one produced
   a number** — do not let it float.
3. **Use JSON:API content types.** Requests and responses are
   `application/vnd.api+json`.
4. **Decide between a private key and OAuth deliberately, because it is a capacity decision
   rather than a distribution one.** **OAuth apps get their own rate-limit quota per
   installed app instance, while private-key integrations all share one quota per
   account.** On an account with other integrations already running, OAuth is the
   difference between a working agent and a starved one.

Verify before planning work:

```bash
curl -s "https://a.klaviyo.com/api/metrics/" \
  -H "Authorization: Klaviyo-API-Key $KLAVIYO_PRIVATE_KEY" \
  -H "revision: 2026-07-15" \
  -H "accept: application/vnd.api+json"
```

**A 403 is not a 401.** 401 means no key or a bad key; **403 means the key is valid but
lacks a scope.** Sending a user to regenerate a key when they need to re-scope one wastes
their afternoon. Read the status code before advising.

Use this same call to **resolve and record the conversion metric ID** you intend to use —
see (b).

---

## (b) Correct query construction

**Values reports — aggregates over a timeframe:**

| Endpoint | Grain |
|---|---|
| `POST /api/campaign-values-reports/` | per campaign |
| `POST /api/flow-values-reports/` | per flow |
| `POST /api/form-values-reports/` | per form |
| `POST /api/segment-values-reports/` | per segment |

**Series reports — the same, bucketed over time, with `interval` of `daily`, `weekly` or
`monthly`:** `/api/campaign-series-reports/`, `/api/flow-series-reports/`,
`/api/segment-series-reports/`.

**`POST /api/metric-aggregates`** performs arbitrary aggregation over a metric and is **the
only endpoint that accepts an explicit `timezone`.** Everything else runs in the account's
configured timezone.

The body carries:

- **`timeframe`** — either a `key` such as `last_30_days`, or explicit ISO `start` and
  `end`
- **`conversion_metric_id`** — **required, and it defines what "converted" means**
- `filter` — Klaviyo's DSL: `equals(...)`, `any(field,[...])`, `and(...)`,
  `contains-any(...)`
- `statistics[]` — the metrics you want
- `group_by[]` — **the dimension that lets one call replace a loop**

```json
{
  "data": {
    "type": "campaign-values-report",
    "attributes": {
      "timeframe": {"key": "last_30_days"},
      "conversion_metric_id": "<resolved Placed Order metric id>",
      "statistics": ["recipients", "delivered", "click_rate", "conversion_value", "conversions"],
      "group_by": ["send_channel"]
    }
  }
}
```

**Resolve `conversion_metric_id` explicitly before composing the report, log it, and print
it in the output.** It is not a filter. It is the definition. Point it at "Placed Order"
and you get order-attributed revenue; point it at "Checkout Started" and you get a
completely different, equally valid-looking set of numbers.

**Design one wide grouped query.** The rate limits in (c) make this a structural rule, not
a style preference.

---

## (c) Pagination, bulk and cost

**Rate limits are per-account, fixed-window, with two simultaneous windows — a one-second
burst and a one-minute steady window.** Standard tiers run from XS at 1/s plus 15/min up to
XL at 350/s plus 3,500/min.

**But the Reporting endpoints sit far below even XS and carry a daily cap the tier table
does not mention.**

| Endpoint | Burst | Steady | Daily |
|---|---|---|---|
| **`/api/campaign-values-reports/`** | **1/s** | **2/min** | **225/day** |

**Always read the per-endpoint limit in the API reference. The tier table is not sufficient
for reporting work.** A naive "check each of my 40 campaigns" agent burns nearly a fifth of
the daily budget in a single turn.

**Query-parameter rate limits are a separate, additive, global budget.** Adding `include=`
or `additional-fields[...]` consumes a second and a third bucket **in parallel** —
Klaviyo's own example shows one request costing **three** calls against three buckets, and
**those buckets are global across endpoints.** An LLM's instinct to fetch related data in
one call "to be efficient" is **actively counterproductive here. Fetch lean, join locally.**

**Payload limit: 5 MB decompressed.**

**There is no async or bulk export API.** Bulk extraction means paginating `/api/events`
and `/api/profiles` under these limits, which for a large account is slow enough to be
impractical. **The honest answer for raw event history is a warehouse or a reverse-ETL
integration**, and you should say so at planning time rather than after six hours of
paging. Klaviyo's bulk *profile import* is an ingest path, not an export path.

**Cache for hours, not minutes.** With 225 report calls a day, a re-run is a real cost.

---

## (d) Preferred MCP server and fallback

**Preferred: the official Klaviyo MCP server, which reached GA on 2025-08-20 and is
mature.**

- Two deployment modes: a **remote-hosted server, which is Klaviyo's recommended option**,
  and a local server.
- Auth via OAuth or a private API key.
- Behaviour is configurable with query parameters and environment variables.
- **The tool catalogue flags which tools are read-only, which handle user-generated
  content, and which are available on the remote server.** That read-only flagging is
  exactly what a public skillpack wants, and it is worth citing as a positive example when
  explaining `mcp-detect-fallback` to a customer.

**Reporting is explicitly in scope** — Klaviyo's own example prompts are campaign
performance and flow conversion questions. **Writes are supported** (create campaigns,
upload profiles, upload images) and route through `write-gate`: campaign creation is Tier E
because a campaign sends to humans.

Community servers exist but are six stars or fewer and either predate or duplicate the
official one. There is no reason to use them.

**Fallback: the REST reporting endpoints, which are well documented and complete.** No
capability here requires the MCP. If the MCP is absent, degrade to direct calls with no
loss of function — and keep the same `revision` pin and the same conversion-metric
discipline, because the MCP does not relieve you of either.

---

## (e) Gotchas, and the specific field that reveals each one

- **`conversion_metric_id` is a required input that silently redefines every revenue and
  conversion number in the response.** It is not a filter; it is the *definition* of
  "converted". **Two agents reporting on the same campaign with different values produce
  contradictory revenue with no error and nothing in the response explaining why. Resolve
  the metric ID explicitly, log it, and print it in the output.**
- **2 per minute and 225 per day on the campaign values report is an architectural
  constraint, not a throttle to back off from.** One wide query with `group_by`, cached for
  hours.
- **`include=` and `additional-fields[...]` consume separate additive global buckets.**
  One request can cost three calls against three buckets, and the buckets are global across
  endpoints. **Fetch lean, join locally.**
- **Revenue attribution is governed by the account's attribution settings, and those are
  retroactive.** Change the attribution window and **every historical report changes**;
  numbers published last month will not reproduce. Snapshot report outputs when
  reproducibility matters.
- **Reports run in the account's configured timezone**, and `timeframe` keys like
  `last_30_days` are evaluated against account-local midnight. **Only `metric-aggregates`
  accepts an explicit `timezone`.** UTC math around those boundaries mis-buckets the first
  and last days of any window.
- **`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` are returned on non-429
  responses and describe the *steady* window. On a 429 they are replaced by
  `Retry-After`** — so you lose visibility exactly when you most need it. Track the budget
  proactively rather than reading it off the failure.
- **403 is not 401.** 403 means a valid key missing a scope. Agents that treat all auth
  failures as "bad credentials" send users to regenerate a key when they need to re-scope
  one.
- **Blank results are a known, confusing failure mode.** A well-formed response with empty
  `data` when the filter matches nothing, the conversion metric does not apply to that
  campaign, or the timeframe predates the campaign. **There is no "0 rows because X"
  signal.** Validate that the campaign or flow IDs exist before concluding performance was
  zero.
- **Open rates are unreliable and Klaviyo knows it.** Apple Mail Privacy Protection
  inflates opens, and Klaviyo's own guidance has moved toward click- and conversion-based
  metrics. **Any ranking by `open_rate` is ranking by noise. Default to `click_rate` and
  conversion metrics, and say why.**
- **The `revision` header floats if you let it.** A new revision roughly quarterly, with
  older ones deprecated on a schedule. Pin it, record it in provenance, and re-verify
  before blaming a response-shape change on a bug.

---

## Files

- `references/conversion-metric-discipline.md` — resolving, logging and printing the
  conversion metric, and what changes when it changes.
- `references/rate-budget-and-query-shape.md` — the reporting endpoint limits, the additive
  query-parameter buckets, and the one-wide-query pattern written out.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
