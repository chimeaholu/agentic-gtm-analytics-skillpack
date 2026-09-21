---
name: hubspot
description: Use for any HubSpot request — contacts, companies, deals, tickets, engagements, marketing email statistics, or traffic analytics. HubSpot is read-only for reporting and weaker than people assume: there is no API to create a report or dashboard, no API to read the output of a custom report you already built, and no aggregation primitives anywhere in the CRM API — no GROUP BY, no SUM. Every HubSpot "report" is extract-then-aggregate-locally, which collides with a hard 10,000-result cap on Search. Plan the shard before starting.
---

# HubSpot

**Capability class: extract-only, and weaker than people assume. State all three limits
before starting work:**

1. **There is no API to create a report or dashboard.** It is still an open idea in
   HubSpot's own ideas forum.
2. **There is no API to read the output of a custom report you already built.** No endpoint
   takes a `reportId` and returns that report's rows.
3. **There are no aggregation primitives anywhere in the CRM API — no GROUP BY, no SUM, no
   COUNT-by-group.** **Search filters and sorts. That is all it does.**

**So every HubSpot "report" is extract-then-aggregate-locally, and that collides with a
hard 10,000-result cap on Search. Plan the shard before starting.** A pipeline report for a
portal with a large deal count is a sharded-extraction engineering task, not an API call,
and saying so at planning time is the whole job of this module.

**Core contracts this module must call, every time:** `provenance-block` (portal, object
type, property set, **currency basis used**, archived-state filter, date-property handling),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor` — **with a dedicated
throttle for Search** — `pagination-patterns` for the keyset shard, `mcp-detect-fallback`,
`write-gate` for any object or property write, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** The aggregate is almost always computable by
extracting and summing locally. Do that, give the number, then name what it excludes:
archived records are absent from Search entirely, and calculated properties may be stale.
Withhold only where the extraction genuinely cannot complete — say that plainly with the
shard plan rather than returning a partial number as if it were whole.

---

## (a) Auth setup — the fastest in the pack

> **Setting this up with someone who has not done it before? `references/connect.md` is
> the same setup as a guided walkthrough — read aloud one step at a time, with the exact
> screens, the scopes to choose and why, a verification call, and the common failures.**

Time to first query: minutes.

1. **Create a Private App:** Settings → Integrations → Private Apps → create → **tick
   granular scopes** → copy the token, which looks like `pat-na1-…`. Send it as
   `Authorization: Bearer`. No OAuth dance, no refresh.
2. **Use OAuth 2.0 instead for distributed public apps and for the remote MCP.**
3. **API keys (`hapikey`) are fully sunset since November 2022. Any tutorial using
   `?hapikey=` is dead** — do not follow one, and treat inherited code using it as broken
   rather than deprecated.
4. **Scope precisely, because missing scopes fail at call time, not at token creation. This
   is the step everyone misses.** Analytics endpoints need the analytics and BI scopes; CRM
   reads need `crm.objects.<type>.read`; exports need object scopes. A token that was
   created successfully will still 403 on the one endpoint you needed, hours into the work.
   Enumerate the endpoints first, then scope.
5. **Check the tier. Tier gating is real** — many reporting-adjacent APIs require
   Professional or Enterprise. **"The API exists" and "your portal can call it" are
   different claims.**
6. **Pin the API version.** HubSpot **migrated to date-based API versions
   (`/crm/objects/2026-09/contacts`) during 2026 and reorganised the docs; older
   `developers.hubspot.com/docs/apis/...` URLs now 404. Pin the version explicitly and
   re-verify paths rather than trusting cached knowledge.**

---

## (b) Correct query construction

| Endpoint | What it does |
|---|---|
| `GET /crm/v3/objects/{objectType}` | list with cursor paging; **excludes archived by default** |
| **`POST /crm/v3/objects/{objectType}/search`** | **filters and sort only — no GROUP BY, no SUM, no COUNT-by-group** |
| `GET /analytics/v2/reports/{breakdown}/{timePeriod}` | pre-aggregated **marketing and traffic** metrics only |
| `/analytics/v2/reports/totals/summarize/daily` | pre-aggregated daily totals |
| `GET /email/public/v1/events` | raw email event stream — **you build your own email reporting** |
| `/marketing/v3/emails/statistics/list` | marketing email statistics |
| `/events/v3/events` | custom behavioural events |

**Property history needs `propertiesWithHistory=dealstage`** on the CRM v3 endpoints, or
`/batch/read`. It returns timestamps plus **`sourceType`** and **`updatedByUserId`**, which
is how you reconstruct stage movement — and it is the only way, because there is no
stage-history object.

**The one genuine aggregation surface is the Analytics API, and it covers marketing and
traffic only.** It will never tie out to CRM object counts (see (e)). For anything
CRM-shaped — pipeline by stage by month, revenue by owner, deal velocity — **you extract
and aggregate locally.**

**Design the shard before the first call.** See (c); this is the planning step that
determines whether the work succeeds.

---

## (c) Pagination, bulk and cost

**Rate limits by tier, for a private app:**

| Tier | Burst | Daily |
|---|---|---|
| Free / Starter | 100 per 10s | 250,000 |
| Professional | 190 per 10s | 625,000 |
| Enterprise | 190 per 10s | 1,000,000 |
| API Limit Increase add-on | 200–250 per 10s | +1,000,000 per increase, **max two** |
| Public apps | 110 per 10s per installing account | — |

**Error responses should stay under 5% of total daily requests — HubSpot treats a high
error ratio as abuse.** An agent that retries aggressively into a 403 can get the portal
flagged.

**CRM Search is rate-limited separately, with a practical ceiling around 4 to 5 requests
per second per account. Build a dedicated throttle for it**, distinct from the general
bucket.

**Search hard-caps at 10,000 total results per query regardless of paging. Paging past
`after=10000` simply stops returning data** — it does not error, it just ends.

**The standard workaround, and this module's default, is a keyset shard:**

```
1. sort ascending on hs_lastmodifieddate (or hs_object_id)
2. request a page of <= 10,000
3. take the LAST value from the page
4. use it as a GT filter for the next window
5. repeat until a window returns fewer rows than the page size
```

**This is the single most common HubSpot extraction bug — budget for it.** An agent that
pages naively gets exactly 10,000 records, reports an aggregate over them, and is wrong by
however much the portal exceeds 10,000.

Page size on search: **100 default, 200 maximum.** List endpoints use an `after` cursor
with **no total-count guarantee**, so you cannot compute progress.

**Bulk: `POST /crm/v3/exports/export/async` → poll `.../tasks/{taskId}/status` → fetch a
short-lived signed download URL.** This is the right tool for a full-object extraction and
it bypasses the Search cap entirely. **Export job counts per day are limited and HubSpot
does not publish one stable number across tiers — verify against the portal** rather than
planning around an assumed figure.

---

## (d) Preferred MCP server and fallback

**Official, and there are two, and both are real:**

- **the remote server at `mcp.hubspot.com`** — OAuth, GA
- **the local npm package `@hubspot/mcp-server`** — v0.4.0, published 2026-08-27, actively
  maintained

**Note the source-of-truth trap: the GitHub repo has roughly 5 stars and was last pushed
2025-04-25, while the npm package is clearly the live artifact. GitHub is not the source of
truth here.** This is the mirror image of the PostHog case and the same lesson: a naive
last-commit check lies in both directions.

**Coverage is a token subset and reporting is entirely absent.** The tools are
`list-objects`, `search-objects`, `batch-read-objects`, `batch-create-objects`,
`batch-update-objects`, `batch-create-associations`, `list-associations`,
`get-association-definitions`, `list-properties`, `get-property`, `create-property`,
`update-property`, `get-schemas`, `create-engagement`, `get-engagement`,
`update-engagement`, `list-workflows`, `get-workflow`, `get-user-details`, `get-link`,
`generate-feedback-link`.

**There is no analytics tool, no reporting tool, no export tool and no dashboard tool. It
is a CRM-object CRUD server, and an agent using it inherits the 10,000-result ceiling and
the no-aggregation limitation with no bulk-export escape hatch.** That last clause is the
decisive one: **the MCP cannot do the thing this module exists to do.**

**The remote server also has no access to Sensitive Data Properties.**

**Fallback for anything analytical: direct REST plus the Exports API.** That is not a
degraded path here — it is the primary path, and the MCP is the supplement.

---

## (e) Gotchas, and the specific field that reveals each one

- **No aggregation primitives anywhere in the CRM API.** You cannot ask for "sum of deal
  amount by stage by month". **A pipeline report for a large portal is a sharded-extraction
  engineering project, not an API call.** Say so before starting.
- **Search is eventually consistent; list and read-by-ID are not.** A record created or
  updated seconds ago **may not appear in `/search` yet. Read back by ID, not by search.**
- **Date-only properties are stored as UTC midnight and cause a silent off-by-one day.**
  Timestamps are epoch milliseconds; **date properties normalise to midnight UTC while the
  UI renders in the portal's timezone.** A close date of `2026-09-20` in an
  `America/New_York` portal renders as 2026-09-19 if you localise the raw epoch naively,
  **and monthly pipeline totals shift across month boundaries because of it. Treat
  date-only properties as UTC dates and never apply a timezone conversion to them.**
- **Multi-currency: `amount` is not the reportable number.** It is in the **deal's own
  currency**; the UI rolls up in the portal's home currency. **Use the
  `*_in_home_currency` variants — `amount_in_home_currency`,
  `hs_closed_amount_in_home_currency` — which use a per-deal snapshotted exchange rate, not
  a recomputed one. Summing raw `amount` across a multi-currency portal produces a
  meaningless number that will not match any HubSpot report.**
- **Field permissions run the *opposite* way from Salesforce.** A private app token is
  **portal-scoped, not user-scoped**: it ignores user roles, teams and field-level
  permissions and returns everything its OAuth scopes allow. **So the API commonly shows
  *more* than a given UI user sees** — which is usually why a sales manager says the
  agent's number is too high. **It also means you cannot reproduce a specific user's
  filtered view.**
- **Calculated and rollup properties are computed asynchronously and can be stale or null
  on read** — `num_associated_contacts`, deal-total rollups, scoring properties — **and
  cannot be filtered on reliably in search.**
- **Soft deletes.** Deleting archives to a roughly 90-day recycle bin.
  **`GET /crm/v3/objects/{type}` excludes archived by default (pass `?archived=true`), and
  Search never returns archived records at all** — so **period-over-period counts built on
  search drift silently with no way to detect it from the response.**
- **Lifecycle stage is a single field that moves forward and backward**, and
  **`hs_lifecyclestage_*_date` stamps are overwritten on re-entry**, so a contact that
  cycles twice loses its first journey. **Snapshot it** if journey analysis matters.
- **Deal→contact→company associations are many-to-many; a naive join multiplies revenue.**
- **Marketing contacts versus non-marketing contacts is a billing construct that leaks into
  reporting** — marketing-report contact counts, CRM contact counts and
  `/crm/v3/objects/contacts` totals are **three different numbers.**
- **Analytics API numbers will never tie out to CRM object counts** — different attribution
  windows, session logic and timezone. **Presenting both without a reconciliation note
  produces an argument.**

---

## Files

- `references/extraction-shard.md` — the 10,000-cap keyset shard written out, the Search
  throttle, and when to use the Exports API instead.
- `references/currency-and-dates.md` — the home-currency properties, the UTC-midnight
  date-only rule, and the archived-record drift.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
