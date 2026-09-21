---
name: rudderstack
description: Use for RudderStack requests about pipeline health, event usage, tracking plans, data governance or transformation development. Like Segment, RudderStack routes rather than analyses: its reporting is ingestion telemetry and usage accounting, not analytics, and there is no report object. RudderStack is warehouse-first by design, so the analytics answer is explicitly "query your own warehouse". Its MCP can deploy transformations, which is the single highest-risk write capability in the whole stack because a bad transformation silently and retroactively corrupts every downstream number.
---

# RudderStack

**Capability class: extract-only — pipeline telemetry and governance. There is no report or
dashboard object.** Like Segment, RudderStack **routes rather than analyses**: its
reporting is **ingestion telemetry and usage accounting, not analytics.**

**RudderStack is warehouse-first by design, so the analytics answer here is explicitly
"query your own warehouse".** That is not a workaround; it is the product's architecture.
There is no bulk event export API because the warehouse *is* the export.

**And this module carries the single highest-risk write capability in the whole pack.**
**The official MCP can write, test and deploy transformations — JavaScript that runs on
every event passing through the pipeline. A bad transformation silently and retroactively
corrupts every downstream number, and nothing errors.** That is **Tier A** in
`write-gate`: always human-approved, never automatic, never batched with anything else,
with **a diff of the JavaScript, not a summary of it.**

**Core contracts this module must call, every time:** `provenance-block` (workspace,
Cloud versus self-hosted, data-plane versus control-plane host, source and destination
identifiers, warehouse sync cadence), `warning-field-reader`, `comparability-rules` —
**because ingestion counts are not comparable to any destination's numbers** —
`rate-limit-governor`, `pagination-patterns`, `mcp-detect-fallback`, **`write-gate` at
Tier A before any transformation deployment**, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** For pipeline-health and governance
questions, RudderStack answers directly — give the answer. For "how many users did X", say
plainly that the warehouse has it and route there; that is the answer, not a deflection.
Withhold only where the deployment genuinely does not expose it: **self-hosted and Cloud
diverge substantially in API surface, retention and dashboard metrics, and
programmatic coverage of dashboard delivery metrics is thinner than the UI.**

---

## (a) Auth setup

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

1. **Create a workspace or personal access token** in the RudderStack dashboard. Basic or
   Bearer, depending on the API.
2. **Supply the data-plane URL, which is per-workspace. This is the step everyone misses,
   and it is a very common setup error: using the control-plane host for ingestion, or the
   data-plane host for configuration.** They are different hosts with different purposes
   and the failure is confusing rather than explicit.
3. **Ask whether the user is on Cloud or self-hosted before assuming any endpoint exists.**
   **Self-hosted and open-source deployments have entirely different hosts and a reduced
   API surface.** A plan built against Cloud endpoints does not degrade on self-hosted — it
   simply has no equivalent.

Record which deployment and which hosts in the provenance block, because every subsequent
claim about what is available depends on it.

---

## (b) Correct query construction

**The closest thing to a reporting endpoint is the Organization Usage API** —
organization-level **event usage metrics by workspace, source and time bucket**. It is
**aggregated server-side and therefore cheap**, which makes it the right first call for any
volume question.

| Surface | What it gives you |
|---|---|
| **Organization Usage API** | event usage by workspace, source, time bucket |
| **Audit Logs API** | who changed what |
| **Event Audit API (v2)** | event metadata for data-governance compliance |
| Data Catalog API | tracking plans, events, properties |
| Transformation API | transformation CRUD — **Tier A writes** |
| Profiles API | identity resolution configuration |
| Reverse ETL Connections API | rETL configuration |
| Test API | verify a source→destination transformation and delivery |

**Delivery metrics — events delivered, failure counts and rate, and P95 latency — exist in
the dashboard**, and self-hosted deployments expose a Grafana dashboard. **Programmatic
coverage of dashboard delivery metrics is thinner than the UI, so verify against the plan
before promising it.** Do not assume a number you can see in the UI is retrievable.

**CRUD exists for transformations, tracking plans and rETL connections. Nothing to author a
report into.**

---

## (c) Pagination, bulk and cost

**RudderStack publishes far less numeric limit detail than the other platforms in this
pack. Treat specific numbers as unverified and plan-dependent; read response codes and back
off.** An agent that hard-codes a rate assumption here is coding against something that was
never published.

**The Organization Usage API is time-bucketed and server-aggregated, so it is cheap.**
Prefer it over anything that iterates.

**There is no bulk event export API, by design, because the warehouse *is* the export.**
RudderStack's primary job is landing raw events in Snowflake, BigQuery, Redshift,
Databricks or S3, **and that is where bulk reads belong.** Say so at routing time — it is
the architecture, not a limitation to work around.

**Cost therefore lands in the customer's warehouse, not in a RudderStack quota.** An
analysis that queries the landed events is a warehouse bill, and the relevant guardrails
are in the `snowflake` or `bigquery` module, not here.

---

## (d) Preferred MCP server and fallback

**Preferred: the official RudderStack MCP.** **OAuth browser-based login with automatic
token refresh and no credentials stored in client config — a good security posture** worth
citing as a positive example.

**Five functional areas:**

1. **Pipeline monitoring** — error investigation, warehouse upload status, live event
   stream, audit logs
2. **Source and destination management** — view configs, inspect connections, analyse event
   metrics
3. **Transformation development — write, test and deploy transformation code from
   templates**
4. **Data governance** — tracking plans, validation metrics, Data Catalog
5. **Documentation Q&A**

**The write scope is tightly bounded and they say so explicitly: "The only write operations
are creating or updating transformations, and connecting them to destinations. No sources
or destinations are created or deleted."** **That is a well-designed blast radius and is
worth citing as a model — but see the gotcha, because the one thing it permits is the
riskiest write in the pack.**

**Two caveats:**

- **The AI-powered documentation answers "may occasionally be inaccurate" — one of its
  tools is an LLM, so do not chain agent reasoning off it without verification.** A
  documentation answer is a starting point, not a fact.
- **`rudderlabs/profiles-mcp` is also official but different** — an MCP for the Profiles
  product that **executes queries against your warehouse**. It is **vendor-owned but
  essentially unadopted: 0 stars, last commit 2026-05-11. Verify it works before depending
  on it.**

**Fallback: the REST APIs directly** — Organization Usage, Audit Logs, Event Audit, Data
Catalog and Transformation. **And note that the fallback is the safer default for
transformation work**, because a direct, deliberate API call with a reviewed diff is easier
to gate than a conversational tool call.

---

## (e) Gotchas, and the specific field that reveals each one

- **Transformations are JavaScript that runs on every event, and the official MCP can
  deploy them. An agent with transformation write access can silently corrupt every
  downstream number in the stack. This is the highest-risk write capability found anywhere
  in the research — higher than ad-spend writes, because it is silent and retroactively
  invisible. Gate transformation deployment behind explicit human approval (Tier A in
  `write-gate`)**, with the JavaScript diff shown and the attached sources named.
- **Usage metrics are ingestion counts** — **pre-filter, pre-transformation, and not
  comparable to any destination's own numbers.** The same caution as Segment's volume
  metric, for the same reason.
- **Self-hosted and Cloud diverge substantially** in API surface, retention and dashboard
  metrics. **Do not generalise between them**, and ask which one before planning.
- **Live Events is a sampled real-time debug stream, not a log. It is not a source of truth
  for "did this event arrive".** An event's absence from Live Events is not evidence.
- **Warehouse sync frequency is configurable and often hourly or slower.** **"The event is
  in RudderStack" and "the event is queryable in Snowflake" can be an hour apart.** Any
  agent reconciling pipeline to warehouse **must account for the sync cadence** or it will
  report a delivery failure that is really a schedule.
- **Identity stitching happens in the warehouse (Profiles), not in the stream.** The
  `anonymous_id` to `user_id` resolution is **a modelled artifact you own**, with your own
  edge cases — **unlike Amplitude, Mixpanel and PostHog where the vendor does it. More
  control, more responsibility**, and the resolution logic is a thing you can inspect and
  must maintain.
- **Deletion and suppression carry the same partial-propagation caveat as Segment** —
  destinations that do not support deletion keep the data. Never claim data is deleted
  everywhere.
- **Warehouse schema notes:** **RudderStack populates `user_id` from the event's root-level
  `userId`, not from a `properties.user_id` field — sending the latter silently yields
  nulls.** And **"Skip Users Table" defaults on, so the `users` table may not exist at all
  in a given deployment.** Check before writing a model that joins to it.

---

## Files

- `references/transformation-risk.md` — why transformation deployment is Tier A, what the
  approval must contain, and the review checklist.
- `references/warehouse-first.md` — the sync cadence, the schema traps, identity stitching
  ownership, and how to route an analytics question correctly.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
