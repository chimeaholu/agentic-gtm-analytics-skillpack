# Reading the LookML model safely

The Looker model is the best semantic introspection surface in the pack — an explicit
join graph, typed fields, and metric expressions. It is also the surface where
permissions masquerade as absence. Read this before concluding anything about what a
model does or does not contain.

## What the model call returns

`GET /api/4.0/lookml_models/{model}/explores/{explore}` returns the explore with:

- `fields.dimensions[]` and `fields.measures[]` — each with `name`, `label`, `type`,
  `value_format`, `description`, and **`sql` where the credential is permitted to see it**
- `joins[]` — the explicit join graph: `name`, `relationship`
  (`many_to_one`, `one_to_many`, `many_to_many`, `one_to_one`), `sql_on`, `type`
- `always_filter` and `conditionally_filter` — filters applied whether or not you asked
- `access_filter_fields` — the row-level security hooks, with values you cannot read

## The three things a role changes

| Role capability | Effect on the response |
|---|---|
| no `see_lookml` / `develop` | `sql` is **omitted from every field**. Names and types remain. |
| no access to a field or view | The field **is not in the response at all**. No error. |
| an `access_filter` on the user | Every row count and total is filtered. Nothing says so. |

**The diagnostic:** if `sql` is absent on *all* fields, that is a role boundary and you
should say so. If `sql` is present on most fields and one metric the user named is
missing entirely, that is field-level access. Ask the human what they can see in the
Explore UI and compare — the difference is the permission gap, not a modelling gap.

## The join graph, and what it does not tell you

`joins[].relationship` is a real declaration and is unusually trustworthy compared with
inferring cardinality from view SQL elsewhere in the stack. Use it:

- `many_to_one` joins are safe to aggregate across.
- `one_to_many` and `many_to_many` **fan out the rows on the left**, so a `SUM` of a
  left-side measure over a fanned-out join double-counts. Looker's symmetric aggregates
  handle this **when you query through the measure**; they do not help an agent that read
  the `sql` and rebuilt the arithmetic itself.

This is the concrete reason for the module's rule: **query through the measure by name.**
The fan-out correctness is in Looker's SQL generation, not in the measure expression you
can read.

## Filters you did not write

`always_filter` and `conditionally_filter` are applied to every query against the explore.
They are visible in the model response, so read them and include them in the provenance
block. `access_filter_fields` names the field used for row-level security but **not the
value bound to your identity** — you cannot determine your own visibility from the API.
Run under a deliberately chosen service identity and state which one in the answer.

## Table calculations and merged results

Neither is a model field.

- **Table calculations** are computed in Looker after the SQL returns. They appear in a
  saved Look's query definition, not in the explore's field list. Rebuilding a Look from
  the field list silently drops them.
- **Merged results** combine two queries in the Looker front end. There is no API
  equivalent. If the tile the user is asking about is a merged result, say the API cannot
  reproduce it and offer to run the component queries separately.

## Checklist before quoting a model-derived number

1. Did you set `query_timezone` explicitly?
2. Did you query through the measure, or did you rebuild its SQL?
3. Is `sql` present on fields — that is, is this the full model or a role-narrowed one?
4. Are there `always_filter` / `conditionally_filter` entries you did not account for?
5. Does the explore contain `one_to_many` or `many_to_many` joins on the path you used?
6. Which identity ran the query, and does it carry an `access_filter`?
