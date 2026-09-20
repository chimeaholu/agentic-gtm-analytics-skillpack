---
name: funnel-conversion-analysis
description: Use for stage-to-stage conversion, funnel drop-off, lead-to-opportunity or MQL-to-close analysis, and for comparing funnel performance across segments, sources or time. Computes cohorted rather than snapshot conversion where stage history exists, marks incomplete cohorts rather than reading their truncation as a decline, and refuses rates on segments too small to support them. Prevents a snapshot funnel being presented as a conversion rate, which it is not.
---

# Funnel conversion analysis

Most funnel charts in production are not conversion rates. They are current
occupancy counts divided by each other, which answers "where is everything
sitting" and is then read as "how well do we convert". The two move in opposite
directions under the same event. This skill computes the right one, marks what
is not yet knowable, and decomposes movement before anyone narrates a cause.

## Cohorted and snapshot are different objects

| | Cohorted | Snapshot |
|---|---|---|
| **Question** | of the things that entered here, how many got there | where is everything sitting right now |
| **Grain** | entry cohort × stage | stage, as of an instant |
| **Denominator** | the entry cohort, fixed | current occupancy at the prior stage |
| **Needs** | stage history or snapshots with entry timestamps | the current-stage field |
| **Matures** | only after a full cycle has elapsed | immediately, and means something else |
| **Good for** | conversion, forecasting inputs, benchmarking | capacity, coverage, where the work is |

```
Cohorted conversion(A→B, cohort C) =
    members of cohort C that reached stage B within the conversion window
    ÷ members of cohort C

Snapshot ratio(A→B, date D) =
    records at stage B on date D
    ÷ records at stage A on date D
```

**They are never labelled the same way and never appear on the same axis.**

The cheap diagnostic: in a snapshot funnel the stage counts sum to the
population; in a cohort funnel they do not, because one record appears at every
stage it passed through.

**The failure this prevents, concretely.** A snapshot MQL→SQL ratio *rises*
when the MQL stage drains — top-of-funnel volume falls, or sales works through a
backlog — with no change whatever in conversion behaviour. Narrating that as
improved conversion is the most common funnel error there is.

## Cohorted conversion, properly specified

Four decisions, all of which change the number, all of which must be emitted:

1. **The entry event.** Entered the stage, or first reached it? Re-entries are
   common and the two differ. Default to *first entry* and say so.
2. **The conversion window.** "Reached stage B **within N days**" or "ever
   reached stage B". An unbounded window means the cohort never matures and
   every recent cohort is understated. Set N from the observed p75 or p90
   stage-pair duration, and state it.
3. **Skips count as conversion.** A deal that jumped A→C converted A→B for the
   purpose of the funnel, unless the org's definition says otherwise. Say which.
4. **Backwards moves.** A record that reached B and returned to A has converted
   A→B. Max-stage-reached, not current stage.

```
rate            = converted ÷ cohort size
cohort_size     = records entering stage A in the cohort period
grain           = cohort period × stage pair × segment
window          = N days from stage-A entry
maturity        = min(1, days since cohort close ÷ N)
```

## Stage transitions require stage history

The current-stage field cannot produce a transition. A record that skipped a
stage or moved backwards is invisible in it, and the arithmetic quietly assumes
a path that did not happen.

| Source | What exists | What breaks |
|---|---|---|
| Salesforce `OpportunityHistory` | stage changes with timestamps | only covers tracked fields, and tracking is typically enabled **after** the history you want; pre-enablement deals have no rows |
| Salesforce `OpportunityFieldHistory` | field-level changes | same enablement problem; retention policies apply |
| HubSpot `hs_v2_date_entered_<stage>` | date a deal entered each stage | **overwritten on re-entry** — a re-entered stage loses the earlier entry, so re-entry is undercounted and durations are wrong |
| HubSpot `hs_lifecyclestage_<stage>_date` | lifecycle-stage dates | same overwrite behaviour |
| `fact_lead_stage` / `fact_opportunity_snapshot` | full daily state | nothing, which is why `data-model-designer` treats snapshotting as non-optional |

Where none of these exist, the cohorted rate is `unavailable`. Say so, give the
snapshot ratio labelled as occupancy, and name daily snapshotting as the change
that resolves it.

## Incomplete cohorts are marked, never trimmed

The last few points on any cohort curve are short, not falling. A cohort whose
window has not elapsed has a rate that can only rise.

```
maturity(cohort) = min(1, (today − cohort_end_date) ÷ conversion_window_days)
```

- `maturity = 1` → the rate is final.
- `maturity < 1` → the rate is a **lower bound**, labelled as such per
  `answer-contract`, and excluded from any trend statement.
- **Never silently drop immature cohorts.** Dropping them hides the most recent
  data, which is what the reader came for. Show them, marked.

**The honest comparison across cohorts is at a common horizon.** Compare every
cohort at day 30, or day 60 — the largest horizon all cohorts have reached. A
day-30 comparison across six cohorts is a real trend; a terminal-rate
comparison across cohorts of different ages is a measurement of cohort age.

## Small-n refusal, with the threshold stated

A four-record cohort at 75% is three records.

- **State a minimum n and apply it to every cell.** A defensible default is 30
  for a reported rate and 100 before a rate difference is narrated as a change.
  Say which you used.
- **Refused cells are listed, not dropped.** "These 14 of 48 cells are below
  the minimum" is information; a table with holes and no explanation is not.
- **Where the audience wants the thin cell anyway, give it with an interval.**
  A Wilson score interval is the right one for proportions near 0 or 1, where
  the normal approximation produces bounds outside [0,1]:

```
Wilson centre = (p̂ + z²/2n) ÷ (1 + z²/n)
Wilson half-width = (z ÷ (1 + z²/n)) × √( p̂(1−p̂)/n + z²/4n² )
```

At n=4 and p̂=0.75, the 95% interval runs roughly 0.30 to 0.95. Show that
rather than the bare 75%, and the thin cell stops being a talking point.

## Decompose before you narrate

A blended rate moves for two reasons: the segments changed their rates, or the
mix of segments changed. **Mix shift looks exactly like a performance change.**

```
Δtotal = Σ_s (w_s1 · r_s1) − Σ_s (w_s0 · r_s0)

mix effect         = Σ_s (w_s1 − w_s0) · r_s0
rate effect        = Σ_s w_s0 · (r_s1 − r_s0)
interaction        = Σ_s (w_s1 − w_s0) · (r_s1 − r_s0)

Δtotal = mix effect + rate effect + interaction
```

where `w_s` is segment `s`'s share of the cohort and `r_s` its conversion rate.

- **Grain:** segment × two periods.
- Run it on source first, then segment, then rep or territory. Source mix is
  the usual culprit: paid-list and content-syndication inquiries convert at a
  fraction of inbound, so a blended Inquiry→MQL rate moves when procurement
  buys a list, not when anything improved.
- **Report all three terms.** A large interaction term means the segments
  moved unevenly and the summary rate is a poor description of what happened.

## Definition drift is marked on the timeline

MQL has no industry-standard definition; it is a threshold on a scoring rule the
org wrote, and the rule gets retuned. A trendline crossing a definition change
is not a trend.

- Establish the change dates before charting: scoring-model edits, stage
  renames, lifecycle-stage rule changes, routing changes.
- **Mark the date on the output** and refuse period-over-period comparisons that
  straddle it unless the rate is recomputed under one definition on both sides.
- The signature of a gamed threshold: **rising MQL count with a falling
  MQL→SQL rate.** Report count and downstream rate together or not at all.

## Missing stages are reported as missing

SAL (sales accepted lead) is frequently not instrumented at all. Without it,
MQL→SQL blends two opposite problems: leads sales worked and rejected, and
leads sales never touched. They have opposite fixes — lead quality versus
routing and follow-up — and a single blended rate averages them into an
uninterpretable number.

**Say this as a finding** rather than computing around it. The computable proxy,
with its bias named: leads with zero logged sales activity are a **floor** on
untouched, understated by however much activity capture misses
(`sales-activity-analytics` has the capture-rate caveat).

## Answering

> **Inquiry→MQL converted at 11.4% for the July cohort, down from 14.1% in
> April.**
>
> Both cohorts are mature — the window is 45 days, which is the p75 for this
> transition. The drop is almost entirely mix: paid-list inquiries went from 18%
> to 34% of the cohort, and they convert at 4% against inbound's 19%. Decomposed,
> mix accounts for −2.4 points and within-segment rate change for −0.3.
>
> So inbound performance is flat and the blended number fell because we bought a
> list. For a board slide the blended figure is fine with one line of context;
> for deciding whether to change the scoring model, use the inbound-only series,
> which has not moved.
>
> The two most recent cohorts are 21 and 6 days old, so their rates are lower
> bounds and are shown greyed. The MQL scoring rule changed on 14 March, so
> nothing before that date is comparable to anything after it without recomputing.

## Honest limits

- **No stage history: no cohorted rate.** The snapshot ratio is computable and
  is offered, labelled as occupancy.
- **A cohort that has not matured has a lower bound, not a rate.** It is always
  reported as a lower bound and never used in a trend claim.
- **A blended rate crossing a definition change is not comparable to itself.**
- **Refused cells are named.** Below the stated minimum n, the rate is not
  reported as a point estimate; an interval is offered instead.
- **Conversion is not causation.** Segments differ in more than the thing being
  compared, and no uncontrolled funnel comparison isolates a cause.

## Core contracts this skill calls

- `answer-contract` — `lower_bound` for immature cohorts, `unavailable` where
  stage history is absent, and the numerator/denominator statement on every rate
- `provenance-block` — window, timezone (stage timestamps are bucketed in the
  source's timezone, which for Salesforce reports is the **running user's**),
  and the metric version behind each stage definition
- `comparability-rules` — before comparing funnels across sources, segments or
  a definition-change boundary
- `warning-field-reader` — Salesforce `allData` on report-sourced funnel counts,
  HubSpot archived records that search never returns
- `pagination-patterns` — full-cohort extraction needs the bulk path; a
  2,000-row report cap silently truncates a cohort and biases every rate
- `rate-limit-governor` — cohort × stage × segment grids multiply queries fast

## References

- `references/cohort-construction.md` — entry rules, window selection, maturity
  marking, and the per-platform stage-history field register
- `references/decomposition.md` — the mix/rate/interaction decomposition worked
  end to end, plus small-n intervals and the refusal rule

## Related skills

- `funnel-model-designer` for the stage model, unit of analysis and stage
  definitions this skill consumes
- `gtm-metric-dictionary` for what each stage means and the ten pre-flight checks
- `data-model-designer` for `fact_lead_stage` and `fact_opportunity_snapshot`
- `win-loss-analysis` for the terminal stage, where the denominator question
  gets harder
- `pipeline-forecast` consumes these cohorted rates
