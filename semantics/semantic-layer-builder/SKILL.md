---
name: semantic-layer-builder
description: Use when creating or extending a semantic layer so metric definitions become governed and reusable — dbt semantic models and metrics, LookML measures and explores, Snowflake semantic views, Cube data model files, Power BI measures and relationships, Tableau Pulse metric definitions. Writes the definition with its additivity rule, time grain and valid dimensions machine-readable, on a dev branch with a diff, never straight to production. Prevents metric definitions trapped in one BI tool and prevents an agent shipping a model change nobody reviewed.
---

# Semantic Layer Builder

Authoring a metric is a write. Writes are gated, reviewed and reversible, and
**`write-gate` is a mandatory dependency of every path in this skill.**

Inputs: a resolved metric contract from `gtm-metric-dictionary`, a model from
`data-model-designer`, a target platform, and explicit write authorization.

---

## 1. Per-platform authoring surfaces and their real limits

### dbt

Write `semantic_models:`, `metrics:`, `saved_queries:` YAML plus the `.sql`
model, then `dbt parse`, then a pull request.

**`dbt build` from an agent is a production action and is gated.** `dbt parse`
validates without touching the warehouse; that is the safe verification step.

```yaml
semantic_models:
  - name: opportunity
    model: ref('mart_opportunity')
    defaults:
      agg_time_dimension: close_date
    entities:
      - {name: opportunity, type: primary, expr: opportunity_id}
      - {name: account,     type: foreign, expr: account_id}
    dimensions:
      - name: close_date
        type: time
        type_params: {time_granularity: day}
      - {name: stage, type: categorical}
      - {name: segment, type: categorical}
    measures:
      - name: won_amount
        agg: sum
        expr: "case when is_won then amount else 0 end"
        agg_time_dimension: close_date
      - name: closed_count
        agg: count
        expr: opportunity_id
        agg_time_dimension: close_date
      - name: open_pipeline
        agg: sum
        expr: "case when not is_closed then amount else 0 end"
        agg_time_dimension: snapshot_date
        non_additive_dimension:          # open pipeline is a balance, not a flow
          name: snapshot_date
          window_choice: max

metrics:
  - name: win_rate_close_date
    label: "Win rate (close-date basis)"
    description: "Of opportunities that closed in the period, the share we won."
    type: ratio
    type_params:
      numerator: won_count
      denominator: closed_count
```

The example's `ref('mart_opportunity')` model must define every referenced
column. For this example, the model contract is explicit:

```sql
-- models/mart_opportunity.sql; stg_opportunity supplies the source columns.
select
  opportunity_id,
  account_id,
  close_date,
  snapshot_date,
  stage,
  segment,
  amount,
  (stage = 'Closed Won') as is_won,
  (stage in ('Closed Won', 'Closed Lost')) as is_closed
from {{ ref('stg_opportunity') }}
```

`stg_opportunity` must expose those seven source columns; `is_won` and
`is_closed` are defined here. This supplies the fields used by the measures,
dimensions and `snapshot_date` additivity declaration above.

Note what the YAML carries that SQL alone would not: the aggregation time
dimension, the additivity rule, and a description written as the sentence a
stakeholder would say.

### Snowflake

`CREATE SEMANTIC VIEW`, and since 2026-05-04 (preview) **`CREATE OR ALTER
SEMANTIC VIEW`**, which is declarative, safe to re-run, and **preserves
grants**. Prefer `CREATE OR ALTER` over drop-and-recreate for exactly that
reason: a drop silently revokes every grant on the object.

`NON ADDITIVE BY` is the semi-additivity declaration and belongs on every
balance-like measure (ARR, MRR, open pipeline, headcount, subscriber count).

### Looker

`create_project_file` / `update_project_file` in **dev mode**, then
`deploy_to_production`.

**Get dev mode wrong and the change is a silent no-op, invisible to everyone
else.** The file writes succeed, the API returns success, and nobody sees the
change because it never left the developer's branch. Always: enter dev mode,
write, verify by reading back **through a dev-mode session**, then deploy
deliberately as a separate step.

### Power BI

TMDL / PBIP through the modeling MCP server, or TMSL over XMLA.

Two hard facts:

- **TMDL is the git-friendly format. TMSL is what actually deploys to an XMLA
  endpoint. TMDL does not deploy directly.** Generating TMDL and expecting it
  to land on the model is a common and confusing failure.
- **XMLA requires Fabric / Premium / PPU capacity. A Power BI Pro licence in a
  shared workspace cannot use XMLA at all.** Check the capacity before
  promising the capability, not after generating the artefact.

### Cube

`startDataModelEdit` → dev branch named `dev-<user>-<hash>` → `writeDataModelFile`
→ `commitToNewBranch` with an optional PR → `mergeToDefaultBranch`.

This is the cleanest built-in review flow of any platform here. Use the PR
step; do not merge to default in the same operation that wrote the file.
Note that Cube Cloud model authoring is Premium/Enterprise only.

### Tableau

**Pulse metric definitions are full CRUD and are the right target for
agent-created metrics.** `Create Metric Definition`, `Update Metric
Definition`, `Create Metric`, `Batch Get Metrics`, plus digest subscription
management. A definition specifies data source, measure, time dimension and
which dimensions are filterable, and humans can subscribe to it.

**Workbooks are publish-a-file, not compose-an-object.** There is no
`POST /worksheets`. Generating `.twb` XML is an advanced, version-fragile,
high-maintenance technique, not a product capability, and this skill does not
present it as one.

---

## 2. What cannot be authored, stated plainly

Say this before starting work, not after.

| Target | Status |
|---|---|
| GA4 Explorations and dashboards | **No public API at all.** The Admin API creates dimensions, audiences and channel groups, not reports. |
| Looker Studio reports | The API does `assets:search` and permissions. It cannot create or modify a report. |
| Snowsight dashboards | Not meaningfully exposed via public API. |
| HubSpot reports or dashboards | Neither exists. Report creation is still an open idea in HubSpot's own forum. |
| Marketo reports | No reporting API of any kind. |
| Pardot / MCAE report objects | None. B2B Marketing Analytics requires a separate CRM Analytics licence. |
| Amplitude charts or dashboards | Amplitude's own docs: the Dashboard REST API "cannot create charts or dashboards". |
| Tableau worksheets or dashboards from a spec | No composition API. Pulse metric definitions instead. |
| Salesforce dashboard authoring over the Reports API | **Clone only.** Authoring from nothing needs the Metadata API. |

**"I'll build you a GA4 dashboard" must be impossible for this skill to say.**

---

## 3. Encode the rules, not just the arithmetic

Every authored metric carries five things beyond its expression:

1. **The additivity rule.** `non_additive_dimension` in dbt, `NON ADDITIVE BY`
   in Snowflake. Where the platform has no field for it (Looker, Power BI,
   Cube, Tableau), put it in the description in a fixed, greppable form:
   `ADDITIVITY: semi-additive over time; take the last value per period.`
2. **The aggregation time dimension.** Which date column. Booked, created,
   entered-stage, close, recognised. This is the most common GTM reporting
   dispute and it should not be discoverable only by reading SQL.
3. **The valid-dimension set.** What the metric may legally be sliced by.
4. **The time granularity.** The finest grain at which the metric is
   meaningful. A daily NRR is not a thing.
5. **A description written as the sentence a stakeholder would say out loud.**
   Not "sum of amount where is_won". Instead: "Of the opportunities that closed
   in the period, the share we won, counted by opportunity."

That last one is not documentation politeness. It is the artefact that
`calculation-integrity-audit` checks the denominator against.

---

## 4. The append-only metric contract register

A warehouse table whose rows are metric **definitions**, not metric values.

```sql
create table metric_contract_versions (
  metric_key              varchar(200) not null,
  version                 int         not null,
  human_name              varchar(2000)        not null,
  stakeholder_sentence    varchar(2000)        not null,
  source_system           varchar(2000)        not null,
  formula                 varchar(2000)        not null,
  numerator_definition    varchar(2000),
  denominator_definition  varchar(2000),
  grain                   varchar(2000)        not null,
  time_basis              varchar(2000)        not null,
  additivity              varchar(2000)        not null,
  valid_dimensions        varchar(2000), -- delimited list; ANSI SQL has no portable array type
  convention_notes        varchar(4000),
  effective_from          date        not null,
  effective_to            date,
  is_current              boolean     not null,
  approver                varchar(2000)        not null,
  created_at              timestamp   not null default current_timestamp,
  primary key (metric_key, version)
);
```

This registry DDL is an ANSI SQL variant: store `valid_dimensions` as a
delimited string (for example, `segment|region|owner`) and split it in the
application. It avoids PostgreSQL-only arrays and partial unique indexes; the
versioning transaction below keeps one current version per metric. If native
array types or filtered indexes are desired, label that separate DDL with the
specific database dialect.

**A redefinition inserts a new version. Nothing is ever overwritten.**

Two consequences that matter more than the table:

- **Every published number cites its metric version.** `win_rate v3` on the
  chart, not `win_rate`.
- **A trendline crossing an `effective_from` is marked on the chart**, and is
  never described as a trend across the boundary. Silent metric redefinition
  restating history is one of the quietest ways to lose a stakeholder's trust
  permanently.

See `assets/metric_contract_versions.sql` for the DDL plus two synthetic seed
rows showing a redefinition.

---

## 5. Dev-branch discipline is the default posture

**Verify before merging, not after.** Never author straight to production on
any platform.

| Platform | Dev path | Production step |
|---|---|---|
| dbt | branch + PR, `dbt parse` to validate | `dbt build` / merge, **gated** |
| Looker | dev mode file write | `deploy_to_production`, separate call |
| Cube | `startDataModelEdit` → dev branch → commit → PR | `mergeToDefaultBranch`, separate call |
| Snowflake | dev schema or a `_dev` suffixed view | `CREATE OR ALTER` on the production name |
| Power BI | TMDL in git, dev workspace | TMSL deploy over XMLA, capacity permitting |
| Tableau Pulse | create the definition, do not subscribe anyone | add subscribers as a separate action |

Always produce: the file diff, the PR or commit reference, and the round-trip
test result. An agent that reports "created successfully" without a diff has
not given anyone anything to review.

---

## 6. Round-trip testing

Creation succeeding is not the same as creation working.

- **PostHog insights created via the API bypass UI validation.** It is possible
  to create an insight the UI cannot render. Always fetch it back and, where
  possible, render or query it.
- **Power BI PBIR generation fights schema validation**, because the schema is
  not published as a downloadable document. **Template-and-modify beats
  generate-from-nothing**: start from an existing working artefact and change
  the parts you need.
- **Snowflake `CREATE OR ALTER SEMANTIC VIEW`** should be followed by a
  `SEMANTIC_VIEW()` query against the new metric. A definition that parses and
  cannot be queried is not done.
- **dbt** metrics should be validated with `dbt parse` and then queried through
  MetricFlow. A metric that parses and returns a cartesian result has an entity
  problem the parse will not catch.

The general rule: **the acceptance test is a successful read of the thing you
wrote, through the path a user would take.** Not the write's status code.

---

## 7. Answering

**Answer first.** If the request is "build me a metric in X" and X cannot
author, say what X can do and offer the nearest real target in the same
breath. "GA4 cannot be authored at all; the equivalent here is a metric in your
warehouse plus a Looker Studio link, or a Tableau Pulse definition if you have
Tableau." Do not stop at the refusal.

Withhold only the capability that does not exist. Never generate a `.twb` XML
workbook and describe it as a supported capability, and never claim a dev-mode
write reached production without a deploy step you can point to.

## References

- `references/authoring-per-platform.md` — the exact calls, file formats,
  permission and capacity requirements per platform
- `references/metric-register.md` — the append-only contract register, how to
  version a redefinition, and how charts cite versions
- `assets/metric_contract_versions.sql` — DDL plus seed rows

## Related skills

- `write-gate` is **mandatory** before any write in this skill.
- `gtm-metric-dictionary` supplies the contract being authored.
- `data-model-designer` supplies the model underneath it.
- `semantic-layer-introspector` tells you whether the metric already exists,
  which is the first question.
