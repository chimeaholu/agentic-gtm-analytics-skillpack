---
name: google-ads
description: Use for any Google Ads request — spend, impressions, clicks, conversions, campaign and keyword performance, or explaining why Google Ads numbers disagree with GA4, Meta or the CRM. GAQL through GoogleAdsService covers the entire read API and is the right interface; there is no saved-report, scheduled-report or dashboard resource, so an agent cannot create a report object. Read `customer.currency_code` and `customer.time_zone` every time, filter `status = 'REMOVED'` deliberately, and never compare a click-date conversion number to another platform's conversion-date number.
---

# Google Ads

**Capability class: extract-only. There is no saved-report, scheduled-report or dashboard
resource in this API.** GAQL is a query language, not a report builder: nothing persists and
nothing appears in the Google Ads UI. The old AdWords `ReportDefinitionService` is gone with
no successor. The deliverable here is extraction plus local aggregation, which means the
agent owns the metric definitions and must say so.

**The API is write-capable with real money attached.** It can create campaigns, ad groups,
ads, budgets, audiences, conversion actions and offline conversion uploads. **Default to
read-only.** Any mutation is a separate, explicitly approved capability routed through
`write-gate`, and it is never routed through a community MCP server.

**Core contracts this module must call:** `provenance-block` (customer id, currency,
timezone, attribution window, click-date versus conversion-date basis, API version),
`warning-field-reader`, `comparability-rules` before any cross-platform comparison,
`rate-limit-governor`, `pagination-patterns`, `mcp-detect-fallback`, `answer-contract`.

**Answer-first discipline for this platform.** Google Ads numbers are computable and
precise; what makes them wrong is comparing them to something they are not. Give the
number, then name the basis that bounds it: "spend is 84,200 in the account's currency,
account timezone, which is final; conversions for the same window are attributed to click
date and will keep rising for up to 90 days, so last-7-days ROAS is structurally
understated." The rough figure is usually fine for direction and pacing, and you should say
so. Withhold only what genuinely is not there: search terms suppressed by privacy
thresholds, or a UI-layer column with no GAQL equivalent.

---

## (a) Auth setup — the heaviest onboarding in the pack

> **Setting this up with someone who has not done it before? `references/connect.md` is
> the same setup as a guided walkthrough — read aloud one step at a time, with the exact
> screens, the scopes to choose and why, a verification call, and the common failures.**

**Time to first query: three days to three weeks.** Say this up front, before any plan that
depends on Google Ads data. The approval is the critical path and it cannot be accelerated.

1. **Apply for a developer token** through a Google Ads **manager (MCC) account**. Tokens
   start at **Test** (production accounts unreachable at all), then **Explorer**, then
   **Basic** (15,000 operations per day), then **Standard**. Each step is a separate,
   human-reviewed application describing your tool. Approval is not instant and can be
   rejected. **Start this on day one of any engagement.**
2. **Create a Google Cloud project and enable the Google Ads API.**
3. **Create an OAuth 2.0 client and mint a refresh token.** Service accounts need
   domain-wide delegation and are awkward here; OAuth refresh tokens are the mainstream
   path.
4. **Assemble the config:** `developer_token`, `client_id`, `client_secret`,
   `refresh_token`, and, **for anyone operating under an MCC, `login_customer_id` set to
   the manager account id. Omitting it when it is required produces a confusing
   `USER_PERMISSION_DENIED` rather than a helpful error.** This is the step everyone misses
   and it wastes hours because the error points at permissions rather than at configuration.
5. **Customer ids are 10-digit and dash-free in the API** (`1234567890`, not
   `123-456-7890`).
6. **Treat the API version as configuration, never hard-coded.** Versions sunset on roughly
   a 12-month clock with around three releases a year. A skill that hard-codes a version
   has an expiry date. Record the version that produced every number.

---

## (b) Correct query construction

**One service, two methods.** `GoogleAdsService.Search` (paginated) and
`GoogleAdsService.SearchStream` (streams the whole result set over one request). Both take
a GAQL string:

```sql
SELECT campaign.id, campaign.name, campaign.status,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value,
       customer.currency_code, customer.time_zone
FROM campaign
WHERE segments.date DURING LAST_30_DAYS
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
```

**This is the interface model the pack imitates everywhere: one generic query surface plus
a metadata call beats fifty hand-wrapped endpoints, because the agent can compose any query
the API supports.**

Rules that keep GAQL correct, with the full set in `references/gaql-patterns.md`:

- **Select `customer.currency_code` and `customer.time_zone` in every reporting query.**
  Not once at setup: every query, because they travel with the rows and belong in the
  provenance block.
- **Divide `cost_micros` by 1,000,000.** Every money field is in micros. A cost that looks
  a million times too large is not a data problem.
- **Decide about `REMOVED` explicitly** rather than inheriting whatever the default gives
  you. See (e).
- **`segments.date` in the `WHERE` clause is what makes a query a report.** Without a date
  segment you get resource rows without metrics semantics.
- **Use `get_resource_metadata` or the resource reference to confirm which fields are
  selectable together.** Not every field combination is legal on every resource, and the
  error is not always clear about which field caused it.

**What the API can create:** campaigns, ad groups, ads, budgets, audiences, conversion
actions, offline conversion uploads. **What it cannot create: a report, a scheduled report
or a dashboard.** When a user asks for a Google Ads dashboard, the honest path is extract
plus a delivered artefact elsewhere, the same as GA4.

---

## (c) Pagination, bulk and cost

**Reporting is cheap on quota; mutations are what burn it.**

| Access tier | Daily operations against production |
|---|---|
| Test | production accounts unreachable |
| Explorer | 2,880 |
| Basic | 15,000 |
| Standard | daily cap lifted; per-minute and concurrency throttles remain |

- **A `Search` or `SearchStream` request counts as one operation regardless of how many
  rows it returns**, and `SearchStream` counts as one operation irrespective of the number
  of batches.
- **Paginated follow-up requests carrying a valid `next_page_token` do not count against
  the daily quota. Pagination is free.** So the cost-minimising shape is fewer, wider
  queries, not narrower ones.
- Throttling surfaces as `RESOURCE_EXHAUSTED`. Back off; do not retry immediately.
- **The gRPC response size cap is 64 MB.** A wide `Search` can exceed it; the fix is fewer
  selected fields or `SearchStream`.
- Mutate limits, for when a gated write is genuinely approved: 10,000 mutate operations per
  request, 2,000 conversions per conversion-upload request, `KeywordPlanIdeaService` around
  1 QPS per customer id, Audience Insights around 200 requests per day per customer id.

**Bulk.** `SearchStream` for anything over a few thousand rows. For large historical pulls,
**the BigQuery Data Transfer Service for Google Ads** lands the standard report tables on a
schedule with no API code, and for repeated multi-month analysis it is materially cheaper
and more reliable than paging the API. Recommend it whenever the same data will be queried
more than a few times.

---

## (d) Preferred MCP server and fallback

**Preferred: the official `googleads/google-ads-mcp`**, open-sourced by Google, Python,
authenticating by OAuth 2.0 or service account / ADC.

**Three tools:** `list_accessible_customers`, **`search` (arbitrary GAQL)** and
`get_resource_metadata`.

Google's own documentation states: *"This implementation is strictly read-only. It cannot
modify bids, pause campaigns, or create new assets."* Three tools sounds thin and is not:
**because `search` accepts arbitrary GAQL, the read surface is effectively complete.** This
is an unusually good design for an agent and the one other modules should be measured
against.

**Community servers, and why not to use them here:**

- `cohnen/mcp-google-ads` — popular but around eleven months stale at research time. Treat
  as unmaintained.
- `promobase/google-ads-mcp` — wraps **write** operations including campaign creation, and
  is pinned to an older API version. **Do not route mutations through a community MCP on a
  real ad account.** The blast radius is money.
- Others exist and add nothing the official server lacks.

**Fallback: direct GAQL over `SearchStream`.** The fallback is fully capable; there is no
feature that forces the MCP. If no MCP is present, a thin direct client needs: OAuth token
refresh, the `developer_token` and `login_customer_id` headers, a `SearchStream` reader, a
`next_page_token` loop for `Search`, micros conversion, and a hard requirement that
`customer.currency_code` and `customer.time_zone` are selected in every reporting query.

---

## (e) Gotchas, and the specific field that reveals each one

- **Attribution windows are per conversion action, not per account.** Click-through
  defaults to **30 days**, configurable 1 to 90; view-through defaults to 1 day;
  engaged-view 3 days. Changes are prospective only and do not restate history. **A single
  account can mix 7-day and 90-day windows, which makes the account conversion total an
  apples-and-oranges sum.** Read
  **`conversion_action.click_through_lookback_window_days`** rather than assuming 30, and
  report the spread when the account mixes windows.
- **Conversions are attributed to the click date, not the conversion date.**
  `metrics.conversions` for last Tuesday keeps rising for up to 90 days as conversions land
  against that click. **Any "last 7 days ROAS" is structurally understated.** Use
  **`metrics.conversions_by_conversion_date`** and
  `metrics.conversions_value_by_conversion_date` when the question wants conversion-date
  reporting, and **never compare a click-date number to another platform's conversion-date
  number.**
- **Money is in micros and in the account's own currency.** `metrics.cost_micros /
  1_000_000`. An MCC-level query returns each child account's cost in **that account's**
  currency with no conversion, so **summing across a multi-currency MCC without reading
  `customer.currency_code` produces nonsense that looks plausible.**
- **Dates are in the account's timezone** (`customer.time_zone`), not UTC and not yours.
  Cross-account roll-ups silently misalign day boundaries, and so does any comparison
  against GA4, which uses the property's timezone.
- **Zero-impression rows are omitted by default.** "The campaign is missing from the
  report" usually means "it had no impressions that day", not "it does not exist". Query
  the resource without metrics, or join, when you need the full entity list.
- **`REMOVED` is a soft delete and the rows are still returned.**
  `campaign.status = 'REMOVED'` persists forever and comes back unless you filter. The UI
  hides removed entities by default; the API does not. **This is the single biggest cause of
  "the API says 400 campaigns and the UI says 50."** Filter deliberately and say which way
  you filtered.
- **Search terms are privacy-thresholded.** Low-volume queries are withheld from
  `search_term_view` entirely, so **search-term spend will not sum to campaign spend**. The
  gap has widened over time. Present it as designed behaviour, not a data-quality problem,
  and give the campaign-level total as the anchor.
- **Segmentation multiplies rows and can change totals.** Adding `segments.device` alongside
  certain conversion segments produces rows that **do not sum to the unsegmented total**,
  because some conversions cannot be attributed to a segment. **GAQL issues no warning.**
  Always pull the unsegmented total separately and reconcile against it before presenting a
  segmented breakdown; report the residual rather than hiding it.
- **UI-versus-API disagreement is routine.** The UI defaults to the account's attribution
  model and a specific date range and hides removed entities; the API does what you asked.
  Some UI columns, including certain "Conv. value (by conv. time)" and cross-account
  conversion views, are computed in the UI layer and **have no exact GAQL equivalent**. Say
  so rather than approximating and calling it a match.
- **Freshness:** most metrics settle within about 3 hours, but conversions and some video
  metrics take 1 to 3 days or more. Same-day numbers are provisional, and a same-day ROAS
  is provisional twice over.
- **Version churn is the biggest maintenance tax in the stack.** Fields get removed in
  breaking releases. Monitor the sunset schedule and expect to re-test annually.

---

## Files

- `references/gaql-patterns.md` — resources, segments, date handling, micros, and the
  query shapes worth copying.
- `references/attribution-and-windows.md` — click date versus conversion date, the
  per-conversion-action window problem, and what may and may not be compared to other
  platforms.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
