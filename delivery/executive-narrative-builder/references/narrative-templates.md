# Narrative templates

The five-part structure filled for the four situations that actually occur, plus
the lens dictionary for per-surface narration.

All figures below are illustrative.

---

## 1. The miss

The hardest one, and the one where the temptation to write adjectives instead of
arithmetic is strongest.

> **Q3 revenue was 4.23M against a 5.0M forecast — a 15.5% miss.**
>
> **Versus expectation.** The forecast was set on 1 July using weighted pipeline
> at stage-entry probabilities. Our forecasts have run 8% high on average across
> the last four quarters, so against a bias-adjusted 4.6M the miss is nearer 8%.
> Both numbers are in the table below; the raw miss is the one that matters for
> the plan, the adjusted one for judging the quarter.
>
> **Why.** Three drivers, summing exactly to the gap:
>
> - **Opportunity volume, −11.9 points.** 370 qualified opportunities against 420
>   forecast. The shortfall is concentrated in the first six weeks.
> - **Win rate, −4.4 points.** 22.8% against 24.0%. Every segment's win rate held
>   or improved — the blended decline is a mix shift, as the lower-converting
>   segment grew from 40% to 53% of closed opportunities.
> - **Deal size, +0.8 points.** 50.1K against 49.6K forecast.
>
> This is a top-of-funnel volume problem with a mix change on top, not a closing
> problem. The sales-execution read that the numbers *appear* to support is not
> supported once win rate is decomposed by segment.
>
> **What we are doing.** Top-of-funnel capacity review, concluding 10 Oct
> (demand generation lead). Segment-level pipeline coverage targets replacing the
> blended target, in place for Q4 planning (revops lead).
>
> **What we need.** A decision by 15 Oct on moving 180K from paid social to paid
> search for Q4, based on the cost-per-opportunity gap between them (marketing
> lead). No other asks this quarter.
>
> **What this does not claim.** The decomposition shows where the number went, not
> why. The comparison is uncontrolled before-and-after with no control group and
> no seasonality adjustment, so nothing here is a causal claim. Two of the twelve
> weeks sit inside the CRM's close-date edit window, so the actual will rise
> slightly; the drivers and their ranking will not change.

Four things that paragraph does that a weak version does not:

1. **Gives the bias-adjusted number** instead of leaving the reader to discover
   the forecast bias later. It is computable and it changes the reading.
2. **Corrects the obvious misreading** — the blended win rate — inside the driver
   section rather than in a footnote nobody reaches.
3. **Names the direction of the remaining error** on the actual.
4. **"No other asks this quarter"** is written. Silence in that section reads as
   an oversight.

---

## 2. The beat

Beats get less scrutiny than misses, which is precisely why they get narrated
badly. A beat nobody can explain is a forecast problem, not a win.

> **Q3 revenue was 5.4M against a 5.0M forecast, an 8% beat.**
>
> **Versus expectation.** Our fourth beat in six quarters against a process that
> averages 8% high — so this beat is larger than it looks relative to our own
> bias, and it is worth understanding rather than banking.
>
> **Why.** Two drivers:
>
> - **Deal size, +6.1 points.** Three deals above 200K closed in the quarter
>   against one in a typical quarter. **This is concentration, not a trend** — the
>   median deal size was flat.
> - **Win rate, +2.4 points.** Broad-based across segments, so more likely to
>   persist than the deal-size effect.
>
> **What we are doing.** Nothing differently on the basis of the deal-size effect;
> three deals is not a pattern. The win-rate improvement is being checked against
> stage-conversion data to see whether it is durable (revops lead, by 20 Oct).
>
> **What we need.** Nothing this quarter.
>
> **What this does not claim.** That the quarter is repeatable. Remove the three
> large deals and the quarter is a 1% beat.

**"Remove the outliers and this is a 1% beat" is the sentence that makes a beat
narrative useful.** It is computable, it changes next quarter's plan, and nobody
volunteers it.

---

## 3. The flat quarter

The hardest one to write well, because there is no event and the temptation is
either to manufacture a story or to write nothing.

> **Q3 revenue was 5.02M against a 5.0M forecast — on plan, within 0.4%.**
>
> **Versus expectation.** On plan at the total, but the composition changed:
> opportunity volume was 9% below forecast and deal size 10% above, and the two
> offset. **A flat total with offsetting drivers is not the same as a flat
> business**, and the volume shortfall carries into Q4's starting pipeline.
>
> **Why.** Volume −9.4 points, deal size +9.8 points, win rate flat.
>
> **What we are doing.** Treating the volume shortfall as the live issue despite
> the total landing on plan; top-of-funnel review as scheduled.
>
> **What we need.** Nothing this quarter.

**Offsetting drivers inside a flat total is the most under-reported situation in
GTM reporting.** The headline says nothing happened; the decomposition says two
things happened and cancelled, and one of them is a problem next quarter.

---

## 4. The weekly

Three to five sentences. Leading indicators only. Nobody reads more than this on a
Monday.

> **Pipeline created was 940K last week, 12% below the four-week same-weekday
> baseline.** The shortfall is one segment (−180K of the −128K net change; the
> rest of the business was up). The CRM extract is healthy and row counts are
> normal, so this is a business movement rather than a data issue. Meetings booked
> were flat, which suggests the gap is in qualification rather than in demand.
> Segment owner is reviewing before Thursday's pipeline call.

Note **−180K inside a −128K net change**. That is not an error, it is the point:
one segment fell further than the total, and the rest of the business partly
offset it. Saying only "pipeline down 128K" hides both halves.

---

## 5. The lens dictionary

For per-surface narration. **One generic prompt produces identical generic
commentary on every view**, and readers notice within two surfaces.

```yaml
lenses:
  pipeline_by_stage:
    focus: [stage conversion rates, stage ageing, volume entering the top stage]
    compare_to: same_weekday_4w
    decomposition: funnel_stage_contribution
    known_traps:
      - "time-in-stage is right-censored: open opportunities have not exited, so
         the average understates the true duration"
      - "a stage-definition change invalidates the whole trend"
    asks_shape: "which stage transition to work on next"

  paid_channel_detail:
    focus: [cost per opportunity, volume, platform-attributed vs warehouse figures]
    compare_to: prior_period
    decomposition: [spend, cpm, ctr, conversion_rate]
    known_traps:
      - "platform-attributed conversions overlap across platforms and overstate"
      - "the recent window sits inside the platform's settlement period"
      - "platform ROAS and blended MER are different metrics and are not comparable"
    asks_shape: "reallocate, hold, or test"

  cohort_retention:
    focus: [curve shape, horizon-matched comparison, the most recent complete cohort]
    compare_to: same_age_cohorts
    known_traps:
      - "a young cohort compared to a mature one at different horizons is the
         single most common cohort error"
      - "the most recent cohort is incomplete by construction"
    asks_shape: "which cohort's onboarding to change"

  account_health:
    focus: [engagement breadth across the buying group, trend not level, ownership]
    compare_to: prior_period
    known_traps:
      - "activity is a leading indicator, correlational at best — see sales-activity-analytics"
      - "an account with one engaged contact is a single point of failure, not a healthy account"
    asks_shape: "which accounts need coverage"

  _default:
    focus: [largest absolute change, direction versus baseline]
    compare_to: prior_period
    decomposition: additive_top_3
    known_traps: ["uncontrolled comparison, no causal claim"]
    asks_shape: "what to investigate next"
```

### Composing the narration request

```python
def narrate(surface: str, filtered_data, decomposition):
    lens = LENSES.get(surface, LENSES['_default'])
    return build_prompt(
        focus       = lens['focus'],
        comparison  = lens['compare_to'],
        data        = filtered_data,
        drivers     = decomposition,       # the arithmetic, already done
        must_state  = lens['known_traps'],
        close_with  = lens['asks_shape'],
    )
```

**Pass the decomposition, not the chart.** A narration given only a chart
describes the chart — "revenue rose then fell" — which the reader can already see.
A narration given the decomposition explains the business.

**`_default` is required.** An unmapped surface must narrate with a
generic-but-honest lens rather than producing nothing or inventing a focus the
view does not support.

**`known_traps` are stated in the output, not merely avoided.** The reader of a
cohort view needs to know the most recent cohort is incomplete, whether or not it
happens to look bad this week.

---

## 6. The phrase bank

Banned, and what to write instead. These are not style preferences; each left-hand
phrase hides a number that exists.

| Do not write | Write |
|---|---|
| "revenue was down" | "revenue was down 15.5%, of which 11.9 points is volume" |
| "driven by" (without a control) | "accounts for" / "coincided with" |
| "significant improvement" | the number and the comparison basis |
| "we saw strong performance in X" | "X contributed +N, the largest positive driver" |
| "due to market conditions" | the decomposition, or "unexplained: residual N after the named drivers" |
| "trending positively" | "up N% against the four-week baseline" |
| "we need more investment" | the amount, the source, the decision date, the owner |
| "data quality issues" | which source, which field, what effect on which number |
| "should improve next quarter" | the forecast, its interval, and the method |

**"Unexplained: residual N" is a legitimate and useful output.** It is far better
than a plausible-sounding cause, because it tells the reader exactly how much of
the movement nobody has accounted for yet — and that number is usually the most
interesting one on the page.
