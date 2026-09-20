# The append-only metric contract register

A table whose rows are metric **definitions**, not metric values. It exists to
make one thing impossible: a metric definition changing and history silently
restating.

---

## Why append-only rather than a documentation page

A wiki page describing a metric has three problems. It is not versioned against
the data, nothing forces a published number to reference it, and when the
definition changes the old page is edited, so the record of what the number
used to mean is destroyed.

The register fixes all three by being a table:

- **Versioned**: a redefinition inserts a new row.
- **Referenced**: every published number cites `metric_key` and `version`.
- **Immutable**: nothing is updated except `is_current` and `effective_to`.

---

## The columns, and why each earns its place

| Column | Why |
|---|---|
| `metric_key` | stable machine identifier, unchanged across redefinitions |
| `version` | increments on every change to meaning |
| `human_name` | what it is called on the chart |
| `stakeholder_sentence` | **the sentence someone would say out loud**, which is what the calculation gets audited against |
| `source_system` | where the authoritative implementation lives |
| `formula` | the expression |
| `numerator_definition` / `denominator_definition` | separate, because the denominator is where the errors are |
| `grain` | per what |
| `time_basis` | which date column |
| `additivity` | additive, semi-additive over which dimension, or non-additive |
| `valid_dimensions` | what it may legally be sliced by |
| `convention_notes` | for contested metrics: which convention and why |
| `effective_from` / `effective_to` | the boundary a trendline must be marked at |
| `is_current` | the convenience flag |
| `approver` | a person, not a team |

---

## Redefinition procedure

1. **Do not edit the existing row.**
2. Insert a new row with `version = previous + 1` and a new `effective_from`.
3. Update the previous row: set `effective_to` and `is_current = false`.
4. Record the approver.
5. **Find every artefact that renders this metric** (via
   `data-lineage-tracer` blast radius, or dbt `exposures`) and mark the
   boundary date on each.

```sql
begin;

update metric_contract_versions
   set effective_to = date '2026-09-30', is_current = false
 where metric_key = 'mql' and is_current;

insert into metric_contract_versions
 (metric_key, version, human_name, stakeholder_sentence, source_system,
  formula, numerator_definition, denominator_definition, grain, time_basis,
  additivity, valid_dimensions, convention_notes,
  effective_from, effective_to, is_current, approver)
values
 ('mql', 3, 'Marketing Qualified Lead',
  'A person whose behaviour and firmographic score crossed the qualification threshold.',
  'warehouse',
  'score_behaviour + score_fit >= 85',
  'count of persons crossing the threshold', null,
  'person', 'mql_date',
  'additive', array['source','channel','segment','region'],
  'Threshold raised from 70 to 85 on 2026-10-01. Volumes are not comparable across the boundary.',
  date '2026-10-01', null, true, 'name of approver');

commit;
```

---

## The rule that makes it worth building

> **A trendline crossing an `effective_from` is marked on the chart and is
> never described as a trend across the boundary.**

Concretely: MQL volume falls 40% on 1 October because the threshold moved from
70 to 85. That is not a demand decline. Without the register, three people
spend a week investigating a demand decline that did not happen. With it, the
chart shows a vertical rule at the boundary and the two segments are described
separately.

The same applies to:

- attribution model changes (every attributed number restates)
- sessionization gap changes (every session-denominated metric restates)
- ESP attribution window changes, which some platforms apply **retroactively to
  all history**
- fiscal calendar changes
- segment or territory redefinitions, which move the denominator population

---

## Citing the version on a published number

Every number carries `metric_key` and `version` in its provenance block. On a
chart, the minimum is the metric name plus version in the subtitle:

```
Win rate (close-date basis) · win_rate v3 · as of 2026-09-19
```

When a stakeholder asks "is this the same number as last quarter's deck", that
line answers it without anyone opening a query.

---

## Seeding the register without boiling the ocean

Do not attempt to register every metric in the estate on day one. Seed it with:

1. The metrics that appear in the board pack or the exec dashboard. Usually
   fewer than fifteen.
2. Any metric where `metric-definition-audit` found two implementations that
   disagree. Those are the ones where a canonical version has actual value.
3. Any metric whose definition is known to have changed inside the reporting
   window, because those are the trendlines currently lying to someone.

Everything else can be added when it next gets argued about, which is a
reliable prioritisation signal.
