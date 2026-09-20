# Authoring per platform: calls, formats, gates

Every procedure here assumes `write-gate` has already approved the write.

---

## dbt

### Files you write

| File | Contains |
|---|---|
| `models/marts/<model>.sql` | the model SQL |
| `models/marts/<model>.yml` | `models:` description, columns, tests |
| `models/semantic/<name>.yml` | `semantic_models:`, `metrics:`, `saved_queries:` |

### Validation ladder

```bash
dbt parse          # syntax and reference validation, no warehouse touch. SAFE.
dbt compile        # renders Jinja against a target. Reads the warehouse.
dbt build          # RUNS models and tests. PRODUCTION ACTION. GATED.
```

An agent may run `dbt parse` freely. `dbt build` against a production target is
gated and loud, and in most cases should be left to CI on the merged PR.

### Metric types and when each is right

| Type | Use for |
|---|---|
| `simple` | a single measure: bookings, opportunity count |
| `ratio` | anything with a denominator: win rate, conversion rate, coverage |
| `cumulative` | running totals: MTD bookings, cumulative cohort revenue (`grain_to_date` or `window`) |
| `derived` | expressions over other metrics, with `offset_window` for period-over-period |
| `conversion` | funnel stage rates: base event, conversion event, entity, window |

Prefer `ratio` over a `derived` metric that divides two simple metrics.
`ratio` makes the numerator and denominator machine-readable, which is what
`calculation-integrity-audit` reads.

### `non_additive_dimension`

```yaml
measures:
  - name: arr
    agg: sum
    expr: arr_amount
    agg_time_dimension: snapshot_date
    non_additive_dimension:
      name: snapshot_date
      window_choice: max        # take the last snapshot in the period
      window_groupings: [account_id]
```

Without this, summing ARR across three months returns three times the ARR and
nothing errors.

---

## Snowflake

```sql
CREATE OR ALTER SEMANTIC VIEW analytics.gtm.revenue
  TABLES (
    opp AS analytics.marts.mart_opportunity PRIMARY KEY (opportunity_id),
    acc AS analytics.marts.dim_account       PRIMARY KEY (account_id)
  )
  RELATIONSHIPS (
    opp_to_acc AS opp (account_id) REFERENCES acc
  )
  DIMENSIONS (
    opp.close_month AS DATE_TRUNC('month', close_date),
    acc.segment     AS segment
  )
  METRICS (
    opp.won_amount    AS SUM(CASE WHEN is_won THEN amount ELSE 0 END),
    opp.open_pipeline AS SUM(CASE WHEN NOT is_closed THEN amount ELSE 0 END)
                         NON ADDITIVE BY (snapshot_date)
  )
  COMMENT = 'GTM revenue metrics. Win amount is on close-date basis.';
```

**Use `CREATE OR ALTER`, not `DROP` + `CREATE`.** A drop silently revokes every
grant on the object, and the failure surfaces later as "the dashboard stopped
working for everyone except the person who deployed it".

Round trip:
```sql
SELECT * FROM SEMANTIC_VIEW(analytics.gtm.revenue
  METRICS won_amount DIMENSIONS segment, close_month) LIMIT 10;
```

Verification that the metadata landed:
```sql
SHOW SEMANTIC METRICS IN VIEW analytics.gtm.revenue;
SHOW SEMANTIC DIMENSIONS FOR METRIC won_amount;
SELECT GET_DDL('SEMANTIC_VIEW', 'analytics.gtm.revenue');
```

---

## Looker

```
1. enter dev mode for the session
2. update_project_file / create_project_file
3. read the file back THROUGH A DEV-MODE SESSION to confirm the write
4. lookml_model_explore in dev mode, check the errors[] block is empty
5. deploy_to_production  <- separate, deliberate step
6. lookml_model_explore in production mode, confirm the change is visible
```

**Step 3 and step 6 are different reads and both are required.** The classic
failure is a successful write in dev mode, no deploy, and a report that "the
metric was created" when nobody but the writing session can see it. The API
returns success at every stage of that failure.

Check `errors[]` from `lookml_model_explore` after the write. A LookML change
that breaks the model returns an errors block rather than failing the write.

LookML has no first-class additivity field. Put it in the description in a
fixed form:

```lookml
measure: open_pipeline {
  type: sum
  sql: ${amount} ;;
  description: "Open pipeline at the snapshot date.
                ADDITIVITY: semi-additive over time, take the last snapshot in the period.
                TIME BASIS: snapshot_date.
                VALID DIMENSIONS: segment, stage, owner, close_month."
}
```

---

## Power BI

### The format question, which trips everyone

| Format | What it is | Deploys? |
|---|---|---|
| **TMDL** | the git-friendly text model format | **no, not directly** |
| **TMSL** | the JSON command format | **yes, over XMLA** |
| **PBIP / PBIR** | project folder format including report definition | via Fabric APIs |

Generating TMDL and attempting to apply it to an XMLA endpoint fails. Convert
or author TMSL for the deploy step, keep TMDL for the diff and review.

### Capacity gate, check before promising

**XMLA read/write requires Fabric, Premium or PPU capacity. A Power BI Pro
licence in a shared workspace cannot use XMLA at all.** Check this first:

```dax
EVALUATE INFO.MODEL()
```
If `executeQueries` works but XMLA connection is refused, the workspace is on
shared capacity and model authoring is not available on this tenant. Say so
rather than generating an artefact that cannot be deployed.

### Permissions

Writes need semantic-model contributor or above, plus the tenant setting that
allows service principals to use the Power BI APIs. That tenant setting is off
by default in many organisations and only a Fabric administrator can change it.

### Template-and-modify

PBIR report generation fights schema validation because the schema is not
published as a downloadable document. **Start from an existing working report,
change the parts you need, redeploy.** Generating from nothing produces
artefacts that fail validation with messages that do not identify the field.

---

## Cube

```
startDataModelEdit            -> opens an edit session
                                 creates dev branch dev-<user>-<hash>
writeDataModelFile            -> writes a .yml or .js model file
commitToNewBranch             -> commit, optionally opens a PR
mergeToDefaultBranch          -> SEPARATE STEP, gated
```

Do not commit and merge in one operation. The PR step is the only human review
point in the flow and skipping it discards the platform's own safety feature.

Cube Cloud model authoring is **Premium/Enterprise only**. An OSS Cube customer
has `/v1/meta`, `/v1/load` and the SQL API, and cannot author through the API
at all; their model files live in their own repo and are deployed by their own
CI.

Cube `segments` are worth authoring deliberately: they are named, reusable
business filters, which is exactly the shape of a GTM qualifier ("enterprise
accounts", "active subscribers", "excluding internal test orders"). Most tools
have no equivalent and the logic ends up copy-pasted into every query.

---

## Tableau Pulse

```
POST   /api/-/pulse/definitions                 Create Metric Definition
PATCH  /api/-/pulse/definitions/{id}            Update Metric Definition
POST   /api/-/pulse/metrics                     Create Metric (a filtered instance)
POST   /api/-/pulse/metrics:batchGet            Batch Get Metrics
POST   /api/-/pulse/insights/.../generate       Generate Insight Bundle
```

A **definition** specifies: the data source, the measure, the time dimension,
and which dimensions are filterable. A **metric** is a filtered instance of a
definition (for example, the same definition scoped to one region).

Recent capability worth knowing: up to 5 related links per definition, a
`custom_calendar` extension option for fiscal calendars sourced from your own
data, a `PulseMetricDefine` permission capability on data sources, and a PNG
endpoint for metric cards with UI parity (API 3.29 / Tableau Cloud June 2026
and later).

**What Tableau does not offer:** worksheet or dashboard composition from a
spec. There is no `POST /worksheets`. Generating `.twb` XML is undocumented by
contract and version-fragile. Do not present it as a product capability.

Auth note: PATs expire after 15 days idle. For anything scheduled, use a
Connected App JWT.

---

## Cross-platform: the three artefacts every authoring run must produce

1. **The diff.** What changed, in the platform's own text format where one
   exists (LookML, TMDL, YAML, DDL).
2. **The review reference.** A PR URL, a commit SHA, or the dev-branch name.
   "Created successfully" without one of these is not reviewable.
3. **The round-trip result.** A read of the authored object through the path a
   user would take, not the write's status code.

An authoring run missing any of the three is incomplete, and saying so is part
of the deliverable.
