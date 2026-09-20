---
name: segment
description: Use for Segment requests about what data exists and where it goes, or about why a number is wrong downstream — tracking plans, the source-and-destination graph, delivery success and failure rates, event volume, MTU, audit trail, and per-profile lookups. Segment is a router, not an analytics tool: it has no analytics reporting API and no report object, and its event volume is not comparable to any downstream tool's count. Position it honestly as a schema oracle and a pipeline-diagnosis surface, and query the warehouse for actual analytics.
---

# Segment

**Capability class: extract-only, and specifically a schema oracle plus pipeline
diagnostics. Segment is a router, not an analytics tool.** It has **no analytics reporting
API and no report object**, and **its event volume is not comparable to any downstream
tool's count.**

**Position it honestly, because it is genuinely valuable for two things:**

1. **Telling you what data exists and where it goes.** The Tracking Plan and the
   source-and-destination graph are **a real schema oracle for the rest of the stack** —
   the best answer in the pack to "what events do we have, and which tools receive them".
2. **Diagnosing why a number is wrong downstream.** A destination failing for three days
   explains a discrepancy that would otherwise be blamed on the analytics tool.

**Both are high-value. Neither is a metric.** For actual analytics, **query the
warehouse.**

**Core contracts this module must call, every time:** `provenance-block` (workspace,
region, token role, source and destination identifiers, the retention window of anything
delivery-related), `warning-field-reader`, `comparability-rules` — **load-bearing here,
because Segment's counts are not comparable to anything downstream** —
`rate-limit-governor` reading `X-RateLimit-*`, `pagination-patterns`,
`mcp-detect-fallback`, `write-gate` before any configuration change, and `answer-contract`
on the way out.

**Answer-first discipline for this platform.** When the question is "what data do we have"
or "why is this number wrong", Segment answers directly and you should give the answer.
When the question is "how many users did X", say plainly that Segment cannot answer it and
name the warehouse — that is the answer, not a deflection. Withhold only where retention
has genuinely expired: **Delivery Overview retention is short, and historical pipeline
forensics beyond that window are not possible via API.**

---

## (a) Auth setup

1. **Create a workspace-scoped API token** in Settings → Access Management → Tokens, with
   an assigned role — Workspace Owner, Read-only, and so on. Bearer auth. No app review.
2. **Match the token's role to the work, and know that the role bounds the answer silently.
   This is the step everyone misses: a read-only token silently omits resources rather than
   erroring**, so an incomplete inventory looks like a small workspace.
3. **US versus EU workspace endpoints differ.** Establish the region before the first call.

Verify before planning work:

```bash
curl -s -H "Authorization: Bearer $SEGMENT_TOKEN" \
  "https://api.segmentapis.com/sources" | head -c 400
```

If the source list looks smaller than the customer describes, check the token role before
concluding anything about the workspace.

---

## (b) Correct query construction

**The Segment Public API** at `api.segmentapis.com`, OpenAPI-described.

**What actually counts as reporting here:**

| Surface | What it answers |
|---|---|
| **Monitoring → "Get Events Volume from Workspace"** | **event volume by source over time** |
| **Delivery Overview metrics** | **ingress and egress success and failure rates, destination delivery summary** — the API behind the UI's Delivery Overview |
| **Usage** | daily API-call usage per source and workspace, and **Monthly Tracked Users** |
| **Audit Trail** | who changed what |

**The Profiles API answers per-profile questions** — traits, external IDs, event history,
audience and computed-trait membership. **But it is a lookup API, not an aggregate query
API: you ask about one profile at a time. Useful for account research, useless for "how
many users did X last week".**

**Configuration CRUD is rich:** sources, destinations, tracking plans, functions,
audiences, Reverse ETL connections. **An agent can build a *pipeline*; it cannot build a
*report*.** All of it is a write and routes through `write-gate` — and **tracking-plan
changes that drop or rename events are Tier A**, because they change what is recorded
everywhere downstream.

**The honest positioning to state at routing time:**

> Segment tells you **what data exists and where it goes**, and **why a downstream number
> is wrong**. It does not tell you **how many**. For that, the warehouse.

---

## (c) Pagination, bulk and cost

**Limits are per-endpoint and not uniform, documented per tag rather than as one global
number.** Observed examples: the Reverse ETL sync-status endpoint at **250 requests per
minute** and other Reverse ETL endpoints at **20 per minute** — a twelve-fold difference
inside one product area.

**Read the response headers rather than guessing: `X-RateLimit-Consumed`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, and back off on those rather than a
hard-coded constant.**

**Ingestion is a different system with its own product limits** — Segment recommends not
exceeding roughly **1,000 requests per second per workspace** on the HTTP tracking API.
That is not this module's concern for reporting work, but it is the thing a community MCP
server will happily let an agent touch (see (d)).

**Pagination is cursor-based** — `pagination.next` — with `pagination.count` capped per
endpoint.

**There is no bulk export of events via the Public API. Segment's bulk path is the
Warehouse connector (Redshift, BigQuery, Snowflake, Postgres) or Data Lakes (S3 or GCS plus
Glue). If you want Segment's event data for analysis, you query the warehouse, not
Segment.** Say this at routing time; it is the whole shape of the platform.

**Delivery Overview retention is short — materially shorter than event data in your
warehouse.** Plan pipeline forensics accordingly and do not promise a look back beyond it.

---

## (d) Preferred MCP server and fallback

**No official Twilio Segment MCP server exists.**

**Do not let the Twilio-owns-Segment relationship mislead you.** Twilio maintains
`twilio-labs/mcp` — an OpenAPI-to-MCP generator plus a server exposing **Twilio's** public
APIs. It is explicitly **alpha**, self-described as "designed for local, single-user use",
110 stars, and **last committed 2025-07-07, roughly 14 months stale at research time — and
it does not cover Segment's Public API at all.**

**Community `segment-mcp` projects wrap the HTTP Tracking API** — that is, they let an
agent ***send*** track, identify and page events. **That is the opposite of reporting, and
wiring an LLM to an ingestion endpoint on a production source is a data-integrity hazard,
not a feature.** An agent that writes synthetic events into a production source corrupts
every downstream number, and the corruption is indistinguishable from real traffic.

**Verdict: write a thin client against the Public API's Monitoring, Tracking Plan and Audit
Trail endpoints. There is nothing to adopt.**

A minimal client needs: bearer auth with the workspace token, the correct regional host,
cursor pagination on `pagination.next`, and `X-RateLimit-*` header handling with
per-endpoint budgets rather than one constant.

---

## (e) Gotchas, and the specific field that reveals each one

- **Volume is not analytics.** "Events volume" counts **messages ingested** — before
  destination filters, before transformations, before deduplication. **It will not match
  any downstream tool's event count and is not supposed to.**
- **MTU is a billing construct** computed on Segment's own rules. **It does not equal GA4
  users, Mixpanel users or your CRM's contact count**, and it is routinely mistaken for a
  product metric.
- **Delivery Overview retention is short** — materially shorter than event data in a
  warehouse. **Historical pipeline forensics beyond that window are not possible via API.**
- **Destination filters, transformations and Replay change what actually arrives
  downstream.** A discrepancy between Segment's egress count and a destination's own count
  **is usually a filter someone added. The Public API can list filters and transformations
  — check them before escalating.**
- **Tracking Plan violations are reported, not enforced, by default.** **A plan can be
  pristine while the data is not**, so a clean plan is not evidence of clean data.
- **Deletion and Suppression are asynchronous and partial.** A deletion request removes
  data from Segment and **requests** deletion from supporting destinations; **destinations
  that do not support it keep the data. A skill must never claim "the user's data has been
  deleted" on the basis of a regulation being created.**
- **Cloud-mode and device-mode destinations receive different data.** An event present in
  Segment **may never have reached a device-mode destination** because the user had an ad
  blocker, **and this is invisible in Segment's egress metrics.**
- **Four timestamps — `timestamp`, `originalTimestamp`, `sentAt`, `receivedAt` — and
  downstream tools pick different ones.** Late-arriving mobile events from offline queues
  can be **days old at `receivedAt`. This is a top cause of "the warehouse and the product
  tool disagree on yesterday".**
- **A read-only token silently omits resources rather than erroring**, so an inventory
  under-reports and the response looks normal.

**Warehouse schema notes for the downstream model**, which is where the analytics actually
happens:

- Tables are `tracks` plus **one table per event name**, `identifies`, `users`, `pages`,
  `screens`, `aliases`.
- **`users` holds only the *latest* traits — it is a Type-1 dimension, so trait history
  requires snapshotting `identifies` yourself.**
- **`users` has no `anonymous_id`; the anonymous-to-known bridge lives in `identifies` and
  `aliases`.**
- **Per-event tables mean a new event name creates a new table**, so a `tracks` union is
  usually the right base model.
- **Events are at-least-once delivered — deduplicate on `message_id`.**

---

## Files

- `references/schema-oracle.md` — using the Tracking Plan and the source/destination graph
  to answer "what data exists and where does it go".
- `references/pipeline-diagnosis.md` — the discrepancy playbook: filters, transformations,
  device mode, the four timestamps, and the warehouse schema model.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
