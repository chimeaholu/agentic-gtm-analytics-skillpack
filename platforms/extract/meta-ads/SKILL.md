---
name: meta-ads
description: Use for any Meta / Facebook / Instagram advertising request — spend, reach, conversions, ROAS, breakdowns by placement or demographic, or explaining why Meta's numbers disagree with Ads Manager or with Google. Insights is query-only: there is no report or dashboard object. Use the async job path by default, read the `x-fb-ads-insights-throttle` header, and never sum a breakdown and call it the total, because unique metrics like reach are not additive. Attribution parameters changed materially in 2025–2026 and any saved query carrying `7d_view` now fails or returns nothing.
---

# Meta Ads

**Capability class: extract-only. There is no report or dashboard object.** Insights is
query-only and **nothing you run appears in Ads Manager.** The async path creates an
`AdReportRun`, but that is an **ephemeral job handle that expires after 30 days**, not a
report artifact. "I'll build you a Meta report" is never an available sentence; the honest
delivery path is to query, then write the result to Sheets, a warehouse or a static
artefact the human opens.

The broader Marketing API **is** write-capable for real ad objects — campaigns, ad sets,
ads, budgets. That is a separate capability and it spends money. It is gated at **Tier B**
under `write-gate`, per operation, and it is never batched with a read.

**Core contracts this module must call, every time:** `provenance-block` (ad account,
`account_currency`, account timezone, **`action_attribution_windows` used**, API version,
async job id), `warning-field-reader`, `comparability-rules`, `rate-limit-governor`
reading **`x-fb-ads-insights-throttle`**, `pagination-patterns`, `mcp-detect-fallback`,
`write-gate` for any Marketing API mutation, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** Meta returns numbers readily. Give them,
then name the direction of their error from the parameters you used rather than hedging:
an unspecified attribution window means the API default, which is **not** the Ads Manager
default; the last 28 days are **still moving**; modelled conversions are estimates that
**change retroactively**. Say when the rough figure is fine — for "roughly what did we
spend on Instagram last month", a breakdown figure is fine and you should say so. Withhold
only the genuinely unavailable: a unique metric beyond its retention window, or a
breakdown combination Meta rejects.

---

## (a) Auth setup

Time to first query: **days, not minutes**, because App Review is a human process. Start it
on day one, in parallel with everything else.

1. **Create a Meta app of type Business** in the Meta for Developers console.
2. **Get a Business Manager account and link the ad account to it.**
3. **Request `ads_read` (and `ads_management` for writes) and pass App Review for Advanced
   Access.** **Standard Access only reaches ad accounts your app's own admins own** — which
   is why a developer's test works and the client's account returns nothing. **This is a
   human review: days, not minutes.**
4. **Use a System User token issued from Business Manager for anything automated. This is
   the step everyone misses, and it is what kills scheduled work months later.** **User
   access tokens expire — 60 days for a long-lived one — and will silently break a
   scheduled skill.** A System User token is long-lived and is not tied to a person who may
   leave the company.
5. **Ad account IDs carry the `act_` prefix.** `act_123456789`, not `123456789`.
6. **Pin the API version.** Current docs referenced v25.0 at research time; community
   tooling had moved to v26.0. Meta ships roughly three versions a year with about a
   two-year support window. **Treat the version as configuration and record which version
   produced a number.**

Verify before planning work, and **read the throttle header from the response**:

```bash
curl -sD - "https://graph.facebook.com/v25.0/act_$AD_ACCOUNT_ID/insights?\
fields=spend,impressions&date_preset=last_7d&access_token=$META_TOKEN" -o /dev/null \
  | grep -i 'x-fb-ads-insights-throttle'
```

---

## (b) Correct query construction

`GET /v{version}/{object-id}/insights`, where the object is an ad account, campaign, ad set
or ad. **A query is three things:**

1. **fields** — the metrics: `spend`, `impressions`, `reach`, `clicks`, `actions`,
   `action_values`, `purchase_roas`, and so on.
2. **params** — `date_preset` or `time_range`, `time_increment`, `level`, `filtering`, and
   **`action_attribution_windows`**.
3. **breakdowns** — `age`, `gender`, `country`, `publisher_platform`, `device_platform` —
   plus **action_breakdowns** — `action_type`, `action_destination`.

**Always set `action_attribution_windows` explicitly.** Omitting it is the single largest
source of "the API doesn't match Ads Manager" tickets — see (e).

```
fields=spend,impressions,reach,actions,action_values
&time_range={"since":"2026-08-01","until":"2026-08-31"}
&time_increment=1
&level=campaign
&action_attribution_windows=['7d_click','1d_view']
&breakdowns=publisher_platform
```

**Supported attribution windows after 2026-01-12 are `1d_click`, `7d_click`, `28d_click`,
`1d_engaged_view` and `1d_view`.** `7d_view` and `28d_view` were **removed entirely** — a
saved query carrying either now fails or silently returns nothing.

**Breakdown compatibility is trial and error.** Not all combinations are legal; some pairs
are rejected and **some silently drop metrics.** There is **no `checkCompatibility`
equivalent** the way GA4 has one — budget for the iteration, and validate that every metric
you asked for is actually present in each returned row.

---

## (c) Pagination, bulk and cost

**Use the async path by default for anything beyond a trivial slice. It is well built.**

1. `POST /{object-id}/insights` → returns a **`report_run_id`**
2. poll the `AdReportRun` for **`async_status`** — Not Started, Job Started, Job Running,
   Job Completed, Job Failed, Job Skipped — and **`async_percent_completion`**
3. `GET /{report_run_id}/insights` with cursor pagination

**There is no published hard row cap.** Meta's docs say there is no explicit limit for when
a query will fail; the system rejects based on response rows **and** the data points needed
to compute totals, returning **error code 100, subcode 1487534**.

**Auto-splitting by date range or object level on that specific error is a required retry
strategy, not an optional one.** An agent that reports "the query failed" on subcode
1487534 has skipped the documented handling.

**Throttling is utilisation-based, not a request count. Read
`x-fb-ads-insights-throttle`** — it carries `app_id_util_pct`, `acc_id_util_pct` and
`ads_api_access_tier` — **and back off as utilisation approaches 100%.** Non-insights
Marketing API calls carry a separate **`X-Business-Use-Case-Usage`** header. **Global load
shedding appears as error code 4, subcode 1504022, which is retryable and is not your
fault** — distinguish it from your own utilisation before changing anything.

**Pagination is cursor-based** — `paging.cursors.after`, `paging.next`. There is **no random
access**, so you cannot skip to page 10 or resume from an offset.

**Data retention restrictions announced 2025-10-13, effective 2026-01-12:**

| Data | Retention |
|---|---|
| Unique-count fields (`unique_actions`, `cost_per_unique_action_type`) | **13 months** |
| `hourly_stats_aggregated_by_advertiser_time_zone` | **13 months** |
| `breakdowns=frequency_value` | **6 months** |
| Plain aggregate totals | up to 37 months |
| MMM breakdowns | **async-only**; synchronous access removed |

*The research flagged medium confidence on this table — verify against Meta's changelog
before shipping a year-over-year plan that depends on it.*

---

## (d) Preferred MCP server and fallback

**Preferred: Meta's own first-party remote MCP server at `https://mcp.facebook.com/ads`.**
OAuth. **If a "Meta MCP" asks you for an API key, it is not Meta's.**

Roughly 29 tools across seven areas: reporting and campaign insights; **creating and
editing campaigns, ad sets and ads**; catalog and product data; signals and dataset health;
Business Help Center search; A/B tests and conversion lift studies; and account activity
logs. Free, with a gradual rollout.

**This is the strongest official MCP story of any platform in the research, and it is
genuinely write-capable — a pack that wires it in is one prompt away from spending real
money. Treat it as privileged and gate every write at Tier B, per operation.**

**Caveats to state before depending on it:**

- It is **remote and Meta-hosted**, so you cannot inspect the source, pin a version, or
  audit which Graph fields it reads.
- **Rollout is gradual, so availability for a given account is not guaranteed. The skill
  must degrade gracefully to direct Graph API calls**, and say that it did.

**Community options, for awareness rather than adoption:** `pipeboard-co/meta-ads-mcp`
(1,267 stars, Meta Business Partner badged) and `gomarble-ai/facebook-ads-mcp-server` lead
the field. `mikusnuz/meta-ads-mcp` claims 135 tools with thin adoption — **tool-count
maximalism is a warning sign for agent UX, not a feature.** **Discount star counts on any
repo in the lookalike cluster** where `byadsco`, `khaphanspace` and `epave` publish
identical descriptions.

**Fallback: the Graph API directly, which covers everything.**

---

## (e) Gotchas, and the specific field that reveals each one

- **Attribution default mismatch is responsible for an enormous share of "the API doesn't
  match Ads Manager" tickets.** Omit **`action_attribution_windows`** and the API's
  historical default is **7d_click**; **Ads Manager's default ad-set setting is 7-day click
  plus 1-day view.** Not the same number. Set it explicitly and print what you set.
- **The attribution parameters were neutered, and pre-2026 sources are actively
  misleading.** From **2025-06-10**, `use_unified_attribution_setting` and
  `action_report_time` are reportedly ignored, with responses mirroring Ads Manager. From
  **2026-01-12**, **`7d_view` and `28d_view` were removed entirely.** **Any skill or saved
  query carrying `7d_view` now fails or silently returns nothing. Treat pre-2026 blog posts
  and Stack Overflow answers about Meta attribution as wrong.**
- **Conversions are reported by impression or click time by default, not conversion time.**
  Combined with the 28-day settling window, **a Meta "yesterday" and a Google Ads
  "yesterday" measure different things** before attribution windows even differ.
- **Breakdown metrics do not sum to the unbroken total, and unique metrics are not
  additive.** A person who saw the ad on Facebook and on Instagram is **1 reach total but
  1 + 1 under a `publisher_platform` breakdown.** **Adding up a breakdown and presenting it
  as the total is a real, common and embarrassing error, and Meta does not warn you.**
  Query the unbroken total separately when you need a total.
- **Not all breakdown combinations are legal.** Some pairs are rejected; **some silently
  drop metrics.** There is **no `checkCompatibility` equivalent** — validate that every
  requested field is present in the returned rows.
- **Currency and timezone are the ad account's** — **`account_currency`**, and
  `time_increment=1` buckets in the **advertiser's** timezone — **with no conversion
  field.** Cross-account roll-ups need explicit normalisation you must do yourself.
- **Deleted objects.** **`effective_status` and `configured_status`** carry `DELETED` and
  `ARCHIVED`. Deleted campaigns are excluded from default list queries **but their
  historical spend still appears in account-level insights**, so **campaign-level sums will
  not match account totals when anything was deleted.**
- **Estimated and modelled metrics** — post-iOS-14 conversion modelling in particular —
  **are not deterministic counts, change retroactively, and cannot be reconciled to a CRM
  row-for-row. Say this before the client asks.**
- **Field permissions.** A token without the right Business Manager role gets **a subset of
  fields back, sometimes without an error.** A missing metric is a permission until ruled
  out.
- **Freshness: insights refresh every 15 minutes and do not change after 28 days of being
  reported — which means numbers for the last 28 days are still moving.** Label any
  recent-window figure provisional, and never treat a changed number as a bug inside that
  window.

---

## Files

- `references/attribution-windows.md` — what changed and when, the supported window list,
  and how to make an API figure comparable to an Ads Manager figure.
- `references/async-and-throttle.md` — the async job lifecycle, the required auto-split
  retry on subcode 1487534, and reading the throttle headers.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
