---
name: gtm-metric-dictionary
description: Use before computing, quoting or charting any go-to-market metric — MQL, SQL, pipeline coverage, win rate, sales cycle, ACV, ARR, NRR, GRR, CAC, CAC payback, LTV, LTV:CAC, ROAS, MER, AOV, repeat purchase rate, cohort LTV, churn — and whenever two people disagree about what a number means. Supplies the canonical definition, the defensible alternatives where the industry genuinely disagrees, the formula with every term named, and the denominator trap each metric is commonly computed wrong by. Prevents a correct calculation of a mis-scoped metric, which is still a wrong claim.
---

# GTM Metric Dictionary

A KPI is a definition, not a number. Almost every wrong GTM number in production
is arithmetically correct: the sum added up, the division divided, and the
metric was scoped to the wrong population. This skill resolves the metric to a
**contract** before anyone computes it.

## Order of precedence

1. **The customer's own definition, if a semantic layer holds one.** Run
   `semantic-layer-introspector` first. A dbt `metrics:` entry, a LookML
   `measure:`, a Power BI measure, a Snowflake semantic view metric: these win
   over anything in this file. Note the difference between theirs and the
   canonical one, do not silently replace it.
2. **The org's written definition**, if there is one and it is dated.
3. **The canonical definition here**, with the convention chosen stated in the
   answer.

Where several conventions are genuinely defensible and they differ materially,
**ask which one**, and if nobody can say, compute the most common convention,
label it, and show what the alternative would give. Do not withhold the number.

## The output is a contract, not a paragraph

Every resolved metric emits these nine fields. They must be *statable*; they do
not all have to be printed in front of the answer.

```
metric_name          canonical name, plus the alias the user said
formula              with every term defined
convention           which of the defensible variants, and why this one
denominator          the population, described as a sentence
grain                per what: person, buying group, account, opportunity,
                     session, order, subscription, day
time_basis           which date column: created, entered-stage, close,
                     booked, recognised, event
lead_or_lag          leading indicator or lagging outcome
preflight_checks     which of the ten cross-cutting checks apply
limitations          what this number does not claim
```

---

# Part 1. The B2B funnel

## 1.1 Two incompatible canonical models. Ask which.

| | Lead-centric (SiriusDecisions Demand Waterfall lineage) | Buying-group-centric (Forrester B2B Revenue Waterfall) |
|---|---|---|
| Unit | a person | a **demand unit** (a buying group inside an account) |
| Stages | Inquiry → MQL → SAL → SQL → Opportunity → Closed Won/Lost | Opportunity-centric stages across acquisition **and** retention/expansion |
| Scope | new acquisition | full revenue lifecycle including renewal and expansion |
| Conversion rates | person-to-person | unit-to-unit |

**Never assume.** A person-grain funnel measured on an org that sells to a
six-person buying group produces conversion rates that are roughly `1/6` of the
real ones and are not comparable to any benchmark. See `funnel-model-designer`.

## 1.2 Stage definitions, with what is actually wrong with each

**Inquiry.** Anyone who raised a hand. Trivially defined, trivially inflated by
content syndication and list buys. Denominator trap: inquiries from paid list
sources routinely convert at a tenth the rate of inbound, so a blended
Inquiry→MQL rate moves when the source mix moves, not when quality moves.
Always split by source.

**MQL.** *No industry-standard definition exists.* It is a threshold on a
scoring rule that the org wrote. Three consequences:
- It is gamed. If marketing is compensated on MQL count, the score threshold
  drifts down. A rising MQL count with a falling MQL→SQL rate is the signature.
- It is versioned, usually undocumented. If the rule changed on a date inside
  your window, the trendline crossing that date is not a trend. See check C10.
- MQL count is not a leading indicator of revenue unless MQL→SQL is stable.
  Report MQL count and MQL→SQL together or not at all.

**SAL (Sales Accepted Lead).** A **receipt**, not a judgment: sales
acknowledges it will work the lead. Frequently **not instrumented at all**.
This is the reason MQL→SQL looks noisy in most orgs: without SAL you cannot
distinguish "worked and rejected" from "never touched". When SAL is missing,
say so as a finding rather than computing around it.

**SQL / SQO.** Naming differs by org. Some mean "sales qualified lead" (a
person sales believes is qualified), some mean "sales qualified opportunity" (a
created opportunity past a qualification stage). These are different objects at
different grains. Resolve the noun before using the rate.

**Opportunity.** Usually the first object with an amount. Beware orgs that
create opportunities at first meeting versus orgs that create them at proposal:
identical win rates mean different things.

**Closed Won / Closed Lost / Closed - No Decision.** *Bucketing "no decision"
as Lost inflates the loss rate and understates win rate against competitors.*
If the CRM has no separate no-decision value, the win rate cannot be computed
on denominator (c) below, and you say so.

---

# Part 2. Pipeline metrics

## 2.1 Pipeline coverage

```
Pipeline coverage = open pipeline for the period ÷ quota for the period
```

**The target is not 3x. The target is `1 ÷ win rate`.**

| Win rate | Correct coverage target |
|---|---|
| 33% | 3.0x |
| 25% | 4.0x |
| 20% | 5.0x |
| 15% | 6.7x |

Quoting a blanket 3x to a 20%-win-rate team tells them they are funded when
they are short by a third. Three further traps:

1. **All open pipeline, rather than pipeline that can close in the period.** A
   deal with a close date next quarter is not coverage for this quarter.
   Filter on close date in period, not on "open".
2. **Raw amount rather than net of stale.** Deals whose close date has been
   pushed three or more times, or that have had no activity in a stage-typical
   cycle length, are carried at full value in almost every CRM report.
3. **Mid-quarter coverage compared to a start-of-quarter benchmark.** Coverage
   mechanically falls through the quarter as deals close. Compare day 30 to day
   30. This needs `fact_opportunity_snapshot`; see `data-model-designer`.

## 2.2 Pipeline velocity

```
Pipeline velocity = (# Opportunities × Win Rate × Avg Deal Value) ÷ Cycle Length
```

Units are **revenue per unit time** (for example dollars per day). It is
routinely mislabelled as a duration, which is the sales-cycle metric, not this
one. All four inputs must come from **the same cohort and the same segment**.
Mixing enterprise deal value with SMB cycle length produces a number that
describes no team.

## 2.3 Stage conversion and stage duration

Stage conversion requires **stage history**, not the current stage field. A
deal that skipped a stage or was pushed backwards is invisible in the current
field. Salesforce `OpportunityHistory` / `OpportunityFieldHistory` cover only
tracked fields and are typically enabled after the fact; HubSpot's
`hs_lifecyclestage_*_date` properties are **overwritten on re-entry**. This is
why daily snapshotting is non-optional (see `data-model-designer` §2).

---

# Part 3. Win rate and sales cycle

## 3.1 Win rate has four defensible denominators and they give four different numbers

| # | Denominator | Formula | Property |
|---|---|---|---|
| a | Closed in period | `Won ÷ (Won + Lost)` by close date | CRM default, **most biased**: long deals land in later periods, so a quarter's win rate is partly an artefact of which deals happened to close |
| b | Cohort created | `Won ÷ all opportunities created in cohort` | **the honest one**; needs a full sales cycle to elapse before it is meaningful |
| c | Including no-decision | `Won ÷ (Won + Lost + No decision)` | the true "we got the deal" rate; needs a no-decision value to exist |
| d | Dollar-weighted | any of the above, summing amount rather than counting | differs from count-weighted whenever deal size correlates with win probability, which it usually does |

**Emit which one you used.** A benchmark computed on (a) compared to your (b)
is comparing nothing. The spread between (a) and (b) on the same data is a
useful finding in its own right.

## 3.2 Sales cycle length

- Use **median and p90**, never the mean. The distribution is right-skewed with
  a long tail, and the mean is dragged by a handful of eighteen-month deals.
- State whether **lost** deals are included. Both conventions exist. Won-only
  cycle is shorter, because lost deals often die slowly.
- **Survivorship bias is structural**: computing cycle length from closed deals
  only systematically under-reports it, because the still-open deals are
  disproportionately the slow ones. For a cohort whose cycle has not fully
  elapsed, report the median as a **lower bound**.

---

# Part 4. Revenue and retention

## 4.1 The four nouns that are not each other

**Bookings ≠ Billings ≠ Revenue ≠ Cash.** A booking is a signed commitment, a
billing is an invoice issued, revenue is recognised over the service period
(ASC 606), cash is money received. A three-year prepaid deal is one booking,
one billing, thirty-six months of revenue and one cash event.

**ARR is a forward run-rate, not revenue.** ARR = annualised value of the
recurring subscriptions active at a point in time. It excludes one-time
services, and it is a snapshot, so "ARR for Q3" is ambiguous until you say
which day.

## 4.2 GRR

```
GRR = (Starting ARR − churned ARR − downgrade ARR) ÷ Starting ARR
```

Expansion is **excluded**. GRR is therefore **structurally capped at 100%**.
A GRR above 100% is a formula bug, and the bug is nearly always expansion
leaking into the numerator.

## 4.3 NRR: the most disputed metric in SaaS

```
NRR = (Starting ARR − churn − downgrades + expansion) ÷ Starting ARR
```

Five genuine points of disagreement. The skill forces a choice on each and
emits it with the number.

1. **Cohort definition.** Customers present at period start, or all customers?
   Only the first is defensible.
2. **In-period new logos.** They must be excluded from both numerator and
   denominator. Implementations leak them in constantly, which inflates NRR in
   fast-growing companies.
3. **FX treatment.** Constant currency or as-reported? A 10% currency move on a
   30% international book moves NRR by ~3 points with no customer behaviour
   change.
4. **Monthly-then-chained vs point-to-point.** `∏(monthly NRR)` over twelve
   months and a single twelve-month point-to-point comparison **differ whenever
   growth is non-linear**, and the chained version is higher in a business with
   churn concentrated in one month.
5. **ARR-weighted vs count-weighted denominator.** Count-weighted NRR treats a
   $2k customer and a $2M customer identically. Almost everyone means
   ARR-weighted. Almost nobody says so.

**Comparing your NRR to a published benchmark computed on a different
convention is comparing nothing.** Emit the convention alongside the number,
always.

## 4.4 ACV, TCV and the multi-year problem

ACV is genuinely contested. Three live conventions:

- `TCV ÷ contract years` (smooths ramps)
- first-year contract value (matches cash in year one)
- recurring-only annualised value (excludes services)

On **multi-year ramped deals these diverge by 30% or more**. A deal at
$100k / $200k / $300k over three years is ACV $200k by convention one, $100k by
convention two. Say which. Where the org has not decided, compute convention
one, label it, and state the convention-two figure in the same breath.

---

# Part 5. Unit economics

## 5.1 CAC

```
CAC = fully-loaded acquisition cost in period ÷ new customers acquired in period
```

Three errors, in descending frequency:

1. **Not fully loaded.** Fully loaded means media spend **plus** sales and
   marketing salaries, commissions, bonuses, tooling and software, agency and
   contractor fees, and allocated overhead. Media-only CAC is typically 40-60%
   of the real number.
2. **Period mismatch.** Q1 spend acquires customers who close in Q2, and
   dividing them anyway is only valid at steady state. For a business with a
   90-day cycle and changing spend, lag the spend by the median cycle or say
   the number is steady-state-only.
3. **Blending new and expansion.** Expansion revenue in the numerator's
   denominator, or expansion-driving spend in the numerator, both corrupt it.
   Keep new-logo CAC separate from expansion cost.

## 5.2 CAC payback: the most-omitted term in GTM analytics

```
CAC payback (months) = CAC ÷ (new MRR per customer × gross margin)
```

**The gross-margin term is not optional.** Without it you are measuring revenue
recovery, not cash recovery, and you understate payback by exactly
`1 ÷ gross margin`. At 70% gross margin, dropping the term reports 14 months
when the truth is 20.

If you are handed a payback figure with no margin term, **recompute it**, give
both, and name which is which. Do not refuse to state the wrong one; state it
and correct it.

## 5.3 LTV

Use **gross profit**, not revenue.

```
LTV (closed form) = (ARPA × gross margin) ÷ churn rate
```

Three honest limits:

- The closed form assumes **constant churn forever**. Real churn declines with
  tenure, so it **understates good businesses and overstates bad ones**.
- For high-NRR businesses where net revenue retention exceeds 100%, the
  denominator goes to zero or negative and **LTV approaches infinity. The
  closed form is simply invalid there.**
- Use a **bounded horizon**: 24-month or 36-month cumulative gross profit per
  cohort, computed from the actual cohort curve. Say the horizon. A 36-month
  LTV and a 24-month LTV are not comparable, and neither is an "LTV" with no
  horizon.

## 5.4 LTV:CAC

The 3:1 rule has **no empirical basis**. It is a rule of thumb that propagated
through blog posts. **Present payback first**, because a 3:1 ratio coexists
happily with a 24-month payback, and a 24-month payback is a fatal cash problem
for a company that is not already profitable.

When asked for LTV:CAC, give it, then give payback in the same sentence.

---

# Part 6. B2C and consumer

The spine of B2C measurement is **blended versus attributed**. Attributed
metrics come from the platform that sold you the ads. Blended metrics come from
your own books. They disagree, and the gap is the point.

## 6.1 ROAS

```
Platform ROAS = platform-attributed conversion value ÷ platform spend
```

**Platform ROAS is the ad platform grading its own homework.** Three
independent inflations:

1. **View-through credit.** An impression nobody clicked counts.
2. **Each platform independently claims the same conversion.** Sums of channel
   ROAS routinely "explain" 130-160% of actual revenue.
3. **Modelled conversions.** Post-ATT, Meta models a material share of
   conversions; Google's data-driven attribution is a vendor model. These are
   *modelled, not measured*, and must be labelled at the point of display.

Fourth, quieter: **ROAS uses revenue, not margin.** At a 15% contribution
margin, a 6x ROAS is loss-making.

**Do not refuse the cross-platform sum.** Compute it, and annotate it: "this
sums to X, which overstates by an unknown amount because each platform claims
overlapping conversions; the blended MER below is the number that reconciles to
your books."

## 6.2 MER and break-even MER

```
MER = total revenue ÷ total marketing spend
Break-even MER = 1 ÷ contribution margin
```

| Contribution margin | Break-even MER |
|---|---|
| 50% | 2.0 |
| 40% | 2.5 |
| 30% | 3.33 |
| 25% | 4.0 |
| 20% | 5.0 |

A "good MER" benchmark quoted without the brand's own contribution margin is
meaningless. **MER is a guardrail, not a router**: it tells you whether total
spend is sustainable, it cannot tell you which channel to cut.

## 6.3 aMER and blended new-customer CAC

```
aMER = new-customer revenue ÷ total marketing spend
Blended new-customer CAC = total marketing spend ÷ new customers
```

Use **new** customers. `total spend ÷ all orders` flatters repeat-heavy brands
by charging retention revenue against acquisition spend, and it improves
automatically as the customer base ages.

## 6.4 Contribution margin

The boundary is contested. State which you used.

- **CM1** = revenue − COGS
- **CM2** = CM1 − fulfilment, shipping, payment processing
- **CM3** = CM2 − variable marketing

**Returns and refunds are the most commonly omitted term**, and in apparel they
run 10-30%. A contribution margin computed on gross revenue in a
high-return category is wrong by most of the margin.

## 6.5 AOV has five defensible versions

1. Gross AOV: `gross order value ÷ orders`
2. Net of discounts
3. Net of returns and refunds
4. Including shipping revenue, or excluding it
5. Including tax, or excluding it

These can differ by 25% on the same data. **Use the median alongside the mean**
where the basket distribution has a tail.

## 6.6 Repeat purchase rate

```
RPR (cohort) = customers in cohort with ≥2 orders within N days ÷ customers in cohort
```

**Read it by acquisition cohort with a fixed window, 60 or 90 days.** All-time
RPR mechanically rises as the business ages and falls when acquisition
accelerates. It measures business age and growth rate, not product love. This
is the single most common B2C denominator trap.

## 6.7 Consumer churn

- **Split voluntary from involuntary.** Involuntary churn is failed payments
  and expired cards; dunning fixes it. Voluntary churn is a product or value
  problem; dunning does nothing for it. A blended churn number hides which
  lever applies.
- **Monthly churn is not annual churn ÷ 12.**

```
annual churn = 1 − (1 − monthly churn)^12
monthly churn = 1 − (1 − annual churn)^(1/12)
```

At 5% monthly, annual churn is 46%, not 60%. At 30% annual, monthly is 2.9%,
not 2.5%.

---

# Part 7. The ten cross-cutting pre-flight checks

Run these as checks before computing, not as prose after. Each names the state
that makes the number wrong.

| # | Check | Fails when |
|---|---|---|
| C1 | **Snapshot vs cohort** | A rate computed by counting everyone currently at each stage is presented as a conversion rate. It is not one. |
| C2 | **Period mismatch** | Numerator and denominator cover different windows, or spend in one period is divided by outcomes in another outside steady state. |
| C3 | **Revenue where margin belongs** | LTV, ROAS-vs-breakeven, CAC payback and contribution analysis computed on revenue. |
| C4 | **Mean where median belongs** | Cycle length, AOV, LTV, time-to-value, deal size. All right-skewed. |
| C5 | **Denominator population drift** | The denominator grew or shrank for a reason unrelated to the metric (new segment added, list purchased, region onboarded). |
| C6 | **Timezone and currency** | Two sources with different day boundaries or currencies combined. No BI platform stores a currency *type*; it is a format string everywhere. See `temporal-integrity-audit`. |
| C7 | **Incomplete-period charting** | The last bar is always short. Exclude it or mark it. Every trend, no exceptions. |
| C8 | **Double-counted conversions** | Cross-platform sums, many-to-many association joins, or multi-touch credit read as whole conversions. |
| C9 | **Small n** | A stage rate on a cohort too small to support it. State the minimum cohort size and refuse below it. |
| C10 | **Definition drift over time** | The rule changed mid-history. The trendline crossing the change is not a trend. Mark the date on the chart. |

## The one-line check that catches more than any other

> **Write the sentence a stakeholder would say out loud, then check it against
> the actual denominator.**

"Of the leads we generated last quarter, 12% became opportunities." Now open
the query. Is the denominator "leads created last quarter" or is it "leads
created last quarter that have a non-null email and are not in an excluded
source list and whose owner is active"? Those are different sentences and only
one of them is true.

---

# Part 8. Answering

**Answer first, caveat second, never withhold.**

When a metric is computable under *some* defensible convention, compute it.
Then, in one plain sentence each:

- name the convention used and the material alternative
- name the **direction** of the error, not just its existence
- offer the better number and the concrete route to it
- say explicitly when the rough figure is good enough for the question asked

Withhold only what cannot honestly be computed: a rate with a zero or absent
denominator, a cohort rate on a cohort whose cycle has not elapsed and whose
partial value would be read as final, a metric whose required field does not
exist in the source. Those emit `unavailable`, `partial`, `lower_bound`,
`ambiguous` or `no_data` per `answer-contract`, each carrying the specific
change that would resolve it.

**Worked shape:**

> Win rate was 24%. That is wins over wins-plus-losses by close date, which is
> the CRM default and is biased by which deals happened to land this quarter.
> On the created-cohort basis, which is the honest one, deals created in Q1 are
> at 19% with 14% of the cohort still open, so that figure is a lower bound and
> will rise. For a board slide the 24% is fine if you label the basis; for a
> capacity model use the cohort figure once the cohort closes out.

---

## References

- `references/b2b.md` — full B2B metric table with formulas, grains and traps
- `references/b2c.md` — full B2C and subscription metric table
- `references/contested.md` — the metrics where the industry genuinely
  disagrees, with each convention and what it implies
- `references/denominator-traps.md` — the trap register as executable checks
- `assets/metric-crosswalk-template.csv` — the per-metric crosswalk template

## Related skills

- `semantic-layer-introspector` runs **before** this one wherever a semantic
  layer exists. Their definition beats this file's.
- `funnel-model-designer` for stage definitions and unit of analysis.
- `metric-definition-audit` when two systems already disagree.
- `calculation-integrity-audit` when the definition is right and the number
  still looks wrong.
