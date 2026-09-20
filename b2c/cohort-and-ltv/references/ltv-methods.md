# LTV methods compared

Three methods, three different objects. The label matters as much as the
number.

---

## 1. Observed cohort LTV (the default)

```
LTV_H(cohort) = Σ over t = 0..H of gross profit from the cohort in period t
                ÷ cohort size
```

- **What it is:** a measurement of what a cohort actually delivered, to a stated
  horizon.
- **Inputs:** order or subscription history, cohort assignment, per-period
  variable costs.
- **Grain:** cohort × horizon.
- **Assumptions:** none beyond the cost model.
- **Limits:** only available for cohorts that have reached the horizon; recent
  cohorts give a lower bound.
- **Use it:** for payback decisions, cohort quality comparisons, planning
  against realised history — which is nearly always.

**Choose the horizon from the decision**, name it in the label, and never
compare two horizons.

---

## 2. Closed-form `1 ÷ churn`

```
LTV = (ARPA × gross margin) ÷ churn rate
```

- **What it is:** an extrapolation assuming constant churn forever.
- **Inputs:** ARPA, gross margin, one churn rate with a declared convention.
- **Assumptions:** churn is constant across tenure; ARPA is constant; there is
  no expansion.
- **Failure modes:**
  - **Churn is not constant.** Conditional retention rises with tenure in almost
    every business, so the formula **understates good businesses and overstates
    bad ones**.
  - **The churn convention is load-bearing.** Monthly versus annual, customer
    versus revenue, start-of-period versus average base — four choices, four
    answers.
  - **Invalid at NRR above 100%.** The denominator goes to zero or negative and
    LTV approaches infinity. **Report that the form does not apply**, not a very
    large number.
- **Use it:** as a cross-check against the observed figure where churn is
  roughly flat across tenure, and for a quick order-of-magnitude sanity read on
  a business with no cohort history yet.

**The honest way to present it:** give it, name the assumption, name the
direction of its error against the observed curve, and lead with the bounded
horizon figure.

---

## 3. Predictive LTV (BG/NBD + Gamma-Gamma)

- **What it is:** a model. Output is an expectation with uncertainty, not a
  measurement.
- **Setting:** **non-contractual** — ecommerce and DTC, where churn is not
  observable. For subscriptions, churn *is* observable; use survival analysis or
  the observed curve instead.
- **Structure:** BG/NBD models purchase frequency and a dropout probability
  after each purchase; Gamma-Gamma models average order value conditional on
  frequency; the product is expected future value.
- **Inputs:** per-customer recency, frequency, monetary value (RFM summary), and
  an observation window.
- **Assumptions, and where each breaks:**

| Assumption | Breaks when |
|---|---|
| Purchases follow a Poisson process while active | purchases are seasonal, subscription-like, or replenishment-driven with a regular cycle |
| Dropout is memoryless after each purchase | there is a lifecycle with a known end (a course, a pregnancy, a lease) |
| **Monetary value is independent of frequency** | frequent buyers spend systematically differently per order — **common in DTC; check it before trusting the monetary component** |
| Customers act independently | referrals, household accounts, shared logins |
| The observation window is representative | the window contains a promotional spike or a stockout |

- **Validation before use:** hold out the last N months, fit on the earlier
  period, and compare predicted against actual purchases and value in the
  holdout. **Report that comparison**; a predictive LTV with no holdout check is
  an assertion.
- **Presentation:** label the series **modelled** at the point of display, show
  the observed curve underneath, and state the assumptions. Never place a
  modelled figure in the same column as observed values without labels.
- **Dependencies are declared explicitly.** A module importing statistical
  libraries that appear nowhere in the project's declared dependencies works on
  the author's machine and fails in a clean container.

---

## 4. LTV:CAC and payback

```
LTV:CAC        = LTV_H ÷ CAC
CAC payback    = months until cumulative gross profit per acquired customer
                 reaches CAC
```

- **The 3:1 rule has no empirical basis.** It propagated through blog posts.
- **Present payback first.** A 3:1 ratio coexists happily with a 24-month
  payback, and a 24-month payback is a fatal cash problem for a company that is
  not already profitable.
- **The two sides must match.** `LTV_H` in gross profit against a **fully
  loaded** CAC — media spend plus salaries, commissions, tooling, agency fees
  and allocated overhead. Media-only CAC is typically 40–60% of the real number,
  and pairing it with a gross-profit LTV produces a ratio that is wrong twice.
- **Cohort-match them.** LTV from a cohort and CAC from the same cohort's
  acquisition period. Blended CAC this month against LTV from cohorts acquired
  two years ago compares two different businesses.
- **Payback read off the observed curve** is more useful than payback computed
  from a ratio, because it is the month number a CFO can plan against.

---

## 5. Choosing

| Situation | Method |
|---|---|
| Cohorts have reached the horizon you care about | observed |
| Cohorts are young but some history exists | observed to the available horizon, as a lower bound, plus the shape of older cohorts |
| Non-contractual, need forward-looking per-customer value for targeting | predictive, labelled modelled, validated on a holdout |
| Contractual/subscription, need forward-looking value | survival curve or observed cohort projection — not BG/NBD |
| No history at all | closed form as an order-of-magnitude estimate, clearly labelled, with the constant-churn assumption named |
| NRR above 100% | observed bounded horizon only; the closed form does not apply |

**In every case, the horizon, the margin basis and the cohort definition travel
with the number.** An LTV figure without them cannot be compared to anything,
including itself next quarter.
