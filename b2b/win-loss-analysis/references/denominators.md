# The four win-rate denominators, worked on one dataset

Same deals, four numbers, all defensible. This file shows the spread and the
selection rule.

## The dataset

A single quarter, one segment, illustrative figures:

```
Created in Q1                      200 opportunities
  of which closed by today         172
    Won                             41
    Lost                            98
    Closed – no decision            33
  still open                        28

Closed during Q1 (any created date) 180 opportunities
    Won                             43
    Lost                           104
    Closed – no decision            33

Amounts (closed during Q1)
    Won total                    2,150,000
    Lost total                   7,020,000
    No-decision total            1,830,000
```

## The four figures

```
(a) Close-date, count
    = Won ÷ (Won + Lost)            among deals closed in Q1
    = 43 ÷ (43 + 104)               = 29.3%

(b) Created-cohort, count
    = Won ÷ all created in Q1
    = 41 ÷ 200                      = 20.5%   ← lower bound: 28 still open

(c) Including no-decision, count (close-date basis)
    = Won ÷ (Won + Lost + No-dec)
    = 43 ÷ (43 + 104 + 33)          = 23.9%

(d) Dollar-weighted, close-date basis
    = Won amount ÷ (Won + Lost amount)
    = 2,150,000 ÷ 9,170,000         = 23.4%
```

Four numbers between 20.5% and 29.3% on the same quarter. **Which one you quote
is a bigger decision than anything else in the analysis.**

## Reading the spread

| Comparison | What a gap means |
|---|---|
| (a) far above (b) | the quarter's closes were skewed toward faster, more winnable deals; the close-date figure is flattered by cycle-length mix. Also expect (b) to rise as the cohort matures |
| (b) at maturity far below (a) | genuine: many created opportunities never reach a close at all |
| (c) far below (a) | a large no-decision population was being counted as losses, understating the competitive picture and overstating the sales problem |
| (d) below (a) | larger deals win less often — the big deals are being lost |
| (d) above (a) | small deals churn through the funnel and lose; the money is winning |

In the worked figures, (d) 23.4% against (a) 29.3% says the larger deals are
losing. That is the sentence worth putting in front of a sales leader.

## The maturity rule for (b)

```
open_share(cohort) = still-open ÷ cohort size
lower_bound        = won ÷ cohort size
upper_bound        = (won + still open) ÷ cohort size
```

In the example: lower bound 20.5%, upper bound (41+28)/200 = 34.5%. The true
mature figure lies between, and the gap narrows as the cohort closes out.

- Report the lower bound as the figure, the upper bound as the ceiling, and the
  open share as the reason.
- **Compare cohorts at a common horizon.** A cohort at day 200 and a cohort at
  day 60 are not comparable on terminal rate; both are comparable on
  "won within 60 days of creation".

## Selection rule

1. **For a trend or a benchmark comparison:** (b), the created cohort, at a
   common horizon. It is the only one not distorted by what happened to close.
2. **For a board or QBR readout where the audience expects the CRM number:**
   (a), explicitly labelled, with (b) in the same breath.
3. **Wherever a no-decision value exists:** report (c) as well. It usually
   changes the story.
4. **Whenever deal size varies materially:** report (d) alongside the count
   version. The gap between them is a finding.
5. **Never quote a rate against a published benchmark** without knowing which
   denominator the benchmark used. Most published B2B win-rate benchmarks are
   (a), and many do not say.

## Currency, for (d)

Dollar-weighting is a currency question first.

- **Salesforce:** `Amount` is in the record's currency (`CurrencyIsoCode`).
  Report-API output is converted using the org's current — or dated — exchange
  rates and presented in the report's currency; SOQL/Bulk output is not, and
  `convertCurrency()` does **not** apply to the report API. **A dollar-weighted
  win rate computed from Bulk extraction and one computed from a report are
  different numbers.** Never mix them in one calculation.
- **HubSpot:** `amount` is in the deal's own currency. The reportable figures
  are `amount_in_home_currency` and `hs_closed_amount_in_home_currency`, which
  use an exchange rate snapshotted per deal rather than recomputed. Summing raw
  `amount` across a multi-currency portal produces a number that matches no
  HubSpot report.

Where conversion is not possible, compute count-weighted, say why, and name the
currency mix in the population.

## Duplicate and re-created deals

A lost deal re-created as a new opportunity counts **twice** in (b) — once in
its original cohort as a loss, once in the new cohort — and once in (a).

Detection: same account, similar amount, close dates within a short interval,
one closed-lost followed by one created. Report the suspected duplicate count
rather than silently deduplicating, because some of them are genuinely new
deals and the judgement belongs to the person who knows the account.
