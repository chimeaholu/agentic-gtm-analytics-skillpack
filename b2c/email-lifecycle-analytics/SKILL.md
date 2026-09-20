---
name: email-lifecycle-analytics
description: Use for email, SMS and lifecycle messaging analysis — campaign and flow performance, deliverability, list health, engagement trends, or comparing messaging platforms. Defaults to click- and conversion-based metrics because Apple Mail Privacy Protection has made open tracking unreliable industry-wide, states the conversion definition explicitly because on some platforms it silently redefines every revenue figure, and never mixes the two attribution bases some platforms return side by side. Prevents ranking campaigns by open rate, which is ranking by noise.
---

# Email and lifecycle analytics

**Ranking campaigns by open rate is ranking by noise.** Apple Mail Privacy
Protection and similar proxies pre-fetch images, so a large and unknowable share
of recorded opens are machines. The vendors say so themselves: Klaviyo's own
guidance has moved toward click and conversion metrics, and MCAE `opens` can
legitimately read 0 while `totalClicks` is large.

Default to **click rate and conversion metrics**, and say why. Present opens if
asked — withholding a computable number sends people to the platform UI where
they will read it with no caveat at all — but never rank on them and never
divide by them.

## The metrics, with denominators that are not interchangeable

```
Delivery rate     = delivered ÷ sent
Open rate         = unique opens ÷ delivered          ← noise-dominated post-MPP
Click rate (CTR)  = unique clicks ÷ delivered
Click-to-open     = unique clicks ÷ unique opens      ← divides by the noisy term
Conversion rate   = conversions ÷ delivered
Revenue per recipient = attributed revenue ÷ delivered
Unsubscribe rate  = unsubscribes ÷ delivered
Spam complaint rate = complaints ÷ delivered
Bounce rate       = bounces ÷ sent                    ← sent, not delivered
```

- **Grain:** message × recipient, aggregated to campaign or flow.
- **Delivered is the industry-standard denominator** for engagement and the one
  platform UIs use. Bounces belong in the sent denominator, not the delivered
  one — a bounce cannot be opened.
- **Click-to-open divides by a term that is largely machine traffic.** State
  what it measures, or do not report it. It is not a measure of creative
  effectiveness post-MPP.
- **Unique versus gross is a platform-level difference that cannot be
  reconciled.** Marketo's UI de-duplicates opens and clicks per person and
  applies undocumented bot filtering; API-derived sums from Bulk Activity
  Extract are therefore **gross** and systematically higher. **Present
  API-derived metrics as independently computed** and say they will not match
  the UI. A skillpack promising "the same numbers as the Marketo report" is
  promising something that cannot be delivered.

## The conversion definition is an input, not a constant

**Klaviyo's `conversion_metric_id` is a required input that silently redefines
every revenue and conversion number in the response.** It is not a filter — it
is the definition of "converted" for that report. Point it at Placed Order and
you get order-attributed revenue; point it at Checkout Started and you get a
completely different, equally valid-looking set of numbers, with nothing in the
response to explain the discrepancy.

**Always resolve the metric ID explicitly, log which one you used, and print it
in the output.** Two agents reporting on the same campaign with different IDs
will produce contradictory revenue figures and both will look correct.

A second Klaviyo consequence: **revenue attribution is governed by the
account's attribution settings, which are retroactive.** Change the attribution
window and every historical report changes. Numbers published last month will
not reproduce. **Snapshot report outputs where reproducibility matters.**

## Never mix two attribution bases in one table

**Braze `/sends/data_series` returns both**:

- `conversions` — attributed to the day the conversion **happened**
- `conversions_by_send_time` — attributed to the day the message was **sent**

Summing the wrong one across a date range, or mixing the two in one table,
produces numbers that match neither the dashboard nor reality. **Pick one, state
it, never mix.** For campaign performance, send-time basis is usually what people
mean; for revenue reporting by period, conversion-date is. Say which.

## Sends are not people

Journey and flow delivery statistics count **sends**. A 2-email journey to 50
contacts reports up to 100 processed.

**Any translation of journey stats into reach without dividing by emails per
journey overstates it, potentially by a large multiple.** Where the platform
exposes distinct recipients, use that; where it does not, state that the figure
is sends and give the emails-per-journey count so the reader can divide.

The same rule governs sequence and flow rate denominators: **rates are per
distinct recipient entering**, not per send. Dividing replies or conversions by
sends penalises longer flows mechanically.

## Bot traffic is flagged, not removed

Where an `is_bot`-style field exists on open, click and unsubscribe events,
**filter on it explicitly and say that you did.** Unfiltered, engagement rates
are inflated by automated scanners — security appliances that click every link
in every message, which produces a 100% click rate on a handful of recipients
and a visible lift on aggregate CTR.

Where no such field exists, the honest statement is that bot traffic is present,
unquantified, and inflates opens more than clicks.

## Flows, journeys and the delay-step trap

**Journeys with a leading delay step of 1+ days show zero processed for the most
recent cohorts.** This is documented behaviour and it looks exactly like a
broken journey to an agent reading numbers cold. **Check for a leading delay
before reporting "this flow isn't sending."**

**"Completed" is not "Exited."** Completed means the contact finished all steps;
exited means they met exit criteria and left early — which, for a flow whose
exit criterion is "purchased", is the success state. **Do not sum them, and do
not read exited as failure.**

Flow versus campaign comparison needs one more caution: flows are triggered and
campaigns are broadcast, so their audiences differ systematically. A flow's
higher conversion rate is partly selection — the recipient did something to
trigger it. Say so rather than concluding flows outperform campaigns.

## State the window explicitly, always

**Report timeframe defaults are often short** — a one-month default where the
human meant lifetime. Klaviyo `timeframe` accepts a key (`last_30_days`,
`last_12_months`) or explicit ISO-8601 `start`/`end`; Braze `data_series` takes
a `length` capped at **1–100 days per call** with no cursor, so a year needs
chunking and stitching, and `ending_at` is inclusive.

**Put the window in the query and in the answer.** A flow's lifetime revenue
and its last-30-days revenue differ by an order of magnitude, and the default is
whichever the platform chose.

## Timezone and currency

| Platform | Behaviour |
|---|---|
| **Klaviyo** | reports run in the **account's** configured timezone; only `metric-aggregates` accepts an explicit `timezone`. `last_30_days`-style keys evaluate against account-local midnight, so UTC math around boundaries mis-buckets the first and last days |
| **Braze** | `data_series` days bucket in the **workspace's** timezone; `ending_at` accepts an ISO-8601 datetime **with offset**, and passing a naive UTC timestamp silently shifts every bucket. Multi-workspace orgs with different timezones cannot naively sum |
| **Braze revenue** | documented as **USD**. Braze has already converted using its own rates and the original amounts are not recoverable from this endpoint — only Currents or raw purchase events carry native currency |
| **MCAE / Pardot** | **export timestamps are frozen to the timezone of whichever user created the export, at the moment they created it.** Two users exporting the same data get differently-offset timestamps, and a user relocating changes the meaning of all their future exports. Pin one dedicated export identity and record its timezone with the data |
| **Marketo** | the **instance** has one configured timezone governing report boundaries, while REST responses are ISO-8601 UTC. Day-boundary aggregations in UTC will not match anything a marketer sees |

## Deliverability and list health

A campaign-level table hides the thing that kills a programme.

```
Hard bounce rate    = hard bounces ÷ sent       ← invalid addresses; must trend to near zero
Soft bounce rate    = soft bounces ÷ sent       ← transient; a sustained rise is a reputation signal
Spam complaint rate = complaints ÷ delivered    ← the metric mailbox providers act on
Unsubscribe rate    = unsubscribes ÷ delivered
List growth rate    = (adds − unsubscribes − bounces − suppressions) ÷ list size
Engaged share       = recipients with ≥1 click in N days ÷ list size
```

- **Split hard from soft bounces.** They have different causes and different
  fixes, and a blended bounce rate hides a list-hygiene problem inside a
  transient one.
- **The list-growth view is what a campaign table hides.** A programme with
  healthy campaign metrics and a shrinking engaged base is on a timer.
- **Engaged share over time is the leading indicator** for deliverability
  decline, ahead of bounce and complaint rates moving.

## Answering

> **Ranked by click rate, the top three campaigns last quarter were the
> restock alert at 4.8%, the loyalty reminder at 3.9% and the seasonal edit at
> 3.1%.**
>
> Open rates are reported in the table but are not used for ranking: post-MPP a
> large and unmeasurable share of opens are machine pre-fetches, and the
> platform's own guidance has moved to click and conversion metrics. Click-to-
> open is omitted for the same reason — it divides by the noisy term.
>
> Revenue figures use the Placed Order conversion metric, printed here because
> the platform's conversion metric is an input that redefines every revenue
> number: the same campaigns under Checkout Started would show roughly double
> and look equally valid.
>
> Two things to flag. Bot events are filtered where the flag exists, which
> lowered aggregate CTR by about 0.3 points — that difference is the scanners.
> And the welcome flow reads zero processed for the last four days, which is the
> leading 48-hour delay step, not a broken flow.
>
> The list-health view matters more than the ranking: the engaged base has
> fallen 11% over the quarter while list size grew, which is the pattern that
> precedes deliverability problems.
>
> Does not claim causality: nothing here was held out, and the top campaigns
> went to self-selected audiences.

## Honest limits

- **Open-derived metrics are not reliable post-MPP**, and the magnitude of the
  distortion is unquantified. They are reported, labelled, never ranked on.
- **API-derived aggregates will not match the platform UI** where the UI
  de-duplicates and bot-filters with undocumented logic. Present them as
  independently computed.
- **Klaviyo revenue figures are not reproducible across an attribution-setting
  change.** Snapshot what must be reproduced.
- **Blank results are a known failure mode.** Klaviyo values-report endpoints
  return a well-formed empty response when the filter matches nothing, the
  conversion metric does not apply, or the timeframe predates the campaign.
  **Validate that the campaign or flow IDs exist before concluding performance
  was zero.**
- **Iterable's experiment metrics cover email experiments only** — push, SMS and
  in-app A/B tests have no metrics endpoint, so multichannel experiment
  reporting is incomplete and should be said to be.
- **No uncontrolled email comparison is causal.** Triggered flows reach
  self-selected audiences.

## Core contracts this skill calls

- `answer-contract` — the conversion definition printed with every revenue
  figure, `unavailable` where a metric is open-derived and the question needs
  reliability, `no_data` distinguished from a blank filter result
- `provenance-block` — per-platform timezone and currency (Braze's USD
  conversion, MCAE's frozen export timezone), the attribution basis, and the
  freshness of a still-running flow
- `comparability-rules` — before any cross-platform messaging comparison, and
  before API-derived aggregates sit beside UI figures
- `warning-field-reader` — Klaviyo's blank-but-well-formed responses, 403 for
  scope versus 401 for credentials, bot flags where present
- `pagination-patterns` — Braze's 100-day `length` cap with no cursor, Iterable's
  progressive export file lists and 10 MB per file, Klaviyo's cursor paging and
  the absence of any bulk export path
- `rate-limit-governor` — **the binding constraint in this domain**: Klaviyo's
  campaign values report at roughly 2 requests/minute and 225/day, Iterable's
  campaign metrics at 10/minute per project, Marketo's shared
  100-calls-per-20-seconds instance limit. One wide grouped query, cached for
  hours, never a per-campaign loop

## References

- `references/platform-register.md` — per-platform endpoints, fields, limits and
  silent failures
- `references/metrics-and-deliverability.md` — every metric with denominator and
  miscomputation, plus the list-health view

## Related skills

- `gtm-metric-dictionary` for the conversion and revenue definitions this joins to
- `comparability-rules` before any cross-platform roll-up
- `cohort-and-ltv` for the customer-level value behind attributed revenue
- `rfm-and-value-segmentation` for the segments these programmes target
- `ecommerce-analytics` for the order data the conversion metric points at
