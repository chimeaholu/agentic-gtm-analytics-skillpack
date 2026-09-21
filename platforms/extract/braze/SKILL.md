---
name: braze
description: Use for any Braze request — campaign, Canvas, segment, session, custom-event or app-KPI analytics, purchase and revenue series, or user export. Braze has the most complete read-only analytics surface of any messaging platform: a whole family of `/data_series` endpoints returning daily time series. It has no report or dashboard object to create. The trap that produces numbers matching neither the dashboard nor reality is `conversions` versus `conversions_by_send_time` — two attribution bases returned side by side in the same response. Pick one and state it.
---

# Braze

**Capability class: extract-only. There is no report or dashboard object.** Content
authoring does exist — `POST /templates/email/create`, `/content_blocks/create`,
`/media_library/create`, `/catalogs` — but those are **content assets, not reports**, and
they are writes that route through `write-gate`.

What Braze does have is **the most complete read-only analytics surface of any messaging
platform in the pack**: a whole family of `/data_series` endpoints returning daily time
series across campaigns, Canvases, segments, sessions, custom events, app KPIs and revenue.
For a lifecycle-analytics question, this is the best-shaped extract API here.

**The trap that produces numbers matching neither the dashboard nor reality is
`conversions` versus `conversions_by_send_time`, returned side by side in the same
response. Pick one, state it in the output, and never mix them in one table.**

**Core contracts this module must call, every time:** `provenance-block` (workspace,
cluster, **workspace timezone**, **which conversion basis**, `length` window and stitching),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor` reading
`x-ratelimit-*`, `pagination-patterns`, `mcp-detect-fallback`, `write-gate` before any
template, content block, catalog or user write, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** The `data_series` endpoints answer directly
— give the numbers. Then name which conversion basis you used and whether the window
required stitching. Withhold only the genuinely gone: **`/users/delete` is a real delete
with no undelete and no deleted-users endpoint**, so a cohort that shrank cannot be
reconstructed, and saying so is the honest answer rather than a smaller number.

---

## (a) Auth setup

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

1. **Create a REST API key** in Dashboard → Settings → API Keys, sent as
   `Authorization: Bearer`.
2. **Tick exactly the endpoints the key may call. This is the step everyone misses, and it
   is genuinely good security design that is genuinely annoying the first time.** Keys
   carry **granular per-endpoint permissions**, so a missing tick produces a permission
   error on **one** endpoint while everything else works — which looks like a broken
   endpoint rather than a scoping problem. Enumerate the endpoints your analysis needs
   before creating the key.
3. **Know the instance or cluster to form the host** — `iad-01` through `iad-10`, `fra-01`,
   `au-01` and others. **Braze documents the mapping and it is not discoverable from the
   key.** Deriving it by guessing produces an auth error, not a routing error (see (e)).
4. **Optional IP allowlisting per key.** Note the interaction in (d): if the org uses
   dashboard IP allowlisting, the remote MCP server is unusable.
5. **Keys are workspace-scoped ("app group"). A multi-workspace org needs one key per
   workspace**, and their timezone settings may differ — which matters for summing (see
   (e)).

---

## (b) Correct query construction

**The `/data_series` family — the core of this module:**

| Endpoint | Grain |
|---|---|
| `GET /campaigns/data_series` | per campaign, daily |
| **`GET /sends/data_series`** | **per `send_id`, with per-variation breakdown** |
| `/canvas/data_series`, `/canvas/data_summary` | per Canvas |
| `/segments/data_series` | segment size over time |
| `/events/data_series` | custom event counts |
| `/sessions/data_series` | sessions |
| `/kpi/dau`, `/kpi/mau`, `/kpi/new_users`, `/kpi/uninstalls` `/data_series` | app KPIs |
| `/purchases/revenue_series`, `/purchases/product_list` | revenue |

**`/sends/data_series` is the richest:** `sent`, `delivered`, `direct_opens`,
`total_opens`, `bounces`, `body_clicks`, `revenue`, `unique_recipients`, `conversions` and
the conversion variants — **broken out per message variation**, which is what makes A/B
readouts possible.

**Discovery endpoints:** `/campaigns/list`, `/campaigns/details`, `/canvas/list`,
`/canvas/details`, `/segments/list`, `/segments/details`, `/events/list`.

**User export:**

- `POST /users/export/ids` — synchronous, by identifier
- **`POST /users/export/segment` — async, and it writes to *your* bucket, not to the
  response** (see (e))
- `POST /users/export/global_control_group`

**`ending_at` accepts an ISO-8601 datetime with offset. Pass one.** A naive UTC timestamp
against a non-UTC workspace silently shifts every bucket.

---

## (c) Pagination, bulk and cost

**The default shared limit is 250,000 requests per hour**, shared across a long list that
includes `/canvas/data_series`, `/canvas/data_summary`, `/segments/data_series`,
`/events/data_series`, `/sessions/data_series`, all four `/kpi/*`, `/sends/data_series`,
the list and details endpoints, the template and content-block endpoints, and
`/users/export/segment`.

**Note the asymmetry: `/campaigns/data_series` has its own much larger bucket at 50,000
requests per minute. Campaign data series is cheap; Canvas data series shares the common
pool.** Shape the analysis accordingly.

| Endpoint | Limit |
|---|---|
| **`/campaigns/data_series`** | **50,000/minute — its own bucket** |
| Shared pool (Canvas, segments, events, sessions, KPI, sends, lists, templates) | **250,000/hour** |
| **`/users/export/ids`** | **250/min if onboarded on or after 2024-08-22; 2,500/min if before** |
| `/events/list` and `/purchases/product_list` | **1,000/hour combined** — low, and easy to blow through while enumerating a catalogue |
| `/sends/id/create` | 100/day |

**Rate limits reset on the clock hour, not a rolling window** — you can burn the full
allowance at 10:59 and get a fresh one at 11:00.

**Every response carries `x-ratelimit-limit`, `x-ratelimit-remaining` and
`x-ratelimit-reset` (lowercase under HTTP/2), and Braze explicitly designed them for
real-time backoff.** Read them; do not model the budget client-side.

**Payloads: 4 MB on most endpoints, 2 MB for `/users/track/bulk`.**

**The row/window cap that matters most: `length` on `/campaigns/data_series` must be 1 to
100 inclusive — a maximum 100-day window per call, with no cursor. Multi-year trend
analysis requires chunking and stitching, and the stitching must handle `ending_at` being
inclusive.** An off-by-one here double-counts a day at every seam.

**Braze recommends a 5-minute delay between dependent consecutive endpoint calls.** Normal
eventual consistency is 10 to 100 milliseconds, but they explicitly advise five minutes
when one call depends on another having been processed. Write-then-read patterns fail
intermittently without it.

**Bulk is Braze Currents**, a separately-priced real-time event stream to S3, Snowflake,
Redshift, BigQuery or Segment. Snowflake Data Sharing is also offered. For raw event
history, that is the answer — not the REST API.

---

## (d) Preferred MCP server and fallback

**Preferred: the official, first-party, remote Braze MCP, GA since 2026-07-23.**
`https://mcp.braze.com/mcp` (US) and `https://mcp.braze.eu/mcp` (EU). **Either endpoint can
reach any Braze cluster.**

**The auth model is materially better than a shared API key and is worth citing as a
positive example: OAuth is tied to your Braze *dashboard user account*, not to an API key.
Agent permissions mirror your dashboard permissions exactly, deactivating a dashboard user
immediately revokes MCP access, and permission changes apply on the next request.**

It is **read and write**: generate email templates, content blocks and media-library assets
from natural language; read Canvas and campaign analytics, segments and custom attributes.
Writes route through `write-gate`.

**The defining constraint, and it is not configurable: tools that expose user-level PII are
not available at all. The Braze MCP is an aggregate analytics and content server by
design.** Any workflow needing "show me the profile of the user who complained" **must fall
back to the REST API with a properly-permissioned key. Design around this split rather than
discovering it mid-demo.**

**Two access caveats:**

- Braze maintains a **domain allowlist — unverified clients may be blocked at auth.**
  Verified clients include Claude, ChatGPT, Cursor, Codex, Claude Code and VS Code.
- **If your org uses dashboard IP allowlisting, you cannot use the remote MCP server at
  all.**

**The locally-hosted beta MCP from August 2025 is deprecated and receives no further
updates. Any tutorial describing an npm install plus a config file plus an API key for
Braze MCP is describing the dead version.**

**Braze's own legal note is unusually candid and worth repeating to stakeholders: Braze
does not see your prompt, cannot verify that the generated tool call reflects your intent,
and does not control how the model summarises the response. They explicitly recommend not
using auto-mode and reviewing AI-generated summaries against the dashboard.**

Community servers (`TMEFRT/mcp-braze`, `delta-and-beta/mcp-braze`, `universal-mcp/braze`)
are one star or fewer and superseded.

**Fallback: the REST API, which is complete and is required anyway for anything
PII-shaped.**

---

## (e) Gotchas, and the specific field that reveals each one

- **`conversions` versus `conversions_by_send_time` in the same `/sends/data_series`
  response.** **`conversions` attributes a conversion to the day it *happened*;
  `conversions_by_send_time` to the day the message was *sent*. Summing the wrong one
  across a date range, or mixing the two, produces numbers matching neither the dashboard
  nor reality. Decide which basis you are reporting, state it in the output, and never mix
  them in one table.**
- **The 100-day `length` cap is a hard window, not a page size.** There is no cursor, so
  **year-over-year analysis means eight or more stitched calls**, and the stitching must
  handle **`ending_at` being inclusive** or you double-count a day at every seam.
- **Timezone: `data_series` days bucket in the *workspace's* configured timezone**, and
  **`ending_at` accepts an ISO-8601 datetime with offset. Passing a naive UTC timestamp
  silently shifts every bucket.** **Multi-workspace orgs with different timezone settings
  cannot have their `data_series` results naively summed.**
- **Currency is USD in the API.** `revenue` in `/sends/data_series` is documented as
  dollars. **If your business transacts in other currencies, Braze has already converted
  using its own rates and you cannot recover the original amounts from this endpoint.**
  Only Currents and raw purchase events carry native currency.
- **Instance/cluster mismatch fails as an auth error, not a routing error.** Hitting
  `rest.iad-01` with a `fra-01` key gives an unhelpful permission failure. **Derive the
  host from documented config, never guess** — and when an otherwise-correct key is
  rejected, check the cluster before regenerating anything.
- **`/users/export/segment` does not return data to you.** It **writes files into your own
  S3, Azure or GCS bucket, and the bucket credentials must be configured in Braze in
  advance.** An agent expecting an HTTP response body gets a job acknowledgement and
  concludes the export was empty.
- **The two-tier `/users/export/ids` limit is invisible from the API** — 250/minute for
  workspaces onboarded on or after 2024-08-22, 2,500/minute for older ones. **Code written
  against an older workspace rate-limits ten times sooner on a newer one, with no signal
  other than 429s.**
- **Eventual consistency is real and Braze tells you to wait 5 minutes** between dependent
  calls. Write-then-read patterns fail intermittently without it.
- **`/users/delete` is a real delete, not a recycle bin. No undelete, no deleted-users
  endpoint. Cohort counts drop permanently and silently, so snapshot cohort sizes at report
  time because you cannot reconstruct them later.**

---

## Files

- `references/conversion-basis.md` — `conversions` versus `conversions_by_send_time`, when
  each is right, and how to present a table that uses one.
- `references/data-series-windows.md` — the 100-day `length` cap, inclusive `ending_at`
  stitching, the timezone offset rule, and the rate-bucket asymmetry.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
