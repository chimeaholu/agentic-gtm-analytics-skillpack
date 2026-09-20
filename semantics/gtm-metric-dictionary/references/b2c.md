# B2C, ecommerce and subscription metric reference

## Acquisition and media

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Platform ROAS | platform-attributed conversion value ÷ platform spend | platform spend | campaign | platform attribution date | lagging | view-through credit, modelled conversions, and each platform claiming the same sale |
| Blended ROAS | total revenue ÷ total ad spend | total ad spend | account | order date | lagging | includes organic and repeat revenue in the numerator |
| MER | total revenue ÷ total marketing spend | total marketing spend | account | order date | lagging | break-even is `1 ÷ contribution margin`, not a universal number |
| aMER | new-customer revenue ÷ total marketing spend | total marketing spend | account | order date | lagging | needs a reliable new-vs-returning flag; guest checkout breaks it |
| Blended new-customer CAC | total marketing spend ÷ new customers | new customers in period | customer | first order date | lagging | using all orders flatters repeat-heavy brands |
| CPA / CPL | spend ÷ conversions | platform-reported conversions | campaign | platform attribution date | lagging | platform conversion definition differs per platform and per attribution window |
| Cost per first order | spend ÷ first orders | first orders in period | order | order date | lagging | returning customers counted as new when identity is not resolved |
| Creative CTR | clicks ÷ impressions | impressions | creative | serve date | leading | auto-placement means impression mix, not creative, moves it |

## Store and basket

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Conversion rate | orders ÷ sessions | sessions | session | session start | lagging | session definition is a construction; GA4's 30-min inactivity gap is convention |
| AOV (gross) | gross order value ÷ orders | orders | order | order date | lagging | five versions exist; see below |
| AOV (net of discount) | (gross − discounts) ÷ orders | orders | order | order date | lagging | promo-heavy periods diverge sharply from gross |
| AOV (net of returns) | (gross − discounts − returns) ÷ orders | orders | order | order date | lagging | returns land weeks later; recent periods overstate |
| Units per order | units ÷ orders | orders | order | order date | lagging | bundles counted as one unit or many |
| Cart abandonment | 1 − (orders ÷ carts created) | carts created | cart | cart creation | leading | bot traffic inflates carts |
| Revenue per session | revenue ÷ sessions | sessions | session | session start | lagging | changing the sessionization gap restates the entire history |

**The five AOVs.** Gross; net of discounts; net of returns; including or
excluding shipping revenue; including or excluding tax. These differ by up to
25% on the same orders. State which. Report the **median basket** alongside the
mean where there is a long tail.

## Retention and value

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Repeat purchase rate | customers in cohort with ≥2 orders within N days ÷ cohort | acquisition cohort | customer | first order date | lagging | all-time RPR measures business age, not loyalty; fix N at 60 or 90 days |
| Purchase frequency | orders ÷ unique customers in window | customers active in window | customer | order date | lagging | window length silently drives it |
| Time to second order | median days between order 1 and order 2 | customers with ≥2 orders | customer | first order date | lagging | survivorship: one-time buyers excluded entirely |
| Cohort LTV at month N | cumulative gross profit per cohort ÷ cohort size | cohort size | customer | cohort month | lagging | compare cohorts **only at the same N**; younger cohorts are not worse, they are younger |
| Contribution margin | CM1/CM2/CM3, stated | revenue | order | order date | lagging | **returns and refunds omitted**, 10-30% in apparel |
| RFM segments | recency, frequency, monetary quantiles | active customer base | customer | last order date | leading | window must match the category's natural purchase cycle |

## Subscription

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| MRR | Σ normalised monthly recurring value of active subs | n/a | subscription | snapshot date | lagging | annual plans must be divided by 12, not counted in the signup month |
| MRR movement | new + expansion − contraction − churn | starting MRR | subscription | month | lagging | reactivation is a fifth bucket and is usually silently folded into new |
| Gross MRR churn | churned MRR ÷ starting MRR | starting MRR | subscription | month | lagging | capped at 100%; above that is a bug |
| Net MRR churn | (churn + contraction − expansion) ÷ starting MRR | starting MRR | subscription | month | lagging | can be negative, which is good and confuses charts |
| Voluntary churn | cancellations ÷ starting subscribers | starting subscribers | subscriber | month | lagging | must be split from involuntary; dunning fixes only one |
| Involuntary churn | failed-payment terminations ÷ starting subscribers | starting subscribers | subscriber | month | lagging | dunning retries mean the churn date is not the failure date |
| Annualised churn | `1 − (1 − m)^12` | n/a | subscriber | month | lagging | **not** monthly × 12 |
| Trial conversion | paid conversions ÷ trials started in cohort | trials started in cohort | trial | trial start date | leading | trials still inside their window are incomplete, not failed |
| Win-back rate | reactivations ÷ churned in prior window | churned cohort | subscriber | churn date | lagging | window choice drives the number entirely |

## Email and lifecycle

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Delivery rate | delivered ÷ sent | sent | message | send date | leading | suppression handling differs per ESP |
| Open rate | opens ÷ delivered | delivered | message | send date | leading | **Apple Mail Privacy Protection makes opens noise**; treat as directional only, never as a KPI |
| Click rate | clicks ÷ delivered | delivered | message | send date | leading | bot clicks from security scanners; use click-to-open with caution for the same reason |
| Conversion per send | attributed orders ÷ delivered | delivered | message | ESP attribution window | lagging | the ESP's own attribution window is a setting and changing it restates history |
| Unsubscribe rate | unsubscribes ÷ delivered | delivered | message | send date | lagging | list-unsubscribe header events counted inconsistently |
| Revenue per recipient | attributed revenue ÷ delivered | delivered | message | ESP attribution window | lagging | double-counts against paid media when both claim the same order |
