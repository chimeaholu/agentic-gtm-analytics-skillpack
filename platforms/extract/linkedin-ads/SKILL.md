---
name: linkedin-ads
description: Use for any LinkedIn Ads request — spend, impressions, conversions, demographic pivots, and especially CRM-joined pipeline metrics through the Attributed Revenue Metrics finder, which is the single most valuable ads endpoint for B2B because it closes the ad-to-pipeline loop without a warehouse. Three constraints shape everything: adAnalytics has no pagination and a 15,000-element cap, omitting `fields` silently returns only impressions and clicks, and the default attribution counts a conversion once for every campaign it can be attributed to, so summing across campaigns double-counts by design.
---

# LinkedIn Ads

**Capability class: extract-only. There is no report or dashboard object.** Campaign
Manager's saved and scheduled reports are **UI features with no API representation** — you
cannot create one, read one, or trigger one. The honest delivery path is to query
`adAnalytics`, then write the result somewhere a human opens.

**The one thing worth reaching for here is `q=attributedRevenueMetrics`.** It returns
pipeline and revenue metrics straight from the ads API — **it closes the ad-to-pipeline
loop without a warehouse**, which nothing else in the ads tier does. It has real
preconditions; they are in (b), and they should be checked before you promise it.

**Core contracts this module must call, every time:** `provenance-block` (ad account URN,
**`attributionType` used**, `LinkedIn-Version`, currency of each metric, pivot, date
range), `warning-field-reader`, `comparability-rules`, `rate-limit-governor`,
`pagination-patterns`, `mcp-detect-fallback`, and `answer-contract` on the way out.
Writes (`rw_ads`) are Tier B under `write-gate` and are out of scope for reporting work.

**Answer-first discipline for this platform.** LinkedIn returns numbers, but three of its
defaults quietly change what the numbers mean. Give the figure, then name which: the
attribution type, whether you named your `fields`, and whether a demographic pivot is in
play. Withhold only the genuinely unavailable — a demographic value below the reporting
threshold, or daily granularity beyond six months. And **never report "no spend" from an
empty response without verifying account access separately**, because an empty `elements`
array means either no activity or no access and **the two are indistinguishable.**

---

## (a) Auth setup — the most fragile of the ad platforms

> **Setting this up with someone who has not done it before? `references/connect.md` is
> the same setup as a guided walkthrough — read aloud one step at a time, with the exact
> screens, the scopes to choose and why, a verification call, and the common failures.**

1. **Create a LinkedIn Developer app and associate it with a LinkedIn Page you
   administer.** This is a hard requirement and it trips people up: no Page admin rights,
   no app.
2. **Apply for Marketing Developer Platform access.** This is a review process. **Until
   approved you get Development-tier access to your own ad accounts only** — which is why a
   developer's test works and the client's account returns nothing.
3. **OAuth 2.0 three-legged**, with **`r_ads_reporting`** for reporting, `r_ads` for entity
   reads, and `rw_ads` for writes.
4. **Budget for token rotation, because LinkedIn has no service-account equivalent. This is
   the step everyone misses.** It is member-token-based, so **a scheduled skill's
   credentials are tied to a person.** Access tokens are short-lived; refresh tokens expire
   on a fixed clock, commonly 365 days, and **require re-consent by that human.** Anything
   scheduled needs a rotation plan and an auth-failure alert — and a named owner who will
   still be at the company.
5. **Ad accounts are URNs:** `urn:li:sponsoredAccount:123456789`.
6. **Every request needs two headers:** `LinkedIn-Version: YYYYMM` and
   `X-Restli-Protocol-Version: 2.0.0`. **The version is a monthly string that sunsets after
   about a year, so treat it as configuration, never a constant**, and record which version
   produced a number.

---

## (b) Correct query construction

**One endpoint: `GET https://api.linkedin.com/rest/adAnalytics`, with three finders.**

| Finder | Pivots |
|---|---|
| `q=analytics` | group by **exactly one** pivot |
| `q=statistics` | up to **three** pivots |
| **`q=attributedRevenueMetrics`** | **ACCOUNT / CAMPAIGN_GROUP / CAMPAIGN only** |

**`q=attributedRevenueMetrics` returns** `returnOnAdSpend`, `openOpportunities`,
`opportunityWinRate`, `revenueWonInUsd`, `closedWonOpportunities`, `opportunityAmountInUsd`,
`averageDaysToClose` and `averageDealSizeInUsd`.

**Its preconditions, all of which must hold:**

- a **connected CRM** in Business Manager — Salesforce, Dynamics 365, HubSpot, or
  Sales-Navigator-linked
- **up to 72 hours to populate initially** after connection
- pivots restricted to **ACCOUNT, CAMPAIGN_GROUP or CAMPAIGN**
- a **`dateRange` between 30 and 366 days**
- **`opportunityAmountInUsd` and `openOpportunities` only return when `dateRange.end` is
  today in UTC — an easy silent-null trap.** A range ending yesterday returns nulls for
  those two fields and nothing explains why.

**You must name your metrics. Omit `fields` and you get only `impressions` and `clicks`** —
a plausible-looking, near-empty response rather than an error. **Maximum 20 metrics per
request.**

**Set `attributionType` explicitly.** The default double-counts by design; see (e).

---

## (c) Pagination, bulk and cost

**`adAnalytics` does not support pagination. This is stated explicitly in LinkedIn's docs
and it is the defining constraint of this module.** A `paging` object appears in responses,
but the analytics finders cannot be paged — **do not write a paging loop against it.**

**The response is limited to 15,000 elements.** Exceed it and you must **re-slice by date
range or by facet**. There is no cursor to continue from.

**Throttling is data-volume-based**, not request-count-based: **45 million metric values
per 5-minute interval**, where a metric value is one metric multiplied by one returned
record. Breaching returns **429 TOO_MANY_REQUESTS**. **Mitigate by requesting fewer
`fields`** — which is the same lever as the 20-metric cap, and the reason to ask for
exactly what you need.

**414 REQUEST_URI_TOO_LONG is a real operational error**, not an edge case, because
everything is a GET query string and URN lists get long. **Use LinkedIn's query-tunnelling
workaround — POST with `X-HTTP-Method-Override` — when building long URN lists.**

**There is no async or bulk export path at all** — no report-run job, no CSV endpoint.
**Bulk means loops of sliced date ranges. Plan for it** and say so at planning time rather
than discovering it mid-extraction.

**Retention:**

| Data | Retention |
|---|---|
| Performance data | 10 years |
| **Professional demographics** | **2 years** |
| **Daily-granularity data** | **6 months** |

A year-over-year daily comparison is not possible. Say so before building it.

---

## (d) Preferred MCP server and fallback

**There is no official LinkedIn or Microsoft MCP server for LinkedIn Ads. This is the
notable gap among the big four ad platforms.**

**The community field is a clone farm, and a skillpack must not depend on any of it:**

- `danielpopamd/linkedin-ads-mcp` (34 stars) and `alessandromontelli/linkedin-ads-mcp`
  (0 stars) publish **byte-identical descriptions with the same commit timestamp to the
  second**, under different owners.
- `paidsync/linkedin-ads-mcp` runs a "25 tools, full write access" pitch as a lead magnet.
- `CDataSoftware`'s option is read-only via a licensed JDBC driver and was roughly 11
  months stale at research time.

**Fallback is the default here, and it is cheap: write a thin direct HTTP client against
`adAnalytics`.** It is **one endpoint**. You will spend less time building and testing that
client than you would spend evaluating the clone farm, and you get to control the three
things that matter — explicit `fields`, explicit `attributionType`, and query tunnelling
for long URN lists.

A minimal client needs: OAuth token refresh, the two required headers, explicit `fields`
construction with the 20-metric cap enforced, date-range slicing against the
15,000-element ceiling, POST tunnelling above a URL length threshold, and a URN-resolution
cache (see (e)).

---

## (e) Gotchas, and the specific field that reveals each one

- **`attributionType` defaults to `LAST_TOUCH_BY_CAMPAIGN` ("Each campaign"), meaning a
  single conversion is counted once for *every* campaign it can be attributed to.** The
  alternative, **`LAST_TOUCH_BY_CONVERSION` ("Single campaign"), counts it once. Under the
  default, summing conversions across campaigns double-counts by design.** This is
  LinkedIn-specific and is **the biggest single reason LinkedIn conversion totals look
  inflated next to Google and Meta.** `postClickAttributionWindowSize` defaults to 30 (1, 7
  or 30 allowed); `viewThroughAttributionWindowSize` defaults to 7 (1, 7 or 30).
- **`timeGranularity=ALL` outside the 6-month daily window silently rounds dates to month
  boundaries and includes the whole month.** A query for 15 Jan to 15 Jul returns 1 Jan to
  31 Jul **without telling you. This produces wrong numbers that look right.**
- **Professional demographic pivots are heavily restricted and approximate.** Only the
  **top 100 demographic values per creative per day**; **values with fewer than 3 events
  are dropped**; values for low-engagement ads are withheld entirely; carousel metrics are
  unsupported. LinkedIn's own docs call demographic metrics "approximate" and warn that
  **daily sums will not equal the period total and campaign sums will not equal account
  totals.** **Their explicit guidance — query the highest level and the full period rather
  than summing — is this module's default query shape.**
- **Some metrics are unavailable with demographic pivots:**
  `conversionValueInLocalCurrency`, `cardImpressions`, `cardClicks`,
  `viralCardImpressions`, `viralCardClicks`, `approximateMemberReach`. **Requesting them
  with a `MEMBER_*` pivot gets you nothing rather than an error.**
- **Company pivots include companies you never targeted** — multi-employer members,
  job-switchers, audience expansion, and parent/child company structures. **Do not present
  `MEMBER_COMPANY` output as "accounts we targeted".**
- **Everything is a URN and URNs are not human-readable** — `urn:li:organization:1111`,
  `urn:li:geo:1`. Labelling a report needs a second round of resolution calls against the
  Geo API and Organization API. **Budget the extra calls and the extra rate limit**, and
  cache the resolutions.
- **A single response can mix two currencies.** **`costInLocalCurrency` is in the account's
  currency while revenue attribution metrics are in USD** — `revenueWonInUsd`,
  `opportunityAmountInUsd`. **Do not divide one by the other without conversion.** A ROAS
  computed across that boundary is silently wrong.
- **Latency varies by metric family.** Performance data is near-real-time; **demographic
  metrics are delayed 12 to 24 hours; `videoWatchTime` up to 48 hours.** A same-day
  demographic read is not a slow query, it is an absent one.
- **Deleted Sponsored Content shares cannot be queried directly** — query analytics for the
  creative that sponsored the deleted share instead.
- **An empty `elements` array means either genuinely no activity or no read access, and
  these are indistinguishable in the response. Verify account access separately before
  reporting "no spend".**

---

## Files

- `references/attributed-revenue-metrics.md` — the B2B pipeline endpoint: preconditions,
  the today-in-UTC null trap, and the currency mixing rule.
- `references/query-constraints.md` — no pagination, the 15,000-element ceiling, the
  `fields` trap, demographic restrictions, and the URI-length workaround.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
