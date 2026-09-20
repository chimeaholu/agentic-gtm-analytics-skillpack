---
name: semantic-layer-introspector
description: Use as the mandatory first step of any analysis against a customer's BI or warehouse stack, before writing a single query. Discovers whether a real semantic layer exists — dbt MetricFlow, LookML, Power BI tabular model, Snowflake semantic views, Cube data model, Tableau calculated fields — reads the metric definitions, additivity rules, valid dimensions and join graph, and reports its own blind spots where the credential cannot see. Treats "no semantic layer found" as a first-class outcome. Prevents an agent confidently reinventing a metric the customer already owns, and prevents slicing a metric by a dimension it does not legally join to.
---

# Semantic Layer Introspector

Before you write a query, find out whether the customer already owns the
definition. If they do, **call their metric rather than re-implementing it**.
Re-implementing is how a stack acquires a third definition of win rate.

Two things this skill must not do: assert that a metric does not exist when the
credential simply cannot see it, and slice a metric by a dimension it does not
legally join to.

---

## 1. The discovery ladder, cheapest first

**(a) dbt local artefacts. No credentials at all.**
`target/manifest.json`, `target/semantic_manifest.json`, `target/catalog.json`,
`target/run_results.json` read straight from a repo checkout or a CI artefact.
This is the cheapest metric discovery anywhere in the stack and it is the
pack's default first move. Always check `metadata.generated_at`: a stale
artefact describes a model that no longer exists.

**(b) Platform semantic APIs.** Looker, Power BI, Snowflake, Cube, Tableau.
Costs credentials and role setup. Ordered below by how much they actually
return.

**(c) SQL-text inference.** BigQuery view and routine definitions. This is
**inference, not discovery**, and every output from it is labelled inferred.

---

## 2. Introspection depth by platform

| Platform | Depth | Metric expression | Join graph | Additivity rule | Can you call the metric instead? |
|---|---|---|---|---|---|
| dbt / MetricFlow | 5 | yes, free from repo artefacts | yes, entity types | `non_additive_dimension` | yes, `query_metrics` |
| Looker | 4.5 | yes, `sql` per field | yes, explicit with cardinality | no first-class field | yes, `run_inline_query` |
| Power BI | 4.5 | yes, exact DAX | yes, **with cross-filter direction** | no first-class field | yes, `EVALUATE SUMMARIZECOLUMNS` |
| Snowflake semantic views | 4.5 | yes, SQL-native | `SEMANTIC_RELATIONSHIPS` | `NON ADDITIVE BY` | yes, `SEMANTIC_VIEW(...)` |
| Cube | 4 | yes, measure type + sql | `joins` in model files | no first-class field | yes, `/v1/load` |
| Tableau | 3.5 | yes, calc-field `formula` | **largely hidden** | no | **yes, VDS, and this is the right route** |
| BigQuery | 2 | view SQL only, inferred | declared constraints only if present | no | **no** |
| Looker Studio | 0 | none | none | none | no |

---

## 3. Per-platform calls and what they actually return

### 3.1 dbt / MetricFlow — the reference case, depth 5

Read from `semantic_manifest.json` and `manifest.json`.

`semantic_models[]`
- `name`, `model` (the ref'd dbt model), `defaults.agg_time_dimension`
- **`entities[]`**: `name`, `type` one of `primary` | `foreign` | `unique` |
  `natural`, `expr`. **This is the join graph.** MetricFlow resolves joins by
  matching primary to foreign entity keys. You do not have to guess a join
  path; you read entity types.
- `dimensions[]`: `name`, `type` (`categorical` | `time`),
  `type_params.time_granularity`, `expr`, `label`, `description`
- `measures[]`: `name`, `agg` (`sum`, `average`, `count_distinct`, `median`,
  `percentile`, `min`, `max`, `sum_boolean`), `expr`,
  **`agg_time_dimension`**, **`non_additive_dimension`**, `create_metric`

`metrics[]`
- `type`: `simple`, `ratio` (numerator/denominator), `cumulative` (with
  `window` / `grain_to_date`), `derived` (expression over other metrics, with
  `offset_window` for period-over-period), and **`conversion`**, which is
  literally a funnel metric with a base event, a conversion event, an entity
  and a window. A GTM funnel, natively modelled.
- `filter` in Jinja `{{ Dimension(...) }}` syntax, `meta` / `config.meta`

`saved_queries[]` with `exports` are the closest thing dbt has to a report
object, and they are authorable.

`manifest.json` adds `compiled_code` and `raw_code` per model, `depends_on`
(the DAG), `columns` with descriptions and `meta`, `data_tests`, `sources` with
freshness config, `access`, `contracts`, and **`exposures`** — which dashboard
or app consumes which model, with owner and URL. **Exposures are how you find
the GTM dashboards that matter.**

`catalog.json` adds warehouse-side column types, row counts and table bytes.

**What it hides.** Jinja is unresolved in `raw_code` and resolved in
`compiled_code`, but `compiled_code` only exists after a `dbt compile` or `run`
and is **target-specific**: read dev artefacts and you reference dev schemas.
`meta` is unvalidated free-form. Row-level security is not a dbt concept; the
warehouse enforces it invisibly.

### 3.2 Looker — depth 4.5

`GET /lookml_models/{model}/explores/{explore}` (`lookml_model_explore`) is the
single most valuable introspection call available anywhere. It returns:

- every field split into `dimensions`, `measures`, `filters`, `parameters`,
  each with `label`, `description`, `type`, `value_format`, **`sql`**,
  `hidden`
- **`joins[]`** with `relationship` (`many_to_one`, `one_to_many`,
  `many_to_many`, `one_to_one`), `sql_on`, `type`, `foreign_key` and
  `dependent_fields`. An explicit, machine-readable join graph. Nothing else
  in the stack matches this cleanly.
- **`errors`** — so you can tell a broken model from a healthy one, and an
  ignored `errors` block is how lineage silently truncates
- `always_filter`, `access_filters`, `source_file`

`get_project_file` reads the literal LookML.

**What it hides.** Liquid templating inside `sql:` comes back as **unrendered
text**. A `sql:` containing `{% if %}` is not a formula you can evaluate.

### 3.3 Power BI — depth 4.5

DAX `INFO.*` functions through the `Execute Queries` endpoint. These are the
TMSCHEMA DMVs re-exposed as native DAX, which means **they are joinable**; the
old DMV syntax was not.

- **`INFO.MEASURES()`** → measure name, **the exact DAX expression**, format
  string, `IsHidden`, display folder, description, table id
- **`INFO.RELATIONSHIPS()`** → from-table/column, to-table/column,
  **cardinality AND cross-filter direction**, `IsActive`. Power BI is the only
  platform in this research that exposes filter direction.
- `INFO.TABLES()`, `INFO.COLUMNS()` (with `DataType`, `SortByColumn`, `IsKey`,
  `SummarizeBy`), `INFO.HIERARCHIES()`, `INFO.LEVELS()`
- **`INFO.TABLEPERMISSIONS()`** → RLS filter expressions, so you know the
  numbers are identity-dependent before you report them
- **`INFO.PARTITIONS()`** → M / Power Query source expressions, which is
  upstream lineage back to the warehouse
- `INFO.CALCULATIONGROUPS()` / `INFO.CALCULATIONITEMS()`, `INFO.ROLES()`,
  `INFO.ANNOTATIONS()`, `INFO.MODEL()`

**Permission catch.** `INFO.*` generally requires **semantic-model admin**;
some calls require workspace admin. A read-only viewer identity gets nothing at
all, and gets it without an error.

**What it hides, and this matters more than what it shows.**
- **Report-layer logic is not in the model.** Visual-level filters,
  report-level measures in thin/PBIR reports, slicer state and Q&A synonyms
  live in the report artefact. An agent that reads only the model computes
  different numbers than the dashboard shows. **This is the number one
  API-versus-UI discrepancy in Power BI.**
- **Implicit measures** are created by report authors by dragging a column onto
  a visual. They exist in the report, not the model. `INFO.MEASURES()` will not
  list a single one of them.
- Direct Lake / DirectQuery pushdown behaviour: the DAX does not tell you what
  SQL will be generated or whether a measure falls back from Direct Lake.
- Calculation groups and field parameters change what a measure *means* at
  query time. You can read the expressions; reasoning about the composed result
  is genuinely hard.

### 3.4 Snowflake semantic views — depth 4.5, uniquely SQL-native

- `SHOW SEMANTIC VIEWS`
- `DESCRIBE SEMANTIC VIEW <name>`
- `GET_DDL('SEMANTIC_VIEW', '<name>')` → the literal creating DDL
- `SHOW SEMANTIC METRICS`
- **`SHOW SEMANTIC DIMENSIONS FOR METRIC <metric>`** → *which dimensions is
  this metric legally sliceable by*. That is the exact question a naive agent
  gets wrong, answered authoritatively by the platform.
- `INFORMATION_SCHEMA.SEMANTIC_VIEWS` / `SEMANTIC_TABLES` /
  `SEMANTIC_RELATIONSHIPS` / `SEMANTIC_DIMENSIONS` / `SEMANTIC_METRICS` are
  **joinable with SQL**, so one query enumerates every metric in an account
  with its expression, base table and permitted dimensions.
- **`NON ADDITIVE BY`** is machine-readable. This is the semi-additivity rule.

Query them with the `SEMANTIC_VIEW()` construct:
```sql
SELECT * FROM SEMANTIC_VIEW(my_view METRICS total_revenue DIMENSIONS region, month)
```
**This is not ordinary SQL.** You cannot select arbitrary expressions inside
it, and an agent that treats it as a normal FROM clause will fail.

### 3.5 Cube — depth 4

`GET /v1/meta` returns cubes and views with:
- measures: `type` (including **`countDistinctApprox`**, which is an
  approximation you must disclose), `format`, `drillMembers`
- dimensions
- **`segments`**: named, reusable business filters. A very GTM-relevant concept
  most tools lack, and where the customer's real business rules often live.

`searchDataModel` does semantic similarity search over the model, which solves
"which of 400 measures actually means revenue?".

Join `relationship` and `sql` are readable from the model files.

**What it hides.** `/v1/meta` returns the model **as visible to the JWT's
security context**, and **`query_rewrite` can inject mandatory filters the
agent never sees**. A number from Cube can be pre-filtered in a way that
nothing in the response discloses.

### 3.6 Tableau — depth 3.5, and PARTIAL by design

Metadata API (GraphQL, `POST /api/metadata/graphql`, read-only) gives you:
- `CalculatedField.formula`, `role`, `aggregation`
- **the best column-level lineage in the stack**: `upstreamColumns`,
  `upstreamTables`, `downstreamSheets`, `downstreamDashboards`,
  `downstreamOwners`
- `sheetFieldInstances`, telling you which fields a sheet actually uses

**But join conditions and cardinality are largely hidden.** `logicalTableId`
hints at the logical table; join keys and relationship cardinality are not
reliably exposed. This is Tableau's biggest introspection gap and it is the
reason for the rule below.

**The rule: adopt Tableau metrics by calling them, not by re-implementing
them.** Use **VizQL Data Service** `query-datasource` against a published data
source (`datasourceLuid`, or `workbookDatasourceId` for an embedded one). The
query body is semantic, not SQL:
- `fields[]`: dimensions with sort, and measures with `function` from
  `SUM, AVG, MEDIAN, COUNT, COUNTD, MIN, MAX, STDEV, VAR, COLLECT`, plus
  temporal `YEAR, QUARTER, MONTH, WEEK, DAY, TRUNC_*`
- ad-hoc `calculation` fields in Tableau calculation syntax
- `filters[]`: `SET`, `QUANTITATIVE_NUMERICAL`, `QUANTITATIVE_DATE`,
  `RELATIVE_DATE`, `TOP_N`, `MATCH`
- `options`: `returnFormat` (`OBJECTS` | `ARRAYS`), `rowLimit`, `debug`,
  `disaggregate`, `bypassMetadataCache`, `returnServerSentEvents`

VDS respects the published data source's calculated fields, so you get the
customer's actual metric logic **without needing to understand the joins you
cannot see**. `read-metadata` gives a simpler query-oriented view of a source.

Also hidden: **LOD expressions and table calculations depend on viz context.**
A `formula` string alone is not enough to reproduce the number a sheet shows.

### 3.7 BigQuery — depth 2, and this is inference not adoption

**BigQuery has no metric semantics.** There is no `CREATE METRIC`, no
additivity declaration, no measure type. Say this plainly rather than implying
a semantic layer exists.

What you can read:
- `INFORMATION_SCHEMA.VIEWS.view_definition` and
  `ROUTINES.routine_definition` — **this is where the customer's real metric
  logic actually lives**, and parsing it is genuine discovery at the SQL level
- `TABLE_CONSTRAINTS` / `KEY_COLUMN_USAGE` give PK/FK **when declared**, and
  most teams have not declared them. Check, do not assume.
- Dataplex / Knowledge Catalog adds a business glossary and column-level
  lineage where it has been adopted

Everything derived from parsing view SQL is labelled **inferred**. You cannot
call a BigQuery metric by name, because there is no name to call.

### 3.8 Looker Studio — depth 0

The Looker Studio API does `assets:search` and permission management. It
**cannot read report data, cannot create or modify a report, and cannot read
chart configuration**. The Linking API builds a pre-filled URL a human clicks.

**Say so and stop.** Do not attempt a workaround.

---

## 4. Prefer calling a metric over reading it

The highest-reliability pattern is not "read the definition and re-implement it
in SQL". It is **"ask for the metric by name and let the platform compile it"**.

| Platform | Call the metric with |
|---|---|
| Looker | `run_inline_query` with the measure name |
| Power BI | `EVALUATE SUMMARIZECOLUMNS(..., "Net Revenue", [Net Revenue])` |
| Tableau | VDS `query-datasource` with `fieldCaption` |
| Snowflake | `SELECT * FROM SEMANTIC_VIEW(v METRICS m DIMENSIONS d)` |
| dbt | MetricFlow `query_metrics` |
| Cube | `/v1/load` |
| BigQuery | **not possible** |
| Looker Studio | **not possible** |

Calling defers to the definition instead of adopting it, which is strictly
safer: if the definition changes, your number changes with it, and you never
own a second copy.

---

## 5. Read the definition anyway, for the rules rather than the arithmetic

The arithmetic is rarely where agents go wrong. Four rules are worth extracting
even when you intend to call the metric:

1. **Additivity.** `non_additive_dimension` in dbt, `NON ADDITIVE BY` in
   Snowflake. Summing a balance-like measure across months is a wrong answer
   that looks completely right. ARR, MRR, open pipeline, headcount and
   subscriber count are all semi-additive.
2. **Valid dimensions.** Slicing a metric by a dimension it does not legally
   join to **produces fan-out, not an error**. Snowflake answers this directly
   with `SHOW SEMANTIC DIMENSIONS FOR METRIC`.
3. **Time grain and which date column.** `agg_time_dimension`. Booked date
   versus created date versus close date is the single most common GTM
   reporting dispute, and in a real semantic layer it is declared, not guessed.
4. **Approximation.** `countDistinctApprox` in Cube, `APPROX_COUNT_DISTINCT` in
   the warehouse. An approximate distinct count must be disclosed as
   approximate.

---

## 6. Assume permission-shaped blindness and probe for it

**The deepest shared failure mode across every platform: the agent's identity
determines what the semantic layer appears to contain, and missing objects are
silently absent rather than access-denied.**

| Platform | What a thin credential silently loses |
|---|---|
| Looker | without `see_lookml`, field names come back but `sql` does not; inaccessible fields are simply absent |
| Power BI | a viewer gets nothing from `INFO.*`; OLS makes objects invisible rather than error-producing |
| Tableau | a service user sees a smaller graph; the Metadata API is permission-filtered **with no error** |
| Snowflake | masking policies return **masked values that look like data**; row access policies silently filter rows |
| Cube | `/v1/meta` returns only what the JWT security context allows; `query_rewrite` can inject filters you never see |
| BigQuery | dataset-level and column-level ACLs remove objects from `INFORMATION_SCHEMA` results |

**An agent that cannot distinguish "this metric does not exist" from "I cannot
see it" will confidently reinvent a metric the customer already owns.**

Run an explicit capability probe and **publish the blind-spot report as part of
the output, not as a footnote**:

```
blind_spots:
  - platform: looker
    probe: "requested sql for a known field"
    result: "field returned, sql absent"
    conclusion: "credential lacks see_lookml; metric expressions unreadable"
    resolves_with: "see_lookml permission on the model"
```

---

## 7. Prevalence honesty: build the fallback path first

**Most dbt projects in 2026 have `models/` and `schema.yml` and no
`semantic_models:` at all. Most Snowflake accounts have zero semantic views.**
The capability is excellent; adoption is thin.

"No semantic layer found" is a **first-class outcome**, not a failure. When you
hit it:

1. Read model SQL, column descriptions and tests. Far better than nothing.
2. Read **`exposures`** to find what the business actually consumes.
3. Read **empirical usage**: Snowflake `ACCESS_HISTORY` and `QUERY_HISTORY`,
   BigQuery job history, Looker System Activity. **Which tables and columns
   does the business actually query?** Empirical usage is a decent proxy for
   semantics when semantics are absent, and it is often more honest than a
   stale declared model.
4. Report the introspection depth score (0-5) so downstream skills know how
   much to trust the inventory.

---

## 8. What introspection cannot tell you on any platform

**No platform in this research has a currency type.** Currency is a format
string everywhere:

| Platform | What "currency" is |
|---|---|
| Looker | `value_format` string |
| Tableau | a number format |
| Power BI | `Currency` / `Fixed Decimal`, which is a 4-decimal **data type**, not a unit |
| Cube | `format: currency` |
| Snowflake / BigQuery | nothing at all |

**An agent literally cannot determine a measure's currency from metadata on any
platform.** If the reporting is multi-currency, the currency is an explicit,
human-supplied input, and this must appear in the provenance block.

---

## 9. Output: the `semantic_inventory` artefact

```
introspection_depth: 0-5
platforms_probed: []
metrics[]:
  name, platform, location, expression, metric_type,
  agg, agg_time_dimension, additivity_rule,
  valid_dimensions[], time_granularity,
  approximate: bool, callable_by_name: bool, call_method
join_graph[]:
  from_table, from_column, to_table, to_column,
  cardinality, cross_filter_direction, declared: bool, source
segments[]          # Cube segments, Looker always_filter, dbt metric filters
blind_spots[]:
  platform, probe, result, conclusion, resolves_with
currency_status: "not determinable from metadata; human input required"
artefact_freshness: metadata.generated_at per source
```

---

## 10. Answering

**Answer first, caveat second.** If the inventory is thin, say what you found,
say what you could not see and why, and proceed with the fallback path rather
than stopping. A depth-2 inventory is a usable inventory as long as its outputs
are labelled inferred.

Withhold only where a specific metric's definition is unreadable **and** the
metric cannot be called by name **and** re-implementing it would require
guessing a join you cannot see. That is `unavailable`, and it names the exact
permission or artefact that would resolve it.

## References

- `references/per-platform-introspection.md` — the exact calls, response
  shapes, permission requirements and gotchas per platform
- `references/fallback-path.md` — what to do when no semantic layer exists

## Related skills

- Runs **before** `gtm-metric-dictionary`: the customer's definition wins.
- Feeds `relationship-discovery` (declared joins beat inferred ones),
  `data-model-designer`, `metric-definition-audit`, `permission-effect-audit`.
