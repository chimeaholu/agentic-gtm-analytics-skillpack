---
name: kpi-tree-builder
description: Use when a team needs a metric hierarchy — connecting revenue or ARR down through the operational inputs that drive it, deciding what to put on a dashboard, or answering "what actually moves this number". Builds the KPI tree with each node's formula, its parent relationship, its lead/lag classification and its owner, and validates that children arithmetically reconcile to parents. Prevents a dashboard of unrelated metrics presented as a strategy, and prevents a tree whose branches do not add up.
---

# KPI tree builder

A KPI tree is a model, not a diagram. Every node has a formula, every edge is
an arithmetic relationship, and the whole thing reconciles or it is decoration.
Most "metric frameworks" in circulation are boxes connected by arrows that mean
"related to", which is why nobody can say what moves the top number.

## The node contract

Every node carries these fields. A node missing any of them is not in the tree
yet.

```
name              canonical name from the metric dictionary
formula           with every term defined
parent            the node above it
edge_type         sum | product | ratio | filter | driver-of
grain             per what: account, opportunity, session, order, rep, day
denominator       for every rate, stated as a sentence
lead_or_lag       leading (moves before revenue) | lagging (confirms)
owner             a named role, not a team
source            where the number comes from, and its metric version
measurable        yes | no — and if no, what instrumentation would change that
```

`edge_type` is what makes the tree checkable:

| Edge type | Relationship | Reconciliation check |
|---|---|---|
| **sum** | parent = Σ children | children sum to parent within tolerance |
| **product** | parent = Π children | the product equals the parent |
| **ratio** | parent = numerator ÷ denominator | both terms are themselves nodes |
| **filter** | child is a subset of parent | child ≤ parent, and the sibling subsets partition it |
| **driver-of** | correlated, not arithmetic | **no check possible — label it and keep it out of the arithmetic** |

**`driver-of` edges are allowed but never counted.** NPS drives retention; it
does not multiply into it. Mixing a driver edge into a product is how a tree
starts producing numbers nobody can reproduce.

## The reconciliation check is the whole point

Run it on every build and on every refresh:

```
for each non-leaf node:
    expected = combine(children, edge_type)
    residual = (actual − expected) ÷ actual
    fail if |residual| > tolerance
```

Tolerance is stated, not assumed. 0.5% is reasonable for warehouse-sourced
sums; wider where FX or a rounding boundary is involved. **Report the residual,
not just pass/fail** — a tree that reconciles to 4% is telling you something
specific about a missing child.

The four things a failing residual usually means:

1. **A missing child.** Revenue has a component nobody modelled — services,
   overages, a reseller channel.
2. **Double counting.** A record appears under two children, usually because a
   filter edge's siblings overlap instead of partitioning.
3. **Different grains.** A sum edge across children measured at different
   grains (one per order, one per line item) cannot reconcile.
4. **Different windows or timezones.** Children pulled with different date
   bases, or from sources bucketing days in different timezones.

**Filter edges must partition.** If children are "new", "expansion" and
"renewal", every revenue row belongs to exactly one. Overlapping definitions
are the most common cause of a tree that sums to 104%.

## Canonical B2B decomposition

Each edge below is labelled with its type, and each rate's denominator is
stated.

```
Revenue
 ├─[sum]── New business revenue
 │          └─[product]── Opportunities won × Average deal value
 │                         ├─ Opportunities won
 │                         │   └─[product]── Opportunities created × Win rate
 │                         │       ├─ Opportunities created
 │                         │       │   └─[product]── Qualified leads × Lead→opp rate
 │                         │       │       ├─ Qualified leads
 │                         │       │       │   └─[product]── Inquiries × Qualification rate
 │                         │       │       │       ├─ Inquiries
 │                         │       │       │       │   └─[product]── Traffic × Conversion rate
 │                         │       │       │       └─ Qualification rate
 │                         │       │       │           (denominator: inquiries created in cohort)
 │                         │       │       └─ Lead→opp rate
 │                         │       │           (denominator: qualified leads created in cohort)
 │                         │       └─ Win rate
 │                         │           (denominator: DECLARE — see win-loss-analysis)
 │                         └─ Average deal value
 ├─[sum]── Expansion revenue
 │          └─[product]── Expansion opportunities × Average expansion value
 └─[sum]── Renewal revenue
            └─[product]── Renewable base × Gross renewal rate
                           (denominator: ARR up for renewal in the period)
```

**Every product edge is a cohort statement.** Opportunities created × win rate
= opportunities won only if the win rate is the created-cohort rate over the
same cohort. Multiplying a created count by a close-date win rate gives a number
that is not any quantity in the business. This is the single most common defect
in B2B KPI trees, and the reconciliation check catches it.

## Canonical B2C decomposition

```
Revenue
 ├─[sum]── New-customer revenue
 │          └─[product]── New customers × First-order AOV
 │                         └─ New customers
 │                             └─[product]── Sessions × New-visitor conversion rate
 │                                            (denominator: sessions, which are constructed)
 └─[sum]── Repeat revenue
            └─[product]── Repeat customers × Purchase frequency × AOV

Contribution margin
 └─[ratio]── (Revenue − COGS − fulfilment − payment − returns) ÷ Revenue
              ── applied at the level it belongs: CM2 stops before ad spend,
                 CM3 includes it. State the level on the node.
```

**Two traps specific to the B2C tree.** Site-wide conversion rate blends new and
returning visitors, which differ several-fold, so a mix shift moves the parent
with no behaviour change — split the node. And contribution margin belongs at a
stated level; a tree that applies a CM3 margin above the ad-spend node
double-counts the spend.

## Lead and lag at every node

A tree of lagging indicators cannot steer anything. Label every node:

| | Lagging | Leading |
|---|---|---|
| **Answers** | what happened | what is about to happen |
| **Use** | accountability, targets | this week's decisions |
| **Examples** | revenue, bookings, win rate, NRR | pipeline created, meetings held, multithreading, trial starts, activation rate |
| **Risk** | you find out too late to act | it moves without revenue following, and nobody notices |

- **Every branch should terminate in at least one leading node.** A branch that
  is lagging all the way down is a reporting line, not a lever.
- **A leading indicator earns its label by predicting.** Check it: does the node
  move before its parent, historically, at a lag consistent with the cycle? A
  "leading indicator" with no observed lead relationship is a lagging indicator
  with an aspirational label. Where you cannot check it, say the label is
  asserted.

## Ownership at every node

A metric with no owner does not move.

- **Name a role, not a team.** "Demand gen" owns nothing; "VP Demand Gen" owns
  something.
- **One owner per node.** Two owners is zero owners.
- **The owner must be able to act on the node.** An owner assigned to a node
  they cannot influence produces a quarterly explanation, not a change.
- **Unowned nodes are marked** rather than quietly assigned upward. An unowned
  node in a tree is a finding for the leadership team.

## Unmeasurable nodes stay in the tree

Pruning a driver because it is not instrumented hides the gap. Keep it, mark
it, and name what would make it measurable.

```
{"name": "Sales-accepted leads",
 "measurable": false,
 "why": "no SAL event exists: no status value, no task type, no timestamp",
 "instrumentation": "a lead status value or a task type logged on acceptance",
 "consequence": "MQL→SQL blends rejected and never-worked leads, which have
                 opposite fixes"}
```

This is more useful than a clean tree, because it tells the team what to build.

## Tile-count discipline follows from the tree

A dashboard shows **the nodes a given audience can act on**, not everything
available.

| Audience | Depth | Typical tile count |
|---|---|---|
| Board / exec | top two levels, lagging plus one leading per branch | 6–9 |
| Functional leader | their branch, two levels down | 8–12 |
| Operating team | their leaf nodes plus the parent they roll into | 6–10 |

**Every tile answers "if this moves, what do I do?"** A tile with no answer is a
tile that trains people to ignore the dashboard. The tree makes the cut
defensible: a metric not in the tree does not go on the dashboard, and a metric
in the tree that its audience cannot act on goes on a different dashboard.

## Answering

> **Here is the tree, and it reconciles to 1.2% at the revenue node.**
>
> The residual is services revenue, which is not in any branch — about 1.2% of
> the total and growing. Adding it as a fourth sum-child of Revenue closes the
> gap and gives the services team a node they own.
>
> Two edges needed correcting to make it reconcile. Opportunities created × win
> rate was using the close-date win rate against a created cohort, which is not
> an identity; swapped to the created-cohort rate, the product edge now holds.
> And "new" and "expansion" revenue overlapped on upsells booked as new
> opportunities, so the filter children were summing to more than the parent.
>
> Three nodes are unmeasurable and are marked rather than dropped: sales-accepted
> leads, which has no event; onboarding completion, which is not instrumented;
> and marketing-influenced pipeline, which needs an attribution model this org
> has not chosen. The first is the cheapest to fix and unblocks the noisiest
> rate in the funnel.
>
> Four nodes have no owner. That is the list I would take to the leadership
> meeting before the dashboard conversation.

## Honest limits

- **A tree cannot be validated against a target it has never reconciled to.**
  If the top node's source disagrees with finance, fix that first
  (`cross-system-reconciliation`) — a tree built on a disputed top number
  propagates the dispute.
- **`driver-of` edges are not arithmetic** and are excluded from every check.
- **Product edges are cohort statements.** Where cohorted rates do not exist,
  the edge is approximate and must be labelled, not quietly multiplied.
- **Lead/lag labels are claims.** Unverified ones are marked as asserted.
- **The tree describes structure, not causality.** Moving a child moves the
  parent arithmetically; it does not follow that the business responds the way
  the arithmetic implies.

## Core contracts this skill calls

- `answer-contract` — the reconciliation residual reported as a number, and
  `unavailable` on nodes with no instrumentation
- `provenance-block` — per-node source, metric version, currency, timezone and
  freshness; a tree assembled from sources with different day boundaries will
  not reconcile and the cause will not be obvious
- `comparability-rules` — before nodes sourced from different systems are
  summed or divided into each other
- `warning-field-reader` — a node fed by a capped or thresholded source carries
  that limitation up the tree
- `pagination-patterns` — leaf nodes built from extractions inherit row caps; a
  truncated leaf makes its parent fail reconciliation for the wrong reason
- `rate-limit-governor` — a refreshing tree queries every leaf on every refresh

## References

- `references/tree-schema.md` — the node and edge schema, the reconciliation
  algorithm, and the residual-diagnosis table
- `references/canonical-trees.md` — full B2B, B2C and subscription trees with
  every formula, denominator and lead/lag label

## Related skills

- `gtm-metric-dictionary` supplies every node's definition and denominator
- `data-model-designer` for the grain each node is computed at
- `funnel-conversion-analysis` and `win-loss-analysis` for the rates the product
  edges depend on
- `cross-system-reconciliation` when the top node is itself disputed
- `revenue-waterfall`, `dashboard-builder-vercel` and
  `executive-narrative-builder` consume the tree
