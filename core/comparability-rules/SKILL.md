---
name: comparability-rules
description: Use before comparing, summing, ranking or charting numbers from two different sources, two different platforms, two different time windows, or two different metric definitions — including "total conversions across channels", "why is GA4 lower than Meta", and any cross-platform spend or ROAS roll-up. Applies the comparison contract and the attribution-window comparison table, and returns cross-platform totals annotated with their overlap, direction of error and the route to a deduplicated figure rather than withholding them. Prevents a wrong number with a clean schema, which is more dangerous than four right numbers with four schemas.
---

# Comparability rules

A unified `conversions` column across four ad platforms is **a wrong number with
a clean schema**, which is strictly more dangerous than four right numbers with
four schemas, because it looks authoritative.

This skill does two things. It decides whether two numbers may be compared. And
when they may not but the user asked anyway, it produces the number with its
error named, because refusing teaches the user to go and add it up themselves
with no caveat at all.

## The comparison contract

Six dimensions must match before any comparison, sum, ranking or shared chart
axis.

| # | Dimension | Matched when |
|---|---|---|
| 1 | **Tenant / account** | the same accounts, properties or workspaces are in scope on both sides, with the same inclusions |
| 2 | **Exact date endpoints** | the same start and end instants, same inclusivity, **and the same date basis** |
| 3 | **Source medium** | the same channel taxonomy, and the same definition of what counts as paid, organic, direct or referral |
| 4 | **Event set** | the same events count as the metric. "Conversion" as three different event sets is three metrics |
| 5 | **Attribution model** | the same model and the same lookback window on both sides |
| 6 | **Timezone** | the same day boundaries, both `confirmed` rather than assumed |

If they do not match:

> **Three different totals are three different questions, not one broken
> number.**

Say that out loud rather than reconciling. An agent that iterates toward a match
between two legitimately different numbers burns the budget and ends with a
coincidence.

## Verdicts

| Verdict | Meaning | Output |
|---|---|---|
| `comparable` | all six match | compare normally |
| `comparable_after_normalisation` | a mismatch is removable by re-querying at a common basis | **both series, both labelled.** The normalised comparable series and the platform-default series |
| `not_comparable` | a mismatch is structural | the **annotated total**, naming which of the six mismatched |

`not_comparable` is not a refusal. It is a different answer shape.

## The cross-platform attribution table

The single most important table for cross-platform reporting. **The platforms do
not agree, and none of them will tell you they disagree.**

| | Default click window | Default view window | Attribution basis | Reported on |
|---|---|---|---|---|
| Google Ads | **30 days** (per conversion action, 1–90) | 1 day view-through; 3 days engaged-view | data-driven by default; **per conversion action** | **click date** — back-fills up to 90 days |
| Meta | **7 days** (API default `7d_click`; Ads Manager ad-set default 7d click + 1d view) | 1 day (`7d_view` and `28d_view` **removed 2026-01-12**) | ad-set setting; API now mirrors Ads Manager | impression/click date; settles over 28 days |
| LinkedIn | **30 days** (1/7/30 only) | **7 days** (1/7/30) | **`LAST_TOUCH_BY_CAMPAIGN` — counts once per campaign** | conversion event date |
| GA4 | 30-day acquisition lookback (30/90 paid&organic) | n/a — no view-throughs | data-driven by default | session/event date |

### The four consequences, as rules

**(a) A conversions column pulled from each platform into one spreadsheet is not
a comparable series.** Google's 30-day click against Meta's 7-day click alone
makes Google look better on considered purchases and Meta look better on impulse
purchases, independent of actual performance.

**(b) Date semantics differ before attribution even enters.** Google and Meta
credit the click or impression date; LinkedIn credits the conversion date; GA4
credits the session. **The same conversion lands on three different days in
three systems.** A daily chart of four platforms is four different calendars.

**(c) There is no date on which all four are simultaneously final except roughly
90 days back.** Meta restates for 28 days, Google back-fills for up to 90, GA4
reprocesses for 24 to 48 hours.

**(d) LinkedIn's default double-counts across campaigns, by design.**
`LAST_TOUCH_BY_CAMPAIGN` counts a conversion once *per campaign*, so a person
touched by three campaigns produces three conversions in a campaign-level
roll-up. The other three platforms do not do this. Summing LinkedIn campaign
rows to an account total overstates before any cross-platform overlap is
considered.

Two more that apply to all four: **timezones and currencies are per-account**, so
a multi-country roll-up needs explicit normalisation that no platform performs
for you.

## The annotated-total rule

**Summing platform-reported conversions and comparing to a CRM or GA4 total is
always wrong and always high.** The skill still produces the total, because the
user asked for it, and because refusing teaches them to compute it themselves
with no caveat at all.

It ships in a fixed six-part shape.

### (a) The number, prominently
Not buried under warnings. First line, plain.

### (b) The components, each labelled with how that platform counts
So the construction is visible and the user can see which component they
distrust.

### (c) The direction of the error, named
**"Overstates" is far more actionable than "may be inaccurate".** The magnitude
scales with audience overlap; **state that it is unquantified without a shared
key rather than inventing a percentage.** A made-up 20% is worse than an honest
"unquantified", because it will be treated as measured.

### (d) Each caveat in one plain sentence
Four apply to nearly every cross-platform conversion sum:

- **Duplication across platforms.** One person converting after seeing two
  platforms' ads is counted by both.
- **Three different definitions of "conversion".** Each platform counts a
  different event set, configured separately.
- **View-through inclusion differs by platform and window.** Google includes
  1-day view-through, Meta 1-day, LinkedIn 7-day, GA4 none.
- **Modelled conversions are included** in Google's data-driven attribution and
  in Meta's post-ATT reporting. Those are vendor estimates, not observations.

### (e) The better number and how to get it
Two routes, and they answer different questions:

- **Deduplicate at person or account level on a shared key in the warehouse**
  for a true unique count. This answers "how many actual conversions".
- **Run a holdout or geo experiment** for what was actually *caused* rather than
  claimed. This answers "what did the spend do".

### (f) When the rough number is fine
Trend checks, scale sanity, board slides where direction matters more than the
decimal. **Saying so builds the credibility the skill needs for the times it is
not fine.** An agent that flags everything equally gets ignored equally.

> If the pack does one thing well, it is making that sum **safe to use**, not
> making the user fight for it.

### Worked output

> **Total conversions across the four platforms: 8,412.**
>
> - Search platform 3,104, counted on click date with a 30-day click window, data-driven attribution.
> - Social platform 2,890, counted on impression date with a 7-day click window, includes modelled conversions.
> - Professional network 1,610, counted on conversion date with a 30-day click window, counted once per campaign so campaign rows double-count a person touched by several campaigns.
> - Web analytics 808, counted on session date, no view-throughs.
>
> **This overstates true unique conversions.** The four sets overlap by
> construction, and the overlap cannot be quantified without a shared key across
> platforms, so I am not putting a percentage on it.
>
> One person who converts after seeing two platforms' ads is counted twice.
> Each platform counts a different set of events as a conversion. View-through
> windows differ, so some of these are conversions no one clicked. Two of the
> four include vendor-modelled conversions, which are estimates.
>
> For a true unique count, join these to person or account records in the
> warehouse on a shared key and deduplicate. For what the spend actually caused
> rather than what the platforms claim, a holdout or geo test is the only honest
> route.
>
> For a trend check or a scale sanity check, this figure is fine as it stands.

## Normalisation, and always both series

Google, Meta and LinkedIn all support a 7-day click window. Where a mismatch is
removable, remove it **and keep both series**.

| Series | What it is | Label it as |
|---|---|---|
| **Normalised** | each platform re-queried at the common window, here 7-day click | "comparable series, 7-day click on all platforms" |
| **Platform default** | each platform at its own default | "what your Ads Manager shows" |

**Present both. Never silently pick one.** The normalised series is the honest
comparison; the platform-default series is the one the client sees in the
interface and will ask about. Showing only the normalised series means telling a
stakeholder their platform interface is wrong, which is both rude and losing.

What cannot be normalised by re-querying: the date basis (click date against
conversion date against session date), the event set, and LinkedIn's per-campaign
counting. Name those as residual and unresolved.

## Metric-name collision

**Two metrics with different denominators never share a chart axis or a sentence
without both denominators labelled.**

| Collision | Why it bites |
|---|---|
| Open rate: over sends against over delivered | delivered excludes bounces, so the rates differ by the bounce rate |
| Conversion rate: over sessions against over users against over clicks | three different populations, three different numbers |
| Win rate: over closed deals against over all deals against over qualified opportunities | see the four-denominator problem in win-loss analysis |
| ROAS: platform-reported against warehouse-computed | different attribution, different revenue definition |
| CTR: over impressions against over reach | reach is unique, impressions are not |

A custom in-house definition is **named distinctly** and stated as not
comparable to the vendor's same-named number. Calling your in-house metric "MQL"
when the platform also has an "MQL" guarantees the two will be charted together
within a month.

## Equal window is not equal coverage

Two 30-day windows are not comparable if one has 30 days of data and the other
has 22.

- **Compute and display covered-day counts on both sides of any before-and-after
  comparison.** A covered day is a day with at least one row from the source, not
  a day in the calendar range.
- Where coverage differs, use an **observed-day rate** (total / covered days) or
  suppress the comparison and say why.
- Common causes: a tracking gap, a pipeline outage, a campaign that started
  mid-window, an export filter that changed, a source that only retains 6 months
  at daily granularity.

**Export filter drift read as a trend** is the specific failure: the same saved
export with a changed filter produces a step change that looks like a business
event.

## Comparison endpoints are derived per row

**Never hardcode comparison endpoints.** A period-over-period comparison
computes each row's prior window from **that row's own event date**, not from a
literal date written into the query.

```
-- wrong: the boundary is frozen at authoring time
where event_date between '2026-08-01' and '2026-08-31'

-- right: the boundary is derived per row
where event_date between date_trunc('month', ref_date) - interval '1 month'
                     and date_trunc('month', ref_date) - interval '1 day'
```

A hardcoded endpoint is correct on the day it is written and silently wrong
every day after.

## Calls

- `provenance-block` is a **mandatory input**. Without provenance on both sides,
  the six dimensions cannot be checked and the verdict is `not_comparable` by
  default
- Feeds `answer-contract`, which renders the annotated total
- Called by every cross-platform analysis, reconciliation, paid-media and budget
  skill

## References

- `references/attribution-windows.md` — the full table, platform by platform, with the normalisation recipe
- `references/annotated-total-template.md` — the six-part template with three worked examples
