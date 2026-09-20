---
name: metric-definition-audit
description: Use when two systems, two dashboards or two teams report different numbers for the same metric, when onboarding onto an unfamiliar analytics stack, or when asked whether the reporting can be trusted. Inventories every definition of each key metric across BI tools, semantic layers, warehouse views and platform reports, shows precisely where they diverge, and identifies which definition is actually in use for decisions. Prevents the permanent trust loss that follows from two dashboards quietly disagreeing, and prevents an agent adding a third definition.
---

# Metric Definition Audit

The deliverable is a findings artefact with evidence, not an opinion. One row
per metric per location, the divergences named at the level of the difference,
and a declared list of what the credential could not see.

The first rule of this audit: **do not add a third definition.** An audit that
ends with the agent's own preferred formula has made the problem worse.

---

## 1. Where definitions hide, per platform

Metric logic is never in one place. The inventory is incomplete until each of
these has been checked or explicitly declared unreachable.

### Semantic and BI layers

| Platform | Where definitions live | The one people miss |
|---|---|---|
| **Looker** | `measure:` blocks in LookML, derived-table SQL | Liquid in `sql:` returns unrendered, so the formula you read is not the formula that runs |
| **Power BI** | `INFO.MEASURES()` DAX expressions | **report-level measures and implicit measures**, which live in the report artefact and `INFO.MEASURES()` will not list |
| **Tableau** | calculated-field `formula` via the Metadata API | **sheet-level LODs and table calcs**, invisible outside their viz context |
| **Snowflake** | semantic-view metric expressions, `GET_DDL`, and `VIEW_DEFINITION` SQL | metric logic buried in a view three layers down |
| **dbt** | `metrics:` YAML and model SQL | logic in staging models, which is where it should not be but often is |
| **Cube** | measures, and **segments** | segments carry business filters that change the denominator |

### The platform-native layer, which audits routinely skip

| Platform | Definition that lives there |
|---|---|
| **Klaviyo** | `conversion_metric_id` on a flow or campaign: which event counts as a conversion, set per object |
| **Braze** | two conversion bases exist; which one a campaign reports on is a campaign setting |
| **Salesforce** | report custom summary formulas, bucket fields, and cross-filters inside the report definition |
| **GA4** | key events, custom definitions, channel group definitions, and conversion counting method |
| **Ad platforms** | attribution window and counting method per account and sometimes per campaign |
| **HubSpot** | calculated properties and report-level filters |

### And the one that is always there

**Every metric implemented in a spreadsheet nobody mentioned.** The board pack
number is frequently computed by hand from an export, with a filter applied in
the sheet that exists nowhere else. Ask directly: "which number in this deck is
computed in a spreadsheet?" It is almost never zero.

---

## 2. Divergence is reported at the level of the difference, not the name

"Two different win rate definitions" is not a finding. This is a finding:

```
metric: win_rate
location A: BI dashboard "Revenue Overview", tile 3
location B: warehouse view analytics.marts.metric_win_rate

difference:  denominator
  A: Won / (Won + Lost)
  B: Won / (Won + Lost + No Decision)
numeric impact (period 2026-Q2, same source rows):
  A: 31.2%    B: 24.8%    delta: -6.4pp, B is lower
cause: 412 opportunities in Closed - No Decision are excluded from A's
       denominator entirely
which is right: both are defensible; they answer different questions
                (see gtm-metric-dictionary, win rate denominators)
```

**Compute the numeric impact where the data allows.** A divergence with a
number attached gets fixed; a divergence described in prose gets filed.

The differences worth checking, in the order they most often matter:

1. **Denominator population** (the most common by a distance)
2. **Date basis**: created, entered-stage, close, booked, recognised
3. **Filters**: excluded sources, test records, internal accounts, deleted rows
4. **Grain**: person versus account versus opportunity
5. **Aggregation**: count versus dollar-weighted; mean versus median
6. **Time window and whether the last period is included**
7. **Currency treatment and FX date convention**
8. **Attribution model**, for anything with "attributed" in it

---

## 3. Find which definition is actually used for decisions

Documentation says what was intended. Usage says what happens. **Empirical
usage is the tiebreak when documentation disagrees.**

| Source | Signal |
|---|---|
| Snowflake `QUERY_HISTORY` / `ACCESS_HISTORY` | which views and columns are actually read, by whom, how often |
| BigQuery `INFORMATION_SCHEMA.JOBS_BY_PROJECT` | referenced tables per job |
| dbt `exposures` | which models feed which dashboards, with owner and URL |
| Looker System Activity | query counts per Look, dashboard, explore and field |
| Power BI usage metrics | report and dashboard view counts |
| Tableau view stats and `downstreamDashboards` | which content is opened |
| Dashboard view counts generally | a definition rendered on a dashboard nobody opens is not in use |

A definition that is beautifully documented and queried twice a year loses to
one that is undocumented and queried four hundred times a month. Report both,
and say which is which.

---

## 4. The canonical recommendation cites evidence

The recommendation names: which definition, why, what evidence supports it, and
what it would cost to consolidate.

**Where the industry genuinely disagrees, present the alternatives rather than
asserting one.** NRR conventions, ACV, win-rate denominators, CM2 versus CM3,
LTV horizon: these are not cases where the audit picks a winner. They are cases
where the audit says "pick one, here are the three, here is what each implies,
here is which one your current benchmark assumes."

**A canonical definition chosen by seniority rather than evidence is not a
finding, it is a decision recorded as one.** If the recommendation is "use
finance's version because finance owns revenue", say that is the reason. It may
well be the right reason. It is not an evidentiary one and should not be
dressed as one.

---

## 5. Permission-shaped blindness is declared, not hidden

**The audit reports what it could not see, as a finding.**

| Platform | Blind-spot signature |
|---|---|
| Looker without `see_lookml` | field names return, `sql` is absent on every field |
| Power BI viewer identity | `INFO.*` returns nothing, without an error |
| Tableau Metadata API | permission-filtered with no error; content is simply absent |
| Snowflake masking policies | masked values that look like data |
| Cube `/v1/meta` | returns only what the JWT security context allows |
| Salesforce report API | runs as the running user; sees less than an admin |
| HubSpot private-app token | portal-scoped, ignores user roles; sees **more** than a UI user |

Each blind spot goes in the output with the probe that found it and the change
that would resolve it. An audit that silently omits what it could not see is
worse than no audit, because it will be read as complete.

See `permission-effect-audit` for the full probe set.

---

## 6. Definition versioning and drift

Where a definition changed, **date it and mark the trendlines that cross it**.

Sources of a dated change: the metric contract register if one exists, git
history on the LookML or dbt repo, Looker `source_file` plus repo blame,
Power BI TMDL diffs, a changelog, or a person's memory (recorded as such, with
lower evidence status).

Output shape:

```
definition_changes[]:
  metric_key, from_version, to_version, effective_from,
  what_changed, evidence, artefacts_affected[]
```

`artefacts_affected` comes from the blast-radius trace in
`data-lineage-tracer`. Every one of them needs the boundary marked.

---

## 7. Output: the per-metric crosswalk

One row per **rendered** metric, per location.

| Column | Content |
|---|---|
| `metric_key` | stable identifier |
| `display_name` | what it says on the chart |
| `location` | dashboard page, tile, view name, sheet, file path |
| `system` | which platform |
| `plain_english_definition` | the sentence a stakeholder would say |
| `formula` | the expression as found |
| `numerator_definition` / `denominator_definition` | separately, because the denominator is where the errors are |
| `grain` | per what |
| `date_grain` and `time_basis` | which date column, at which granularity |
| `source_datasets` | upstream tables |
| `coverage_window` | how far back the data goes |
| `refresh_cadence` | and when it last succeeded |
| `key_assumptions` | conventions chosen |
| `known_limitations` | what it does not claim |
| `usage_signal` | views or query count |
| `owner` | a person |
| `evidence_status` | read from the artefact, inferred from SQL, or reported by a person |

`assets/crosswalk-template.csv` ships the template with synthetic examples.

---

## 8. Answering

**Answer first.** When asked "can the reporting be trusted", lead with the
verdict and the count: "Three of the eight metrics in the exec pack have more
than one implementation; two of the three disagree materially. Here they are."
Then the evidence.

Where a divergence's numeric impact is computable, **compute it**. Where it is
not, say which data would make it computable rather than describing the
divergence qualitatively and stopping.

Withhold only: a definition that exists in a location the credential cannot
reach. That is `unavailable`, it is listed as a blind spot, and the audit's
coverage statement says so explicitly rather than implying completeness.

## References

- `references/where-definitions-hide.md` — the per-platform hunt, with the
  exact calls
- `references/divergence-report.md` — how to compute and present numeric
  impact, and the canonical-recommendation format
- `assets/crosswalk-template.csv` — the crosswalk with synthetic examples

## Related skills

- `semantic-layer-introspector` is a **hard** dependency: it supplies the
  declared definitions.
- `gtm-metric-dictionary` supplies the canonical definitions and names the
  genuinely contested ones.
- `cross-system-reconciliation` when the numbers, not just the definitions,
  need to be reconciled.
- `report-estate-audit` to find the locations in the first place.
