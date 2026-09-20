# Authoring Looks and dashboards, and the delivery path that actually matters

All of this is a write. Route it through `write-gate` first: Looks and dashboards are
Tier D (a visible artefact), project-file edits plus `deploy_to_production` are Tier C
(a shared definition), and a scheduled plan that emails humans is Tier E (it sends).

## Create order

Looker's dashboard model is three objects, and they must be created in order.

1. **`create_dashboard`** — title, folder (`folder_id`), description. Creating a dashboard
   with no elements is valid and produces an empty dashboard, which is a normal
   intermediate state, not a failure.
2. **`create_dashboard_element`** — one per tile. The element carries either a
   `look_id` (pin an existing Look) or an inline `query_id`, plus `type` (`looker_line`,
   `looker_column`, `single_value`, `table`, `text`, …) and layout.
3. **`create_dashboard_filter`** — dashboard-level filters, each bound to a field, and
   each needing `listens_to_filters` wiring on the elements that should respond.

A tile that exists but listens to no filter is the most common half-built artefact.
Check it.

## Looks

`create_look` takes a `query_id` — so the order is `create_query` first, then
`create_look` referencing it. A Look created from a query with no `query_timezone` inherits
the ambiguity permanently; set it on the query before you save the Look.

**Round-trip test every authored artefact.** Re-read it with `look(id)` or
`dashboard(id)`, and run it once. An artefact that returns rows over the API but renders
as an error in the product is a failed deliverable, not a delivered one.

## `create_scheduled_plan` — the real delivery path

This is the capability most worth reaching for and the one most often overlooked, because
people think of Looker authoring as "make a dashboard".

A scheduled plan delivers a Look, a dashboard or a query on a cron schedule to:

- **email** — the default, and the one that reaches non-Looker humans
- **S3 / GCS** — the right target when a downstream job consumes the output
- **SFTP**
- **webhook** — the right target when another system should react

Key fields: `name`, `look_id` / `dashboard_id` / `query_id`, `crontab`, `timezone`,
`scheduled_plan_destination[]` (each with `format`, `type`, `address`),
`run_as_recipient`, and `include_links`.

Two decisions that change the output:

- **`run_as_recipient`** — when true, the plan runs under each recipient's identity, so
  row-level security applies per person and everyone gets different numbers. When false,
  everyone gets the creating user's view. Neither is wrong; state which you chose.
- **`format`** — `wysiwyg_pdf` and `assembled_pdf` reproduce the visual; `csv` and
  `json` deliver data. A stakeholder asking for "the report" usually means the first.

## Dev mode and project files

Project-file writes are a different animal from content writes: they change **everyone's**
definitions.

1. Enter dev mode (`session` with `workspace_id: "dev"`).
2. Write the file.
3. Commit and **`deploy_to_production`**.

**Without step 1 and step 3 the write is a silent no-op** — the API returns success and
production is unchanged. This is the single most confusing Looker failure for an agent,
because nothing in the response distinguishes "saved to your dev branch" from "live".

## Version-dependent call to check

**`create_dashboard_from_lookml` is deprecated in favour of `import_dashboard_from_lookml`.**
Which one the instance exposes depends on its version. Probe rather than assume, and fall
back to `create_dashboard` plus elements, which is stable across versions.
