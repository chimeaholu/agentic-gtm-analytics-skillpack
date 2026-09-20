---
name: churn-retention-analysis
description: Use for retention and churn diagnosis — why customers are leaving, which segments are at risk, what distinguishes retained from churned accounts, and whether a retention intervention worked. Separates logo from revenue retention, splits voluntary from involuntary, decomposes retention movement into mix and rate effects, and refuses to attribute a retention change to an initiative without a comparison group. Prevents a retention story built on the customers who stayed long enough to be surveyed.
---

# Churn and Retention Analysis

Churn analysis has three characteristic failures, and all three produce a
confident, well-formatted, wrong story.

1. **One retention number hiding two opposing trends** — enterprise expansion
   covering SMB collapse.
2. **A mix shift read as a rate improvement** — retention rose because you
   stopped selling to the segment that churns, not because anything got better.
3. **Survivorship everywhere** — every diagnosis is built from the customers who
   stayed long enough to be asked.

This skill is organised around not committing them.

---

## 1. Report logo and revenue retention together, always

They diverge sharply in any segmented business, and **reporting one and calling
it "retention" hides SMB churn under enterprise expansion.**

```
logo retention    = accounts retained at period end / accounts at period start
gross revenue retention (GRR)
                  = (starting ARR − contraction − churn) / starting ARR
net revenue retention (NRR)
                  = (starting ARR + expansion − contraction − churn) / starting ARR
```

Three rules:

- **GRR is capped at 100%. NRR is not.** An NRR above 100% with a GRR of 78%
  means expansion is masking real churn, and it is exactly the situation the
  single-number report conceals.
- **Logo retention weights every customer equally; revenue retention weights by
  spend.** A business losing 30% of its logos and 4% of its revenue has a
  self-serve problem and an enterprise business, and the two numbers say so
  immediately.
- **NRR convention is genuinely disputed** — cohort versus snapshot, whether
  reactivations count, what happens to downgraded-then-churned accounts. See
  `gtm-metric-dictionary`; state the convention in the answer rather than
  assuming the reader shares yours.

**Always segment both.** A single blended pair is better than one number and
still hides the thing you are looking for.

---

## 2. Voluntary versus involuntary determines the entire remedy

| | Voluntary | Involuntary |
|---|---|---|
| Cause | the customer decided to leave | payment failed — expired card, insufficient funds, issuer decline, failed 3DS |
| Remedy | product, pricing, support, value delivery | dunning, card updater, retry logic, pre-expiry outreach |
| Typical share | varies enormously by segment and payment mix | materially larger in self-serve and consumer subscriptions than most teams assume |

**Dunning fixes one and does nothing for the other.** A churn-reduction programme
aimed at the wrong half will show no effect and be declared a failure.

How to split it in practice:

- **Billing system first.** A failed final invoice, a subscription cancelled by
  the billing system rather than by a user action, or a status of `unpaid` or
  `past_due` before cancellation all indicate involuntary.
- **Cancellation source second.** Cancelled through the UI by a logged-in user is
  voluntary. Cancelled by an automated process is not.
- **When the source is unknown, say so and give the split of what is known**,
  with the unknown bucket sized. **Do not assign unknowns to voluntary by
  default** — that is the direction that makes the product look worse and the
  billing team look fine, and it is the default nearly every report takes
  accidentally.

---

## 3. Survivorship bias runs through every churn diagnosis

Three places it enters, each with a specific correction.

| Source | The bias | Correction |
|---|---|---|
| **Exit surveys** | reach only churners engaged enough to answer, who skew toward articulate, deliberate, price-sensitive departures. **Silent churners — the ones who never onboarded — are invisible** | report the response rate, and profile respondents against all churners on tenure, plan and usage. Where they differ, say so in the same sentence as the findings |
| **"Customers who reached month 12"** | excludes everyone who left before month 12, so any analysis of them describes survivors | analyse by **signup cohort**, not by tenure milestone |
| **Feature-usage comparisons** | churned accounts had less time to adopt features, so adopters look more retained by construction | compare usage in a **fixed early window** — first 30 days — for every account, churned and retained alike |

That last one is subtle and extremely common. "Accounts using feature X churn
less" frequently means "accounts that survived longer had more opportunity to
use feature X". **Fix the observation window before comparing.**

---

## 4. Decompose retention movement into mix and rate

**An overall retention improvement driven by an acquisition-mix shift toward
stickier segments is not a product improvement**, and the arithmetic to tell them
apart is small.

With segment weights `w_s` and segment retention rates `r_s`:

```
R = Σ_s  w_s · r_s

ΔR_mix         = Σ_s (w_s¹ − w_s⁰) · r_s⁰
ΔR_rate        = Σ_s  w_s⁰ · (r_s¹ − r_s⁰)
ΔR_interaction = Σ_s (w_s¹ − w_s⁰) · (r_s¹ − r_s⁰)

ΔR = ΔR_mix + ΔR_rate + ΔR_interaction        # must reconcile exactly
```

### Worked

| Segment | Weight before | Rate before | Weight after | Rate after |
|---|---|---|---|---|
| SMB | 60% | 70% | 45% | 68% |
| Enterprise | 40% | 92% | 55% | 91% |

```
R⁰ = 0.60·0.70 + 0.40·0.92 = 0.788
R¹ = 0.45·0.68 + 0.55·0.91 = 0.8065
ΔR = +1.85pp

mix         = (0.45−0.60)·0.70 + (0.55−0.40)·0.92 = +3.30pp
rate        = 0.60·(0.68−0.70)  + 0.40·(0.91−0.92) = −1.60pp
interaction = (−0.15)(−0.02)    + (0.15)(−0.01)    = +0.15pp
                                            total  = +1.85pp  ✓
```

**Overall retention improved by 1.85 points while every individual segment got
worse.** The entire gain is a mix shift toward enterprise. Any report that leads
with "retention improved" is wrong about what happened, and the correction is
one table.

The decomposition is order-dependent — computing rate first and mix second
assigns the interaction differently — so **declare the order and show the
interaction term as its own line.** See `revenue-waterfall`, which applies the
same discipline to revenue.

---

## 5. Cohort curves: truncation marked, cohorts sized, small-n refused

```
retention(cohort c, month m) = accounts from c active in month m / accounts in c
```

- **Mark truncation.** A cohort three months old has no month-12 point. Leave it
  absent; **never carry the last known value forward**, which turns a young
  cohort into a flat, flattering line.
- **Compare cohorts only at the same age.** A 2-year-old cohort's cumulative
  retention against a 6-month-old cohort's is not a comparison. See
  `cohort-and-ltv`.
- **Size every cohort in the output.** A cohort of 19 accounts produces a curve
  that jumps 5 points when one account leaves.
- **Refuse below the small-n floor** rather than plotting a jagged line that
  invites interpretation. Report the counts instead, which are honest and often
  enough.
- **Watch for definitional drift across cohorts.** If "active" changed meaning 14
  months ago, cohorts either side are not comparable, and the chart will not say
  so.

---

## 6. Causal claims about interventions require a comparison group

**Where no comparison group exists, report the before-and-after and state
explicitly that it is not attributable.** This is the same rule as everywhere
else in the pack and it is broken most often here, because retention programmes
are launched to everyone at once and evaluated against the previous quarter.

| Evidence | What you may say |
|---|---|
| Randomised holdout | the intervention caused a change of X, interval A–B |
| Matched comparison group, pre-registered | a difference of X, with the matching assumptions named |
| Staged rollout with a lagging group | a difference-in-differences estimate, parallel-trends assumption stated and checked |
| Before/after, everyone treated | **retention moved by X in this window. This does not establish that the intervention did it** |

Three things that move retention in the same direction as a successful
intervention and are not it: **the acquisition mix shifting** (§4), **a cohort
maturing** past its steep early-churn period, and **seasonality** in a business
with annual contract cycles.

Route intervention design to `experiment-design-readout` before it launches; that
is dramatically cheaper than trying to recover causality afterwards.

---

## 7. Churn reason data is biased, and the bias has a direction

Reasons are captured by the people closest to the loss — a CSM, an offboarding
form, a rep closing the record — and are **biased toward price and toward
whatever the picklist makes easiest.**

- **"Price" is over-reported.** It is the socially easiest reason to give and to
  record, and it is often the proximate reason for a decision made about value
  weeks earlier.
- **"Other" and blank are the largest real categories in most CRMs.** Report
  their share; a reason distribution computed on 40% coverage is a distribution
  of what people bothered to record.
- **The picklist shapes the data.** Adding an option changes the distribution
  from that date forward with no change in customer behaviour. Date the picklist
  changes and mark the trendlines that cross them.
- **Corroborate against behaviour before narrating.** An account whose usage went
  to zero four months before cancelling did not churn because of a price
  increase announced last month, whatever the reason field says. **Usage
  trajectory before cancellation is the strongest corroborating evidence
  available** and it is already in your data.

---

## 8. Output

```
retention:
  logo: { rate, basis, window }
  revenue: { grr, nrr, convention, window }
  by_segment[]: segment, logo, grr, nrr, n
split:
  voluntary, involuntary, unknown        # counts and ARR, unknown never reassigned
  evidence: billing_status | cancellation_source | unresolved
decomposition:
  order_declared, mix_pp, rate_pp, interaction_pp, reconciles: bool
cohorts[]:
  cohort, n, curve[], truncated_from_month, definition_version
drivers[]:
  driver, direction, strength, observation_window, confidence, survivorship_note
reasons:
  distribution[], coverage, other_and_blank_share, picklist_version, corroboration
intervention:
  design: holdout | matched | staged | none
  effect | before_after_only
  causal_claim: made | explicitly_not_made
not_established[]: …
```

---

## 9. Answering

**Answer first**, then split the number that was hiding something.

> **Net revenue retention is 104%, and gross revenue retention is 79%.** The
> headline number is healthy because enterprise expansion is covering real
> losses: SMB logo retention is 61% and falling, enterprise is 94% and flat.
>
> Roughly a fifth of SMB churn is involuntary — failed payments, not decisions —
> which is a different problem with a different fix, and it is the cheaper half
> to address. Another 12% of cancellations have no recorded source, and I have
> left those in an unknown bucket rather than assigning them.
>
> Blended retention actually rose 1.9 points this year, but both segments got
> worse. The entire improvement is a mix shift toward enterprise: you sold less
> to the segment that churns. That is a real business change and it is not a
> retention improvement.
>
> No holdout ran on the onboarding programme, so I cannot attribute any of this
> to it. Retention moved; three other things moved in the same window.
>
> For a board slide on trajectory, the segmented pair with the mix note is the
> honest version. For deciding where to invest next quarter, the SMB involuntary
> split is the clearest opportunity and the fastest to test.

**Withhold only:** a causal attribution of a retention change to an initiative
with no comparison group (§6) — the before-and-after numbers still ship — and a
cohort curve below the small-n floor, replaced by the counts. **Never withhold a
retention figure because it is uncomfortable or because the segmentation is
imperfect.**

---

## References

- `references/survivorship-and-cohorts.md` — the three survivorship sources with worked corrections, cohort construction, truncation and the small-n floor
- `references/churn-decomposition.md` — the mix/rate/interaction arithmetic, the voluntary split procedure, and the driver analysis with its observation-window discipline

## Core contracts called

- **`answer-contract`** — the causal refusal in §6, the unknown bucket in §2, and the small-n floor
- **`provenance-block`** — billing versus CRM source per figure, currency, timezone, and the definition version on "active"
- **`comparability-rules`** — before logo and revenue retention share an axis, before cohorts of different ages are compared, and before any period comparison crosses a definition change
- **`warning-field-reader`** — suppressed or thresholded rows in any segmented cut, which make segment sums disagree with the total

## Related skills

- `subscription-analytics` — MRR movement and the churn split arithmetic.
- `cohort-and-ltv` — cohort curves at matched horizons.
- `gtm-metric-dictionary` — GRR, NRR and the disputed conventions.
- `churn-prediction-models` — forward-looking risk, which is a different question from diagnosis.
- `experiment-design-readout` — required before any intervention claim.
- `revenue-waterfall` — the same mix/rate discipline applied to revenue.
