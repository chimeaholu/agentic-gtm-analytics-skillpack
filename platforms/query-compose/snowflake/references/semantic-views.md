# Semantic views — reading, querying and authoring

Semantic views are the reason Snowflake is the best semantic layer in the pack to both read
and write: they are **first-class SQL objects**, so the usual SQL tooling applies.

## Discovery

```sql
SHOW SEMANTIC VIEWS IN DATABASE analytics;
DESCRIBE SEMANTIC VIEW analytics.gtm.gtm_metrics;
SELECT GET_DDL('SEMANTIC_VIEW', 'analytics.gtm.gtm_metrics');
```

`GET_DDL` is the one worth reaching for. It returns the full definition — tables,
relationships, facts, dimensions, metrics, comments and any **`NON ADDITIVE BY`** markers —
as text you can read and reason about, rather than a metadata blob you have to reassemble.

## Querying — the construct is not ordinary SQL

```sql
SELECT * FROM SEMANTIC_VIEW(
  analytics.gtm.gtm_metrics
  METRICS total_revenue, open_pipeline
  DIMENSIONS region, close_month
);
```

**You cannot `SELECT col FROM semantic_view`.** This is the single most likely failure for
a model working from SQL priors. The error is not subtle — it fails — but an agent that
then "fixes" it by querying the underlying tables directly has silently abandoned the
governance the semantic view exists to provide.

Standard SQL querying of semantic views went GA on 2026-03-02, so behaviour varies by
account version; the construct above is the reliable form.

## `NON ADDITIVE BY` — read it before you aggregate

Available from 2026-03-05, `NON ADDITIVE BY` marks a metric **semi-additive**: it must not
be summed across the specified dimensions.

The canonical cases are balances, headcounts, subscriptions active and inventory levels —
things you can sum across regions but not across months.

```
METRIC active_subscriptions AS COUNT(DISTINCT subscription_id)
  NON ADDITIVE BY (close_month)
```

**This is machine-readable, and it is exactly the semantic nuance an agent would otherwise
get catastrophically wrong.** Read it from `GET_DDL` before aggregating any metric, and say
so in the answer when it applies: "active subscriptions is semi-additive by month — the
quarterly figure is the ending balance, not the sum of three monthly balances."

Nothing else in the pack exposes this declaratively. Use it.

## Authoring — `CREATE OR ALTER SEMANTIC VIEW`

Available from 2026-05-04 (preview). It is **declarative, safe to re-run, and preserves
grants**, and it can modify tables, relationships, facts, dimensions, metrics, comments, AI
instructions and verified queries.

This is a **Tier C write** under `write-gate` — it changes a shared definition, so it needs
approval per change set with a diff shown, not a blanket "go ahead and update the model".

The re-runnability is what makes it safe to automate the *application* of an approved
change: the same statement applied twice leaves the same state, and grants survive.

## Cortex Analyst — use it as a grounding check, not the data path

`POST /api/v2/cortex/analyst/message` takes a semantic model or view and **returns SQL plus
an explanation. You execute it yourself.**

The useful pattern is: *"what SQL would Snowflake's own text-to-SQL write for this
metric?"* — a second opinion on your own construction, cheap to obtain and easy to diff.

**It should not be the primary data path.** An agent that can read the semantic view should
construct `SEMANTIC_VIEW()` queries itself, because **deterministic beats a second LLM in
the loop**: the query is reproducible, inspectable and stable across runs, and a stable
query text also hits the result cache.

## When there are no semantic views — which is most accounts

**Semantic-view adoption is low. Most customers have none.** Plan the fallback rather than
reporting the absence as a blocker:

| Source | What it gives you | How to describe it |
|---|---|---|
| `INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION` | the SQL behind curated views | **inferred** |
| dbt models and `manifest.json` | metric logic, tests, declared relationships | **inferred**, unless dbt metrics are defined |
| `ACCOUNT_USAGE.ACCESS_HISTORY` | which columns feed which outputs | **observed** |
| Column comments and tags | intent, sometimes units | **declared, but unverified** |

**Say "inferred", not "discovered", when a definition came from view SQL.** The distinction
matters: a declared metric is the customer's definition; an inferred one is your reading of
their SQL, and they may disagree.

## Two traps specific to semantic views

- **They are metadata only.** A broken underlying table errors **only at query time**, and
  **`SHOW` still lists a semantic view whose base tables were dropped.** A clean `SHOW`
  output is not evidence the view works.
- **Zero-copy clones** mean the same logical data appears under several names, and
  `ACCESS_HISTORY` lineage shows the clone rather than the origin. A lineage claim built
  from a cloned database names the clone.
