---
name: paid-media-analytics
description: Use for paid media performance analysis across Google, Meta, LinkedIn and other ad platforms — spend efficiency, ROAS, MER, blended CAC, creative and campaign performance, or explaining why platform-reported numbers exceed actual revenue. Presents platform-reported and blended series side by side, computes break-even MER from contribution margin, and refuses to sum conversions across platforms without an explicit acknowledgement, because every platform independently claims the same conversion. Prevents channel ROAS that adds up to 130–160% of the revenue that actually happened.
---

# Paid media analytics

Three series, and the gap between them is the analysis:

| Series | What it is | Who computed it |
|---|---|---|
| **Platform-reported** | each platform's own attributed conversions and value | the platform that sold you the ads |
| **Blended** | your own revenue over your own total spend | your books |
| **Incremental** | the revenue that would not have happened otherwise | an experiment, or nothing |

**Only the third answers "did the ads work".** The first two are useful and
computable; the third requires a holdout and usually has not been run. Say which
one every number is.

## Call `comparability-rules` before any cross-platform roll-up

Non-negotiable. A cross-platform sum, ranking or comparison crosses a source
boundary, and the platforms disagree on every dimension that matters:

| | Default click window | Default view window | Attribution basis | Reported on |
|---|---|---|---|---|
| **Google Ads** | **30 days** (per conversion action, 1–90 configurable) | 1 day view-through; 3 days engaged-view | data-driven by default on eligible accounts; **per conversion action** | **click date** — conversions back-fill for up to 90 days |
| **Meta** | **7 days** (API default `7d_click`; Ads Manager ad-set default 7d click + 1d view) | 1 day (**`7d_view` and `28d_view` removed 2026-01-12**) | ad-set level setting; the API now mirrors Ads Manager | impression/click date; **settles over 28 days** |
| **LinkedIn** | **30 days** (1/7/30 only) | **7 days** (1/7/30) | **`LAST_TOUCH_BY_CAMPAIGN` by default — counts once per campaign** | conversion event date |
| **GA4** | 30-day acquisition lookback default (30/90 for paid and organic) | none — GA4 does not count view-throughs | data-driven by default; last-click available | session/event date |

Four consequences to carry into every output:

1. **A conversions column pasted from each platform into one sheet is not a
   comparable series.** Google's 30-day click against Meta's 7-day alone makes
   Google look better on considered purchases and Meta better on impulse ones,
   independent of performance.
2. **Date semantics differ before attribution enters.** Google and Meta credit
   the click or impression date; LinkedIn credits the conversion date; GA4
   credits the session. The same conversion lands on three different days.
3. **None of the four is stable historically.** Meta restates for 28 days,
   Google back-fills for up to 90, GA4 reprocesses for 24–48 hours. **There is
   no date on which all four are simultaneously final except roughly 90 days
   back.**
4. **LinkedIn's default double-counts across campaigns by design.**
   `LAST_TOUCH_BY_CAMPAIGN` credits one conversion to *every* campaign it can be
   attributed to; `LAST_TOUCH_BY_CONVERSION` counts it once. This is the single
   biggest reason LinkedIn totals look inflated beside Google and Meta.

**Normalise and show both series.** Re-query each platform at a common window
where one exists — 7-day click is available on Google, Meta and LinkedIn — label
that the comparable series, and keep the platform-default numbers as the "what
your Ads Manager shows" series. **Never silently pick one.**

## Platform ROAS is the platform grading its own homework

```
Platform ROAS = platform-attributed conversion value ÷ platform spend
```

Four independent inflations:

1. **View-through credit.** An impression nobody clicked counts.
2. **Each platform independently claims the same conversion.** Sums of channel
   ROAS routinely "explain" 130–160% of actual revenue.
3. **Modelled conversions.** Post-ATT, Meta models a material share; Google's
   data-driven attribution is a vendor model. These are **modelled, not
   measured**, and must be labelled at the point of display.
4. **It uses revenue, not margin.** At a 15% contribution margin, a 6× ROAS is
   loss-making.

**Do not refuse the cross-platform sum.** Compute it and annotate it:

> These sum to X, which overstates by an unknown amount because each platform
> claims overlapping conversions on different windows. The blended MER below is
> the number that reconciles to your books.

**Store platform figures as `platform_reported_conversions`, in a column
distinct from warehouse-measured conversions.** They are not additive across
platforms and must never be silently merged into one column.

## MER is the honest counterweight

```
MER            = total revenue ÷ total marketing spend
Break-even MER = 1 ÷ contribution margin
aMER           = new-customer revenue ÷ total marketing spend
Blended new-customer CAC = total marketing spend ÷ new customers
```

| Contribution margin | Break-even MER |
|---|---|
| 50% | 2.0 |
| 40% | 2.5 |
| 30% | 3.33 |
| 25% | 4.0 |
| 20% | 5.0 |

- **Grain:** business × period. There is no channel grain, by construction.
- **Denominator:** total marketing spend, including agency fees, tooling and
  creative production if you want it to mean anything.
- **A "good MER" benchmark quoted without the brand's own contribution margin is
  meaningless.**
- **State the CM level** the break-even came from — CM2 stops before ad spend,
  CM3 includes it, and using CM3 in `1 ÷ CM` double-counts the spend
  (`ecommerce-analytics`).
- **MER is a guardrail, not a router.** It tells you whether total spend is
  sustainable; it cannot tell you which channel to cut. Anyone using MER to
  reallocate budget is using a thermometer as a map.
- **aMER uses *new* customers.** Total spend ÷ all orders flatters repeat-heavy
  brands by charging retention revenue against acquisition spend, and it
  improves automatically as the base ages.

## Ad data is restated — re-pull a trailing window

Yesterday's numbers change for days or weeks.

| Platform | Settling behaviour | Trailing window to re-pull |
|---|---|---|
| Meta | "Insights refresh every 15 minutes and do not change after 28 days" | 28 days |
| Google Ads | most metrics settle ~3 hours; conversions back-fill to the click date for up to 90 days | 28 days minimum; 90 for conversion-heavy analysis |
| LinkedIn | performance near-real-time; demographics delayed 12–24h; video watch time up to 48h | 7 days, longer if demographics are used |
| GA4 | 24–48h for full processing on standard properties | 7 days |

**Never treat ad data as immutable, and never cache a figure you will later
compare to a fresh pull.** A month-over-month comparison where one month was
pulled in-flight and the other after settling is a comparison of settling, not
performance.

## Six platform-specific traps that produce confident wrong numbers

1. **Currency and timezone are per-account, not per-report.** Google Ads returns
   cost in micros in **each account's own currency** with no conversion — read
   `customer.currency_code` and `customer.time_zone` every time. Meta exposes
   `account_currency` and buckets `time_increment=1` days in the advertiser's
   timezone. LinkedIn returns `costInLocalCurrency` **while its revenue
   attribution fields are USD** (`revenueWonInUsd`, `opportunityAmountInUsd`) —
   **one response, two currencies**; do not divide one by the other.
2. **Breakdown combinations do not sum to totals.** Unique metrics — reach,
   unique clicks — are **not additive across breakdowns**: a person seen on two
   placements is 1 reach in total and 1+1 in a `publisher_platform` breakdown.
   Google Ads segmentation can also produce rows that do not sum to the
   unsegmented total because some conversions cannot be attributed to a segment.
   **Neither platform warns you.**
3. **Removed and deleted objects behave differently from the UI.** Google Ads
   returns `status = 'REMOVED'` entities forever unless filtered — the usual
   cause of "the API says 400 campaigns, the UI says 50". Meta excludes deleted
   campaigns from list queries **while their historical spend remains in
   account-level insights**, so campaign-level sums will not match account
   totals.
4. **Zero-impression rows are omitted by default** in Google Ads. A campaign
   missing from a report usually had no impressions, not no existence.
5. **LinkedIn will silently under-return.** Omit `fields` and you get only
   `impressions` and `clicks` — a plausible-looking, near-empty response rather
   than an error. Maximum 20 metrics per request, **no pagination on
   `adAnalytics`**, a 15,000-element response cap, and with `timeGranularity=ALL`
   outside the 6-month daily-data window, **dates are silently rounded to month
   boundaries and the whole month is included**. A query for 15 Jan–15 Jul
   returns 1 Jan–31 Jul without telling you.
6. **Empty is not zero.** A LinkedIn empty `elements` array means either no
   activity **or no read access**, and the two are indistinguishable in the
   response. Verify account access before reporting "no spend"
   (`warning-field-reader`).

## Campaign-key normalisation is mandatory

Campaign naming is the de-facto join key between ad platforms and UTMs, and it
is almost always inconsistent: case, separators, abbreviations, trailing IDs,
and a rename mid-flight that breaks the key for half the period.

- **Normalise before joining**: lowercase, strip punctuation, extract the stable
  ID where one exists in the name, and keep the raw string alongside.
- **Report the unmatched spend and the unmatched sessions**, in currency and in
  count. Unmatched spend is the direct measure of how much of the analysis is
  guesswork.
- **Prefer real IDs over names** wherever the platform exposes one in the URL
  parameters — a campaign ID survives a rename and a name does not.

## CPA improvements often reflect audience shift

A bid or budget change moves the auction the platform enters, and cheaper
audiences are usually cheaper for a reason. Before narrating an efficiency win:

- Check **impression mix by placement, device, geo and audience** across the two
  periods.
- Check **new-versus-returning customer share** of the conversions.
- **Decompose** with the mix/rate arithmetic from `funnel-conversion-analysis`.

A CPA fall driven entirely by a shift toward retargeting or branded search is a
mix change, not an efficiency gain, and it will not scale.

## Answering

> **Blended MER was 3.1 last month on 412K of spend, against a break-even MER
> of 2.5 at your 40% CM2 margin. The business is buying profitably at this spend
> level.**
>
> Platform-reported ROAS across the three channels sums to 4.4, which would
> imply 1.81M of revenue against the 1.28M your books recorded — about 141% of
> actual. That is expected, not a defect: each platform claims overlapping
> conversions on different windows, and Meta's figure includes modelled
> conversions. Use the per-platform numbers to compare a channel to itself over
> time; use MER for the total.
>
> On the normalised series — all three re-queried at 7-day click — Google's
> relative advantage over Meta narrows from 1.9× to 1.3×, so most of the
> apparent gap was the 30-day window rather than performance.
>
> The LinkedIn conversion total is inflated by design: the account uses the
> default last-touch-by-campaign setting, which counts one conversion once per
> campaign. Across 11 campaigns that is a real multiple, and it should be
> re-queried under the single-campaign setting before any comparison.
>
> aMER on new customers only is 1.9, against the 3.1 blended — about 40% of
> revenue is repeat, so the blended figure is partly retention being charged to
> acquisition spend.
>
> None of this is incremental. No holdout ran, so this is revenue alongside
> spend, not revenue caused by it. If the budget decision is material, a
> geo-holdout on one channel for four weeks would settle it.

## Honest limits

- **Platform-reported conversions are not additive across platforms**, and the
  overlap magnitude is unquantified without a shared identity key.
- **Modelled conversions are estimates**, labelled at display, and cannot be
  reconciled to a CRM row for row.
- **No uncontrolled paid-media read is incremental**, however the series are
  arranged. Only an experiment produces that number.
- **Unmatched spend bounds the channel-level analysis.** Report it.
- **A trailing window not re-pulled makes every recent figure provisional.**
- **Search-term level spend will not sum to campaign spend** — low-volume
  queries are privacy-thresholded and withheld by design, and the gap has
  widened over time.

## Core contracts this skill calls

- `comparability-rules` — **hard dependency**, called before any cross-platform
  sum, ranking or comparison; supplies the annotated-total format
- `provenance-block` — per-platform window, attribution basis, date basis,
  currency, timezone and freshness, emitted automatically, plus the
  measured-versus-modelled label
- `answer-contract` — the annotated total rather than a refusal, `partial` when
  a platform leg fails, `lower_bound` where a 15,000-element cap is hit
- `warning-field-reader` — LinkedIn's ambiguous empty `elements`, Meta's
  `x-fb-ads-insights-throttle`, GA4 sampling and thresholding
- `pagination-patterns` — `adAnalytics` has **no pagination** and caps at 15,000
  elements; Meta's async `AdReportRun` is the bulk path; Google Ads
  `SearchStream` with free pagination
- `rate-limit-governor` — Meta's utilisation-based throttle header, LinkedIn's
  45M-metric-values-per-5-minutes volume limit, Google Ads operation quotas

## References

- `references/platform-register.md` — per-platform fields, windows, caps,
  settling behaviour and silent-failure modes
- `references/blended-vs-incremental.md` — the three series, MER and break-even
  arithmetic, and the experiment designs that produce an incremental number

## Related skills

- `comparability-rules` runs before this skill produces any cross-platform figure
- `gtm-metric-dictionary` §6 for ROAS, MER, aMER and contribution margin
- `ecommerce-analytics` for the revenue and margin denominators
- `cohort-and-ltv` for the LTV side of a payback decision
- `incrementality-testing` and `media-mix-modelling` for the causal question
- `budget-allocation` consumes this skill's output
