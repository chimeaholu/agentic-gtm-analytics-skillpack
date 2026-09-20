---
name: win-loss-analysis
description: Use for win rate, loss reason, competitive win/loss, or "why are we losing" analysis. Computes win rate across all four defensible denominators and states which one the answer uses, handles closed-no-decision explicitly rather than bucketing it as a loss, and separates loss reasons captured by reps from loss patterns visible in the data. Prevents a close-date win rate — the CRM default and the most biased version — being presented as the win rate.
---

# Win/loss analysis

"Win rate" names four different numbers. They are all defensible, they differ
materially on the same data, and the CRM reports the most biased one by default.
This skill computes them side by side, says which it is using, and separates
what reps *said* about losses from what the data *shows* about them.

## The four denominators

```
(a) Close-date        = Won ÷ (Won + Lost), both closed in the period
(b) Created-cohort    = Won ÷ all opportunities created in the cohort
(c) Including no-dec  = Won ÷ (Won + Lost + Closed-No-Decision)
(d) Dollar-weighted   = any of the above, summing Amount rather than counting
```

| | Grain | Denominator | Property |
|---|---|---|---|
| **(a)** | opportunity, by `CloseDate` | deals that closed in the window | **CRM default and the most biased.** Long deals land in later periods, so a quarter's win rate is partly an artefact of *what closed*, not what was sold. A quarter with an unusual mix of fast small deals reads as a win-rate move. |
| **(b)** | opportunity, by `CreatedDate` | everything created in the cohort | **The honest one.** Needs a full sales cycle to elapse; before that it is a lower bound that can only rise. |
| **(c)** | opportunity, by close or cohort | wins + losses + no-decisions | The true "we got the deal" rate. Requires a no-decision value to exist. |
| **(d)** | opportunity, amount-summed | as above, in currency | Differs from count-weighted whenever deal size correlates with win probability, which it usually does. |

**Compute all that the data supports, lead with one, and name it.** The spread
between (a) and (b) on the same data is itself a finding: a large gap means the
close-date figure is being driven by cycle-length mix rather than by selling.

**Cohort maturity governs (b).** With a 120-day median cycle, a cohort created
90 days ago has a win rate that can only rise. Label it a lower bound, show the
open share, and compare cohorts at a common horizon (see
`funnel-conversion-analysis`).

## "Closed – no decision" is its own outcome

Bucketing no-decision as Lost inflates the loss rate, distorts every
competitive read, and points the team at the wrong fix. A loss to a competitor
and a deal that evaporated into budget freeze have nothing in common except a
closed flag.

```
Win rate (c)         = Won ÷ (Won + Lost + No decision)
Competitive loss rate= Lost to a named competitor ÷ (Won + competitive Lost)
No-decision rate     = No decision ÷ all closed
```

- **Grain:** opportunity.
- If the CRM has **no separate no-decision value**, denominator (c) is
  `unavailable`. Say so, and name the resolving change: a `StageName` or
  closed-reason value for no-decision. Do **not** infer it from loss-reason
  free text unless the inference rule is stated and its error rate estimated on
  a sample.
- **The no-decision rate is often the most actionable number in the analysis**
  and it is usually invisible, because it has been folded into losses.

## Where the fields live

| Source | Field | Note |
|---|---|---|
| Salesforce | `Opportunity.StageName`, `IsWon`, `IsClosed`, `CloseDate`, `CreatedDate`, `Amount`, `Type` | `IsWon`/`IsClosed` derive from the stage's metadata, not from a rep tick |
| Salesforce | `OpportunityStage.IsWon`, `IsClosed`, `DefaultProbability` | resolve the stage picklist at runtime; custom closed stages are common |
| Salesforce | loss reason and competitor are **custom fields** in nearly every org | there is no standard field — discover it, do not assume a name |
| Salesforce | `Opportunity.CurrencyIsoCode` + `Amount` | in multi-currency orgs, `Amount` is in the record's currency; the report API converts, SOQL does not, and `convertCurrency()` does not apply to the report API |
| HubSpot | `dealstage`, `closedate`, `createdate`, `amount`, `hs_is_closed_won`, `pipeline` | stage IDs are portal-specific; resolve from the pipelines API |
| HubSpot | `amount_in_home_currency`, `hs_closed_amount_in_home_currency` | **`amount` is not the reportable number** in a multi-currency portal; the home-currency variants use a rate snapshotted per deal |
| HubSpot | `closed_lost_reason`, `closed_won_reason` | present by default but frequently unused or repurposed |

**Dollar-weighted win rate in a multi-currency org is a currency question
before it is a win-rate question.** Summing raw `Amount` across currencies
produces a number that matches no report anywhere. Convert explicitly, state the
rate and its date, or compute count-weighted and say why.

## Loss reasons are rep perception, not cause

Loss reason is picklist or free-text data entered by the person who lost the
deal, usually after the fact, often to close a required field. It is
systematically biased in two known directions:

1. **Toward price.** Price is socially safe, requires no admission, and is
   always partly true.
2. **Toward whatever the picklist makes easiest** — the first option, the
   shortest, the one that avoids a follow-up question.

Treat loss reasons as **a signal about what reps believe and are willing to
record**, and corroborate against data-visible patterns before narrating a
cause:

| Rep-stated reason | Data-visible corroboration to check |
|---|---|
| Price | discount distribution on wins vs losses; deal size vs win rate; whether losses cluster at a specific price point |
| Lost to competitor X | competitor field coverage; stage at loss; cycle length vs other losses |
| No budget / timing | no-decision rate in the same segment; deals reopened later; close-date push count |
| Missing feature | stage at loss (early = qualification problem, late = genuine gap); repeat appearance across segments |
| Went dark | last activity date vs close date; number of contacts engaged (`sales-activity-analytics`) |

**Report the loss-reason population rate first.** A reason distribution over
the 41% of losses where the field is filled describes those 41%, and the
unfilled 59% are not randomly distributed — they skew toward deals nobody wanted
to write up.

## Competitive analysis needs the competitor field populated

The competitor field is typically populated on the deals reps felt good about
recording and missing on the ones that matter.

```
Competitor coverage = closed deals with a competitor value
                      ÷ closed deals
Win rate vs X       = Won against X ÷ (Won against X + Lost to X)
```

- **Report coverage before any competitive claim.** "We win 61% against X" on
  a field populated for 30% of deals is a statement about a self-selected
  sample, and it is usually optimistic, because reps record the competitor more
  reliably when they win.
- Multi-competitor deals: a single-select field forces a choice and loses the
  rest. If the field is multi-select, a deal appears in several competitor
  denominators and the per-competitor rates do not sum to anything.
- **Small-n bites hardest here.** Competitor × segment × quarter slices go thin
  immediately; apply the minimum-n rule and give intervals rather than points.

## Decompose win-rate movement before telling a story

Win rate moves because segments changed, because the deal-size mix changed, or
because the rate changed inside segments. Same arithmetic as
`funnel-conversion-analysis`:

```
Δtotal      = Σ_s (w_s1·r_s1) − Σ_s (w_s0·r_s0)
mix effect  = Σ_s (w_s1 − w_s0)·r_s0
rate effect = Σ_s w_s0·(r_s1 − r_s0)
interaction = Σ_s (w_s1 − w_s0)·(r_s1 − r_s0)
```

Run it over segment, deal-size band, source, and — for the close-date
denominator specifically — **cycle-length band**, because that is the mix that
(a) is uniquely sensitive to.

Two further decompositions worth doing:

- **Count versus dollar.** If count win rate rose and dollar win rate fell, the
  team won more small deals and lost the big ones. That is a different story
  from either number alone.
- **Stage at loss.** Losses concentrated in early stages are a qualification
  problem; losses concentrated at proposal or negotiation are a product,
  pricing or competitive problem. The same total loss count, two different fixes.

## Answering

> **Win rate was 24% last quarter on the close-date basis, which is the CRM
> default.**
>
> That is wins over wins-plus-losses among deals that closed in the quarter, and
> it is biased by which deals happened to land: long enterprise deals close in
> later quarters, so the figure partly measures cycle-length mix. On the
> created-cohort basis, which is the honest one, deals created in Q1 sit at 19%
> with 14% of the cohort still open, so 19% is a lower bound and will rise.
>
> Including no-decision as its own outcome, the rate is 17% — no-decision is 11%
> of closed deals and had been counted as losses, which is why the competitive
> loss picture looked worse than it is.
>
> Dollar-weighted is 21%, below count-weighted, so we are losing the larger
> deals. That is the finding worth acting on.
>
> For a board slide the 24% is fine if you label the basis. For a capacity model
> use the cohort figure once the cohort closes out.
>
> Loss reasons are populated on 41% of losses and skew toward price, as they do
> everywhere; the data-visible pattern is that losses cluster at proposal stage
> in the enterprise segment, which is not what a price story would predict.

## Honest limits

- **No no-decision value: denominator (c) is unavailable.** It is not inferred
  from free text without a stated rule and a sampled error rate.
- **Created-cohort win rate before a full cycle is a lower bound, always.**
- **Loss-reason distributions describe the populated subset**, and the
  unpopulated remainder is not random.
- **Competitive win rates describe the deals where someone filled the field**,
  and that population is biased toward wins.
- **No uncontrolled win/loss comparison identifies a cause.** Segments differ in
  more than the compared dimension, and a decomposition locates movement without
  explaining it.
- **Reopened and re-created deals distort both denominators.** A lost deal
  re-created as a new opportunity counts twice in (b) and once in (a). Check for
  duplicate account-amount-close-date patterns before trusting cohort counts.

## Core contracts this skill calls

- `answer-contract` — the denominator statement on every rate, `unavailable`
  for (c) without a no-decision value, `lower_bound` for immature cohorts
- `provenance-block` — currency and FX on dollar-weighted rates, timezone on
  close-date bucketing, metric version behind each stage's won/lost semantics
- `comparability-rules` — before comparing a win rate to any benchmark, because
  a benchmark computed on (a) against your (b) is comparing nothing
- `warning-field-reader` — Salesforce `allData`, sharing-scoped report results
  that legitimately differ from the UI, HubSpot archived deals absent from search
- `pagination-patterns` — full closed-deal extraction for cohorts exceeds the
  2,000-row report cap and the 10,000-result search ceiling
- `rate-limit-governor` — competitor × segment × period grids multiply queries

## References

- `references/denominators.md` — the four denominators worked on one dataset,
  with the spread explained and the selection rule
- `references/loss-reason-forensics.md` — the corroboration table, coverage
  reporting, and how to read stage-at-loss

## Related skills

- `gtm-metric-dictionary` §3 for the canonical win-rate definitions and the
  sales-cycle survivorship caveat
- `funnel-conversion-analysis` for the cohort machinery and the decomposition
- `sales-activity-analytics` for the multithreading and engagement signals that
  corroborate a rep-stated reason
- `pipeline-forecast` consumes the win rate, and needs to know which one
- `metric-definition-audit` when two systems already disagree about win rate
