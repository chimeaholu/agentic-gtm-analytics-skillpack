# Field register with response shapes

Detection snippets are illustrative pseudocode. The point is *where to look*,
which is the part an agent gets wrong.

---

## GA4 Data API

Response shape, trimmed to the fields that matter:

```json
{
  "rows": [ ... ],
  "rowCount": 18422,
  "metadata": {
    "currencyCode": "EUR",
    "timeZone": "Europe/Berlin",
    "subjectToThresholding": true,
    "dataLossFromOtherRow": false,
    "samplingMetadatas": [
      {"samplesReadCount": "430000", "samplingSpaceSize": "1000000"}
    ],
    "emptyReason": null,
    "schemaRestrictionResponse": {
      "activeMetricRestrictions": [
        {"metricName": "totalRevenue", "restrictedMetricTypes": ["REVENUE_DATA"]}
      ]
    }
  },
  "propertyQuota": {
    "tokensPerDay": {"consumed": 812, "remaining": 199188},
    "tokensPerHour": {"consumed": 812, "remaining": 39188},
    "concurrentRequests": {"consumed": 1, "remaining": 9},
    "potentiallyThresholdedRequestsPerHour": {"consumed": 4, "remaining": 116}
  }
}
```

```
sampling_rate = samplesReadCount / samplingSpaceSize   # per date range, may differ per range
if sampling_rate < 1: flag "sampled", annotate with round(rate*100)%
if subjectToThresholding: flag "thresholded"; forbid segment-sum-as-total
if dataLossFromOtherRow: flag "other_row"; name the high-cardinality dimension
if emptyReason: report it verbatim; do not conclude no_data
if schemaRestrictionResponse: flag restricted metrics; log credential
```

Notes that change behaviour:

- **Sampling is per date range.** A multi-range request can be sampled on one
  range and exact on another. Annotate per range, not globally.
- **Thresholding has its own quota bucket**, separate from tokens: 120
  potentially-thresholded requests per hour on standard properties. An agent
  looping demographic queries exhausts that long before it exhausts tokens.
- **`(other)` applies to the Data API, not just the UI.** The trigger is roughly
  500 unique values in one day on a dimension. Page path on a content site hits
  it routinely.
- **Set `returnPropertyQuota: true` on every request.** It is the only reliable
  self-throttling signal.

---

## Meta

Throttle header, read on every response:

```
x-fb-ads-insights-throttle: {"app_id_util_pct":32.5,"acc_id_util_pct":78.1,"ads_api_access_tier":"standard_access"}
```

```
if max(app_id_util_pct, acc_id_util_pct) > 75: slow down
if max(...) > 90: stop issuing new work; drain
```

Error handling that is part of the query strategy rather than error recovery:

| Code / subcode | Meaning | Correct response |
|---|---|---|
| 100 / 1487534 | too much data requested | **split the date range in half, or drop to a coarser object level, and retry.** Required strategy |
| 4 / 1504022 | platform load shedding | back off with jitter and retry. Not your fault, not your quota |
| 17 | user request limit reached | back off substantially |

**Non-additive metrics under breakdowns.** Reach, unique clicks, unique link
clicks, frequency-derived metrics. Summing a breakdown produces a number larger
than the true unique count, by an unknown amount. There is no correct way to add
them; request the unbroken-out total as a separate call.

---

## LinkedIn Ads

The empty-elements ambiguity, in full:

```json
{ "elements": [], "paging": {"start": 0, "count": 10} }
```

This is returned for **both** "this account had no activity in the window" and
"this token cannot read this account". There is no field that distinguishes
them. The only resolution is an independent access check against the account
endpoint. Until that check runs, the correct result type is `partial`, not
`no_data` and never zero.

The silent-rounding case, which produces a number that is simply about a
different period than the one requested:

```
timeGranularity=ALL with a dateRange outside the trailing 6-month daily window
  → dates rounded to month boundaries, whole months included
```

The response looks normal. The window is not the one you asked for. Detect by
comparing the requested range against the 6-month boundary before issuing, and
either refuse or restate the window in provenance.

Also: omit `fields` and you get `impressions` and `clicks` only, with no error
and no indication that the metrics you asked about were dropped. Maximum 20
fields per request.

---

## Salesforce

The single highest-value field in the pack:

```json
{
  "allData": false,
  "factMap": { "T!T": { "aggregates": [ {"label": "4,127,300", "value": 4127300} ],
                        "rows": [ /* 2000 rows */ ] } }
}
```

Read it as: **the aggregate is over the full result set and is exact. The rows
are the first 2,000 and are not.** These two facts live in the same object and
have different truthfulness. Consequences:

- A total value from `aggregates` with `allData: false` is reportable as exact.
- A count of `rows` with `allData: false` is a `lower_bound`, always.
- Any per-row analysis over that response is over a truncated, unspecified
  subset. Not a sample. A truncation, which is not the same thing and cannot be
  weighted.

For complete rows, leave the report API entirely: query the objects through the
bulk API instead.

Two more:

- **Fields missing from a response are field-level security omissions**, not
  nulls. The value exists; this credential cannot see it.
- **The running user determines both row visibility and timezone.** A report run
  by an integration user and the same report run by an admin legitimately
  disagree on both content and day boundaries.

---

## HubSpot

```
POST /crm/v3/objects/{object}/search  → total: 10000, and it stops there
```

10,000 is a ceiling on the **result set**, not a page size, and paging past it
is not possible. Sharding recipe:

```
sort ascending on hs_lastmodifieddate (or hs_object_id)
page to the end of the ≤10k window
take the last value seen
re-issue with filter: hs_lastmodifieddate GT <last value>
repeat until a page returns fewer than the page size
```

Watch for ties on the sort key; `hs_object_id` as a tiebreaker avoids an
infinite loop on records sharing a modification timestamp.

**Archived records**: absent from list endpoints by default, and **never
returned by search at all**. Period-over-period counts drift as records are
archived, with no signal. Pass `?archived=true` on lists; on search, state the
gap.

**A private-app token ignores user permissions**, so it returns *more* than a
human sees. That is the opposite of every other platform in this register and it
inverts the usual "the agent sees less" assumption.

---

## Cube

The response that is not a response:

```
HTTP/1.1 200 OK
{"error": "Continue wait"}
```

A JSON parser succeeds. A row extractor finds no rows. An agent that does not
special-case this reports zero, or an empty table, with complete confidence. The
correct handling is to **re-send the identical query** until data returns, with
a bounded attempt count.

```
if response.error == "Continue wait": resend identical query; stop after N attempts
```

`countDistinctApprox` is an HLL estimate. Flag `approximate` and never present
it as a count, especially in a reconciliation where the difference will be
attributed to a real cause.

---

## Snowflake

Everything in `data` is a string, typed by `resultSetMetaData.rowType`:

```json
{ "resultSetMetaData": { "rowType": [ {"name": "REVENUE", "type": "fixed", "scale": 2} ] },
  "data": [ ["412730"] ] }
```

`412730` with scale 2 is 4127.30. Reading the string as a float gives a number
a hundred times too large, which looks like a units error and gets "fixed" in
the wrong place. Timestamps arrive as epoch strings. Cast from `rowType`,
deliberately, every time.

**Masking policies mean masked reads succeed.** The query returns, the values
are masked, nothing errors. Check `POLICY_REFERENCES` before reporting on a
column that might carry a policy.

---

## BigQuery

```
jobs.query with dryRun: true → totalBytesProcessed
```

Free, and the correct pre-flight for cost. **But a dry run against a
row-level-security-protected table returns 0 bytes deliberately**, to avoid
leaking information about filtered rows through the estimate. Treating 0 as
"this query is free and safe" is exactly the inference the design is defending
against. Detect RLS on the referenced tables before trusting a 0.

---

## Looker

`apply_formatting: true` returns strings:

```json
{"total_revenue": "$1,204,301.22", "orders": "18,422"}
```

Arithmetic on these silently concatenates or coerces. Request unformatted
values for anything computed, and type-check on arrival regardless.

**A field absent from an explore is permission-shaped blindness.** No error
distinguishes "this field does not exist" from "you cannot see this field". Probe
capability explicitly and report the blind spot rather than concluding the
model lacks the concept.

---

## Tableau

The Metadata API returns partial results **with** a warning rather than failing:

```json
{ "data": { "workbooks": [ /* truncated */ ] },
  "errors": [ {"message": "NODE_LIMIT_EXCEEDED", "extensions": {...}} ] }
```

A lineage graph built from this is incomplete in ways that look complete.
Always read the `errors` block even when `data` is populated. Maximum page 1,000,
20,000-node limit.

`hasExtracts` and `extractLastRefreshTime` are the only freshness signals; a
live-connection data source has neither and is fresh by definition.

---

## Power BI

```
HTTP 200
{ "error": {"code": "...", "message": "..."} }
```

Some client libraries surface only the status code. Check the body on every
call.

The `executeQueries` cap is **1,000,000 values, not rows**. Rows = 1,000,000 /
column count. A 20-column query stops at 50,000 rows. Compute chunk size from
values.

---

## dbt

`manifest.json` carries `metadata.generated_at`. That timestamp is when the
**artefact** was produced. It is not when the models ran, not when the data
landed, and not evidence that the models it describes still exist. A manifest
generated minutes ago can describe a deleted model. Check it, and check run
results separately.
