---
name: platform-router
description: Use as the entry point for any go-to-market analytics request that touches a platform — ads, web, product, CRM, marketing automation, BI or warehouse. Classifies intent, identifies which platforms can answer it, checks which of them the user actually has credentials for, and routes to the right platform module and analysis skill. Declares up front what each platform can and cannot do, so the agent never promises a report object on a platform that has none. Use this first; do not call a platform module directly.
---

# Platform router

This skill does two things: classify the request, and pick the modules. **It contains no
analytics logic, no metric definitions and no query construction.** Those live in the
platform modules and in the analysis tiers. Analytics logic in a router is how routers
become four-thousand-line monoliths, and every line added here is a line that will disagree
with the module that owns it.

Output of this skill is a **routing plan**: platforms, modules, analysis skills, order, and
a capability statement naming what will not be possible and why. Then hand off.

---

## 1. Classify the intent

| Intent class | The user says | Default route |
|---|---|---|
| Spend and efficiency | ROAS, CAC, CPC, budget, wasted spend | ads modules → `paid-media-analytics` |
| Web and traffic | sessions, channels, landing pages, bounce | `ga4` → `content-seo-attribution` |
| Product behaviour | activation, feature usage, funnels, retention curves | `posthog` → `product-led-growth-analytics` |
| Pipeline and CRM | pipeline, opportunities, win rate, forecast, quota | `salesforce` → `pipeline-forecast`, `funnel-conversion-analysis`, `win-loss-analysis` |
| Email and lifecycle | sends, opens, clicks, deliverability, flows | marketing-automation modules → `email-lifecycle-analytics` |
| Retention and subscription | churn, MRR, NRR, cohorts, LTV | product or billing source → `subscription-analytics`, `cohort-and-ltv` |
| Attribution | which channel drove it, first versus last touch, journeys | multiple sources → `identity-resolution` → `journey-assembler` → attribution tier |
| Forecasting | will we hit the number, what will next quarter be | CRM plus history → `pipeline-forecast`, `timeseries-forecasting-models` |
| Data quality and disagreement | why do these two numbers differ | both sources → audit tier, especially `cross-system-reconciliation` |
| Delivery | dashboard, report, send it to the team | source module → delivery tier |

Two routing rules that prevent most wrong answers:

- **A question about disagreement is an audit question, not a metric question.** Route it to
  the audit tier, not to whichever platform the user mentioned first.
- **A question spanning platforms goes through `comparability-rules` before any module
  runs.** Deciding whether two series may be compared at all comes before computing either.

---

## 2. Declare the capability bound before the work starts

Load this at routing time. It is the anti-overpromise step, and the promise has to be
bounded **before** work starts, not corrected afterwards.

| Capability | Who genuinely has it |
|---|---|
| Create a persistent **report object** by API | **Salesforce only** (`POST /analytics/reports`, a real saved report) |
| Create a persistent **dashboard or insight** | PostHog (full CRUD; the only place "the agent built you a dashboard" is truthful), plus Looker, Power BI, Cube Cloud and Mixpanel-via-MCP in later versions |
| Compose a **report query** returning UI-matching aggregates | Klaviyo, Tableau VDS, Snowflake `SEMANTIC_VIEW()` (later versions) |
| Create a **metric definition** object | Tableau Pulse, Snowflake semantic views, dbt metrics (later versions) |
| **Nothing to author into** | **GA4, Google Ads**, Meta, LinkedIn, Amplitude, HubSpot, Marketo, Pardot, Braze, Iterable, Segment, RudderStack, BigQuery, Looker Studio |

Salesforce carries one asymmetry that is frequently misreported: **reports can be created
from nothing over REST; dashboards over that same API are clone only.** Authoring a
dashboard from nothing needs the Metadata API, or CRM Analytics which is separately
licensed and most orgs do not have.

The full 22-platform matrix and the auth-cost gradient are in
`references/capability-matrix.md`. Load it when the request touches a platform outside the
shipped set.

**Shipped in v1: `platform-router`, `posthog`, `salesforce`, `ga4`, `google-ads`.** When a
request needs a platform whose module is not shipped yet, say that plainly and offer the
generic path (direct API or export) rather than pretending a module exists.

---

## 3. The honest delivery path when the platform cannot author

The sentence "I'll build you a GA4 dashboard" must be impossible to say. When the source
platform has nothing to author into, the route is:

**agent queries the platform → writes the result to Sheets, BigQuery, a static artefact or
a deployed page → the human opens that, not the source platform.**

State this at routing time, as a capability, not as an apology. "GA4 has no API for
building reports or Explorations, so I'll pull the numbers and deliver them as a sheet you
can share" is a plan. Discovering it at the end is a failure.

---

## 4. Route to credentials the user actually has

1. **Ask what is connected before planning.** A plan that depends on Google Ads when no
   developer token exists is not a plan; that approval takes days to weeks.
2. **Where two platforms can answer the same question, prefer the lower auth cost and the
   better provenance.** A PostHog answer today beats a Google Ads answer in three weeks,
   and you should say why you chose it.
3. **Start slow approvals on day one, in parallel with everything else.** Google Ads, Meta
   and LinkedIn approvals are the critical path for any cross-channel work.
4. **Name the person-bound credentials that will break**: Tableau PATs die after 15 idle
   days, Looker access tokens have no refresh token, LinkedIn credentials are bound to a
   human. Anything scheduled on those needs a rotation plan and an auth-failure alert.
5. **Call `mcp-detect-fallback` before committing to a plan**, and `rate-limit-governor`
   before the first call. Both are non-optional. A plan that assumes an MCP server is
   present is a plan the vendor can break between sessions.

---

## 5. Prefer the warehouse when there is one, require it never

If a warehouse or semantic layer is available, prefer it for volume, joins and unsampled
history. Then state the thing that surprises people: **warehouse numbers and platform
numbers are two legitimate series that will not match.** Some numbers are computed by the
vendor and are not derivable from raw extracts at all, including Google's data-driven
attribution, Meta's modelled conversions, LinkedIn's per-campaign conversion counting and
GA4's thresholded demographics. The warehouse cannot reproduce them; it can only compute a
different, defensible number.

Where a semantic layer exists, `semantic-layer-introspector` runs before any metric is
defined. Do not invent a definition the customer already has.

---

## 6. Keep this skill thin

Belongs here: intent classification, capability declaration, credential-aware selection,
module ordering, handoff.

Belongs in modules: auth steps, query construction, pagination, MCP selection, gotchas.

Belongs in the analysis tiers: metric definitions, formulas, attribution logic, cohorting,
forecasting.

If a routing decision seems to need a metric definition to resolve, that is the signal to
route to `gtm-metric-dictionary` and let it decide, not to encode the definition here.

---

## Files

- `references/capability-matrix.md` — the full 22-platform capability matrix, the auth-cost
  gradient, and what connecting each platform does not buy you.
- `evals/cases.json` — routing cases including the honest-limit cases.
