# Ad platform register

Per platform: the fields that matter, the caps, the settling behaviour, and the
ways each one fails silently.

---

## Google Ads

**Surface.** `GoogleAdsService.Search` (paginated) and `SearchStream` (one
request, batched response), both taking GAQL. There is **no saved-report or
scheduled-report resource** — GAQL is a query language, nothing persists, and
nothing appears in the UI.

**Fields that must be read every time**

| Field | Why |
|---|---|
| `customer.currency_code` | cost is in **each account's own currency**, with no conversion at MCC level |
| `customer.time_zone` | dates are in the account's timezone, not UTC |
| `metrics.cost_micros` | divide by 1,000,000 |
| `conversion_action.click_through_lookback_window_days` | **the window is per conversion action**, so one account can mix 7-day and 90-day actions and the account total is an apples-and-oranges sum |
| `campaign.status` / `ad_group_ad.status` | `REMOVED` entities persist forever and are returned unless filtered |
| `metrics.conversions` vs `metrics.conversions_by_conversion_date` | click-date versus conversion-date basis |

**Attribution.** Click-through window defaults to 30 days (configurable 1–90 per
conversion action); view-through defaults to 1 day; engaged-view 3 days. Changes
are **prospective only** and do not restate history.

**Settling.** Conversions are attributed to the **click date**, so last
Tuesday's figure keeps rising for up to 90 days. Any "last 7 days ROAS" is
structurally understated.

**Caps and quotas.** Reporting is cheap: a `Search` or `SearchStream` request
counts as one operation regardless of rows, and **paginated follow-ups carrying
a valid `next_page_token` do not count against the daily quota**. gRPC response
size caps at 64 MB — a wide `Search` can exceed it; narrow the field list or use
`SearchStream`. Developer-token access tiers gate the daily operation count, and
obtaining a token is a human-reviewed, multi-day process.

**Silent failures**

- Zero-impression rows are **omitted by default** for most resources. A missing
  campaign means no impressions, not no campaign.
- `REMOVED` entities are returned by the API and hidden by the UI, which is the
  usual cause of a campaign-count discrepancy.
- Adding a segment can produce rows that **do not sum to the unsegmented
  total**, because some conversions cannot be attributed to a segment. GAQL does
  not warn.
- Search terms are **privacy-thresholded**: low-volume queries are withheld, so
  search-term spend will not sum to campaign spend. By design, not a defect.
- Version sunset is roughly annual. A hard-coded version string has an expiry
  date; pin deliberately and diary a review.

---

## Meta

**Surface.** Ads Insights: `GET /v{version}/{object-id}/insights` with fields,
params (`date_preset` / `time_range`, `time_increment`, `level`, `filtering`,
`action_attribution_windows`) and breakdowns. **No report or dashboard object
exists.** The async path creates an `AdReportRun` — an ephemeral job handle that
expires after 30 days, not an artefact.

**Attribution, and what changed**

- API default if `action_attribution_windows` is omitted: **`7d_click`**. Ads
  Manager's ad-set default is **7-day click + 1-day view**. Those are different
  numbers, and that single mismatch drives a large share of
  "the API doesn't match Ads Manager".
- From **2025-06-10**, `use_unified_attribution_setting` and
  `action_report_time` are reported as ignored, with responses mirroring Ads
  Manager's settings.
- From **2026-01-12**, **`7d_view` and `28d_view` were removed entirely**.
  Supported windows: `1d_click`, `7d_click`, `28d_click`, `1d_engaged_view`,
  `1d_view`. **A saved query carrying `7d_view` will fail or return nothing**,
  and pre-2026 blog posts on Meta attribution are actively misleading.

**Settling.** "Insights refresh every 15 minutes and do not change after 28 days
of being reported." The second clause is the operative one: **the last 28 days
are still moving.**

**Data retention (announced 2025-10-13, effective 2026-01-12)**

| Data | Retention |
|---|---|
| `unique_actions`, `cost_per_unique_action_type`, `hourly_stats_aggregated_by_advertiser_time_zone` | 13 months |
| `breakdowns=frequency_value` | 6 months |
| plain aggregate totals | up to 37 months |
| MMM breakdowns | **async jobs only** — synchronous access removed |

**Throttling.** Utilisation-based, not request-count-based. Read
`x-fb-ads-insights-throttle` (`app_id_util_pct`, `acc_id_util_pct`,
`ads_api_access_tier`) and back off approaching 100%. Global load shedding
appears as error code 4 / subcode 1504022 and is retryable.

**Row limits.** No published hard cap. The system rejects based on response rows
*and* the data points needed for totals, returning **error 100 / subcode
1487534**. Auto-splitting by date range or object level on that specific error is
a **required** retry strategy, not an optimisation.

**Silent failures**

- **Breakdown metrics do not sum to the unbroken total.** Unique metrics —
  reach, unique clicks — are not additive: one person on two placements is 1
  reach and 1+1 in the breakdown.
- **Not all breakdown combinations are legal**, and some silently drop metrics
  rather than erroring. There is no compatibility-check endpoint.
- **Deleted campaigns are excluded from list queries while their historical
  spend remains in account-level insights**, so campaign sums will not match the
  account total.
- **Modelled conversions** are a material share post-ATT. Not deterministic, not
  reconcilable to a CRM row for row, and they change retroactively.
- **Currency and timezone are per ad account**; spend comes back in the account
  currency with no conversion field.

---

## LinkedIn Ads

**Surface.** One endpoint: `GET https://api.linkedin.com/rest/adAnalytics`, with
three finders — `analytics` (one pivot), `statistics` (up to three pivots), and
`attributedRevenueMetrics` (CRM-joined). Requires `LinkedIn-Version: YYYYMM` and
`X-Restli-Protocol-Version: 2.0.0`. **Versions sunset after about a year**, so
the version header is configuration, not a constant.

**Attribution — the one that inflates totals**

- `postClickAttributionWindowSize` default **30** (1/7/30 only).
- `viewThroughAttributionWindowSize` default **7** (1/7/30).
- `attributionType` default **`LAST_TOUCH_BY_CAMPAIGN`** — **one conversion is
  counted once for every campaign it can be attributed to.**
  `LAST_TOUCH_BY_CONVERSION` counts it once. **Under the default, summing
  conversions across campaigns double-counts, by design.**

**Caps and behaviour**

- **No pagination on `adAnalytics`.** Stated in LinkedIn's own docs. Slice by
  date range or facet.
- **15,000-element response cap.**
- Throttling is data-volume-based: **45 million metric values per 5-minute
  interval**, where a metric value is one metric × one returned record.
  Breaching returns 429. Request fewer `fields`.
- **Maximum 20 metrics per request.**
- `414 REQUEST_URI_TOO_LONG` is a real operational error because everything is a
  GET; query tunnelling (POST with `X-HTTP-Method-Override`) is the workaround.
- **No async or bulk export path at all.** Bulk means looping sliced date ranges.
- Retention: performance data 10 years; professional demographics **2 years**;
  **daily-granularity data only 6 months**.

**Silent failures**

- **Omit `fields` and you get only `impressions` and `clicks`** — a
  plausible-looking near-empty response, not an error.
- With `timeGranularity=ALL`, dates outside the 6-month daily window are
  **silently rounded to month boundaries and the whole month is included**. A
  15 Jan–15 Jul query returns 1 Jan–31 Jul without saying so.
- **Empty `elements` means no activity *or* no read access** — indistinguishable
  in the response. Verify account access before reporting zero spend.
- Demographic pivots return only the **top 100 values per creative per day**,
  drop values with fewer than 3 events, and withhold values for low-engagement
  ads. LinkedIn's own guidance: **query the highest level and the full period
  rather than summing.** Daily sums will not equal the period total and
  campaign-level sums will not equal account-level.
- Some metrics are non-demographic only — `conversionValueInLocalCurrency`,
  `cardImpressions`, `cardClicks`, `viralCardImpressions`, `viralCardClicks`,
  `approximateMemberReach`. Requesting them with a `MEMBER_*` pivot returns
  nothing rather than an error.
- **Two currencies in one response:** `costInLocalCurrency` is the account's
  currency; `revenueWonInUsd` and `opportunityAmountInUsd` are USD.
- Everything is a URN (`urn:li:organization:1111`). Labelling a report needs a
  second round of resolution calls — budget them.
- `attributedRevenueMetrics` specifics: needs a connected CRM, up to 72 hours to
  populate, `dateRange` between 30 and 366 days, and
  **`opportunityAmountInUsd` / `openOpportunities` return only when
  `dateRange.end` is today in UTC.**

---

## GA4 (as the paid-media cross-check)

**Surface.** Data API `properties.runReport` and friends. **Nothing is saved**;
`runReport` is a stateless query and no Exploration or dashboard can be created
over the API.

**Fields to read on every response** (`ResponseMetaData`)

| Field | Meaning |
|---|---|
| `samplingMetadatas[]` | `samplesReadCount ÷ samplingSpaceSize` is the sampling rate; ratio < 1 means the report is sampled |
| `subjectToThresholding` | rows suppressed for privacy; **totals will not equal the sum of the breakdown** |
| `dataLossFromOtherRow` | high-cardinality dimensions rolled into `(other)` |
| `currencyCode` | revenue is in the **property's** currency |
| `timeZone` | dates are bucketed in the **property's** timezone |
| `schemaRestrictionResponse` | field-level permissions changed what you got back |
| `emptyReason` | an empty report is not always "no data" |

**Quotas** are token-based, not request-based: a wide report burns far more than
a narrow one. Set `returnPropertyQuota: true` on every request and read the
`PropertyQuota` object back — it is the only reliable way to self-throttle.
Row cap is 250,000 per request; pagination is offset-based and each page is a
full re-query.

**Attribution.** 30-day acquisition lookback by default (30 or 90 for paid and
organic); **GA4 does not count view-throughs**; data-driven attribution by
default. GA4 will not agree with the ad platforms and is not supposed to.

**API–UI disagreement is normal.** The UI's standard reports use pre-aggregated
tables; the Data API computes from a different path, with different session and
key-event semantics. Reconciling exactly is often not achievable — say so rather
than iterating.
