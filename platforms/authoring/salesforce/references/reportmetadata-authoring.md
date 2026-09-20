# Salesforce report authoring and reading the `factMap`

Two jobs live here: building a `reportMetadata` body that Salesforce accepts, and reading
the run response without mistaking a truncated detail set for the whole thing.

**Before writing any payload, describe a report of the same report type:**

```bash
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports/$EXISTING_REPORT_ID/describe"
```

The response gives you three things you cannot reliably guess: the exact column API names
for that report type (`reportTypeMetadata.categories[].columns`), which columns are
filterable and with which operators, and a working `reportMetadata` block you can modify
rather than compose from scratch. Column names are report-type specific and org specific;
a guessed name produces a report that saves and returns nothing.

## Create a real, saved report

Minimum viable body is `name` plus `reportType`. Everything else narrows it.

```bash
curl -s -X POST "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports" \
  -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "reportMetadata": {
      "name": "Open pipeline by stage, this quarter",
      "reportType": {"type": "Opportunity"},
      "reportFormat": "SUMMARY",
      "folderId": "00l000000000000AAA",
      "detailColumns": ["OPPORTUNITY_NAME", "ACCOUNT_NAME", "AMOUNT", "CLOSE_DATE"],
      "groupingsDown": [{"name": "STAGE_NAME", "sortOrder": "Asc", "dateGranularity": "None"}],
      "groupingsAcross": [],
      "aggregates": ["s!AMOUNT", "RowCount"],
      "standardDateFilter": {"column": "CLOSE_DATE", "durationValue": "THIS_QUARTER"},
      "reportFilters": [
        {"column": "STAGE_NAME", "operator": "notEqual", "value": "Closed Lost"}
      ],
      "reportBooleanFilter": null,
      "showGrandTotal": true,
      "showSubtotals": true
    }
  }'
```

Notes that save a round trip:

- **`reportFormat`** is `TABULAR`, `SUMMARY` or `MATRIX`. `groupingsDown` requires at least
  `SUMMARY`; `groupingsAcross` requires `MATRIX`. A grouping on a tabular report is
  rejected or ignored depending on version.
- **Aggregate naming is prefix-coded:** `s!` sum, `a!` average, `mx!` maximum, `mn!`
  minimum, plus the bare `RowCount`. So `s!AMOUNT` is "sum of Amount".
- **`folderId`** decides who can see it. Omitting it puts the report somewhere the
  requester may not expect; ask which folder, and confirm the integration user can write
  there.
- **`standardDateFilter.durationValue`** takes the relative tokens (`THIS_QUARTER`,
  `THIS_MONTH`, `LAST_MONTH`, `LAST_N_DAYS:7`) that evaluate in the **running user's
  timezone**, or supply explicit `startDate` and `endDate` in `YYYY-MM-DD` for a
  reproducible window. Prefer explicit dates for anything you will quote later.
- **`reportFilters` operators** include `equals`, `notEqual`, `lessThan`, `greaterThan`,
  `lessOrEqual`, `greaterOrEqual`, `contains`, `notContain`, `startsWith`, `includes`,
  `excludes`. Confirm the set for the column from `describe` rather than assuming.
- Creating a report is a **write**. Route it through `write-gate`, name the folder, and
  confirm before creating.

## Run a report with overrides, without saving

`POST /analytics/reports/{id}` with a `reportMetadata` body applies the overrides **for
that run only**. This is the right way to answer "same report but last quarter" without
mutating an object other people depend on.

```bash
curl -s -X POST "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports/$REPORT_ID" \
  -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reportMetadata": {"standardDateFilter": {"column": "CLOSE_DATE", "durationValue": "LAST_QUARTER"}}}'
```

`Content-Type: application/json` is mandatory here. Without it the run returns silently
unexpected results rather than an error.

## Clone

- Report: `POST /analytics/reports?cloneId={reportId}` with a body carrying at least a new
  `name`.
- Dashboard: `POST /analytics/dashboards?cloneId={dashboardId}`. **Clone only.** There is
  no dashboard authoring from nothing over this API. Say that plainly rather than producing
  an approximation.

## Asynchronous runs

Sync runs die at the 2-minute platform API timeout. For anything heavy:

```bash
INSTANCE=$(curl -s -X POST "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports/$REPORT_ID/instances" \
  -H "Authorization: Bearer $SF_ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{}' | jq -r .id)
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/v60.0/analytics/reports/$REPORT_ID/instances/$INSTANCE"
```

Poll `status` until it is `Success` (other values include `New`, `Running`, `Error`).
**Async results live in a 24-hour rolling window**, so retrieve and persist them; do not
plan to re-read an instance tomorrow.

## Reading the run response

The important top-level fields:

| Field | Meaning |
|---|---|
| **`allData`** | `false` means the 2,000-row cap truncated the detail rows. **Check first, every time.** |
| `hasDetailRows` | whether detail rows were requested at all; a summary-only run has aggregates and no rows |
| `factMap` | the actual numbers, keyed by grouping |
| `groupingsDown` / `groupingsAcross` | the grouping keys and their labels |
| `reportExtendedMetadata` | `detailColumnInfo`, `aggregateColumnInfo`, `groupingColumnInfo` — the labels and data types for everything in `factMap` |
| `reportMetadata` | the metadata the run actually used, including the filters that were applied |

**`factMap` keys are `<downGroupingKey>!<acrossGroupingKey>`, where `T` means total.**

- `factMap["T!T"]` is the grand total, and on a tabular report it is the only key.
- `factMap["0!T"]` is the first down-grouping's total, `factMap["1!T"]` the second.
- `factMap["0!0"]` is the first down-grouping crossed with the first across-grouping on a
  matrix report.

Each entry has `aggregates` (a list aligned with `reportExtendedMetadata.aggregateColumnInfo`,
each with `label` for display and `value` for arithmetic) and `rows` (each with
`dataCells`, again `label` and `value`).

**Use `value` for arithmetic and `label` for display.** `label` is locale-formatted and
currency-symboled; parsing it back to a number is how currency and thousands separators
corrupt a calculation.

## The truncation rule, stated once

When `allData` is `false`:

1. **The aggregates are still computed over the full result set.** Report them.
2. **The detail rows are truncated at 2,000 with no pagination.** Any breakdown you compute
   yourself from `rows` is incomplete and biased toward whatever the report's sort order put
   first.
3. Say both of those in one sentence, then offer the route to the complete row-level
   answer: Bulk API 2.0 against the underlying objects, with the caveat that you will be
   re-implementing the report's logic and any custom summary formula cannot be reproduced
   at all.
