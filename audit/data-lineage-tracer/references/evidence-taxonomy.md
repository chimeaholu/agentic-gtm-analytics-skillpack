# Evidence taxonomy and the refresh discipline

---

## 1. The three tiers

### repo-derived

Evidenced by artefacts in version control: committed SQL, dbt `manifest.json`
from a pinned commit, LookML files, ingestion schemas, tests.

- **Evidence reference:** commit SHA and file path.
- **Ages:** with the repo. A SHA pins it exactly.
- **Strongest for:** structural edges inside the transformation layer.
- **Weak for:** anything that happens outside the repo, which is most of the
  BI layer and all of the platform-native layer.

### preserved live evidence

A dated readback gathered in an earlier session and stored.

- **Evidence reference:** the stored readback with its date and the call that
  produced it.
- **Ages:** by the date, and it must be stated. **Never present preserved
  evidence as current.**
- **Strongest for:** things that are expensive to re-read (tenant scans,
  20,000-node graphs).
- **Weak for:** anything that changes weekly.

### live-confirmed

Produced by a bounded read-only metadata refresh in this session.

- **Evidence reference:** the call, its timestamp and the response.
- **Ages:** immediately, but it is current as of now, which is the strongest
  claim available.
- **Strongest for:** the edges a decision depends on right now.
- **Cost:** credentials, quota, and on some platforms real money.

**Never merge the tiers.** Rendering a live-confirmed edge and an eighteen-
month-old preserved edge identically means the whole graph gets trusted at the
level of its weakest edge, which is the same failure as a join path that does
not carry its minimum confidence.

---

## 2. Snapshot, diff, reconcile, promote

### Why not just refresh

A naive refresh replaces the catalogue with live metadata. The structure is
accurate afterwards and every human-written description is gone. The artefact
is now correct and useless, and nobody rewrites the descriptions.

**Live metadata wins on structure. Reviewed documentation wins on meaning.**

### The four steps

**1. Snapshot.** Generate a dated snapshot of the live graph. Write it to a new
dated location. Do not touch the existing baseline.

**2. Diff.** Compare against the prior baseline. Three kinds of difference:

| Difference | Usually means |
|---|---|
| new edge | a genuine addition, or newly visible because permissions changed |
| removed edge | a genuine removal, **or** a permission artefact, **or** an indexing lag |
| changed edge | a rename or a re-pointing |

**3. Reconcile each difference against source evidence.** A removed edge is the
dangerous one, because the default interpretation is "it is gone" and the
common cause is "I cannot see it any more". Check:

- Did the credential change? (see `permission-effect-audit`)
- Is the source index asynchronous, as Tableau's is?
- Was a truncation flag raised: `NODE_LIMIT_EXCEEDED`, a Looker `errors` block,
  a partial scanner result, a stale `metadata.generated_at`?
- Does the repo still contain the SQL that creates the edge?

**4. Enrich, then promote.** Carry forward the business descriptions, ownership
and known limitations from the baseline onto the new structure. Promote in a
reviewed change. **Keep the old dated snapshots.** They are the audit trail
that makes "when did this edge disappear" answerable.

---

## 3. The bounded read-only refresh contract

A lineage refresh runs on a schedule, against production, with elevated read
permissions. It composes query strings from catalogue names. That combination
deserves four constraints.

### 3.1 Query allowlist

Only fixed `INFORMATION_SCHEMA`-class query templates, parameterised by an
allowlisted project/dataset or database/schema pair. Not arbitrary SQL, not
SQL assembled from user input.

```
ALLOWED_TEMPLATES = {
  "list_tables":   "SELECT table_name, table_type FROM {catalog}.INFORMATION_SCHEMA.TABLES",
  "list_columns":  "SELECT table_name, column_name, data_type FROM {catalog}.INFORMATION_SCHEMA.COLUMNS",
  "view_defs":     "SELECT table_name, view_definition FROM {catalog}.INFORMATION_SCHEMA.VIEWS",
  "constraints":   "SELECT * FROM {catalog}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS",
}
ALLOWED_CATALOGS = [...]   # explicit, not wildcarded
```

### 3.2 Compiled denylist

Applied to the composed statement immediately before submission, not to the
template:

```
DENY = compiled regex over:
  INSERT UPDATE DELETE MERGE TRUNCATE DROP ALTER CREATE GRANT REVOKE
  COPY UNLOAD CALL EXECUTE SET USE
```

Belt and braces with the allowlist. The allowlist is the control; the denylist
catches a template that acquires an interpolated identifier during a refactor.

### 3.3 Maximum-bytes ceiling

Every query carries a byte ceiling (`maximumBytesBilled` in BigQuery, a
statement timeout and warehouse size cap in Snowflake). A lineage refresh
should never be the most expensive query of the day, and without a ceiling it
occasionally is.

### 3.4 Row counts from metadata, not from scanning

```sql
-- NO
SELECT COUNT(*) FROM big_table;

-- YES (BigQuery)
SELECT table_id, row_count, size_bytes FROM dataset.__TABLES__;
-- YES (Snowflake)
SELECT table_name, row_count, bytes FROM information_schema.tables;
```

The catalogue already knows. Scanning to learn it is the single most common
avoidable cost in a metadata job.

---

## 4. Truncation signals, which must be read

A trace that hit any of these is **partial** and says so in its coverage block.

| Platform | Signal | Meaning |
|---|---|---|
| Tableau | `NODE_LIMIT_EXCEEDED` | results capped at 20,000 nodes, partial results returned |
| Tableau | content absent, no error | permission-filtered, or not yet indexed |
| Looker | non-empty `errors[]` on `lookml_model_explore` | broken model; fewer fields returned; **trace stops early silently** |
| Power BI | scanner API partial result | async scan not complete, or rate limited |
| dbt | `metadata.generated_at` older than expected | the manifest describes a model that may no longer exist |
| Snowflake | `ACCESS_HISTORY` latency | account usage views lag by up to a few hours |
| Any | credential change since the baseline | apparent removals may be blindness |

**Ignoring a truncation signal produces a lineage graph that is quietly
incomplete**, which is worse than a graph that is visibly partial, because it
will be used to assess a blast radius.

---

## 5. Clones and wildcards

### Zero-copy clones

Snowflake `ACCESS_HISTORY` shows the **clone**, not the origin. A dev clone
appears as an independent root with no upstream, and a trace from it does not
connect to the real source.

Detect and map explicitly:

```sql
SHOW TABLES LIKE '%' IN SCHEMA dev;   -- clone metadata appears in the output
```

Record the clone-to-origin mapping as its own edge type so a trace through a
clone resolves to the origin rather than dead-ending.

### BigQuery wildcard suffixes

A query on `events_*` references every shard, including ones created after the
query was written. Expanding the wildcard into a table list produces a lineage
record that is wrong the next day.

**Record the wildcard as a wildcard.** `events_*` is the upstream node, with
the shard-matching pattern stored, not the 400 tables it currently matches.

---

## 6. Unevidenced edges

They stay in the graph. Removing them destroys the knowledge that someone
believed the edge existed, and that belief is usually correct even when the
evidence is missing.

```yaml
unevidenced_edges:
  - upstream: analytics.marts.mart_opportunity
    downstream: "Quarterly board pack, tab 'Sales'"
    why_believed: "the tab's column headers match this model's columns exactly"
    who_reported: "name of the analyst who maintains it"
    would_be_evidenced_by: "the connector configuration, or a query log entry
                            from the spreadsheet's service account"
```

They are drawn as dashed lines, they appear in blast radius output, and they
are the ones that break silently when a column is renamed.
