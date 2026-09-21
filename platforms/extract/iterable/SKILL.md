---
name: iterable
description: Use for any Iterable request — campaign metrics, A/B experiment results, per-user event history, or bulk data export. Read-only for reporting, with a proper async export job API most platforms lack. One limit dictates the architecture of anything built here: `GET /api/campaigns/metrics` is capped at 10 requests per minute per project and it is the only campaign-performance endpoint there is. Batch campaign IDs into single calls and cache hard; an agent that iterates campaign-by-campaign dies immediately, and Iterable returns no rate-limit headers to warn you.
---

# Iterable

**Capability class: extract-only. There is no report object.** Campaign authoring exists —
`POST /api/campaigns/create`, `/schedule`, `/trigger`, `/archive`, `/cancel`,
`/activateTriggered` — but those create **campaigns, not reports**, and they send to humans,
so they are Tier E writes under `write-gate`.

**One limit dictates the architecture of everything built here: `GET /api/campaigns/metrics`
is capped at 10 requests per minute per project, and it is the only campaign-performance
endpoint there is.** It accepts **multiple campaign IDs per call**, which is the whole
design. **Batch the IDs, cache hard, and never let an agent iterate campaign-by-campaign.**

**Iterable returns no rate-limit headers at all**, so you will not see the wall coming —
client-side rate modelling from the published numbers is mandatory, not optional.

**Core contracts this module must call, every time:** `provenance-block` (project, data
centre, campaign IDs batched, export job id, date window), `warning-field-reader`,
`comparability-rules`, **`rate-limit-governor` before the first call — non-optional given
10/minute and no headers** — `pagination-patterns`, `mcp-detect-fallback`, `write-gate`
before any campaign create, schedule, trigger or send, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** Campaign metrics come back as CSV and answer
directly — give the numbers. Then name what the request cost against a 10-per-minute
budget, and whether a narrower date window would have been better. Withhold only where
parity does not exist: **`/api/experiments/metrics` supports email experiments only**, so a
push or SMS A/B result is absent rather than zero, and saying so is the answer.

---

## (a) Auth setup — the easiest of the messaging platforms

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

1. **Create an API key per project** in the dashboard and **send it in the `Api-Key` HTTP
   header.**
2. **Pick the right key type. Server-side keys are what reporting needs.** JWT-enabled keys
   and mobile keys exist with restricted scope; a mobile key will not do this work.
3. **US and EU data centres are separate — `api.iterable.com` versus `api.eu.iterable.com`
   — and keys are not portable.** Establish the region before the first call.
4. **Audit for the query-string deadline. This is the step everyone misses, because it
   degrades rather than breaks.** **From 2025-11-10, API calls passing the key in the query
   string or request body are subject to stricter rate limiting.** Inherited code doing
   `?api_key=` keeps working, just more slowly and less predictably — **which makes it hard
   to diagnose.** Migrate it to the header.

Verify before planning work:

```bash
curl -s -H "Api-Key: $ITERABLE_API_KEY" \
  "https://api.iterable.com/api/campaigns" | head -c 300
```

A 401 is the key or the region. An empty list on a project the user says is busy is the
region.

---

## (b) Correct query construction

**`GET /api/campaigns/metrics` is the campaign-performance endpoint, and it returns CSV.**

Fields: `bounces`, `clicks`, `conversions`, `opens`, `purchases`, `pushBounces`,
`pushOpens`, `pushSent`, `pushUninstalls`, `revenue`, `sent`, `smsBounces`, `smsReceived`,
`smsSent`, `spams`, `totalClicks`, `totalOpens`, `totalPushOpens`, `unsubs` — **per campaign
ID.**

**It accepts multiple campaign IDs per call. That is the whole architecture.** One call
with fifty IDs replaces fifty calls, and on a 10-per-minute budget that is the difference
between an analysis and a rate-limit error.

**It requires a date range, and Iterable's own documentation warns to always use the
narrowest window possible.** Honour that; it is a cost instruction, not a style note.

**The rest of the surface:**

| Endpoint | Use |
|---|---|
| `GET /api/experiments/metrics` | A/B analysis — **email experiments only** |
| `/api/campaigns`, `/api/campaigns/{id}` | campaign metadata |
| `/api/campaigns/recurring/{id}/childCampaigns` | recurring campaign children |
| `/api/events/{email}` or `/byUserId/{userId}` | per-user event history |
| `/api/export/data.csv` / `.json`, `/api/export/userEvents` | **sync** export |
| **`POST /api/export/start` → `GET /api/export/{jobId}/files` → `DELETE /api/export/{jobId}`** | **async export — use this for anything real** |

**Call `get_available_export_data_types` rather than hard-coding the exportable types.**
They include email, push, SMS, WhatsApp and in-app events plus user and purchase data, and
the list changes.

---

## (c) Pagination, bulk and cost

**Iterable publishes per-endpoint rate limits inside each operation's description in its
Swagger contract, and each endpoint declares whether its limit is counted per project, per
API key or per organization. There is no single global number, and the limits live in the
operation descriptions rather than in one limits page.**

| Endpoint | Limit | Scope |
|---|---|---|
| **`GET /api/campaigns/metrics`** | **10/minute** | **per project** |
| `GET /api/campaigns` | 100/second | per project |
| `/api/export/data.csv` / `.json` | **4/minute** | per project |
| **`POST /api/export/start`** | **1/second** | **per organization** |
| `DELETE /api/export/{jobId}` | 1/second | per project |
| `/api/users/getFields`, `/api/lists/getUsers` | 3/second | per project |
| `POST /api/campaigns/archive` | 5/second | **per API key** |

**Three different blast radii in one API — misreading the scope is easy.** A
**per-organization** limit means **a second team's export job consumes your budget**, which
is not something an agent can detect or control.

**Exhaustion returns HTTP 429 `RateLimitExceeded` with `Retry-After`. But Iterable returns
no `X-RateLimit-*` or RFC 9238 `RateLimit-*` headers at all, so client-side rate modelling
from the published numbers is mandatory, not optional.** You discover the limit by
receiving a 429.

**Export caps:** each file up to **10 MB**; each job limited to **100 GB**. Paginate the
file list with `startAfter`. **Files are added to the list progressively as the job runs,
so a complete-looking mid-job response is not the full file list — poll to terminal
state.** Concurrent export jobs are limited and additional starts are **queued rather than
rejected**, which means a "successful" start may simply be waiting.

**Race-condition guidance from Iterable's own docs: allow at least 60 seconds between
updates to the same user, or before sending a campaign based on that update.** That is a
much longer consistency window than most platforms admit to, and it is documented rather
than folklore.

---

## (d) Preferred MCP server and fallback

**Preferred: the official, first-party, open-source Iterable MCP — MIT licensed, and one of
the best-designed permission models in the research.**

- Repo `Iterable/mcp-server`; npm **`@iterable/mcp` v1.8.1** (Node 20 or newer).
- Install: `npx -y @iterable/mcp setup`.
- **Local stdio only — there is no hosted or remote endpoint.** `mcp.iterable.com` does not
  resolve and `api.iterable.com/mcp` returns 404, so any instruction pointing at a remote
  Iterable MCP is wrong.
- Auth is an API key stored locally: macOS Keychain, Windows DPAPI, or a **mode-0600 file
  on Linux**. US and EU hosts both supported.

**The permission model is the standout and is the model to recommend for a public
skillpack: the server defaults to read-only with no PII, no writes and no sends. Each
capability is opted into per stored key by an explicit flag — `ITERABLE_USER_PII`,
`ITERABLE_ENABLE_WRITES`, and `ITERABLE_ENABLE_SENDS` (which requires writes).** **Because
permissions bind to the stored key, a sandbox key and a production key can carry different
grants on the same machine.**

**Coverage includes the analytics you actually want**, which is more than several other
official servers manage: `get_campaign_metrics` — **carrying the docs' own warning that it
requires a date range and that you should always use the narrowest window possible** —
`get_experiment_metrics`, plus a full five-tool Data Export group: `start_export_job`,
`get_export_jobs`, `get_export_files`, `cancel_export_job`,
`get_available_export_data_types`. **That is a fuller wrap than Salesforce's or HubSpot's
official servers manage.**

**Fallback: direct REST, which is complete.**

---

## (e) Gotchas, and the specific field that reveals each one

- **10 requests per minute on the only campaign-performance endpoint.** Any agent looping
  over campaigns hits the wall almost immediately. **Batch IDs, cache the results, and
  never let an agent iterate campaign-by-campaign. This single limit dictates the
  architecture.**
- **No rate-limit headers.** You cannot see remaining budget; **you discover the limit by
  receiving a 429** with `Retry-After`. Model the budget client-side from the published
  per-endpoint numbers.
- **Rate-limit *scope* varies by endpoint and is easy to misread** — per organization, per
  project and per API key all appear. **`POST /api/export/start` is per organization, so a
  second team's export job consumes your budget.**
- **`/api/experiments/metrics` supports email experiments only.** **Push, SMS and in-app
  A/B tests have no metrics endpoint — say so rather than implying parity for a
  multichannel programme.**
- **A 60-second write-to-read consistency window, documented by the vendor.** Agents that
  update a profile and immediately trigger a campaign target stale data.
- **US and EU data centres are separate universes** — different host, different keys, no
  cross-DC queries. **A multi-region brand needs two integrations and cannot join the data
  inside Iterable.**
- **`GET /api/events/{email}` defaults to `limit=30`.** An agent asking "what has this user
  done" gets **the 30 most recent events** and, unchecked, **reports that as the whole
  history.**
- **Sync export endpoints are 4 per minute and return data inline** — fine for small pulls,
  **useless for history. Use the async job for anything real.**
- **Export file lists grow progressively.** A mid-job `get_export_files` response looks
  complete and is not. **Poll to terminal state before treating the list as final.**
- **The query-string key deadline degrades rather than breaks.** From 2025-11-10, keys
  passed in the query string or body are subject to stricter rate limiting — inherited
  `?api_key=` code gets slower and less predictable, **which is harder to diagnose than an
  outright failure.**

---

## Files

- `references/campaign-metrics-batching.md` — the 10-per-minute architecture, ID batching,
  the caching policy, and modelling the budget without headers.
- `references/export-jobs.md` — sync versus async, the progressive file list, the 60-second
  consistency window, and scope-aware rate planning.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
