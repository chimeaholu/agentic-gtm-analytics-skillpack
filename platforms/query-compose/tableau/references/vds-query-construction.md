# VizQL Data Service — query shape, and the filter defect that returns nothing

VDS is the correct agent entry point for Tableau data. It is a semantic query API, not
SQL, and it respects the published data source's calculated fields — which is the entire
reason to use it rather than reaching around it to the warehouse.

## The body shape

```json
{
  "datasource": {"datasourceLuid": "<luid>"},
  "query": {
    "fields": [
      {"fieldCaption": "Close Month", "function": "TRUNC_MONTH"},
      {"fieldCaption": "Segment"},
      {"fieldCaption": "Net Revenue", "function": "SUM"},
      {"fieldCaption": "Accounts", "function": "COUNTD"}
    ],
    "filters": [
      {
        "field": {"fieldCaption": "Close Date"},
        "filterType": "QUANTITATIVE_DATE",
        "quantitativeFilterType": "RANGE",
        "minDate": "2026-01-01",
        "maxDate": "2026-09-01"
      }
    ]
  },
  "options": {"returnFormat": "OBJECTS", "rowLimit": 10000, "debug": false}
}
```

**Measure functions:** `SUM`, `AVG`, `MEDIAN`, `COUNT`, `COUNTD`, `MIN`, `MAX`, `STDEV`,
`VAR`, `COLLECT`.
**Temporal functions:** `YEAR`, `QUARTER`, `MONTH`, `WEEK`, `DAY`, and the `TRUNC_*`
family.
**Filter types:** `SET`, `QUANTITATIVE_NUMERICAL`, `QUANTITATIVE_DATE`, `RELATIVE_DATE`,
`TOP_N`, `MATCH`.

## Call the measure; do not rebuild it

If the data source defines `[Net Revenue]`, reference it by caption and let VDS apply the
customer's calculation. Reading its `formula` from `read-metadata` and reimplementing the
arithmetic is wrong for a reason that is specific to Tableau:

**Join keys, cardinality and referential-integrity settings are not reliably exposed.** The
Metadata API's `upstreamTables` tells you which tables are involved, not how they are
joined or at what grain. A reimplemented `SUM` over a one-to-many join double-counts, and
nothing in the data tells you it did.

The formula text is useful for *explaining* a metric to a human. It is not a specification
you can safely execute elsewhere.

## The `SET`-filter defect — 10 or more values returns empty

**A `SET` filter on a calculated field returns empty results when the filter contains 10 or
more string values. Nine or fewer works.**

There is no error. The response is well-formed and contains nothing.

**Workaround — chunk the filter:**

```python
def vds_query_chunked_set(client, datasource_luid, query, set_field, values, chunk=9):
    """SET filters on calculated fields silently return empty at >= 10 values."""
    rows = []
    for i in range(0, len(values), chunk):
        q = copy.deepcopy(query)
        q["filters"] = q.get("filters", []) + [{
            "field": {"fieldCaption": set_field},
            "filterType": "SET",
            "values": values[i:i + chunk],
            "exclude": False,
        }]
        rows.extend(client.query_datasource(datasource_luid, q)["data"])
    return rows
```

The alternative is to drop the filter entirely, retrieve the wider set, and filter
locally — often cheaper if the unfiltered cardinality is small.

**Diagnostic rule:** an empty VDS result on a `SET` filter with 10 or more values is this
defect until proven otherwise. Check the value count before investigating the data.

## `rowLimit` is not optional

**As of 2026.1, VDS streams and the previous 1 GB response cap was removed.** The removal
of a ceiling is precisely the reason to impose your own: an unbounded query against a large
data source will flood the agent's context and the process's memory.

Set `rowLimit` on every query. Pick it from the question:

| Question shape | Sensible `rowLimit` |
|---|---|
| Aggregate by a handful of dimensions | 1,000–10,000 |
| Detail rows for investigation | 10,000, then narrow the filter |
| "Give me everything" | **do not** — go to the warehouse via Metadata API lineage |

## Timeouts you will actually hit

- **Queries against interactive workbook data sources time out at 30 seconds.** If the
  target is a workbook data source rather than a published one, budget accordingly or
  publish the data source.
- **The general VDS timeout is 30 minutes and produces HTTP 408.** A 408 is a query too
  broad, not a platform failure.
- **20 concurrent requests to endpoints that start long-running jobs** (Cloud), then 429.

## `disaggregate` and `bypassMetadataCache`

- **`disaggregate: true`** returns row-level rather than aggregated results. Powerful and
  expensive; pair it with a tight `rowLimit`.
- **`bypassMetadataCache: true`** forces a fresh metadata read. Use it after someone has
  just republished a data source and the field list looks wrong — but note this does not
  help with **extract** staleness, which is a different thing entirely (see
  `pulse-and-lineage.md`).
