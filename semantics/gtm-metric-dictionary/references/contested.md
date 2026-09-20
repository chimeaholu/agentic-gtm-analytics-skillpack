# The genuinely contested metrics

These are not cases where one side is wrong. Several conventions are
defensible, they give materially different numbers, and the only failure is
using one without saying which.

For each: the conventions, how far apart they land, and what to do when nobody
in the org can say which one they mean.

---

## NRR / Net Revenue Retention

**Five independent choices.** An NRR can legitimately land anywhere in a ~15
point range on the same underlying data.

| Choice | Option A | Option B | Which is defensible |
|---|---|---|---|
| Cohort | customers present at period start | all customers touched in period | A only. B lets new logos inflate it. |
| In-period new logos | excluded from numerator and denominator | included | Excluded. Implementations leak them constantly. |
| FX | constant currency | as reported | Both. State it. A 10% FX move on a 30% international book shifts NRR ~3 points. |
| Chaining | `∏` of 12 monthly NRRs | single point-to-point 12-month comparison | Both. They differ whenever growth is non-linear; chained runs higher when churn is concentrated. |
| Weighting | ARR-weighted | customer-count-weighted | ARR-weighted is what almost everyone means. Count-weighted is a different metric and should be called logo retention. |

**If nobody can say:** compute ARR-weighted, start-of-period cohort, new logos
excluded, point-to-point, as reported. Label every one of those five choices in
one sentence. Then state which single alternative choice would move the number
most, and by roughly how much if it is cheap to compute.

---

## ACV

| Convention | Formula | When it is right |
|---|---|---|
| Annualised TCV | `TCV ÷ contract years` | comparing deal sizes across different term lengths |
| First-year value | year-1 contracted value | cash planning and commission |
| Recurring-only | recurring components annualised, services excluded | SaaS multiple and valuation contexts |

On a ramped $100k / $200k / $300k three-year deal: annualised TCV = $200k,
first-year = $100k. **A 2x difference on the same contract.**

**If nobody can say:** annualised TCV, labelled, with the first-year figure
given alongside.

---

## Win rate

Four denominators (see SKILL.md §3.1). The dispute is real because the
questions differ:

- "Of deals that closed, how many did we win?" → close-date basis
- "Of deals we started, how many will we win?" → cohort basis
- "When a customer made a decision, did they pick us?" → excluding no-decision
- "Of the money in play, how much did we get?" → dollar-weighted

All four are legitimate answers to different questions. **Pick by the question
asked, not by convention**, and name it.

---

## Contribution margin: CM2 vs CM3

| Level | Subtracts |
|---|---|
| CM1 | COGS |
| CM2 | + fulfilment, shipping, payment processing |
| CM3 | + variable marketing |

Break-even MER derives from CM2 (you cannot subtract marketing and then
solve for marketing). Profitability-per-order conversations usually mean CM3.
**Returns and refunds belong in CM1 or CM2 depending on whether the product is
resellable**, and are the most commonly omitted term in both.

---

## Sales cycle: including lost deals or not

- **Won-only** cycle is what a rep means by "how long does a deal take".
- **Won and lost** cycle is what a capacity model needs, because lost deals
  consume capacity too, and they often die slowly.

Both conventions are in active use. The won-only figure is typically 15-30%
shorter. State which, and use won-and-lost for anything involving rep capacity.

---

## MQL

There is no industry-standard definition and there is no defensible canonical
one. It is a threshold on a rule the org wrote. The only correct handling:

1. Read the current rule and **date it**.
2. Find out whether it changed inside the reporting window.
3. If it changed, mark the change on every trendline that crosses it and
   refuse to describe the crossing as a trend.
4. Never compare an MQL count across orgs.

---

## LTV horizon

An unqualified "LTV" is ambiguous. The three live versions:

- `(ARPA × GM) ÷ churn` closed form: assumes constant churn forever, invalid
  when net retention ≥ 100%
- Bounded N-month cumulative gross profit from the actual cohort curve
- Predicted LTV from a model (a forecast, and must be labelled as one)

**Only compare LTVs at the same horizon.** A 36-month LTV against a 24-month
LTV is not a comparison. When asked for "LTV" with no horizon, give the
24-month bounded figure and name the horizon in the same sentence.

---

## Attribution model for any revenue-credited metric

Any metric with "attributed" in it (attributed revenue, channel ROAS, source
of pipeline) inherits the attribution model's assumptions. First-touch,
last-touch, linear, time-decay, U-shaped, W-shaped, data-driven and
platform-modelled all produce different credit for the same revenue. They are
not conventions of the metric; they are conventions of the model. Emit the
model with the number, and see `attribution-rule-based` for the spread.

---

## How to handle a contested metric in an answer

1. Compute the most common convention.
2. Name it in one sentence.
3. Name the alternative that would move the number most, and the direction.
4. Say whether the difference matters for the decision at hand. Often it does
   not, and saying so is the difference between a useful tool and a pedantic
   one.

Never respond to a contested metric by refusing to produce a number.
