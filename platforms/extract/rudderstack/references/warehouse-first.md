# Warehouse-first — routing the question, and the schema traps

**RudderStack is warehouse-first by design.** There is **no bulk event export API** because
**the warehouse *is* the export**: RudderStack's primary job is landing raw events in
Snowflake, BigQuery, Redshift, Databricks or S3.

So when the question is analytical, the answer is "query the warehouse" — and that is the
architecture, not a limitation to work around.

## Routing the question

| Question | Answered by |
|---|---|
| "How many users did X last week?" | **the warehouse** |
| "Which events do we collect, and what properties?" | Data Catalog / tracking plans |
| "Did these events reach the destination?" | Pipeline monitoring, warehouse upload status |
| "How much volume are we sending?" | **Organization Usage API** (cheap, server-aggregated) |
| "Who changed this connection?" | Audit Logs API |
| "Why does the destination's count differ?" | pipeline monitoring + transformations |

**Say the routing out loud.** "RudderStack routes rather than analyses — the event data is
in your warehouse and that's where I'll count. What RudderStack can tell us first is
whether everything arrived." That is an answer and it usually saves a step.

## Usage metrics are not analytics

**Usage metrics are ingestion counts — pre-filter, pre-transformation, and not comparable
to any destination's own numbers.**

The same caution as Segment's volume metric, for the same reason: a number counted before
transformations and filters cannot match a number counted after them, and the difference is
not a defect.

## The sync cadence, which fakes a delivery failure

**Warehouse sync frequency is configurable and often hourly or slower.**

**"The event is in RudderStack" and "the event is queryable in Snowflake" can be an hour
apart.**

**Any agent reconciling pipeline to warehouse must account for the sync cadence**, or it
reports a delivery failure that is really a schedule. The diagnostic order:

1. Check the configured sync frequency.
2. Check the last successful warehouse upload (pipeline monitoring covers warehouse upload
   status).
3. Only then investigate the events themselves.

## Live Events is not a log

**Live Events is a sampled real-time debug stream, not a log. It is not a source of truth
for "did this event arrive".**

An event's **absence** from Live Events is **not evidence** it was not received — the
stream is sampled. Use it to confirm shape and structure while debugging, never to prove a
negative.

## Two schema traps that yield nulls and missing tables

**1. `user_id` comes from the root-level `userId`, not from `properties.user_id`.**

**RudderStack populates `user_id` from the event's root-level `userId` field. Sending the
identifier inside `properties.user_id` instead silently yields nulls** in the warehouse
`user_id` column.

This is an instrumentation bug that presents as a modelling problem: the warehouse table
exists, the events are there, and the join key is empty. **Check the event payload shape
before debugging the model.**

**2. "Skip Users Table" defaults on.**

**The `users` table may not exist at all in a given deployment.** A model that joins to it
fails at build time on one customer and works on another, for a configuration reason
nothing in the schema documents.

**Check before writing a model that depends on it**, and prefer building user state from
`identifies` where you need trait history anyway.

## Identity stitching is yours, not the vendor's

**Identity stitching happens in the warehouse (Profiles), not in the stream.** The
`anonymous_id` to `user_id` resolution is **a modelled artifact you own**, with your own
edge cases.

This is a real difference from Amplitude, Mixpanel and PostHog, where the vendor resolves
identity internally:

| | Vendor-resolved (Amplitude, Mixpanel, PostHog) | **RudderStack Profiles** |
|---|---|---|
| Who owns the logic | the vendor | **you** |
| Can you inspect it | no | **yes** |
| Can you change it | no | **yes** |
| Retroactive rewrites | **happen silently** | happen when **you** rebuild |
| Edge cases | vendor's | **yours to find** |

**More control, more responsibility.** The upside is real: an identity rule that is wrong
can be inspected, corrected and rebuilt, which is impossible on the vendor-resolved
platforms. The cost is that nobody else is going to find the shared-device edge case for
you.

## Cloud and self-hosted are different products

**Self-hosted and open-source deployments have entirely different hosts and a reduced API
surface**, and **Cloud and self-hosted diverge substantially in API surface, retention and
dashboard metrics.**

**Do not generalise between them.** Ask which one before planning, and record it in the
provenance block, because every availability claim depends on it.

And note the related honesty requirement: **programmatic coverage of dashboard delivery
metrics is thinner than the UI.** Events delivered, failure counts and rate, and P95
latency **exist in the dashboard** — and self-hosted exposes a Grafana dashboard — but
**verify against the plan before promising them via API.** A number visible in the UI is
not automatically retrievable.

## Limits are barely published

**RudderStack publishes far less numeric limit detail than the other platforms in this
pack. Treat specific numbers as unverified and plan-dependent; read response codes and back
off.**

An agent that hard-codes a rate assumption here is coding against something that was never
published. Prefer the **Organization Usage API**, which is time-bucketed and
server-aggregated and therefore cheap, over anything that iterates.

## Deletion propagates partially

**Deletion and suppression carry the same partial-propagation caveat as Segment** —
destinations that do not support deletion keep the data.

**Never claim data is deleted everywhere.** State what RudderStack removed, what it
requested, and which destinations need handling directly.
