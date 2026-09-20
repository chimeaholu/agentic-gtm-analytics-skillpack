---
name: data-model-designer
description: Use when designing or reviewing a GTM data model in a warehouse — deciding tables, grains, keys and layering for marketing, sales, product and revenue data, or diagnosing why two models give two different customer counts. Produces the fact and dimension model with one declared grain per table, the staging/intermediate/mart layering with a rule for where business logic belongs, and the daily opportunity snapshot that is unrecoverable retroactively. Prevents fan-out joins that silently multiply revenue and business logic buried in staging.
---

# GTM Data Model Designer

Grain first. Every argument about a GTM model that goes in circles is an
argument where two people are holding two different grains and neither has said
so out loud.

Run `semantic-layer-introspector` first: adopt what exists rather than
designing over it.

---

## 1. The core GTM model

A canonical starting point, not a mandate. Cut what the questions do not need.

### Dimensions

| Table | Grain | Notes |
|---|---|---|
| `dim_date` | one day | **not optional**, see §8 |
| `dim_channel` | one channel | the mapping from raw source/medium to a business channel, versioned |
| `dim_campaign` | one campaign per platform | platform campaign id plus a conformed campaign key |
| `dim_account` | one account | SCD Type 2 where segment, tier or owner history matters |
| `dim_person` | one person | SCD Type 2; email is an attribute, not the key |
| `dim_product` | one product / SKU / plan | |
| `dim_rep` | one rep | SCD Type 2: territory and quota change |

### Facts

| Table | Grain | Why it exists |
|---|---|---|
| `fact_touchpoint` | one marketing touch | the atom attribution is a function of |
| `fact_session` | one **constructed** session | GA4 has no session table in BigQuery; a session is something you build |
| `fact_lead_stage` | one person-stage transition, with `entered_at` | stage history, not current stage |
| `fact_opportunity` | one opportunity, current state | the convenient one |
| **`fact_opportunity_snapshot`** | **one opportunity × one day** | see §2. The most consequential table in the model. |
| `fact_ad_spend` | platform × campaign × day | the only fact with a natural daily grain from source |
| `fact_order` | one order (B2C) | line items are a separate grain: `fact_order_line` |
| `fact_subscription_event` | one subscription state change | new, expansion, contraction, churn, reactivation |
| `identity_edges` | one observed identity link, with evidence and timestamp | append-only |
| `identity_graph` | one resolved person, bitemporal | see `identity-resolution` |

---

## 2. `fact_opportunity_snapshot` is unrecoverable retroactively

**Without daily opportunity snapshots you cannot compute:**

- pipeline created versus pushed versus pulled
- stage conversion and stage duration
- slippage
- historical pipeline coverage
- "what did the forecast look like on day 30 of the quarter"

And you cannot compute them **later**, because the history does not exist.

**Why the CRM does not save you.**

- Salesforce `OpportunityHistory` and `OpportunityFieldHistory` cover **tracked
  fields only**, and field-history tracking is almost always enabled *after*
  someone needs it. The history simply does not exist for the period being
  asked about. Field history also has retention limits.
- HubSpot's `hs_lifecyclestage_*_date` properties are **overwritten on
  re-entry**. A contact that cycles through a stage twice loses its first
  journey entirely.

**Snapshot daily from day one.** It is cheap, it is boring, and it cannot be
backfilled. Store opportunity id, snapshot date, stage, amount, close date,
owner, forecast category, and a hash of the tracked field set so changes are
cheap to detect.

The same argument applies at lower value to `fact_account_snapshot` (for ARR
and segment history) and any slowly-changing field that a trend will one day be
drawn through.

---

## 3. Layering, and the GTM-specific failure

```
staging       1:1 with source. Renamed, typed, deduplicated. NO business logic.
intermediate  joins, unions, identity resolution, sessionization, journey assembly
marts         dimensional, one grain per table, documented, tested
```

**The failure: business logic in staging.**

Once "MQL" is defined inside `stg_hubspot__contacts`, two things follow. It
cannot be changed without rebuilding history, and three other models will have
defined it differently because nobody could find the first definition. A
definition that lives in staging is a definition nobody can version.

Rule: **staging renames and types; intermediate joins and resolves; marts
define.** A `CASE WHEN score > 70 THEN 'MQL'` in a staging model is a defect.

---

## 4. One declared grain per table, published next to the table

Write the grain as a sentence in the model's `description`, in the exact
form: *"One row per X per Y."*

**Grain collapse looks exactly like data loss to a stakeholder expecting a
different grain.** When a model rolls 40,000 order lines into 12,000 orders,
someone will report that 28,000 rows went missing. Handle it three ways:

1. Publish the grain next to the table.
2. **Reconcile the two counts explicitly** in a test or a documented control:
   `40,000 lines → 12,000 orders, 3.33 lines per order`.
3. Where a grain change collapses rows, **retain the contributing source IDs in
   a column** so the collapse is traceable rather than lossy.

---

## 5. Fan-out is the silent revenue multiplier

The failure mode: joining a fact to a many-side table multiplies its measures,
producing a number that is larger, plausible, and never errors.

**Known GTM sources of fan-out:**

| Join | Why it fans out |
|---|---|
| HubSpot deal → contact → company | associations are **many-to-many**; a deal with 4 contacts becomes 4 rows with the full amount on each |
| Salesforce opportunity → OpportunityContactRole | same shape |
| opportunity → campaign influence | one opportunity, many campaigns |
| snapshot table with no date filter | one opportunity × N days |
| dbt snapshot without `dbt_valid_to IS NULL` | one entity × N versions |
| session table joined to event table | one session × N events |
| account → multiple CRM records after a merge | merged records that did not fully collapse |

**Every mart needs a row-count and a sum-total test against a declared
control.** Both, not one. A row-count test alone misses a partial fan-out that
also dropped rows; a sum test alone misses a duplication that cancels out.

```yaml
# the shape, not a specific tool's syntax
tests:
  - row_count_equals: {control: stg_crm__opportunity, tolerance: 0}
  - sum_equals: {column: amount, control: stg_crm__opportunity, tolerance: 0.01}
```

**Session rows are never joined to event counts.** Aggregate each separately
and declare which filters move which number. A "sessions with events" join
produces neither a session count nor an event count.

---

## 6. Snapshot-grained tables carry a mandatory filter

State it in exactly these terms, in the table's description and in whatever
schema context an agent reads:

> **Always filter to one snapshot date, or join across exactly two for a
> comparison. Without a date filter you will get duplicates.**

This sentence needs to be in the metadata, not in a wiki, because the agent
reading the schema is the one that will get it wrong.

---

## 7. Dedup rules are business decisions

An `ORDER BY created_at LIMIT 1` "earliest wins" rule absorbs later records
invisibly. Nothing errors, nothing logs, and the absorbed record's attributes
are gone.

Three requirements when you dedup:

1. **State the rule in the metric definition**, not just in the SQL.
2. **Retain the absorbed IDs** in an array column.
3. **Count how many rows were absorbed** and expose the count, so a sudden rise
   in absorption is visible.

The same applies to identity merges, campaign conformance and account
hierarchies.

---

## 8. A `dim_date` spine is not optional

Without a date spine, **periods with zero activity vanish from charts instead
of showing zero.** A week with no deals created becomes a missing point, the
line connects across it, and the chart shows a smooth trend through a gap.

Build it once, with: date, day of week, ISO week, month, quarter, fiscal
period (with the org's fiscal calendar, which is not the calendar year in most
orgs), is-weekday, is-holiday by region, and relative offsets. Left join facts
onto it, always.

---

## 9. The twelve-item warehouse-model register

Review a model against these. Each one is a real failure that ships.

| # | Failure |
|---|---|
| 1 | Identity resolved per-model instead of once, so two marts count different customers |
| 2 | Type-1 overwrite where Type-2 was needed, so history restates every time the source changes |
| 3 | Metrics defined in the BI tool rather than the warehouse, producing two dashboards and two truths |
| 4 | No daily opportunity snapshot (see §2) |
| 5 | Business logic in staging (see §3) |
| 6 | Grain undeclared, so nobody can tell collapse from loss |
| 7 | No control totals, so fan-out ships silently |
| 8 | No `dim_date` spine, so zeroes become gaps |
| 9 | Dedup rules implicit, absorbed records untraceable |
| 10 | Currency stored as a number with no currency column, because no platform has a currency type |
| 11 | Timezone handled per-model instead of once at the boundary, so two marts disagree on a day |
| 12 | Late-arriving facts overwrite rather than append, so restatements are invisible |

---

## 10. SCD decisions, briefly

| Attribute | Type | Why |
|---|---|---|
| account segment / tier | 2 | reports "as it was" versus "as it is" differ and both get asked for |
| account owner | 2 | attribution of results to a rep requires the owner at the time |
| person email | 1 on the key, 2 on the attribute | never key on email |
| product price | 2 | realised price analysis needs the price at the time |
| campaign name | 1 usually | but retain the original if campaigns get renamed mid-flight, which they do |

The question that decides it: **will anyone ever ask "what did this look like
then"?** If yes, Type 2. Retrofitting Type 2 requires history you did not keep.

---

## 11. Output: the model specification

```
tables[]:
  name, layer (staging|intermediate|mart), grain_sentence,
  primary_key, natural_key, scd_type,
  source_models[], business_logic_owned[],
  mandatory_filters[],        # e.g. "snapshot_date = one date"
  control_tests[]             # row count and sum total, against which control
join_graph[]:
  from, to, cardinality, key, declared_or_inferred
snapshot_tables[]:
  name, cadence, retention, fields_tracked
cannot_answer[]:              # the written list, see below
```

## 12. The "what this model cannot answer" list

Ship it with the model, in writing. Typical entries:

- Anything requiring opportunity history before the snapshot table started.
- Stage duration for deals that moved backwards, if only forward transitions
  were captured.
- True multi-touch attribution without an assembled journey (see
  `journey-assembler`); attribution over an unresolved identity is arithmetic
  on a fiction.
- Any metric denominated in sessions, if the sessionization gap has changed.
- Currency-converted revenue, unless a rate table and a conversion date
  convention exist. The model cannot infer currency.
- Anything at buying-group grain if the model only has person grain.

---

## 13. Answering

**Answer first.** When asked "why do two models give different customer
counts", give the most likely cause ranked by frequency before running
anything: identity resolved differently per model, a dedup rule in one and not
the other, a fan-out join, a different active-customer filter, a different
date basis. Then go and check.

Withhold only where the question requires history that does not exist. That is
`unavailable`, and the resolving change is "start snapshotting today", which
should be said plainly even though it does not help with the current question.

## References

- `references/grain-and-fanout.md` — the grain catalogue and fan-out test
  patterns
- `references/snapshot-design.md` — snapshot table design, cost and retention

## Related skills

- `semantic-layer-introspector` first, always.
- `relationship-discovery` for the join graph where it is not declared.
- `warehouse-schema-designer` for physical design and partitioning.
- `calculation-integrity-audit` runs the fan-out tests this skill specifies.
