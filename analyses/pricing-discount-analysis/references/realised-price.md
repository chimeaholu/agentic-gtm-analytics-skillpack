# Computing realised price

The headline discount is one line in a ledger of six or seven. This page is how
to build the rest of the ledger from fields that exist.

---

## 1. The ledger, with valuation rules

| Concession | Detection | Valuation |
|---|---|---|
| **Percentage discount** | discount field non-zero, or `UnitPrice < ListPrice` | `(ListPrice − UnitPrice) × Quantity` |
| **Free months** | contract term ≠ billing term; a start date preceding the first billed period | `invoiced × (12 / months_of_service) ` for the annualised figure |
| **Free units** | `UnitPrice = 0` with `ListPrice > 0`, or entitled quantity > billed quantity | reduces **realised unit price**; leaves revenue unchanged |
| **Waived fees** | a one-time fee line at zero, or absent where standard | list fee foregone, **plus the marginal cost still incurred to deliver it** |
| **Bundled services** | a services line at zero, or an SOW referenced on the order | **cost to deliver**, never list. A margin item |
| **Extended payment terms** | payment terms field ≠ standard | `amount × cost_of_capital × extra_days / 365` |
| **Price holds / capped uplifts** | renewal or multi-year clause | foregone uplift in future years, discounted to present value |
| **MFN clauses** | contract text only | **not quantifiable up front — report the count, not a number** |

**Free units are the one that vanishes in a revenue-only analysis.** Revenue is
unchanged, realised unit price falls, and delivery capacity is consumed. Any
per-seat or per-unit pricing conclusion is wrong without them.

---

## 2. The arithmetic

```
months_of_service    = contract_end − service_start, in months
annualised_revenue   = invoiced_amount × 12 / months_of_service
                       − waived_fees_list
                       − bundled_services_cost
realised_unit_price  = annualised_revenue / units_delivered
list_annual_value    = Σ (ListPrice × entitled_quantity) + standard_fees
effective_discount   = 1 − annualised_revenue / list_annual_value
```

### Worked

10 seats at 1,000/seat/year plus a 2,000 onboarding fee. **List annual value
12,000.**

| Step | Concession | Annualised revenue | Effective discount | Realised unit price |
|---|---|---|---|---|
| 0 | list | 12,000 | 0% | 1,000 |
| 1 | 10% off subscription | 11,000 | 8.3% | 900 |
| 2 | onboarding fee waived | 9,000 | 25.0% | 900 |
| 3 | 2 free months — 14 months of service for 9,000 | 7,714 | **35.7%** | 771 |
| 4 | 2 extra seats free — 12 delivered | 7,714 | 35.7% | **643** |

**Quote says 10%. Realised erosion is 35.7%, and realised per-seat price is 36%
below list.** Steps 2 and 3 are invisible in the discount field; step 4 is
invisible in revenue entirely.

---

## 3. Field map

### Salesforce

| Field | Meaning | Caution |
|---|---|---|
| `OpportunityLineItem.ListPrice` | price book entry price **at quoting time** | reflects the price book then in force; correct for the deal, wrong for like-for-like comparison across a price change |
| `OpportunityLineItem.UnitPrice` | agreed price per unit | `0` with a non-zero `ListPrice` is a free-of-charge line |
| `OpportunityLineItem.Discount` | percentage | **only the headline** |
| `OpportunityLineItem.TotalPrice` | `UnitPrice × Quantity` | a filter of `TotalPrice > 0` **silently drops every free-of-charge line** |
| `OpportunityLineItem.Quantity` | billed quantity | may differ from entitled quantity, which often lives in a custom field or the contract |
| `Opportunity.Amount` | roll-up of line items | **manually overridable.** Reconcile against the line-item sum |
| `Opportunity.CurrencyIsoCode` | per-record currency | present only with multi-currency enabled |
| `QuoteLineItem.Discount`, `.Subtotal`, `.TotalPrice` | quote-level equivalents | quotes and opportunities can disagree; the signed quote is usually the better evidence |

### HubSpot

| Field | Meaning |
|---|---|
| line item `price`, `quantity`, `amount` | the agreed figures |
| `hs_discount_percentage`, `hs_total_discount` | headline discount, percentage and absolute |
| `hs_term_in_months`, `recurringbillingfrequency` | the term fields that reveal free months |

**Note the permission asymmetry**: a HubSpot private-app token is portal-scoped
and returns more than a UI user sees, while Salesforce field-level security omits
fields rather than erroring. **A concession field that appears empty may be a
permission effect rather than an empty field** — verify before concluding the
concession does not exist. See `permission-effect-audit`.

---

## 4. Reconciling deal amount to line items

```sql
select o.id,
       o.amount                              as deal_amount,
       sum(li.total_price)                   as line_item_sum,
       o.amount - sum(li.total_price)        as gap
from opportunities o
join line_items li on li.opportunity_id = o.id
where o.is_closed and o.is_won
group by 1, 2
having abs(o.amount - sum(li.total_price)) > 0.01;
```

Read the result as a finding, not a data-quality chore:

- **Gaps in one direction, systematically** — the amount is being overridden, and
  usually to include or exclude something the line items do not carry.
- **Gaps concentrated on one rep or one product** — a process difference worth a
  conversation.
- **Gaps only on deals with services** — the services value is being handled
  outside the line items, which is exactly where the unrecorded concessions live.

**Report the mismatch count and total in the output.** A realised-price analysis
computed on line items while the business reports on `Amount` will produce two
different numbers and a lost afternoon.

---

## 5. Currency

**No platform supplies a currency type**, so a currency mismatch produces silently
wrong numbers rather than errors.

Declare three things:

| Decision | Options |
|---|---|
| **Conversion basis** | close date, quote date, period-end, or plan rate |
| **Rate source** | which table, and its refresh date |
| **Scope** | whether list prices are converted as well, or held in local currency |

**List and realised must be in the same currency at the same rate**, or the
computed "discount" contains an FX movement.

On Salesforce with multi-currency enabled, check whether **dated exchange rates**
are configured. If they are not, converted amounts on historical records use
today's rate, which means **every historical discount changes when the rate
moves** — a restatement with no business cause, and one nobody announces.

---

## 6. When the concession data does not exist

This is the common case, and the answer is not silence.

1. **Report the headline discount** and label it explicitly as a **lower bound on
   erosion**.
2. **Size the gap where any evidence exists.** Even "38% of won deals have a
   contract term longer than their billing term" is a quantified statement about
   how much is missing.
3. **Name the specific fields or documents that would close it** — entitled
   quantity, service start date, the fee schedule, the SOW register.
4. **Estimate the direction, never the magnitude.** Realised erosion is higher
   than headline; how much higher is unknown without the data, and inventing a
   multiplier is worse than the gap, because an invented number gets treated as
   measured.
