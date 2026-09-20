# GA4 BigQuery export — the schema traps

The export is the right answer for bulk, history, high-cardinality dimensions and
reconciliation-grade work: **no sampling, no thresholding, no `(other)` row**. A free tier
is available on standard properties, with daily and streaming options. What it costs
instead is schema knowledge, and choosing wrong here is the most common GA4-in-BigQuery
error.

## Tables

- `events_YYYYMMDD` — one sharded table per day, finalised.
- `events_intraday_YYYYMMDD` — today's streaming data, **with a different completeness
  profile**. It is incomplete, some fields populate later, and rows can be restated when
  the daily table is built.

**Do not union the two naively.** A query over `events_*` with a wildcard picks up intraday
tables if they exist and mixes finalised and unfinalised rows into one series, which
produces a sawtooth at the right-hand edge of every chart. Filter `_TABLE_SUFFIX`
explicitly to the finalised range, and query intraday separately and label it provisional.

## `event_params` is a repeated record

Every custom parameter needs an `UNNEST`, and **a parameter's value lives in exactly one of
`string_value`, `int_value`, `double_value` or `float_value`, and which one varies by
parameter** and can vary between rows for the same parameter name.

```sql
SELECT
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
  (SELECT COALESCE(value.int_value, value.double_value, value.float_value)
   FROM UNNEST(event_params) WHERE key = 'value') AS event_value
FROM `project.analytics_123456789.events_20260801`
WHERE event_name = 'purchase'
```

Reading only `string_value` for a numeric parameter returns NULL for every row and looks
like the parameter was never sent.

**Custom event-parameter string values are truncated at 100 characters.** A long URL or a
long custom label is silently cut, so grouping on a truncated value merges distinct values
that share a prefix.

## There is no session table and no top-level session id

The session key is built from two fields:

```sql
CONCAT(user_pseudo_id, '.',
       (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')) AS session_key
```

Sessions must be assembled by aggregating events on that key. Session-scoped metrics from
the Data API (`sessions`, `engagedSessions`, `sessionDefaultChannelGroup`) do not exist as
columns here; you are re-implementing them, **which means you own the definition and the
answer must say so.**

## Four traffic-source structures, and only one reconciles with the UI

| Structure | Scope | What it is |
|---|---|---|
| `session_traffic_source_last_click` | session | last-click attribution per session — **this is the one that reconciles with the GA4 UI** |
| `traffic_source` | user | first-touch for the user, set at acquisition and never updated |
| `collected_traffic_source` | event | raw, unattributed, as collected on the hit |
| `event_params` source / medium / campaign | event | a fourth surface, populated on some events only |

**Choosing wrong here is the most common GA4-BigQuery error.** A "channel" column built
from `traffic_source` is user first-touch and will never match a UI acquisition report,
which is session last-click. State which structure you used in every attribution answer
built on the export.

## Other practical notes

- `user_pseudo_id` is the device-scoped cookie id, not a person. Cross-device stitching
  requires `user_id`, which is populated only where the site sets it.
- `ecommerce` and `items` are nested records; `items` needs its own `UNNEST` and an item
  row multiplies the event row, so revenue summed after unnesting double-counts unless you
  aggregate carefully.
- Partition pruning is the cost control: always filter `_TABLE_SUFFIX` or the partition
  column. A wildcard scan across a year of shards is an expensive way to get a small
  answer, and BigQuery will not warn you before billing it.
- Consent mode and modelled conversions are **not** in the export. Google's modelled
  numbers are computed by Google and are not derivable from raw event rows. A BigQuery
  number and a GA4 UI number are two legitimate series and will not match. Say that once,
  plainly, rather than iterating to force agreement.
