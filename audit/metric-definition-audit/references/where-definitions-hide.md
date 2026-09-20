# Where definitions hide: the per-platform hunt

Work the list. A metric is not inventoried until every reachable location has
been checked or declared unreachable.

---

## Looker

```
GET /api/4.0/lookml_models/{model}/explores/{explore}
  -> fields.measures[].sql        the expression
  -> fields.measures[].description
  -> fields.dimensions[].sql      filters and derived logic hide here too
  -> always_filter, conditionally_filter, access_filters
  -> errors[]                     read it; a broken model is a finding
GET /api/4.0/projects/{p}/files/{f}    the literal LookML
```

**The ones people miss:**
- **Derived-table SQL.** A `derived_table:` block can contain an entire
  alternative definition, and it does not appear as a measure.
- **`always_filter` and `conditionally_filter`.** These change the denominator
  for every query through the explore and are invisible on the chart.
- **`access_filters`.** Per-user filters, so the definition is identity-
  dependent. See `permission-effect-audit`.
- **Liquid in `sql:`.** Returns unrendered. The formula you read is not the
  formula that runs. Flag it rather than parsing it.
- **Looks and dashboards with tile-level filters.** The measure is shared; the
  filter is not.

---

## Power BI

```dax
EVALUATE INFO.MEASURES()          -- name, DAX expression, format, table
EVALUATE INFO.CALCULATIONITEMS()  -- calc groups change what a measure means
EVALUATE INFO.TABLEPERMISSIONS()  -- RLS filter expressions
EVALUATE INFO.RELATIONSHIPS()     -- cardinality and cross-filter direction
EVALUATE INFO.PARTITIONS()        -- M expressions, upstream logic
```

**The ones people miss, and this is the single biggest gap in any Power BI
audit:**

- **Report-level measures** in thin / PBIR reports. They live in the report
  artefact, not the semantic model. `INFO.MEASURES()` does not list them.
- **Implicit measures.** Created by dragging a column onto a visual. They exist
  only in the report. `INFO.MEASURES()` does not list them either.
- **Visual-level and page-level filters.** These change the denominator per
  tile, and nothing in the model reflects them.
- **Slicer state and default selections.**
- **Calculation groups.** `INFO.CALCULATIONITEMS()` gives the expressions, but
  a measure's meaning at query time is the composition of the measure and the
  active calculation item.

**Together these are the number one API-versus-UI discrepancy in Power BI.** An
audit that reads only the model will report definitions that differ from what
the dashboard shows and will not know why. Get the report definition (PBIR
JSON via Fabric REST, or the `.pbip` folder from git) and read it too.

---

## Tableau

```graphql
{
  workbooks {
    name
    sheets {
      name
      sheetFieldInstances {
        name
        ... on CalculatedField { formula role aggregation }
      }
    }
  }
}
```

**The ones people miss:**
- **Sheet-level LOD expressions and table calculations.** These are viz-context
  dependent. A `formula` string alone does not reproduce the number.
- **Worksheet filters and context filters**, which change the denominator per
  sheet.
- **Parameter defaults**, which change what the sheet computes.
- **Data source filters**, applied before anything the sheet does.
- **Published data source calculated fields** versus **workbook-embedded**
  ones: the same field name can exist in both with different formulas.

When the formula cannot be trusted to reproduce the number, the honest audit
entry is: definition read, reproduction not verified, because Tableau's join
conditions and viz context are not exposed. Then **verify by calling it**
through VizQL Data Service rather than by re-implementing.

---

## Snowflake

```sql
SHOW SEMANTIC VIEWS IN ACCOUNT;
SELECT GET_DDL('SEMANTIC_VIEW', '<name>');
SHOW SEMANTIC METRICS IN VIEW <view>;

SELECT table_schema, table_name, view_definition
FROM   <db>.information_schema.views;

SELECT function_name, argument_signature, function_definition
FROM   <db>.information_schema.functions;
```

**The ones people miss:**
- Metric logic three views deep. A mart view selects from an intermediate view
  that applies the actual filter.
- **Row access policies and masking policies**, which change what the same
  definition returns per role.
- Stored procedures and UDFs computing a metric outside any view.
- Tasks that materialise a metric into a table on a schedule, where the
  definition is in the task body.

---

## dbt

```
target/semantic_manifest.json   metrics with numerator/denominator, type, filter
target/manifest.json            model raw_code and compiled_code, tests,
                                exposures, column descriptions
models/**/*.sql                 the actual logic
models/**/*.yml                 descriptions and tests
```

**The one people miss:** business logic in **staging** models. Once a
`CASE WHEN score > 70 THEN 'MQL'` lands in `stg_*`, it is both authoritative
and invisible, because nobody looks for definitions in staging. Grep the whole
project for threshold literals and `CASE WHEN`, not just the marts.

Also check `metadata.generated_at`: a stale manifest describes a model that no
longer exists.

---

## Cube

```
GET /v1/meta      measures, dimensions, segments, views
                  model files for the actual sql: and joins
```

**The one people miss: `segments`.** A segment is a named reusable business
filter. Applying one changes the denominator, and a chart built on a segment
looks identical to one built without it.

Also: **`query_rewrite` can inject mandatory filters the agent never sees.**
If the deployment uses it, every Cube number in the inventory is conditionally
scoped, and the audit must say so.

---

## The platform-native layer

This is where audits are most often incomplete, because the definitions are
settings rather than code.

| Platform | What to read | Why it is a definition |
|---|---|---|
| **Klaviyo** | `conversion_metric_id` on each flow and campaign | which event counts as a conversion, set per object; two campaigns can report "conversions" meaning two different events |
| **Klaviyo** | the attribution window setting | changing it **restates all history retroactively** |
| **Braze** | the conversion basis on each campaign | two bases exist; the campaign chooses |
| **Salesforce** | report metadata: custom summary formulas, bucket fields, cross filters, row-level formulas | the report *is* the definition, and it is not in any semantic layer |
| **Salesforce** | the report's running user | changes which rows are in the denominator |
| **GA4** | key event configuration, custom definitions, channel group definitions, conversion counting method (once per event versus once per session) | all four change the number and none is in a warehouse |
| **Google Ads / Meta / LinkedIn** | attribution window and counting method, per account and sometimes per campaign | the same campaign reports different conversion counts under different windows |
| **HubSpot** | calculated properties, report filters, list definitions | a list is a denominator |
| **Marketo / Pardot** | smart list definitions, scoring rules | the MQL rule lives here |

---

## The spreadsheet

**Ask directly: which numbers in this deck are computed in a spreadsheet?**

It is almost never zero, and the spreadsheet almost always contains a filter,
an exclusion or a manual adjustment that exists nowhere else. Common shapes:

- a row deleted because "that deal was a one-off"
- a segment mapping maintained by hand
- a currency conversion at a rate someone typed
- last month's number carried forward because the export failed

These are legitimate business adjustments. They are also undocumented metric
definitions, and they belong in the crosswalk with `evidence_status: reported
by a person` and the person named.

---

## Coverage statement

Every audit closes with what it covered and what it did not:

```
coverage:
  reached:    [looker, dbt repo, snowflake, salesforce reports]
  unreachable:
    - power_bi: credential is a workspace viewer; INFO.* returns nothing.
                Resolves with semantic-model admin on the two workspaces listed.
    - tableau:  Metadata API not enabled on this server instance.
  not_attempted:
    - spreadsheets: no inventory was supplied. Three numbers in the exec pack
                    could not be traced to any system and are likely computed
                    by hand.
```

`not_attempted` is as important as `unreachable`. It is the difference between
an audit that is honest about its scope and one that will be read as complete.
