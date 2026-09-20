# Ecommerce metric definitions

Formula, grain, denominator, miscomputation. Where the industry genuinely
disagrees, the conventions are listed and one is marked as the default.

## Revenue and order value

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Gross revenue | Σ order value as placed | order | — | including cancelled orders that never paid |
| Net revenue | gross − discounts − refunds − cancellations | order | — | omitting refunds, which is the usual case |
| Orders | count of orders | order | — | counting line items; counting draft or abandoned orders that the platform stores as order objects |
| Units | Σ line quantity | line item | — | counting lines instead of quantity |
| **Gross AOV** | gross revenue ÷ orders | order | orders in window | — |
| **AOV net of discounts** | (gross − discounts) ÷ orders | order | orders in window | order-level discount not allocated when computing at line grain |
| **AOV net of returns** | (gross − discounts − refunds) ÷ orders | order | orders in window | refunds from a different period's orders in the numerator |
| Median basket | median order value | order | — | omitted entirely; the mean alone misleads on a skewed distribution |
| Units per order | units ÷ orders | order | orders in window | computed as a mean of per-order means (average of averages) |
| Average unit retail | net revenue ÷ units | line item | units | mixing with AOV, which is a different denominator |

**Shipping and tax.** Both can be inside or outside every figure above.
Whether tax is in revenue at all is a platform-configuration and jurisdiction
decision. State the treatment; do not assume it is consistent across markets.

## Traffic and conversion

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Sessions | as the analytics tool constructs them | session | — | treating sessions as a natural quantity rather than a rules output |
| Users | distinct identifiers in the window | user | — | summing daily users to a monthly figure; users do not add |
| **Conversion rate** | orders ÷ sessions | session | sessions in window | site-wide rate over a changing new/returning mix |
| New-visitor CR | new-visitor orders ÷ new-visitor sessions | session | new-visitor sessions | — |
| Returning-visitor CR | returning orders ÷ returning sessions | session | returning sessions | — |
| Revenue per session | net revenue ÷ sessions | session | sessions in window | the more robust alternative to CR × AOV, which double-counts mix effects |
| Add-to-cart rate | sessions with an add-to-cart ÷ sessions | session | sessions | counting add-to-cart events rather than sessions containing one |

**New versus returning is a definitional choice** the analytics tool makes, and
it is cookie- or identity-based, so it degrades with tracking restrictions and
cross-device behaviour. The split is still worth making; the labels are
approximate and should be called approximate.

**Users do not sum.** Daily users summed across a month exceeds monthly users
by the repeat-visit factor. This is the same non-additivity as unique reach in
ad platforms.

## Funnel and abandonment

```
Cart abandonment     = 1 − (orders ÷ carts created)
Checkout abandonment = 1 − (orders ÷ checkouts initiated)
Payment failure rate = failed payment attempts ÷ payment attempts
```

| Denominator candidate | What it counts | Effect on the rate |
|---|---|---|
| Add-to-cart event | any item added | highest denominator, highest abandonment |
| Cart page view | intent to review | moderate |
| Server-side cart object created | persisted cart | lower, and more stable |
| Checkout step 1 event | entered checkout | lowest denominator, lowest abandonment |

**Four definitions, four rates, all defensible.** Report the event definition
with the number, and never compare abandonment across two tools without
normalising it first.

The more useful artefact is the **step funnel** with each event named:
`add to cart → view cart → begin checkout → add payment → purchase`, with the
drop at each step. It localises the problem, which a single abandonment
percentage cannot.

## Returns

```
Return rate (cohort)  = refunded value from orders placed in cohort
                        ÷ gross value of orders placed in cohort
                        computed only on cohorts aged past the return window

Return rate (naive)   = refunds issued in period ÷ orders placed in period
```

- **The naive version is a ratio of two unrelated populations.** In a growing
  business it understates returns (the denominator grew while refunds reflect
  smaller past cohorts); in a shrinking one it overstates them.
- **Recent-cohort return rates are lower bounds** and rise until the window
  closes.
- **Return rate by product and by category** is where the actionable variation
  is, and it must be computed at line-item grain — a partial return is not a
  cancelled order.
- Return **reason** data, where it exists, is subject to the same caveats as
  CRM loss reasons: it is what the customer was willing to select from a list.

## Margin

```
CM1 = net revenue − COGS
CM2 = CM1 − fulfilment − shipping cost − payment processing
CM3 = CM2 − variable marketing
```

- **State the level.** CM2 stops before ad spend; CM3 includes it. A break-even
  MER derived from an unstated CM level is unusable (`paid-media-analytics`).
- **Net revenue, not gross.** A margin computed on gross revenue in a
  high-return category is wrong by most of the margin.
- **Shipping charged is revenue; shipping cost is a cost.** They are different
  numbers and frequently netted by accident.
- COGS at line-item grain, allocated order-level costs by a declared rule.

## Product and category

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Product revenue share | product net revenue ÷ total net revenue | line item | total net revenue | computed before returns, which flatters high-return products |
| Attach rate | orders containing product A ÷ orders | order | orders in window | computed at line grain, which counts multi-quantity as multi-order |
| Category mix | category net revenue ÷ total | line item | total | category assignment as-of-today applied to historical orders |
| Sell-through | units sold ÷ units available | line item | units available in window | inventory snapshot taken at the wrong point in the window |

**Declare whether category is as-of-order or as-of-today.** A product
recategorised mid-window produces two different category rankings depending on
the choice, and neither is wrong.

**High-cardinality product dimensions hit GA4's `(other)` row.** A dimension
with more than 500 unique values in a day gets rolled up, and
`dataLossFromOtherRow` in `ResponseMetaData` tells you it happened. Product
IDs, page paths with query strings and SKU-level dimensions are the usual
victims; the long tail of products disappears and the total stays correct,
which is exactly the shape of a silently wrong report.
