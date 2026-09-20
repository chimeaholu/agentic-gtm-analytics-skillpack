---
name: marketo
description: Use for any Marketo Engage request — lead and activity extraction, program membership, email engagement, or Marketo Measure / Bizible attribution data. Marketo has no reporting API at all: you cannot create, run or read a Marketo report or Revenue Cycle Explorer view. What it gives you is excellent raw extraction via Bulk Extract, from which you rebuild the numbers yourself and must say so — Marketo's own report figures are not reproducible from the API and never will be exactly, because the UI de-duplicates and bot-filters with undocumented logic.
---

# Marketo

**Capability class: extract-only, and more strictly so than any other platform in the pack.
Marketo has no reporting API at all.** You cannot create a report, run a report, or read a
report's output. Revenue Cycle Explorer has no API. Adobe's own community answer to "how do
I get my report numbers" is blunt: **download activities via REST and do your own
calculation.**

**And you must never promise matching numbers.** Marketo's Email Performance Report
de-duplicates opens and clicks per person, applies its own bot-filtering, and attributes
activity to programs **with logic that is neither documented nor exposed**. Summing
`Open Email` activities gives you **gross** opens; the UI shows **unique** opens after
filtering. **Your number will be higher, sometimes by a lot, and that is correct
behaviour.** A skillpack promising "the same numbers as the Marketo report" is promising
something that cannot be delivered.

**There is one genuinely useful, non-obvious route out of this: Marketo Measure / Bizible
attribution data lives in Salesforce custom objects**, which means every Salesforce
capability applies to it — including `POST /analytics/reports`. **You author attribution
reports through Salesforce, not through Adobe.** See (b).

**Core contracts this module must call, every time:** `provenance-block` (Munchkin-derived
host, API-only user, **instance timezone**, activity type IDs used, extraction window),
`warning-field-reader`, `comparability-rules` — **because the API figure and the UI figure
are two legitimate series** — `rate-limit-governor`, `pagination-patterns`,
`mcp-detect-fallback`, `write-gate` for any lead or program write, and `answer-contract` on
the way out.

**Answer-first discipline for this platform.** Compute the number from the activity stream,
give it, and label it **independently computed**, naming the direction of the difference
from the UI. Withhold only what genuinely is not retrievable: activity beyond the
subscription's retention, or a field the API user's role cannot see.

---

## (a) Auth setup — straightforward, but admin-only

A marketer cannot self-serve this. Get an admin involved from the start.

1. **Create an API-Only user role** in Admin → Users & Roles with the permissions the work
   needs. **The role's permissions directly determine what the agent can see**, and the
   failure mode is silent (see (e)).
2. **Create an API-Only user** and assign that role.
3. **Create a LaunchPoint Custom Service** assigned to that user. This yields the
   **Client ID** and **Client Secret**.
4. **Get the Munchkin ID** from Admin → Munchkin. **It forms the host:
   `https://{munchkinId}.mktorest.com`. This is the step everyone misses — there is no
   shared host. Every subscription has its own**, and a hard-coded host from a previous
   engagement simply will not authenticate.
5. **Mint a token:**
   `GET /identity/oauth/token?grant_type=client_credentials&client_id=…&client_secret=…`
   returns a bearer token with a **3600-second TTL. Cache and refresh it — each mint costs
   a call** against a daily budget that is smaller than people expect.

**Pin the instance timezone at the top of any extraction job.** It governs every date
boundary the marketer sees, and REST responses do not use it — see (e).

---

## (b) Correct query construction

**Lead and activity surfaces:**

| Endpoint | Use |
|---|---|
| `GET/POST /rest/v1/leads.json` | lead reads |
| **`/rest/v1/leads/describe2.json`** | **drive the schema at runtime — never hard-code a field list** |
| `GET /rest/v1/activities.json` + `/activities/pagingtoken.json` | the activity stream |
| **`GET /rest/v1/activities/deletedleads.json`** | **the soft-delete escape hatch — you need it** |
| `/rest/asset/v1/programs.json`, `/rest/v1/campaigns.json` | programs and campaigns |
| `GET /rest/v1/leads/programs/{id}.json` | program membership |

**Bulk Extract**, which is the real extraction path:
`POST /bulk/v1/leads/export/create.json` → `/enqueue` → `/status` → `/file`. The same
lifecycle exists for `/bulk/v1/activities/export/` and `/bulk/v1/program/members/export/`.

**`GET /rest/v1/stats/usage.json` and `/stats/errors.json` are API-quota telemetry, not
marketing metrics.** The naming trips up agents and humans alike — they tell you how many
calls you have made, not how a campaign performed.

**To build email performance, extract the activity types and aggregate.** The relevant
ones: Send Email, Email Delivered, Email Bounced, Email Bounced Soft, Unsubscribe Email,
Open Email, Click Email. **Get the current numeric IDs from
`GET /rest/v1/activities/types.json` rather than hard-coding them, because custom activity
types are instance-specific** and the numeric IDs are not portable between subscriptions.

**Marketo Measure / Bizible attribution — the route worth knowing.** The data lives in
**Salesforce custom objects**: `bizible2__Bizible_Attribution_Touchpoint__c`,
`bizible2__Bizible_Touchpoint__c`, `bizible2__Bizible_Person__c`, plus Bizible-namespaced
fields across Lead, Contact, Account, Opportunity and Campaign. **Every Salesforce
capability therefore applies, including `POST /analytics/reports` — so you author
attribution reports through Salesforce, not through Adobe.** Hand off to the `salesforce`
module for that work.

**The Marketo Measure Data Warehouse is a Snowflake share** — Reader Account or Direct
Share — so it is **SQL access, not a REST API, and it is the right answer for serious
attribution analytics.** Hand off to `snowflake`. **There is no meaningful standalone
Marketo Measure REST reporting API.**

---

## (c) Pagination, bulk and cost

| Limit | Value |
|---|---|
| Daily REST calls per subscription | **50,000** (minimum allocation 10,000) |
| **Daily quota reset** | **12:00 AM CST — not UTC, not local** |
| Burst | **100 calls per 20 seconds per instance, shared across *all* integrations** |
| Concurrency | **maximum 10 in-flight calls** |
| REST payload | 1 MB |
| Bulk Extract capacity | **500 MB or more per day**, 2 executing plus 10 queued, inclusive |
| Activity extract window | **31 days maximum per job** |
| Lead IDs per GET filter | 300 |

**Error 606 is the burst limit. Error 607 is the daily quota.** They need different
responses: back off for 606, stop and report for 607.

**Adobe's guidance is to keep any single integration under roughly 50 calls per 20 seconds
so it does not starve other tools.** This is not politeness — see the political note in (d)
and the gotcha in (e).

**Pagination is `nextPageToken`.** The activity stream is specifically: mint a paging token
from a datetime via `/activities/pagingtoken.json`, then follow `nextPageToken` until
**`moreResult`** is false. **Tokens expire, so a long-running extraction must handle
re-minting** rather than failing at hour six.

**The practical consequence, and the planning rule for this module: on a 50,000-call daily
budget with a 100-per-20-seconds ceiling, streaming activity data through
`/rest/v1/activities.json` exhausts the quota long before it finishes. Bulk Extract is not
an optimisation, it is the only viable path above a few tens of thousands of rows.** Decide
this before the first call.

---

## (d) Preferred MCP server and fallback

**There is no official Adobe or Marketo MCP server.**

Every option is a small community project and all are early:

| Repo | Stars | Note |
|---|---|---|
| `tyron-pretorius/marketo-mcp` | 4 | |
| `etumos-lab/Marketo-MCP` | 4 | self-described unofficial, from a MOps agency, so domain-aware |
| `zsimmons-etumos/marketo-mcp-server` | 0 | claims 90+ tools |
| `alexleventer/marketo-mcp` | 2 | |
| `bagwanpankaj/marketo-mcp` | 0 | |
| `CDataSoftware/marketo-mcp-server-by-cdata` | 1 | read-only, requires a CData licence |

**Maximum adoption is four stars. Do not build on any of them.**

**Fallback is the default: call the REST and Bulk APIs directly.**

**And note the political dimension, which is specific to this platform: an MCP server
firing eager per-record calls will trip error 606 and break *other* integrations in the
same Marketo instance.** The 100-per-20-seconds burst limit is shared instance-wide, so a
chatty agent does not just degrade itself — it takes down the Salesforce sync and the
webinar connector alongside it. That is a stakeholder conversation, not a technical detail.

---

## (e) Gotchas, and the specific field that reveals each one

- **Marketo's own report numbers are not reproducible from the API and never will be
  exactly.** The Email Performance Report **de-duplicates opens and clicks per person,
  applies its own bot-filtering, and attributes activity to programs with undocumented
  logic.** **Summing `Open Email` activities gives gross opens; the UI shows unique opens
  after filtering, so your number will be higher, sometimes by a lot. Present API-derived
  metrics as independently computed and say so.**
- **The 100-calls-per-20-seconds limit is shared across the whole instance.** Your
  integration competes with the Salesforce sync, the webinar connector and every
  consultant's ad-hoc script. **Throttle well under the ceiling and back off on 606s you
  did not cause.**
- **The daily quota resets at midnight CST.** An agent scheduling a "start of day"
  extraction on a UTC clock runs into a partially-consumed window.
- **Timezone is the instance's.** A single configured timezone governs Smart Campaign
  windows and report date boundaries, **while REST responses use ISO-8601 UTC. Day-boundary
  aggregations computed in UTC will not match anything a marketer sees. Pin the instance
  timezone at the top of any extraction job.**
- **Activity data retention is finite and silently truncates history** — commonly
  documented as about 25 months, with shorter effective retention for some activity types
  and legacy contracts. **Verify against the specific subscription; this genuinely varies.**
  A year-over-year report may find the comparison period simply absent.
- **`updatedAt` churns for reasons unrelated to the marketer.** System processes, list
  membership changes and score recalculations bump it, **so incremental extraction on
  `updatedAt` pulls far more than actually changed and cannot distinguish a meaningful edit
  from housekeeping.**
- **Soft-deleted leads have their own endpoint and you need it.** Deleting removes a person
  from `/rest/v1/leads.json` **entirely**; **`deletedleads.json` is the only way to learn a
  record was removed. Without polling it at least as often as you extract, period-over-period
  counts drift downward with no visible cause.**
- **Fields the API user's role cannot see simply do not appear in `describe2` output** —
  **the agent has no way to know the field exists.** Marketo's "block field updates" config
  can also reject writes per-service.
- **Program membership is not activity.** Program success, program status and acquisition
  program are three different concepts with different APIs, and **Marketo's attribution is
  computed internally with rules you cannot read. Extract the field; do not recompute the
  concept.**
- **Bizible touchpoints are recalculated in bulk on Marketo Measure's own schedule**, so
  **attribution weights on a given opportunity change retroactively** — a report run today
  over last quarter can differ from the same report last week with nothing having
  "changed". **Snapshot attribution outputs if reproducibility matters, and never present
  Bizible figures as immutable.**
- **Lead dedupe on email is the default and creates merge events that rewrite IDs.** Track
  the `mergeLeads` activity to keep the identity spine coherent, or joins built on lead ID
  silently decay.

---

## Files

- `references/bulk-extract.md` — the Bulk Extract lifecycle, the 31-day activity window,
  the call-budget arithmetic, and the paging-token re-mint.
- `references/why-numbers-differ.md` — gross versus unique, bot filtering, the soft-delete
  drift, and how to present an independently computed metric honestly.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
