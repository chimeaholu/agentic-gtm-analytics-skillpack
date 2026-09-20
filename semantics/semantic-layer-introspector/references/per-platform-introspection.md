# Per-platform introspection: calls, permissions, gotchas

Ordered by what is actually discoverable, cheapest and deepest first.

---

## 1. dbt / MetricFlow

**Auth cost: none** for local artefacts. Medium for dbt Platform (service
token, host, `environment_id`; the Semantic Layer API is plan-gated to
Starter/Enterprise).

### Local artefacts route (preferred)

Read from `target/` in a repo checkout or a CI artefact download:

| File | Gives you |
|---|---|
| `semantic_manifest.json` | semantic models, entities, dimensions, measures, metrics, saved queries |
| `manifest.json` | every model's `raw_code` and `compiled_code`, `depends_on` DAG, columns with descriptions and `meta`, `data_tests`, `sources` with freshness, `exposures`, `access`, `contracts` |
| `catalog.json` | warehouse-side column types, row counts, table bytes |
| `run_results.json` | last run status per node, timing |

**First check, always:** `metadata.generated_at`. A stale artefact describes a
model that no longer exists, and nothing in the file warns you.

**Second check:** which target produced it. `compiled_code` is target-specific.
Dev artefacts reference dev schemas, and a query built from them silently hits
the wrong tables.

### dbt Platform route

MCP server `dbt-labs/dbt-mcp` (~50 tools). Discovery and Semantic Layer tools
are plan-gated; CLI and manifest tools are not. **Design for graceful
degradation to local-artefact mode.** `get_column_lineage` /
`fusion.get_column_lineage` give column-level lineage, which only dbt and
Tableau offer.

Admin API: `list_job_run_artifacts` / `get_job_run_artifacts` (with jq
filtering) is how you pull a production `manifest.json` without repo access.

### Metric types, in full

| `type` | Shape | GTM use |
|---|---|---|
| `simple` | one measure | revenue, count of opportunities |
| `ratio` | `numerator` / `denominator` | win rate, conversion rate |
| `cumulative` | with `window` or `grain_to_date` | running pipeline, MTD bookings |
| `derived` | expression over other metrics, `offset_window` for period-over-period | growth rate, coverage |
| `conversion` | base event + conversion event + entity + window | **a funnel stage rate, natively modelled** |

---

## 2. Looker

**Auth cost: low-medium.** `client_id` / `client_secret` → `/login`. Watch
port 19999 on legacy instances.

### `lookml_model_explore`

`GET /api/4.0/lookml_models/{model_name}/explores/{explore_name}`

Returns per explore:

```
fields:
  dimensions[]:  name, label, description, type, value_format, sql,
                 hidden, primary_key, tags, source_file
  measures[]:    name, label, description, type (count, sum, average,
                 count_distinct, number, ...), sql, value_format, hidden
  filters[]      parameters[]
joins[]:         name, relationship (many_to_one | one_to_many |
                 many_to_many | one_to_one), sql_on, type (left_outer,
                 inner, full_outer, cross), foreign_key, dependent_fields
errors[]:        message, details, doc_url
always_filter    conditionally_filter    access_filters
source_file      connection_name
```

`joins[].relationship` plus `sql_on` is the cleanest machine-readable join
graph in the stack. Feed it directly to `relationship-discovery` as a
**declared** edge.

### Calling the metric instead

`run_inline_query` with `model`, `view`, `fields: ["explore.measure_name"]`,
`filters`, `limit`. Governed, and no SQL is needed. `run_look` runs a saved
Look. `create_query_task` is the async variant for large results.

### Gotchas

- **Liquid in `sql:` comes back unrendered.** A `sql:` containing `{% if %}`
  or `{{ _user_attributes[...] }}` is not evaluable text. Flag it and call the
  metric instead.
- **Without `see_lookml` the `sql` field is omitted.** Field names still come
  back, so the response looks complete. Probe for this explicitly.
- Fields the user cannot access are **absent**, not flagged.
- `errors[]` is the difference between "this explore has no measures" and
  "this explore is broken". Read it.

---

## 3. Power BI / Fabric

**Auth cost: high.** Entra app registration, admin consent, **tenant admin must
enable service principals**, per-workspace membership, and a capacity licence
gate for XMLA.

### Route 1: DAX `INFO.*` through `Execute Queries` (preferred)

`POST /v1.0/myorg/datasets/{datasetId}/executeQueries` with a DAX body:

```dax
EVALUATE INFO.MEASURES()
EVALUATE INFO.RELATIONSHIPS()
EVALUATE INFO.TABLEPERMISSIONS()
EVALUATE INFO.PARTITIONS()
```

Because these are native DAX rather than the old DMV syntax, **they join**:

```dax
EVALUATE
SELECTCOLUMNS(
    NATURALLEFTOUTERJOIN(INFO.MEASURES(), INFO.TABLES()),
    "measure", [Name], "dax", [Expression], "table", [Name]
)
```

`executeQueries` returns up to **100k rows / 1M values**. The Arrow DAX
endpoint has no row cap but is Premium/Fabric only.

### Route 2: XMLA + TOM/TMSL

Everything above plus perspectives, translations, KPIs, incremental-refresh
policies, and **write**. Requires Fabric / Premium / PPU capacity. **A Power BI
Pro licence in a shared workspace cannot use XMLA at all.**

### Route 3: Fabric REST `Get Semantic Model Definition`

Returns TMDL/TMSL parts, base64-encoded. This is the model as text, suitable
for git-style diffing, and the format the Power BI modeling MCP server speaks.

### `INFO.RELATIONSHIPS()` columns that matter

| Column | Why |
|---|---|
| `FromTableID` / `FromColumnID` | the many side, usually |
| `ToTableID` / `ToColumnID` | the one side, usually |
| `FromCardinality` / `ToCardinality` | many-to-one, one-to-one, many-to-many |
| `CrossFilteringBehavior` | **filter direction**: one-directional or both |
| `IsActive` | inactive relationships exist and only apply under `USERELATIONSHIP` |

Bidirectional cross-filtering is a common source of unexpected totals and
ambiguous filter paths. Record the direction, do not just record the edge.

### Gotchas

- `INFO.*` needs **semantic-model admin**; some calls need workspace admin. A
  viewer gets nothing, silently.
- **Report-layer logic is not in the model.** Visual filters, report-level
  measures, slicer state, Q&A synonyms. The number one API-vs-UI discrepancy.
- **Implicit measures** live in the report. `INFO.MEASURES()` misses every one.
- OLS makes objects invisible rather than error-producing.
- Calculation groups and field parameters change a measure's meaning at query
  time. `INFO.CALCULATIONITEMS()` gives the expressions; composing them
  correctly is hard, and it is fair to say so.

---

## 4. Snowflake semantic views

**Auth cost: low.** Key-pair JWT or PAT. One user, one role, one warehouse.

```sql
SHOW SEMANTIC VIEWS IN DATABASE <db>;
DESCRIBE SEMANTIC VIEW <db>.<schema>.<view>;
SELECT GET_DDL('SEMANTIC_VIEW', '<db>.<schema>.<view>');
SHOW SEMANTIC METRICS IN VIEW <view>;
SHOW SEMANTIC DIMENSIONS FOR METRIC <metric>;
```

The `INFORMATION_SCHEMA.SEMANTIC_*` views are joinable:

```sql
SELECT m.metric_name, m.expression, t.base_table, d.dimension_name
FROM   information_schema.semantic_metrics    m
JOIN   information_schema.semantic_tables     t USING (semantic_view_name)
LEFT   JOIN information_schema.semantic_dimensions d USING (semantic_view_name)
WHERE  m.semantic_view_name = '<view>';
```

Querying through the semantic layer:
```sql
SELECT * FROM SEMANTIC_VIEW(my_view METRICS total_revenue DIMENSIONS region, month);
```

### Gotchas

- **`SEMANTIC_VIEW()` is not ordinary SQL.** You cannot add arbitrary
  expressions, and you cannot join it the way you would join a table. An agent
  that treats it as a normal relation will produce syntax errors it then tries
  to "fix" by inventing SQL.
- **`NON ADDITIVE BY`** is the semi-additivity declaration. Read it before
  summing anything across time.
- **Adoption is very low.** Most accounts have zero semantic views. Plan for
  the fallback.
- Masking policies return **masked values that look like data**. Row access
  policies silently filter. Neither errors.
- `ACCESS_HISTORY` gives empirical column-level lineage from actual query
  execution, which is the best fallback when no semantic view exists.

---

## 5. Cube

**Auth cost: low.** JWT with embedded security context (Core), OAuth (Cloud).

`GET /v1/meta` returns:

```
cubes[]:
  name, title, description, public
  measures[]:   name, title, type (count, sum, avg, min, max,
                countDistinct, countDistinctApprox, number),
                format, drillMembers, aggType
  dimensions[]: name, title, type (string, number, time, boolean),
                primaryKey, format
  segments[]:   name, title, shortTitle
views[]
```

`searchDataModel` does semantic similarity search over the model. This is the
answer to "which of 400 measures means revenue?".

Join `relationship` and `sql` come from the model files, not `/v1/meta`.

### Gotchas

- **`/v1/meta` returns only what the JWT's security context allows.** Two JWTs
  produce two different models.
- **`query_rewrite` can inject mandatory filters the agent never sees.** A
  number from Cube may be pre-filtered with no disclosure anywhere in the
  response. Treat every Cube number as potentially scoped and say so.
- `countDistinctApprox` is an approximation. It is in the type. Check it and
  disclose it.
- Cube Cloud specific features (dashboards, model authoring with dev branches)
  are Premium/Enterprise only. An OSS Cube customer has `/v1/meta`, `/v1/load`
  and the SQL API, and nothing else.

---

## 6. Tableau

**Auth cost: medium.** PAT is easy but **expires after 15 days idle**.
Connected App JWT is the real answer for anything durable.

### Metadata API (GraphQL, read-only)

`POST /api/metadata/graphql`

```graphql
{
  workbooks(filter: {name: "..."}) {
    name
    sheets { name
      sheetFieldInstances { name ... on CalculatedField { formula role aggregation } }
    }
    upstreamTables { name schema fullName }
    upstreamDatasources { name hasExtracts }
  }
}
```

Column-level lineage fields: `upstreamColumns`, `upstreamTables`,
`downstreamSheets`, `downstreamDashboards`, `downstreamOwners`. **The best
column-level lineage in the stack.**

### VizQL Data Service (the right way to get Tableau numbers)

`POST /api/v1/vizql-data-service/query-datasource`

```json
{
  "datasource": { "datasourceLuid": "..." },
  "query": {
    "fields": [
      { "fieldCaption": "Region" },
      { "fieldCaption": "Sales", "function": "SUM" }
    ],
    "filters": [
      { "field": {"fieldCaption": "Order Date"},
        "filterType": "DATE", "periodType": "MONTHS", "dateRangeType": "LAST", "rangeN": 12 }
    ]
  },
  "options": { "returnFormat": "OBJECTS", "rowLimit": 10000 }
}
```

`read-metadata` gives a simpler query-oriented view of a data source's fields.

Measure `function` values: `SUM, AVG, MEDIAN, COUNT, COUNTD, MIN, MAX, STDEV,
VAR, COLLECT`, plus temporal `YEAR, QUARTER, MONTH, WEEK, DAY, TRUNC_*`.

Filter types: `SET`, `QUANTITATIVE_NUMERICAL`, `QUANTITATIVE_DATE`,
`RELATIVE_DATE`, `TOP_N`, `MATCH`, plus context filters.

### Why VDS rather than re-implementation

**Join conditions and cardinality are not reliably exposed by the Metadata
API.** You can read the formula and still be unable to reproduce the number,
because you do not know how the logical tables relate. VDS executes the
customer's own logic without you needing to understand it. That is a real win
and it is the documented right answer for Tableau.

### Gotchas

- Metadata API is **permission-filtered with no error**, asynchronously
  indexed, capped at **20,000 nodes** with partial results signalled by
  `NODE_LIMIT_EXCEEDED`, and must be **explicitly enabled on Tableau Server**.
- **LOD expressions and table calculations depend on viz context.** A `formula`
  string is not enough to reproduce a sheet's number.
- There is a known VDS defect around categorical filters in some versions;
  round-trip a known value before trusting a filtered result.
- No per-query timezone override in VDS; the data source / server timezone
  applies. `TRUNC_WEEK` follows the site's start-of-week.
- VDS `rowLimit` lives in `options`; the general VDS timeout is 30 minutes
  returning HTTP 408.

---

## 7. BigQuery

**No metric semantics exist.** State this rather than implying otherwise.

```sql
SELECT table_name, view_definition
FROM   `project.dataset.INFORMATION_SCHEMA.VIEWS`;

SELECT routine_name, routine_definition
FROM   `project.dataset.INFORMATION_SCHEMA.ROUTINES`;

SELECT * FROM `project.dataset.INFORMATION_SCHEMA.TABLE_CONSTRAINTS`;
SELECT * FROM `project.dataset.INFORMATION_SCHEMA.KEY_COLUMN_USAGE`;
```

Parsing `view_definition` is **genuine discovery of where the metric logic
lives**, and it is **inference of what the metric means**. Label it inferred.
Never present a metric derived this way as "the customer's definition" without
the inference label.

`TABLE_CONSTRAINTS` / `KEY_COLUMN_USAGE` are only populated if someone declared
PK/FK. BigQuery does not enforce them. Most teams have declared nothing.
**Check for presence; do not assume absence means no relationship.**

Dataplex / Knowledge Catalog adds a business glossary and harvested
table-and-column-level lineage where adopted.

---

## 8. Looker Studio

`assets:search` and permission management. **No data API.** Cannot read report
data, cannot create or modify a report, cannot read chart configuration. The
Linking API builds a pre-filled URL for a human to click.

Report this as a hard boundary in the inventory and move on.

---

## 9. The capability probe

Run before trusting any inventory. Each probe distinguishes "absent" from
"invisible".

| Platform | Probe | "I am blind" signature |
|---|---|---|
| Looker | request a known field's `sql` | field present, `sql` absent → no `see_lookml` |
| Power BI | `EVALUATE INFO.TABLES()` | empty or 401 → not semantic-model admin |
| Tableau | Metadata API query for a workbook you know exists | absent from results → permission-filtered |
| Snowflake | `SHOW SEMANTIC VIEWS` then `DESCRIBE` one | `SHOW` lists it, `DESCRIBE` fails → role lacks usage |
| Snowflake | compare a masked column's distinct count to a known value | masked values look like data; only a control value catches it |
| Cube | request `/v1/meta` with two different JWTs | differing models → security context is filtering |
| BigQuery | `INFORMATION_SCHEMA.TABLES` count vs a known dataset inventory | fewer tables → dataset ACL |
| dbt | `metadata.generated_at` vs today | stale artefact → the model you are reading is not production |

Emit every probe result in `blind_spots[]`, including the passes. A probe that
passed is evidence; a probe that was never run is not.
