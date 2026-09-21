# The auth-cost gradient, in full

**Load this when someone asks which platform to connect, or when they have not yet picked
one.** Say the number for their platform before they open a settings page.

The purpose of this page is one decision: **should this person start this today, or start
something else today and this in parallel?**

---

## The gradient

| Band | Time to working access | Platforms | What the time is actually spent on |
|---|---|---|---|
| **Minutes** | 2 to 10 minutes | PostHog, Amplitude, Mixpanel, Klaviyo, Segment, Iterable, Braze, RudderStack, Snowflake, Cube | Creating a key in a settings page. **The thing that goes wrong is the region or host, not the key.** |
| **About 30 minutes** | 20 to 45 minutes | GA4, BigQuery, Marketo | Several settings in more than one place, all of which must line up. **Nobody has to approve anything.** |
| **About an hour** | 1 to 4 hours | Salesforce, HubSpot, Looker, Tableau, Pardot, dbt Platform | An administrator is required, and the permission choices are consequential. Still no external approval. |
| **Hours to days** | 4 hours to 2 days | Power BI / Fabric | A tenant administrator must enable service principals and allowlist a group. Capacity questions apply before anything can be promised. |
| **Days** | 2 to 10 days | **Meta Ads, LinkedIn Ads** | **A human at the vendor reads an application.** Your own work is an hour; the rest is queue. |
| **Days to weeks** | 3 days to 3 weeks | **Google Ads** | **Tiered, human-reviewed approval — each tier a separate, rejectable application.** The starting tier cannot reach production accounts at all. |

**The sentence that reframes the whole table, and is worth saying out loud:**

> **Auth cost does not correlate with data value.** The two-minute platforms have some of
> the best query surfaces in the stack. The three-week platform has a three-tool read-only
> interface.

---

## What actually goes wrong in each band

Knowing the failure shape per band is what lets you set expectations accurately rather than
generically.

**Minutes band — the region trap.** The key is created in seconds and the mistake is
pointing it at the wrong host. Amplitude EU, Mixpanel EU and India, Iterable EU, PostHog EU
and self-hosted, Braze's per-cluster addresses. **A wrong host does not redirect you — it
returns an authentication error or a silently empty result.** Klaviyo additionally requires
a `revision` header on every single request. **Always ask which region they are on before
anything else.**

**Thirty-minute band — the second system.** These setups span two places that do not know
about each other. **GA4 is the clearest case: enabling the API in a Google Cloud project
grants access to nothing at all. The property-level grant in Google Analytics is a separate
system and is the step everyone forgets.** BigQuery needs billing enabled and cost
guardrails set. Marketo needs an API-only user plus a LaunchPoint service, which is
administrator-only from start to finish.

**Hour band — permissions that fail silently.** The credential works; what it can *see* is
decided elsewhere. **Salesforce needs API Enabled, report folder access, and field-level
security on every field — and missing field-level security produces no error, only a
missing column.** HubSpot scopes fail at call time, hours later, not at token creation.
Tableau personal access tokens expire after fifteen idle days. Looker on older instances
serves its API on a different port.

**Days band — the access tier.** Both Meta and LinkedIn give you a working low tier
immediately, and that tier reaches **only your own accounts**. So the developer's test
passes and the client's account returns nothing, with no useful error. **This one pattern
causes more confusion than every other item on this page.** Tell people before they test,
not after.

**Weeks band — the token tier, and one misleading error.** Google Ads tokens start at Test,
which cannot reach production accounts. Each promotion is a separate application. And under
a manager account, **a missing `login_customer_id` returns `USER_PERMISSION_DENIED`, which
sends people to audit permissions that were correct all along.**

---

## What connecting does not buy you

**Say these at connection time, not when the person asks for the thing that does not
exist.** Every one of them is a promise someone has already made by accident.

- **Connecting HubSpot does not get you reporting.** There is no API to create a report or
  dashboard, no API to read an existing custom report's output, and no aggregation — no
  GROUP BY, no SUM — anywhere in the CRM API. Every HubSpot report is extract-and-aggregate
  locally, against a hard 10,000-result cap on search.
- **Connecting GA4 does not let you build a GA4 dashboard.** No API exists for reports,
  Explorations or dashboards. Explorations have no public API at all.
- **Connecting Google Ads does not get you a saved report or a dashboard.** No such
  resource exists in the API.
- **Connecting Marketo does not get you Marketo's reports.** There is no reporting API of
  any kind. Adobe's own guidance is to extract activities and compute your own numbers.
- **Connecting Salesforce does not get you a reporting MCP server.** None exists, official
  or community, that wraps the Reports and Dashboards API. This pack ships one because the
  gap is real.
- **Connecting an official vendor MCP server does not get you API parity.** Hosted official
  servers are vendor-hosted and versionless: unpinnable, undiffable, and changeable between
  sessions with no changelog. Every module names a direct-API fallback for that reason.

---

## How to recommend a starting platform

**Recommend one. Not three.** One working connection makes the second attempt happen; three
half-finished ones make the person stop.

**If they have a specific question,** pick the cheapest platform that genuinely answers it
and say why you picked it.

**If they do not have a specific question, recommend PostHog.** Two minutes, no approval
from anybody, SQL-based querying, and the session ends with something that works rather
than something pending. The fastest path in the pack from nothing to a real answer.

**If their question needs an ad platform,** start the application today and connect
something in the minutes band in the same session. **Never leave a person with only a
pending approval to show for an hour of work** — that is the shape of an abandoned tool.
