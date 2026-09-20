---
name: data-lineage-tracer
description: Use when someone needs to know where a number on a chart actually comes from, when assessing the blast radius of a schema or definition change, or when a lineage diagram needs to be produced or verified. Traces from the rendered metric back through the BI layer, the semantic layer, the warehouse models and the ingestion path to the source system, recording how each edge was established. Prevents a lineage diagram that ages into fiction, because every edge carries its evidence status.
---

# Data Lineage Tracer

A lineage diagram with no evidence status is a drawing. Six months later nobody
can tell which edges are still true, so the whole thing gets ignored and
someone draws a new one.

**Every edge carries how it was established.** That is the difference between
documentation and a diagram.

---

## 1. Store lineage as rows, not as a picture

```
upstream, downstream, edge_type, evidence_status, evidenced_at, evidence_ref
```

| Field | Content |
|---|---|
| `upstream` / `downstream` | fully qualified object names, or a metric and an artefact |
| `edge_type` | `table_to_table`, `column_to_column`, `model_to_metric`, `metric_to_artefact`, `source_to_table` |
| `evidence_status` | see §2 |
| `evidenced_at` | the date the evidence was gathered |
| `evidence_ref` | the commit SHA, the query ID, the API call, the file path |

**An edge nobody can evidence is visibly unevidenced rather than quietly
present.** Unevidenced edges stay in the graph, flagged, because removing them
loses the knowledge that someone once believed the edge existed.

---

## 2. The three-tier evidence taxonomy, never merged

| Tier | Meaning | Ages how |
|---|---|---|
| **repo-derived** | evidenced by committed SQL, ingestion schemas, or tests in version control | ages with the repo; a commit SHA pins it |
| **preserved live evidence** | a dated readback already stored from an earlier session | ages by the date; state the date, never present it as current |
| **live-confirmed** | produced by a bounded read-only metadata refresh in this session | current as of now |

**Never merge the tiers.** A diagram where a live-confirmed edge and a
two-year-old preserved edge look identical is a diagram that will be trusted
uniformly and is not uniformly trustworthy.

---

## 3. Per-platform lineage sources and their limits

### Tableau: the best column-level lineage in the stack, with four hard limits

Metadata API GraphQL gives warehouse column → calculated field → sheet →
dashboard → owner. `upstreamColumns`, `upstreamTables`, `downstreamSheets`,
`downstreamDashboards`, `downstreamOwners`, `sheetFieldInstances`.

The limits, all four of which produce silent truncation:

1. **Permission-filtered with no error.** Content the credential cannot see is
   absent, not denied.
2. **Asynchronously indexed.** Recently published content may not be in the
   index yet.
3. **Capped at 20,000 nodes**, with partial results signalled by
   **`NODE_LIMIT_EXCEEDED`**. Read that field. Ignoring it produces a lineage
   graph that is quietly incomplete.
4. **Must be explicitly enabled on Tableau Server.** On an instance where it is
   off, the API is simply unavailable.

### dbt: column-level lineage plus the DAG, and `exposures`

`manifest.json` gives `depends_on` for the full DAG, `compiled_code` for the
actual SQL, tests, source freshness config, and **`exposures`**.

**`exposures` are how an agent finds the dashboards that matter**, with owner
and URL, without touching the BI tool.

`get_column_lineage` / `fusion.get_column_lineage` via the dbt MCP give
column-level lineage. Only dbt and Tableau offer this.

Limit: `manifest.json` reflects the **last parse, not production**. Check
`metadata.generated_at`, and check which target produced it, because
`compiled_code` is target-specific.

### Power BI

- **`INFO.PARTITIONS()`** returns M / Power Query source expressions, which is
  upstream lineage from the model back to the warehouse.
- **Admin scanner APIs** give tenant-wide inventory. **Fabric Administrator
  required, asynchronous, and historically around 16 workspace-scan requests
  per hour. Do not inventory a tenant with per-item calls.**

Limit: report-layer logic is not in the model, so lineage that stops at the
semantic model misses where report-level measures and visual filters change the
number.

### Looker

`dependent_fields` and `source_file` give intra-model lineage. **No first-class
column-level warehouse lineage.** Derived-table SQL has to be parsed to get
past the explore boundary.

Read the `errors` block from `lookml_model_explore`. **Truncated lineage from
an ignored `errors` block** is a specific and common failure: a broken model
returns fewer fields, and the trace silently stops early.

### Snowflake

`ACCOUNT_USAGE.ACCESS_HISTORY` gives `base_objects_accessed` and
`objects_modified`: **empirical column-level lineage derived from actual query
execution, arguably better than declared lineage** because it cannot drift from
reality.

`QUERY_HISTORY` tells you which objects matter and how often.

### BigQuery

Dataplex lineage harvests table- and column-level lineage automatically where
adopted. `INFORMATION_SCHEMA.JOBS_BY_PROJECT` with
`UNNEST(referenced_tables)` gives the tables each job touched.

---

## 4. Snapshot, diff, reconcile, promote

**Never silently replace documentation with a raw live snapshot.**

```
1. snapshot    generate a dated live snapshot of the graph
2. diff        against the prior baseline
3. reconcile   each difference against source evidence: is this a real change,
               a permission artefact, or an indexing lag?
4. enrich      carry forward the business descriptions humans wrote; the live
               snapshot does not have them
5. promote     in a reviewed change, keeping old dated snapshots for auditability
```

**Live metadata wins on structure. Reviewed documentation wins on meaning.**

The failure this prevents: a refresh job overwrites the catalogue with live
metadata, and every column description someone spent a week writing is gone,
replaced by nothing. The structure is now accurate and the artefact is now
useless.

---

## 5. Read-only metadata refresh, bounded

Any live refresh runs under four constraints:

1. **A query allowlist.** Only fixed `INFORMATION_SCHEMA`-class queries, built
   from an allowlisted project/dataset or database/schema pair.
2. **A compiled denylist** of every mutating keyword, applied to the composed
   statement before submission.
3. **A maximum-bytes ceiling** on every query.
4. **Row counts read from the metadata API, not by scanning.** `SELECT
   COUNT(*)` on a large table is an expensive way to learn something the
   catalogue already knows.

This is not ceremony. A lineage refresh is the kind of job that runs on a
schedule against production with elevated read permissions, and a composed
query string is the kind of thing that acquires an interpolated identifier.

---

## 6. Two distortions that make lineage lie

**Zero-copy clones.** Snowflake `ACCESS_HISTORY` shows the **clone**, not the
origin. A clone created for a dev environment appears as an independent source,
and lineage from it does not connect to the real upstream. Detect clones
(`SHOW TABLES` clone metadata, naming conventions) and map them to origins
explicitly.

**Wildcard suffixes.** BigQuery `_TABLE_SUFFIX` queries silently include tables
you did not mean. A job that references `events_*` appears in lineage as
depending on every shard, including ones created after the query was written.
Record the wildcard as a wildcard rather than expanding it to a table list that
will be wrong tomorrow.

---

## 7. Blast radius is the practical output

For a proposed change, return what breaks:

```
proposed_change: rename mart_opportunity.amount -> amount_usd

downstream:
  models:      3   (int_pipeline_daily, mart_revenue, mart_forecast_input)
  metrics:     2   (win_rate_dollar, pipeline_coverage)
  exposures:   4   dashboards, with owners and URLs
  BI artefacts: 7  tiles across 3 dashboards
  scheduled deliveries: 2   (a weekly email, a Slack digest)
  unevidenced edges: 1      (a spreadsheet that pulls from this table via a
                             connector; reported by a person, not verified)
owners_to_notify: [list]
```

**The unevidenced edges belong in the blast radius**, clearly marked. They are
exactly the things that break silently, because nobody knew they were there.

Scheduled deliveries belong there too: they are frequently the only thing
keeping a report alive, and they fail quietly into someone's inbox.

---

## 8. Output

```
edges[]:
  upstream, downstream, edge_type,
  evidence_status (repo_derived | preserved_live | live_confirmed),
  evidenced_at, evidence_ref
unevidenced_edges[]:
  upstream, downstream, why_believed, who_reported
coverage:
  platforms_traced[], platforms_unreachable[], truncation_flags[]
blast_radius (when a change is proposed):
  models[], metrics[], exposures[], artefacts[], deliveries[], owners[]
snapshot_meta:
  snapshot_date, diffed_against, differences_reconciled[]
```

`truncation_flags` carries `NODE_LIMIT_EXCEEDED`, a non-empty Looker `errors`
block, a scanner API partial result, or a stale `metadata.generated_at`. A
trace with a truncation flag is a partial trace and says so.

---

## 9. Answering

**Answer first.** Give the trace you have, with each edge's evidence status
visible, rather than withholding until everything is live-confirmed. A trace
that is 70% repo-derived and 30% unevidenced is useful **as long as the 30% is
marked**.

For a blast radius, lead with the count and the owners, then the detail. People
act on "seven tiles across three dashboards, here are the owners", not on a
graph.

Withhold only: an edge asserted with no evidence of any kind. That edge is
listed as unevidenced, with who believes it and why, and it is never drawn as
a solid line.

## References

- `references/evidence-taxonomy.md` — the three tiers, the refresh discipline,
  and the bounded read-only refresh contract
- `references/per-platform-lineage.md` — the calls, limits and truncation
  signals per platform

## Related skills

- `semantic-layer-introspector` and `relationship-discovery` supply the
  structural edges.
- `metric-definition-audit` supplies the metric-to-location edges.
- `report-estate-audit` supplies the downstream artefact inventory.
- `permission-effect-audit` explains why a trace is shorter than expected.
