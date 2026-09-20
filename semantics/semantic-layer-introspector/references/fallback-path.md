# The fallback path: no semantic layer found

This is the common case, not the exception. Most dbt projects in 2026 have
`models/` and `schema.yml` and no `semantic_models:` at all. Most Snowflake
accounts have zero semantic views. Build this path first and treat the
semantic-layer path as the upside.

"No semantic layer found" is a **first-class outcome**. Report it, then proceed.

---

## Step 1. Model SQL, column descriptions and tests

Still far better than nothing.

- **Model SQL** tells you what the transformation does, and specifically which
  date column the model buckets on, which is the most common source of GTM
  reporting disputes.
- **Column descriptions** in `schema.yml` or `INFORMATION_SCHEMA.COLUMNS`
  carry human meaning nothing else does.
- **Tests** are a declaration of intent. A `unique` test on a column is the
  team telling you the grain. A `relationships` test is a **declared foreign
  key in everything but name**, and `relationship-discovery` should treat it as
  a declared edge.
- **`not_null` on a join key** means the team believes the join is total. Check
  whether it still passes.

## Step 2. Exposures

dbt `exposures` name which dashboard or application consumes which model, with
owner and URL. **This is how you find the dashboards that matter** without
touching the BI tool.

```yaml
exposures:
  - name: revenue_dashboard
    type: dashboard
    owner: {name: ..., email: ...}
    depends_on: [ref('mart_opportunity'), ref('mart_spend')]
```

A model with no exposures and no downstream models is a candidate orphan.
A model with five exposures is load-bearing and must not be changed casually.

## Step 3. Empirical usage: what the business actually queries

Declared semantics describe intent. Query history describes behaviour. When
they disagree, behaviour is usually the better guide to what matters.

### Snowflake

```sql
-- which tables and columns are actually read
SELECT  value:objectName::string        AS table_name,
        f.value:columnName::string      AS column_name,
        count(*)                        AS reads
FROM    snowflake.account_usage.access_history,
        LATERAL FLATTEN(base_objects_accessed) ,
        LATERAL FLATTEN(value:columns) f
WHERE   query_start_time > dateadd('day', -90, current_timestamp())
GROUP BY 1,2
ORDER BY reads DESC;
```

`ACCESS_HISTORY` also gives `objects_modified`, which is **empirical
column-level lineage derived from actual execution**. Arguably better than
declared lineage, because it cannot drift from reality.

`QUERY_HISTORY` tells you which tables matter, who runs them, and how often.

**Caveat:** zero-copy clones distort this. `ACCESS_HISTORY` shows the clone,
not the origin. See `data-lineage-tracer`.

### BigQuery

`INFORMATION_SCHEMA.JOBS_BY_PROJECT` gives referenced tables per job:

```sql
SELECT  ref.project_id, ref.dataset_id, ref.table_id, count(*) AS jobs
FROM    `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT,
        UNNEST(referenced_tables) ref
WHERE   creation_time > timestamp_sub(current_timestamp(), INTERVAL 90 DAY)
GROUP BY 1,2,3 ORDER BY jobs DESC;
```

Dataplex lineage API gives harvested table- and column-level lineage where
adopted.

**Caveat:** `_TABLE_SUFFIX` wildcard queries silently include tables you did
not mean, which inflates apparent usage of the whole sharded set.

### Looker

System Activity explores give query counts per Look, dashboard, explore and
field, plus per-user activity. This is the best available "which metric is
actually used for decisions" signal in Looker.

### Power BI

Usage metrics reports per workspace; Admin scanner APIs for tenant-wide
inventory. **Scanner APIs are async and historically limited to roughly 16
workspace-scan requests per hour. Do not inventory a tenant with per-item
calls.**

### Tableau

View stats via REST; `downstreamSheets` / `downstreamDashboards` from the
Metadata API give structural usage even where view counts are unavailable.

---

## Step 4. Infer, and label the inference

Where you must infer a metric definition from SQL:

1. Extract the aggregate expression and its filters.
2. Write the **stakeholder sentence** the filters imply, not the sentence the
   model name implies.
3. Record every predicate. A predicate in the SQL that is not in the sentence
   is either a bug in the model or a missing clause in the sentence.
4. Mark the whole record `evidence: inferred_from_sql` with the file path and
   commit, or the `view_definition` and its `INFORMATION_SCHEMA` source.
5. Never present an inferred definition as the customer's declared one.

---

## Step 5. Report the depth score honestly

| Depth | Meaning |
|---|---|
| 5 | declared metrics with additivity, valid dimensions, agg time dimension and an entity join graph |
| 4 | declared metrics and a declared join graph, additivity not declared |
| 3 | declared metric expressions, join graph partial or hidden; metrics callable by name |
| 2 | metric logic readable only as SQL; joins inferred from constraints or naming |
| 1 | table and column metadata only; metric logic not located |
| 0 | no programmatic access to definitions at all |

Downstream skills read this score. A depth-2 inventory is usable; it just means
every derived number is labelled inferred and `relationship-discovery` carries
a lower minimum confidence along every join path.
