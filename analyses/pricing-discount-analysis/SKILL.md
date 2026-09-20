---
name: pricing-discount-analysis
description: Use for pricing and discounting analysis — realised versus list price, discount distribution by segment and rep, the relationship between discount and win rate or cycle length, or the margin effect of a pricing change. Computes realised price net of every concession rather than headline price, treats the discount-to-win-rate relationship as confounded by deal quality, and separates a price change's volume effect from its mix effect. Prevents "discounting wins deals" being read as causal when the discount was granted to the deals that were already going to close.
---

# Pricing and Discount Analysis

Two things go wrong here and both are expensive.

**The headline discount is not the discount.** The percentage on the quote is one
of six or seven concessions, and the others — free months, extra seats, waived
fees, extended terms, services thrown in — are individually small, jointly large
and almost never in the discount field.

**The discount-to-win-rate relationship is confounded in both directions.**
Discounts are granted to deals that are close to won *and* to deals that are
struggling. Any correlation between them is a mixture of two opposite causal
stories, and reading it as "discounting works" is the mistake this skill exists
to prevent.

---

## 1. Realised price is net of every concession

```
realised_annual_revenue = invoiced_amount × (12 / months_of_service_delivered)
                          − amortised_waived_fees
                          − cost_of_bundled_services

realised_unit_price     = realised_annual_revenue / units_delivered

effective_discount      = 1 − (realised_annual_revenue / list_annual_value)
```

### The concession ledger

Every one of these erodes realised price and only the first one usually lands in
a discount field.

| Concession | Where it hides | How to value it |
|---|---|---|
| **Percentage discount** | the discount field — the only one that is visible | list − net |
| **Free months** | contract term versus billing term | invoiced ÷ months of service, annualised |
| **Extra seats or units at no charge** | quantity versus entitled quantity | reduces realised unit price; **does not reduce revenue**, so it is invisible in a revenue-only view |
| **Waived fees** | implementation, onboarding, migration, training | list fee foregone, plus the marginal cost still incurred |
| **Bundled services** | a line item at zero, or an SOW attached to the order | **cost to deliver**, not list price — this is a margin item, not a revenue item |
| **Extended payment terms** | net-90 instead of net-30 | cost of capital over the extra days; small per deal, real at portfolio scale |
| **Price holds and capped uplifts** | renewal clauses, multi-year terms | the foregone uplift in future years, discounted |
| **Most-favoured-nation clauses** | contract text, nowhere in the CRM | unquantifiable up front; **flag the count, not a number** |

**Headline discount understates real erosion, often substantially.** Name the
direction whenever only the headline is available.

### Worked

List: 10 seats at 1,000 per seat per year, plus a 2,000 onboarding fee. **List
annual value 12,000.**

| Step | Concession | Realised annual revenue | Effective discount |
|---|---|---|---|
| 0 | list | 12,000 | 0% |
| 1 | 10% off subscription | 11,000 | 8.3% |
| 2 | onboarding fee waived | 9,000 | 25.0% |
| 3 | two free months (14 months of service for 9,000) | 7,714 | **35.7%** |
| 4 | two extra seats at no charge | 7,714 | 35.7% of revenue, and **realised unit price falls from 1,000 to 643** |

**The quote says 10%. The realised erosion is 35.7%, and the per-seat price is
36% below list.** Step 4 is the one that vanishes entirely from a revenue-only
analysis: revenue does not change, unit economics do, and the account consumes
20% more capacity than it pays for.

### Where the fields live

| System | Line-item fields that matter |
|---|---|
| **Salesforce** | `OpportunityLineItem.UnitPrice`, `.ListPrice`, `.TotalPrice`, `.Quantity`, `.Discount`, `.PricebookEntryId`; `QuoteLineItem.Discount`, `.Subtotal`, `.TotalPrice`; `Opportunity.Amount`, `.CurrencyIsoCode` |
| **HubSpot** | line item `price`, `quantity`, `amount`, `hs_discount_percentage`, `hs_total_discount`, `hs_term_in_months`, `recurringbillingfrequency` |

Three cautions on both:

- **`Opportunity.Amount` is a roll-up and can be manually overridden**, at which
  point it stops equalling the sum of its line items. Reconcile the two and
  report the mismatch count; a systematic gap is where unrecorded concessions
  live.
- **`ListPrice` comes from the price book entry at the time of quoting.** If the
  price book changed, historical `ListPrice` values reflect the old book, which
  is correct for the deal and wrong for a like-for-like comparison across a price
  change.
- **Free-of-charge lines often carry `UnitPrice = 0` with a non-zero
  `ListPrice`**, which is exactly the signal for concession types 3 and 5 — and
  a filter on `TotalPrice > 0` silently drops them.

---

## 2. Distribution, not average

**A 12% mean discount with a bimodal distribution at 0% and 30% is a governance
problem that the mean conceals.**

Report, every time:

```
p10, p25, median, p75, p90, max
share at exactly 0%
share above the approval threshold
modality: unimodal | bimodal | multimodal
count above each approval tier
```

What the shapes mean:

| Shape | Reading |
|---|---|
| **Unimodal around the mean** | a discounting norm exists and is followed |
| **Bimodal at 0% and a cluster** | two sales motions, or a threshold that is either respected or blown through |
| **Spike just below an approval threshold** | **the threshold is being managed, not respected.** The single most informative pattern in the whole analysis |
| **Long right tail** | a small number of large concessions; check whether they are the largest deals or the most desperate ones |

That spike is worth stating plainly: a pile-up at 19.5% when approval is required
at 20% is not a coincidence, and it means the recorded discount distribution is
partly a description of the approval process rather than of customer
negotiations.

---

## 3. The discount-to-outcome relationship is confounded in both directions

> **Deals that close with bigger discounts win more often.**

Two causal stories produce that pattern and they have opposite implications:

| Story | Mechanism | Implication |
|---|---|---|
| **Discounts win deals** | the concession converts a wavering buyer | discount more |
| **Discounts are granted to deals already close to won** | reps concede at the final stage, on deals that reached the final stage | the correlation is selection, and discounting more would not replicate it |

And a third that runs the other way: **discounts are also granted to struggling
deals**, which drags measured win rates down among discounted deals. The
observed correlation is a mixture of all three, **and its sign tells you which
mixture dominates, not which mechanism is real.**

**Never present the relationship as causal.** Report it, name the confounding,
and route to a price test where the decision matters.

Partial mitigations, none of which is a substitute:

- **Condition on stage at the time of discount.** A discount granted at
  first-meeting is a different object from one granted at verbal-agreement, and
  pooling them is what creates most of the apparent effect.
- **Control for deal size, segment and product mix** before comparing.
- **Look at cycle length alongside win rate.** Discounts granted early and
  discounts granted late have different cycle signatures, and the split is more
  informative than either outcome alone.
- **A list-price test or a segment-level price change**, measured properly, is
  the only thing that settles it. Route to `experiment-design-readout`, and note
  that pricing tests have small n and slow feedback, so a geo or segment holdout
  usually beats per-deal randomisation.

---

## 4. Rep and segment variance is a process finding

Discounting varies by rep. Most of that variance is **not** rep behaviour — it is
the deals they were given.

**Normalise before comparing:**

1. Bucket deals by segment, size band and product mix.
2. Compare each rep's discount against the **within-bucket** distribution, not
   the overall one.
3. Report the rep's deviation from their bucket's median, with their deal count.
4. **Apply a small-n floor.** A rep with six closed deals has no discount
   profile.

What survives normalisation is a real finding, and it is usually one of three:

- A rep who concedes earlier in the cycle than peers — a coaching finding.
- A rep who concedes more on the same deal profile — a process or authority
  finding.
- A rep whose deals are systematically different in a way the buckets did not
  capture — which means the buckets are wrong, not the rep.

**Never rank reps on raw discount.** It ranks territories.

---

## 5. A price change decomposes into volume, mix and rate

```
Δrevenue = volume effect + mix effect + rate effect + interaction

volume = (units¹ − units⁰) · price⁰
rate   =  units⁰ · (price¹ − price⁰)
mix    = the shift between products or segments at different price points
```

Same identity, same order-dependence and same interaction discipline as
`revenue-waterfall` — **declare the order and show the interaction as its own
line.**

Two things specific to pricing:

- **The volume effect takes a full sales cycle to appear.** A price change made
  six weeks ago in a business with a four-month cycle has produced a rate effect
  and almost none of its volume effect. **Early reads are structurally
  incomplete, not merely noisy**, and the direction of the incompleteness is
  known: they flatter the price increase.
- **State the elapsed share of a sales cycle** alongside any price-change read.
  "Six weeks into a four-month cycle, so roughly a third of the volume response
  is observable" is a complete sentence and stops the finding being
  over-interpreted.

---

## 6. Margin, not revenue, is the outcome variable

Every pricing conclusion is a margin conclusion. A discount that wins a deal at
below contribution margin has lost money efficiently.

```
deal contribution = realised revenue − COGS − variable delivery
                    − bundled services cost − variable support
deal margin %     = deal contribution / realised revenue
```

- **Bundled services enter at cost, not at list.** Giving away a 20,000 service
  engagement that costs 8,000 to deliver is an 8,000 margin event.
- **Variable delivery differs by product.** A discount analysis pooled across
  products with different gross margins compares things that are not comparable.
- **Break-even discount depends on contribution margin**, which is the same
  arithmetic as `budget-allocation`: at a 40% contribution margin, a 40% discount
  takes the deal to zero contribution.

---

## 7. Multi-currency requires a declared FX convention

**No platform supplies a currency type.** A currency mismatch is invisible in
metadata, so it produces silently wrong numbers rather than errors.

Declare, in the output:

| Decision | Options |
|---|---|
| **Conversion basis** | deal close date, quote date, period-end, or a fixed plan rate |
| **Source** | which rate table, and its own refresh date |
| **Scope** | whether list prices are converted too, or held in local currency |

**List and realised must be compared in the same currency at the same rate**, or
the "discount" includes an FX movement. On Salesforce with multi-currency
enabled, `CurrencyIsoCode` is per record and the converted fields depend on the
org's dated exchange rate table — **check whether dated rates are enabled, because
if they are not, historical deals are converted at today's rate and every
historical discount moves when the rate does.**

---

## 8. Output

```
realised_price:
  by_segment[] / by_product[]: list, realised, effective_discount, unit_realised
  concession_ledger[]: type, count, value, basis
  headline_vs_realised_gap
distribution:
  p10, p25, p50, p75, p90, max, share_zero, share_above_threshold
  modality, threshold_pileup: { threshold, share_just_below }
outcome_relationship:
  discount_band → win_rate, cycle_days, n
  conditioned_on: stage_at_discount, size_band, segment
  causal_claim: none, confounding_named: both_directions
rep_variance[]:
  rep, n, bucket, deviation_from_bucket_median, survives_normalisation: bool
price_change:
  order_declared, volume_pp, mix_pp, rate_pp, interaction_pp, reconciles: bool
  cycle_elapsed_share, read_completeness: partial | full
margin:
  by_segment[]: revenue, contribution, margin_pct, break_even_discount
fx: { basis, rate_source, rate_date, dated_rates_enabled }
reconciliation: { amount_vs_line_item_sum_mismatches }
```

---

## 9. Answering

**Answer first**, and lead with the gap between the headline and the reality.

> **Your average headline discount is 11%. Realised erosion is 24%.** The gap is
> free months and waived implementation fees, neither of which appears in the
> discount field — 38% of closed deals last year included at least one, and they
> are worth roughly twice the headline discount in aggregate.
>
> The distribution matters more than the average: it is bimodal at 0% and 28%,
> with a visible pile-up just under the 25% approval threshold. That pattern says
> the threshold is being managed rather than respected, and it is a governance
> finding rather than a pricing one.
>
> Deals with discounts above 20% do win more often, and **I am not going to tell
> you that discounting wins deals.** Those discounts are granted late, on deals
> that had already reached the final stage, so the correlation is mostly
> selection. The version of that comparison conditioned on stage-at-discount
> narrows the difference by about half, which is the honest read.
>
> At your 42% contribution margin, a 42% discount takes a deal to zero
> contribution, and 9% of last year's closed deals were at or past that line.
>
> For sizing the erosion problem and setting an approval policy, these figures are
> fine. For deciding whether to change list price, they are not — that needs a
> segment-level price test, and the volume effect will take a full sales cycle to
> appear.

**Withhold only:** a causal claim about discounting's effect on win rate (§3),
and a realised-price figure where the concession data does not exist — in which
case report the headline discount, label it a **lower bound on erosion**, and
name the specific fields or documents that would close the gap. **Never withhold
the headline number because the full one is unavailable.**

---

## References

- `references/realised-price.md` — the concession ledger with valuation rules, the CRM field map, the reconciliation between deal amount and line items, and the FX convention
- `references/discount-outcome-confounding.md` — the two-directional confounding worked out, the stage-conditioned comparison, rep normalisation, and the price-test designs that actually settle it

## Core contracts called

- **`answer-contract`** — the causal refusal in §3 and the lower-bound labelling when concession data is missing
- **`provenance-block`** — currency, FX basis and rate date on every price figure; whether dated exchange rates are enabled; price book version behind `ListPrice`
- **`comparability-rules`** — before comparing discounts across a price-book change, across currencies, or across products with different gross margins
- **`warning-field-reader`** — Salesforce field-level security omits fields rather than erroring, so a missing concession field may be a permission effect rather than an empty one
- **`pagination-patterns`** — line-item extracts are one-to-many against opportunities and are the usual place a row cap truncates silently

## Related skills

- `win-loss-analysis` — win rate across its four denominators, which this analysis depends on getting right.
- `revenue-waterfall` — the volume/mix/rate identity and its interaction discipline.
- `experiment-design-readout` — for any price test; small n and slow feedback usually point to a segment or geo holdout.
- `gtm-metric-dictionary` — contribution margin, ACV, TCV and the multi-year problem.
- `subscription-analytics` — where realised price feeds MRR movement.
