# Per-platform lineage: calls, depth and truncation

Ranked by how much lineage you actually get.

---

## 1. Tableau Metadata API: the deepest, with four silent failure modes

**Depth:** warehouse column → calculated field → sheet → dashboard → owner.
The best column-level lineage in the stack.

```graphql
{
  columns(filter: {name: "amount"}) {
    name
    table { name schema }
    downstreamFields {
      name
      ... on CalculatedField { formula }
      sheets { name workbook { name owner { name email } } }
    }
    downstreamDashboards { name }
    downstreamOwners { name email }
  }
}
```

Upstream direction:
```graphql
{
  workbooks(filter: {name: "Revenue Overview"}) {
    upstreamTables   { name schema fullName database { name } }
    upstreamColumns  { name }
    upstreamDatasources { name hasExtracts }
    sheets { name sheetFieldInstances { name } }
  }
}
```

**The four limits, all of which truncate silently:**

1. **Permission-filtered with no error.** Content the credential cannot see is
   absent from results. It does not 403; it simply is not there.
2. **Asynchronously indexed.** Recently published content is missing until the
   indexer catches up.
3. **20,000-node cap** with partial results signalled by
   **`NODE_LIMIT_EXCEEDED`**. Read the field, page the query by workbook or
   database, and record the flag.
4. **Must be explicitly enabled on Tableau Server.** On instances where it is
   off, there is no API to call.

`sheetFieldInstances` is the underused one: it tells you which fields a sheet
**actually uses**, which is how you distinguish a field that is referenced from
one that merely exists in the data source.

---

## 2. dbt: DAG, column lineage, tests, and `exposures`

```
manifest.json
  nodes[].depends_on.nodes[]     the DAG
  nodes[].compiled_code          the SQL that ran
  nodes[].columns{}              descriptions and meta
  child_map / parent_map         precomputed adjacency
  exposures[]                    downstream dashboards with owner and URL
  sources[].freshness            ingestion freshness config
```

**`exposures` are the bridge out of the warehouse.** They are how an agent
finds the dashboards that matter, with an owner and a URL, without touching the
BI tool. A model with no exposures and no downstream models is an orphan
candidate; a model with five is load-bearing.

Column-level lineage via the dbt MCP: `get_column_lineage` /
`fusion.get_column_lineage`. Only dbt and Tableau offer this.

**Limits:**
- `manifest.json` is the **last parse, not production**. Check
  `metadata.generated_at`.
- `compiled_code` is **target-specific**. Dev artefacts point at dev schemas.
- Jinja is unresolved in `raw_code`, so a trace built from `raw_code` misses
  dynamically referenced objects.

To get a production manifest without repo access, pull it from a production job
run: dbt Admin API `list_job_run_artifacts` then `get_job_run_artifacts`.

---

## 3. Snowflake `ACCESS_HISTORY`: empirical column-level lineage

```sql
select
  query_id,
  query_start_time,
  bo.value:objectName::string        as upstream_object,
  c.value:columnName::string         as upstream_column,
  om.value:objectName::string        as downstream_object
from   snowflake.account_usage.access_history,
       lateral flatten(base_objects_accessed) bo,
       lateral flatten(bo.value:columns)      c,
       lateral flatten(objects_modified)      om
where  query_start_time > dateadd('day', -30, current_timestamp());
```

**Derived from actual query execution, so it cannot drift from reality.**
Arguably better than declared lineage for the question "what actually feeds
this table".

**Limits:**
- `ACCOUNT_USAGE` views lag, typically by a few hours.
- **Zero-copy clones show the clone, not the origin.**
- Only covers what has run. A model that runs quarterly is invisible in a
  30-day window.

`QUERY_HISTORY` complements it: which objects matter, to whom, how often.

---

## 4. Power BI

**Upstream, per model:**
```dax
EVALUATE INFO.PARTITIONS()
```
Returns the M / Power Query source expressions, which name the warehouse
objects the model reads. Parse them for server, database, schema and table.

**Tenant-wide inventory:** Admin scanner APIs (`getModifiedWorkspaces`,
`postWorkspaceInfo`, `getScanStatus`, `getScanResult`).

- **Fabric Administrator required.**
- **Asynchronous**: submit, poll status, fetch result.
- **Historically around 16 workspace-scan requests per hour.**
- **Do not inventory a tenant with per-item calls.** Batch workspaces into the
  scan request. Per-item enumeration will rate-limit long before it finishes
  and will produce a partial inventory that looks complete.

**Limit:** the model is not the report. Report-level measures, implicit
measures and visual filters live in the report artefact, so a lineage trace
that stops at the semantic model misses the layer where the number is actually
shaped. Pull the report definition (PBIR via Fabric REST, or `.pbip` from git)
for the last hop.

---

## 5. Looker

```
lookml_model_explore -> fields[].source_file
                     -> fields[].sql               (needs see_lookml)
                     -> joins[].dependent_fields
                     -> errors[]                   READ THIS
get_project_file     -> the literal LookML
System Activity      -> usage: which explores, fields, dashboards get queried
```

`dependent_fields` and `source_file` give intra-model lineage: which fields
depend on which. **There is no first-class column-level warehouse lineage.**
Getting past the explore boundary to the warehouse means parsing the `sql:`
expressions and any derived-table SQL, and **Liquid templating returns
unrendered**, so some expressions cannot be parsed at all.

**Truncated lineage from an ignored `errors` block** is the specific failure
here: a broken model returns fewer fields, the trace stops early, and nothing
says why. Read `errors[]` on every explore call and set a truncation flag when
it is non-empty.

---

## 6. BigQuery + Dataplex

**Dataplex lineage API** harvests table- and column-level lineage
automatically for supported sources, where it has been adopted.

**Job history, always available:**
```sql
select
  job_id, creation_time, user_email,
  ref.project_id, ref.dataset_id, ref.table_id,
  destination_table.dataset_id as dest_dataset,
  destination_table.table_id   as dest_table
from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT,
     unnest(referenced_tables) ref
where creation_time > timestamp_sub(current_timestamp(), interval 30 day)
  and job_type = 'QUERY';
```

Pairing `referenced_tables` with `destination_table` gives empirical
table-to-table lineage from actual execution.

**Limit:** **`_TABLE_SUFFIX` wildcards silently include tables you did not
mean.** `referenced_tables` for a wildcard query lists every matched shard.
Record the wildcard pattern as the node, not the expanded list.

---

## 7. The platform-native tail

Lineage does not stop at the BI tool. The last hop is often outside it.

| Destination | How to find it |
|---|---|
| scheduled emails and Slack digests | Looker scheduled plans, Tableau subscriptions, Power BI subscriptions, Salesforce report subscriptions (**5 per user, 5 notifications per user**) |
| spreadsheets | a connector configuration, a service-account query-log entry, or a person. Often unevidenced, and always in the blast radius. |
| reverse-ETL destinations | the reverse-ETL tool's own sync configuration |
| embedded analytics | the embedding application's code |

**Scheduled deliveries are frequently the only thing keeping a dead report
alive**, and they fail quietly into an inbox rather than loudly on a dashboard.
They belong in every blast radius.

---

## 8. Depth summary

| Platform | Table-level | Column-level | Downstream to artefact | Truncation signal to read |
|---|---|---|---|---|
| Tableau | yes | **yes** | **yes, to owner** | `NODE_LIMIT_EXCEEDED` |
| dbt | yes | **yes** | via `exposures` | `metadata.generated_at` |
| Snowflake | yes (empirical) | **yes (empirical)** | no | `ACCOUNT_USAGE` lag |
| BigQuery + Dataplex | yes | yes, where adopted | no | wildcard expansion |
| Power BI | yes, via partitions | no | within tenant, via scanner | scan partial result |
| Looker | partial | no | within Looker | `errors[]` |
