# Meta attribution windows — what changed, and how to be comparable

Attribution is the top cause of Meta API-versus-Ads-Manager disputes, and the parameter
surface changed materially across 2025 and 2026. **Pre-2026 blog posts and Stack Overflow
answers about Meta attribution are actively misleading.** Work from this page.

## The timeline

| Date | Change |
|---|---|
| **2025-06-10** | `use_unified_attribution_setting` and `action_report_time` reportedly **ignored**; responses mirror Ads Manager |
| **2026-01-12** | **`7d_view` and `28d_view` removed entirely** |

**Any saved query, dashboard definition or inherited script carrying `7d_view` now fails or
silently returns nothing.** Audit for it before anything else when an inherited integration
"stopped working".

## Supported windows now

- `1d_click`
- `7d_click`
- `28d_click`
- `1d_engaged_view`
- `1d_view`

## The default mismatch

| Surface | Default |
|---|---|
| **API, with `action_attribution_windows` omitted** | **`7d_click`** |
| **Ads Manager, default ad-set setting** | **7-day click + 1-day view** |

These are different numbers for the same campaign, and neither is wrong.

**Always set `action_attribution_windows` explicitly, and print what you set in the
answer.** One line — "attributed on 7-day click plus 1-day view, matching the ad set's Ads
Manager setting" — prevents the entire dispute.

## Making an API figure comparable to Ads Manager

1. **Read the ad set's configured attribution setting** and mirror it in
   `action_attribution_windows`.
2. **Match the date range in the account's timezone**, not UTC. `time_increment=1` buckets
   in the advertiser's timezone.
3. **Match the level.** Account-level insights include spend from deleted campaigns;
   campaign-level sums do not. See the deleted-objects note below.
4. **Accept that the last 28 days are still moving.** Insights refresh every 15 minutes and
   settle at 28 days. A figure pulled today for last week will change.

If it still does not match after those four, stop. `cross-system-reconciliation` owns the
decision of when to stop, and the remaining gap is usually modelled conversions, which are
not reproducible by construction.

## Conversion time versus click time

**Conversions are reported by impression or click time by default, not conversion time.**

So a conversion that happened on the 10th, from a click on the 3rd, lands on **the 3rd**.

Two consequences worth stating to a client:

- **A Meta "yesterday" and a Google Ads "yesterday" measure different things** before
  attribution windows even differ. Cross-platform daily comparisons are not like-for-like.
- Combined with the 28-day settling window, **a day's reported conversions keep rising for
  four weeks after that day.**

## Breakdowns do not sum to totals

**Unique metrics are not additive.** A person reached on Facebook and on Instagram is:

- **1** under an unbroken `reach` query
- **2** when you sum `reach` across a `publisher_platform` breakdown

**Meta does not warn you.** Adding up a breakdown and presenting it as the total is a
common, real and embarrassing error.

**The rule: when you need a total, query the total. When you need a split, query the
split. Never derive one from the other.** And when presenting both in one table, say in
the caption that the rows do not sum to the total and why.

Non-unique metrics — `spend`, `impressions`, `clicks` — generally do sum, but even there
some breakdown combinations silently drop metrics (see below), so verify rather than
assume.

## Breakdown legality

**Not all breakdown combinations are legal. Some pairs are rejected outright; some silently
drop metrics.** There is **no `checkCompatibility` equivalent** the way GA4 has one.

Practical handling:

- validate that **every field you requested is present in every returned row**
- when a metric is absent from the rows but present in your `fields` list, that is a
  dropped metric, not zero
- budget for trial and error on unusual combinations rather than treating a rejection as a
  bug

## Deleted objects and the total that will not tie

**`effective_status` and `configured_status` carry `DELETED` and `ARCHIVED`.**

Deleted campaigns are **excluded from default list queries** but **their historical spend
still appears in account-level insights**. So:

> campaign-level sum ≠ account-level total, whenever anything was deleted

That is expected behaviour, not a data error. When the two disagree, check for deleted
objects before investigating anything else.

## Modelled conversions

Post-iOS-14 conversion modelling means some reported conversions are **estimates, not
deterministic counts**. They **change retroactively** and **cannot be reconciled to a CRM
row-for-row.**

**Say this before the client asks**, not after they have spent a week trying to match Meta
to Salesforce.
