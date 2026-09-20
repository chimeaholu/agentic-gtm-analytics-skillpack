# Canonical trees

Three trees with every formula, denominator, edge type and lead/lag label.
Adapt the shape to the org's motion; do not adopt it unexamined.

---

## 1. B2B new-business tree

| Node | Formula | Edge to parent | Grain | Denominator | Lead/lag |
|---|---|---|---|---|---|
| Revenue | bookings recognised in period | root | period | — | lagging |
| New business revenue | bookings from new logos | sum | period | — | lagging |
| Expansion revenue | bookings from existing customers above renewal | sum | period | — | lagging |
| Renewal revenue | bookings from contracts renewed | sum | period | — | lagging |
| Opportunities won | count won, by created cohort | product | opportunity | — | lagging |
| Average deal value | won amount ÷ opportunities won | product | opportunity | opportunities won in the cohort | lagging |
| Opportunities created | count created in period | product | opportunity | — | **leading** |
| Win rate | won ÷ all created in cohort | product | opportunity | **declare** — created cohort for this edge | lagging |
| Qualified leads | count reaching the qualification threshold | product | person or demand unit | — | **leading** |
| Lead→opp rate | opportunities created from cohort ÷ qualified leads in cohort | product | person | qualified leads created in the cohort | lagging |
| Inquiries | count of hand-raises | product | person | — | **leading** |
| Qualification rate | qualified ÷ inquiries in cohort | product | person | inquiries created in the cohort | lagging |
| Traffic | sessions | product | session | — | **leading** |
| Site conversion rate | inquiries ÷ sessions | product | session | sessions in the window | lagging |

**Load-bearing notes.**

- Every product edge is a **cohort statement**. `Opportunities created × win
  rate = opportunities won` holds only when the win rate is the created-cohort
  rate over that cohort. Using the close-date rate breaks the identity, and the
  residual is the only signal.
- **Declare the unit.** If the org sells to buying groups, the funnel above
  `Opportunities created` should be at demand-unit grain, not person grain, or
  the rates are off by roughly the buying-group size
  (`account-based-analytics`).
- Expansion and renewal both need their own denominators:
  `gross renewal rate = renewed ARR ÷ ARR up for renewal in the period`.
  GRR is **structurally capped at 100%**; above it means expansion is leaking
  in (`gtm-metric-dictionary` §4.2).
- **New versus expansion must partition.** Upsells booked as new-logo
  opportunities are the usual cause of a sum edge exceeding its parent.

---

## 2. B2C / ecommerce tree

| Node | Formula | Edge | Grain | Denominator | Lead/lag |
|---|---|---|---|---|---|
| Revenue | gross order value in period | root | period | — | lagging |
| New-customer revenue | orders from first-time customers | sum | period | — | lagging |
| Repeat revenue | orders from returning customers | sum | period | — | lagging |
| New customers | distinct first-time purchasers | product | customer | — | lagging |
| First-order AOV | new-customer revenue ÷ new customers | product | order | new customers in period | lagging |
| Sessions | sessions, **as the analytics tool constructs them** | product | session | — | **leading** |
| New-visitor conversion rate | new-visitor orders ÷ new-visitor sessions | product | session | new-visitor sessions | lagging |
| Repeat customers | distinct returning purchasers | product | customer | — | lagging |
| Purchase frequency | repeat orders ÷ repeat customers | product | customer | repeat customers in period | lagging |
| Repeat AOV | repeat revenue ÷ repeat orders | product | order | repeat orders | lagging |
| Contribution margin | (revenue − COGS − fulfilment − payment − returns) ÷ revenue | ratio | period | revenue, at the **stated CM level** | lagging |

**Load-bearing notes.**

- **Split new and returning at the conversion node.** They differ several-fold,
  so a site-wide rate moves on mix with no behaviour change. A blended node
  makes the tree reconcile while hiding the driver.
- **Sessions are constructed**, so the denominator changes when sessionization
  rules change and bot traffic sits inside it.
- **Contribution margin sits at a declared level.** CM2 stops before ad spend;
  CM3 includes it. A CM3 margin applied above the ad-spend node double-counts
  the spend.
- **Returns and refunds belong in the tree**, not in a footnote — in some
  categories they run 10–30% and are the most commonly omitted term.

---

## 3. Subscription tree

| Node | Formula | Edge | Grain | Denominator | Lead/lag |
|---|---|---|---|---|---|
| Ending MRR | starting + new + expansion − contraction − churn + reactivation | root | month | — | lagging |
| New MRR | MRR from subscriptions starting this month | sum | month | — | lagging |
| Expansion MRR | increases on existing subscriptions | sum | month | — | lagging |
| Contraction MRR | decreases on existing subscriptions (not to zero) | sum (negative) | month | — | lagging |
| Churned MRR | MRR of subscriptions ending this month | sum (negative) | month | — | lagging |
| Reactivation MRR | MRR from previously churned subscriptions restarting | sum | month | — | lagging |
| Gross revenue retention | (starting − churn − contraction) ÷ starting | ratio | month | starting MRR, **cohort present at period start** | lagging |
| Net revenue retention | (starting − churn − contraction + expansion) ÷ starting | ratio | month | same cohort; **exclude in-period new logos from both sides** | lagging |
| Trial starts | trials beginning in period | driver-of New MRR | trial | — | **leading** |
| Trial→paid rate | trials converting within N days ÷ trials starting in cohort | product | trial | trials starting in the cohort | **leading** |
| Involuntary churn | churn from failed payments | filter of churned MRR | subscription | churned MRR | lagging |
| Voluntary churn | churn from cancellation | filter of churned MRR | subscription | churned MRR | lagging |

**Load-bearing notes.**

- **The waterfall is a sum edge that must reconcile exactly**:
  `starting + new + expansion − contraction − churn + reactivation = ending`.
  If it does not, the model is wrong and the components should not be
  presented (`subscription-analytics`).
- **Voluntary and involuntary churn must partition churned MRR.** They have
  different fixes; blending them hides a solvable billing problem.
- **GRR is capped at 100%.** Above it is a formula bug, usually expansion in
  the numerator.
- **NRR carries five convention choices** (cohort, in-period new logos, FX,
  chained versus point-to-point, ARR- versus count-weighted). Emit the
  convention with the node.
- **Trial→paid is a driver edge to New MRR, not a product edge**, unless the
  tree models trial volume explicitly — otherwise the arithmetic double-counts
  conversions already inside New MRR.

---

## 4. Dashboard cuts from the tree

| Audience | Nodes | Count |
|---|---|---|
| Board | Revenue, its three sum-children, one leading node per branch, NRR or GRR | 6–9 |
| CRO | New business branch two levels down, plus coverage and win rate | 8–12 |
| Demand gen | Inquiries, qualification rate, qualified leads, lead→opp rate, cost per node | 6–10 |
| Sales ops | Opportunities created, win rate, cycle, coverage, attainment distribution | 8–10 |
| Lifecycle / retention | the subscription tree's movement nodes plus trial→paid | 7–9 |

**Every tile answers "if this moves, what do I do?"** Nodes whose owner sits
elsewhere belong on that owner's dashboard, not on this one.
