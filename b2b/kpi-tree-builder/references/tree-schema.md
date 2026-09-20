# Tree schema and the reconciliation algorithm

## 1. Node schema

```json
{
  "id": "opportunities_won",
  "name": "Opportunities won",
  "formula": "count of opportunities with IsWon = true, by created cohort",
  "parent": "new_business_revenue",
  "edge_type": "product",
  "siblings": ["average_deal_value"],
  "grain": "opportunity",
  "denominator": null,
  "time_basis": "created date (cohort), outcome observed at close",
  "lead_or_lag": "lagging",
  "lead_verified": null,
  "owner": "VP Sales",
  "source": {"system": "crm", "metric_version": "win_rate_v2_created_cohort"},
  "measurable": true,
  "tolerance": 0.005
}
```

For a rate node, `denominator` is mandatory and is written as a sentence, not a
field name: *"qualified leads created in the cohort period, excluding those from
excluded sources"*. A field name hides the filters; the sentence exposes them.

## 2. Edge schema

```json
{
  "parent": "revenue",
  "children": ["new_business_revenue", "expansion_revenue", "renewal_revenue"],
  "edge_type": "sum",
  "partition": true,
  "tolerance": 0.005
}
```

`partition: true` on a sum or filter edge asserts that every underlying row
belongs to exactly one child. It is checkable and it is usually where the tree
first breaks.

## 3. The reconciliation algorithm

```
for each non-leaf node n, bottom-up:

    if edge_type == "sum":
        expected = Σ children.value
    elif edge_type == "product":
        expected = Π children.value
    elif edge_type == "ratio":
        expected = numerator.value ÷ denominator.value
    elif edge_type == "filter":
        expected = Σ children.value          # only if partition == true
        also assert every child.value ≤ n.value
    elif edge_type == "driver-of":
        skip — not arithmetic

    residual = (n.value − expected) ÷ n.value
    status   = pass if |residual| ≤ n.tolerance else fail

    emit {node, value, expected, residual, status}
```

Rules:

- **Bottom-up.** A parent's check is meaningless if its children have not been
  validated first.
- **Report every residual**, including passing ones. A node that passes at 0.4%
  every month and suddenly passes at 0.49% is drifting toward a real problem.
- **Never auto-correct.** A tree that silently plugs the residual into the
  largest child is a tree that hides the finding.
- **Partition assertions are separate checks** from the sum check. Children can
  sum correctly while overlapping, if the overlap is offset by a gap.

## 4. Residual diagnosis

| Residual pattern | Likely cause | Confirm by |
|---|---|---|
| Small, stable, positive | a missing child of constant relative size — services, overages, a small channel | list the parent's underlying rows and group by a dimension none of the children filter on |
| Small, stable, negative | double counting in one child | check the partition assertion; look for rows matching two children's filters |
| Large and growing | a new revenue stream nobody modelled | same grouping check, but on recent periods only |
| Oscillating around zero by period | timing — children on different date bases, or different timezones | compare each child's date basis and the source's day-boundary timezone |
| Appears only at period boundaries | incomplete-period effects, or a settling window on one child's source | re-run excluding the most recent period |
| Fails only on a product edge | a rate and a count from different cohorts | check that every factor in the product comes from the same cohort |
| Fails after a source change | metric version drift in one child | compare `metric_version` across refreshes |
| Fails only in one currency or region | FX conversion applied at different rates or dates | check the conversion rate and its date on each child |

**The product-edge check deserves its own mention** because it fails quietly.
`opportunities_created × win_rate = opportunities_won` is an identity **only**
when the win rate is the created-cohort rate over the same cohort. Substituting
a close-date win rate produces a product that is not any quantity in the
business, and the residual is the only thing that reveals it.

## 5. Grain consistency

A sum edge across children at different grains cannot reconcile, and the error
often looks like a data problem rather than a design problem.

```
check: all children of a sum edge share a grain
       all factors of a product edge are dimensionally consistent
```

Dimensional check for products — the units must multiply to the parent's units:

```
opportunities (count) × average deal value (currency/opportunity) = currency ✓
opportunities (count) × win rate (dimensionless)                  = count    ✓
sessions (count) × conversion rate (orders/session)               = orders   ✓
pipeline (currency) ÷ quota (currency)                            = ratio    ✓
(opps × win rate × value) ÷ cycle length (days)  = currency/day            ✓
```

A product whose units do not resolve to the parent's units is wrong regardless
of what the numbers say. This catches the pipeline-velocity mislabelling —
revenue per unit time, not a duration — before it reaches a slide.

## 6. Refresh discipline

- **Re-run the full reconciliation on every refresh**, not on build only. Trees
  break when a source changes, and nothing else will tell you.
- **Version the tree.** A node's formula changing is a tree version change, and
  trend charts crossing a version boundary carry the same warning as any other
  definition drift.
- **Record the residual history.** Residual drift over time is an early signal
  of a source change nobody announced.
- **Propagate source limitations upward.** A leaf fed by a sampled, thresholded
  or row-capped source makes its parent's value carry that limitation. Mark it
  on the parent rather than losing it at the leaf.

## 7. Unmeasurable nodes

```json
{
  "id": "sales_accepted_leads",
  "name": "Sales-accepted leads",
  "parent": "qualified_leads",
  "edge_type": "filter",
  "measurable": false,
  "why": "no SAL event exists: no status value, no task type, no timestamp",
  "instrumentation": "a lead status value, or a task type logged on acceptance",
  "consequence": "MQL→SQL blends rejected and never-worked leads, which have opposite fixes",
  "owner": "VP Sales Ops"
}
```

Unmeasurable nodes are **excluded from the arithmetic** but **present in the
tree**, and they carry an owner — because the owner of the gap is the person who
can close it. A list of unmeasurable nodes ordered by cost-to-instrument is one
of the more useful artefacts this skill produces.
