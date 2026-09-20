# The annotated-total template

## The template

```
(a) THE NUMBER
    <metric> across <n> <sources>: <figure>.
    First line. No preamble. No warning above it.

(b) THE COMPONENTS
    - <source 1>: <figure>, counted <how: date basis, window, model>
    - <source 2>: <figure>, counted <how>
    ...
    Each component labelled with how that source counts, so the construction
    is visible.

(c) THE DIRECTION OF THE ERROR
    This <overstates | understates> <what exactly>.
    <Why, in one clause.>
    The magnitude scales with <the driver>, and is unquantified without
    <the missing input>.
    Never invent a percentage.

(d) THE CAVEATS, ONE PLAIN SENTENCE EACH
    - <duplication>
    - <definition differences>
    - <inclusion differences>
    - <modelled components>
    No sentence longer than one line. No hedging words.

(e) THE BETTER NUMBER AND HOW TO GET IT
    For <the question this actually answers>: <route>.
    For <the causal question>: <route>.

(f) WHEN THE ROUGH NUMBER IS FINE
    For <named uses>, this figure is fine as it stands.
```

Part (f) is not politeness. An agent that flags every number equally gets
ignored equally, and then the flag that mattered is ignored too.

---

## Example 1: cross-platform conversions

> **Total conversions across the four platforms: 8,412.**
>
> - Search platform 3,104, counted on click date, 30-day click window, data-driven attribution.
> - Social platform 2,890, counted on impression date, 7-day click window, includes modelled conversions.
> - Professional network 1,610, counted on conversion date, 30-day click window, counted once per campaign.
> - Web analytics 808, counted on session date, no view-throughs.
>
> **This overstates true unique conversions.** The four populations overlap by
> construction. The magnitude scales with how much your audiences overlap and is
> unquantified without a shared key across platforms, so I am not putting a
> number on it.
>
> One person converting after seeing two platforms' ads is counted by both.
> Each platform counts a different event set as a conversion. View-through
> inclusion differs: three include it, the web analytics figure does not. Two of
> the four include vendor-modelled conversions, which are estimates rather than
> observations.
>
> For a true unique count, deduplicate at person or account level on a shared
> key in the warehouse. For what the spend actually caused rather than what the
> platforms claim, run a holdout or a geo test.
>
> For a trend check or a scale sanity check, this figure is fine as it stands.

## Example 2: blended ROAS across platforms

> **Blended ROAS last quarter: 3.4x.** That is total platform-reported revenue
> over total spend.
>
> - Search platform 2.9x on click-date revenue, 30-day window.
> - Social platform 4.6x, including modelled conversions and 1-day view-through.
> - Professional network 1.8x on conversion-date revenue.
>
> **The blended figure overstates return**, because revenue is double-counted
> where platforms claim the same purchase while spend is counted once. Spend is
> exact; revenue is not. The overlap is unquantified without order-level
> deduplication.
>
> Each platform claims a purchase it believes it caused, and more than one can
> claim the same one. Revenue definitions differ: one reports purchase value
> from the pixel, another reports a conversion value you configured. The 4.6x
> includes modelled conversions.
>
> The defensible version is MER, or media efficiency ratio: total spend over
> total **back-end** revenue from your own order system. That has no overlap
> problem because the denominator is counted once, and it is the number to
> manage against. Platform ROAS is still useful for relative within-platform
> comparison.
>
> For "are we roughly profitable at this spend level", the blended figure is
> fine. For "should we move budget between platforms", use MER plus an
> incrementality test.

## Example 3: a metric the sources define differently

> **Marketing-sourced pipeline last quarter: 4.2M by the CRM's campaign
> influence model, 6.8M by the marketing platform's own attribution.**
>
> Both are real. They are not two versions of one number.
>
> The CRM counts an opportunity as marketing-sourced when the primary campaign
> source is a marketing campaign, one campaign per opportunity. The marketing
> platform credits every campaign that touched any contact on the account within
> its lookback, so a single opportunity contributes to several campaigns and the
> total exceeds the opportunity value.
>
> **The marketing platform's figure overstates pipeline** and is a credit-share
> figure, not a pipeline figure. The CRM figure understates marketing's
> contribution by crediting only one campaign.
>
> The defensible version is a multi-touch model over an assembled journey with
> fractional credit summing to one per opportunity, which is what the attribution
> tier of this pack builds. Until that exists, report both and label them.
>
> For a board slide showing marketing's direction quarter on quarter, either
> figure works as long as you use the same one every quarter. For a budget
> reallocation between campaigns, neither is good enough on its own.

---

## Words to use and words to avoid

| Use | Avoid | Why |
|---|---|---|
| "overstates" / "understates" | "may be inaccurate" | direction is actionable; vagueness is not |
| "unquantified without a shared key" | "approximately 20% overlap" | an invented precision gets treated as measured |
| "counted once per campaign" | "attribution differences" | names the mechanism |
| "this figure is fine for X" | silence about fitness | silence reads as "never trust this" |
| "three different questions" | "the numbers don't reconcile" | reframes from defect to definition |

## When this template does not apply

The annotated total is for numbers that **can** be computed but are easy to
misread. It is not for numbers that cannot be computed. If there is no identity
resolution, the volume is below a privacy floor, or the source simply does not
hold the data, the correct output is a typed non-answer from `answer-contract`,
not an annotated guess.

The line is: can I compute this honestly from what I have? If yes, annotate and
ship. If no, type it and say what would unblock it.
