---
name: warning-field-reader
description: Use immediately after any GTM platform API or MCP response, before using the numbers. Reads the specific response fields and headers that reveal sampling, privacy thresholding, cardinality rollup, truncation, caching, throttling and permission-shaped blindness — GA4 `samplingMetadatas` / `subjectToThresholding` / `dataLossFromOtherRow` / `emptyReason`, Salesforce `allData`, Tableau `NODE_LIMIT_EXCEEDED`, Cube's `Continue wait`, Meta's throttle header, and the rest. Prevents the single most common agentic-analytics failure: reporting the number and dropping the caveats.
---

# Warning field reader

**A response is not a number. It is a number plus its caveats.** The caveats are
in named fields and headers that a naive parser walks straight past, because
they sit beside the data rather than in it, and because nothing errors.

Run this on every response, before any arithmetic. Output is
`integrity_flags[]` on the provenance block, plus one plain sentence per flag,
plus a hard stop where a flag makes the number unusable.

## The three dispositions

| Disposition | Meaning | Example |
|---|---|---|
| **Annotate** | the number is usable; the caveat travels with it | sampling rate 43% |
| **Reclassify** | the number is a different kind of number than it looks | a capped row count is a `lower_bound`, not a count |
| **Stop** | the number is not usable as retrieved | an async placeholder parsed as data; a formatted string treated as a float |

Most flags annotate. Reclassify and stop are rare and specific. Annotating is
not a soft option: it is the correct handling for the large majority of real
warnings, and treating every warning as a stop is how an agent becomes useless.

## The field register

### GA4 (Data API)

The three sampling-class fields live in `ResponseMetaData` and are the reason
GA4 disagrees with its own UI.

| Field | Meaning | Action |
|---|---|---|
| `samplingMetadatas[]` — `samplesReadCount`, `samplingSpaceSize`, one entry per date range | the report is sampled. Rate = `samplesReadCount / samplingSpaceSize` | **annotate** with the rate. Mitigate by shortening the range, dropping dimensions, or going to the BigQuery export |
| `subjectToThresholding: true` | rows suppressed for privacy, typically with demographics, interests or Google-signals data in the query | **annotate, and never present segment sums as the total.** Suppressed rows are silently missing and the parts will not add to the whole |
| `dataLossFromOtherRow: true` | high-cardinality dimension combinations rolled into an `(other)` bucket. Triggered above roughly 500 unique daily values on a dimension | **annotate and name the dimension.** Do not present a long tail from this report. Classic victims: page path, page title, any custom dimension carrying an ID or query string |
| `emptyReason` | an empty report is not always "no data" | **read it and report it** before concluding zero |
| `schemaRestrictionResponse` | field-level permissions changed the numbers without erroring | **annotate**; log the credential; flag which metrics were restricted |
| `currencyCode` | revenue is in the **property's** currency | read it; never assume USD |
| `timeZone` | date dimensions are bucketed in the **property's** IANA timezone | read it; never assume UTC |
| `returnPropertyQuota: true` → `PropertyQuota` | token-based quota consumption after the request | **make the request parameter non-optional** and self-throttle from the response |

Two more GA4 realities to state rather than chase: the UI uses pre-aggregated
tables and the Data API computes on a different path, so exact reconciliation is
often unachievable; and `runFunnelReport`, `reportTasks` and `chat` are v1alpha
and can change shape without a deprecation window.

### Google Ads

| Signal | Meaning | Action |
|---|---|---|
| **Absence of zero-impression rows** | the API omits rows with no impressions. A "missing campaign" usually means no impressions that day, not a missing campaign | query the resource **without metrics**, or join to a full entity list, before reporting a gap |
| `status = 'REMOVED'` present in results | soft-deleted entities persist forever. The UI hides them; the API does not | **filter deliberately.** This is the number one cause of "the API says 400 campaigns, the UI says 50" |
| Access tier on the developer token | Explorer, Basic and Standard have different daily operation ceilings | record the tier in provenance; it caps what is plannable |

### Meta

| Field / header | Meaning | Action |
|---|---|---|
| `x-fb-ads-insights-throttle` — `app_id_util_pct`, `acc_id_util_pct`, `ads_api_access_tier` | utilisation-based throttling, expressed as percentages | **back off as either percentage approaches 100.** This is the only forward-looking rate signal Meta gives |
| error code **100**, subcode **1487534** | too many rows or data points requested | **auto-split by date range or object level and retry. This is a required strategy, not an optional optimisation** |
| error code **4**, subcode **1504022** | global load shedding | retryable, and not caused by your usage. Back off and retry |
| Unique metrics under a breakdown — reach, unique clicks | **not additive across breakdown values** | **never sum a breakdown and call it the total.** The same person appears in more than one bucket |
| `async_status`, `async_percent_completion` on a report run | the async path is the default for anything substantial | poll; do not treat the job handle as a result. Run IDs expire after 30 days |

### LinkedIn Ads

| Signal | Meaning | Action |
|---|---|---|
| Empty `elements` array | **either no activity or no read access. The API does not distinguish them** | verify account access separately before reporting "no spend". Report as `partial`, not zero |
| Missing `fields` parameter | returns only `impressions` and `clicks`, **with no error** | always name the metrics explicitly. Maximum 20 fields per request |
| `timeGranularity=ALL` outside the 6-month daily window | **dates are silently rounded to month boundaries** and the whole month is included | detect and refuse, or restate the window the user actually got |
| 414 URI too long | a real error on wide requests | use query tunnelling rather than trimming the question |

### Product analytics

| Platform | Field / signal | Meaning | Action |
|---|---|---|---|
| Amplitude | export window keys on `server_upload_time` | **export and chart are not the same population.** Client-side event time and server receipt time differ | reconcile deliberately and say which basis produced the number |
| Amplitude | 400 on an oversized export, 504 on a very large one | 365-day maximum period, hard 4 GB response | split the range; the error is a size signal, not a failure |
| Mixpanel | project timezone change | **retroactively re-buckets historical reports** | a number quoted last month may not reproduce. Record the project timezone in provenance |
| PostHog | HTTP **400** on `OFFSET` | offset pagination is rejected for personal API keys. **This is not "the query failed"** | switch to keyset pagination on `timestamp`. See `pagination-patterns` |
| PostHog | `query_status.id` present in the body | an async query handle, not a result | poll `GET /query/:query_id/`. Parsing this as data yields nothing, silently |

### CRM and marketing automation

| Platform | Field | Meaning | Action |
|---|---|---|---|
| **Salesforce** | **`allData: false`** | the 2,000-row cap was hit. **The aggregates are computed over the full result set and are correct; only the detail rows are truncated** | **the highest-value single check in the pack.** Never trust detail rows without reading it. Report counts as `lower_bound` while reporting the aggregate as exact |
| Salesforce | fields missing from the response | field-level security omission, not a null value | log the credential. The API and the UI legitimately disagree |
| Salesforce | report run by the integration user | row visibility and **timezone** both follow the running user | record the running user in provenance |
| **HubSpot** | result count at **10,000** on `/search` | a hard ceiling regardless of paging | shard on `hs_lastmodifieddate` or `hs_object_id`. Named in the research as the most common HubSpot extraction bug |
| HubSpot | archived records absent | list endpoints exclude them by default and **search never returns them at all** | period counts drift invisibly. Pass `?archived=true` on lists; accept the gap on search |
| **Marketo** | error **606** / **607** | rate limit / daily quota. **Shared across every integration on the instance** | back off, and expect 606s you did not cause. Never conclude your own code is the problem |
| **Pardot / MCAE** | error **66** | concurrency above 5 | serialize the requests |
| **Braze** | `conversions` versus `conversions_by_send_time` | **two attribution bases in one response** | pick one, state which, and never mix them in a table |
| **Iterable** | *no rate-limit headers at all* | the only signal is the 429 itself | model the limits client-side from the documentation. This is mandatory, not optional |
| **Klaviyo** | `RateLimit-*` replaced by `Retry-After` on 429 | **visibility is lost exactly when it is needed** | track the steady window proactively rather than reactively |
| Klaviyo | well-formed response, empty `data` | the filter matched nothing, the conversion metric does not apply, or the timeframe predates the campaign | validate the IDs exist and the window postdates creation before concluding performance was zero |

### BI and warehouse

| Platform | Field | Meaning | Action |
|---|---|---|---|
| **Looker** | a field absent from an explore | **permission-shaped blindness with no error** | probe capability explicitly and report the blind spot |
| Looker | `apply_formatting: true` | numbers return as **formatted strings**, with separators and currency symbols | **type-check before arithmetic.** String concatenation of "1,200" and "300" is a silent, enormous error |
| **Tableau** | Metadata API `errors` block, `NODE_LIMIT_EXCEEDED` | **partial results are returned together with a warning**, not an error | read the errors block. Ignoring it silently truncates the lineage graph |
| Tableau | `hasExtracts`, `extractLastRefreshTime` | the only way to know the number is hours stale | always report extract freshness |
| **Power BI** | HTTP **200** with an `error` object in the body | some client libraries mask the failure entirely | **check the body, not the status code** |
| Power BI | 1,000,000 **values**, not rows | a 20-column result caps at 50,000 rows | compute chunk size from values, not rows |
| **Snowflake** | everything is a string in `rowType` | `NUMBER` arrives as a string, timestamps as epoch strings | cast deliberately. Sorting strings as numbers puts 9 above 100 |
| Snowflake | `POLICY_REFERENCES`, masking policies | **masked reads succeed.** No error, wrong values | check policy references before reporting |
| **BigQuery** | dry run returns **0 bytes** on RLS-protected tables | deliberate, to block a side channel | **0 is not "safe"**. Do not size a query from it |
| **Cube** | HTTP **200** with `{"error": "Continue wait"}` | an async idiom, not a result and not a failure | **re-send the identical query.** An agent parsing the body as data silently produces nothing |
| Cube | measure type `countDistinctApprox` | an HLL estimate | **never report an approximation as a count.** Flag `approximate` |
| **dbt** | `metadata.generated_at` on `manifest.json` | the artefact's age, not the model's run time. A stale artefact describes a model that may not exist | always check before trusting the manifest as a schema source |

## The three that produce the worst failures

If only three checks ever run, run these.

1. **Salesforce `allData`.** Correct totals sitting above truncated rows, in one
   response, with no error. Every other truncation at least looks truncated.
2. **Cube's `Continue wait`.** HTTP 200 with an error string where data should
   be. A parser that expects rows finds none and reports zero.
3. **GA4 `subjectToThresholding`.** Segments that do not add to the total, with
   the shortfall invisible. Anyone checking the arithmetic concludes the agent
   cannot add.

## Output shape

```json
{
  "integrity_flags": ["sampled", "other_row"],
  "sentences": [
    "This report was sampled at 43%, so the figure is close but not exact.",
    "Page paths above roughly 500 daily unique values were rolled into an (other) bucket, so the long tail in this table is not complete."
  ],
  "stop": false,
  "reclassify": null
}
```

`stop: true` is reserved for responses that are not data: an async handle, a
`Continue wait` body, a formatted-string payload about to enter arithmetic, an
error object inside a 200. Everything else annotates or reclassifies.

## Calls

- Feeds `provenance-block`, which decides whether the caveat is displayed
- Feeds `answer-contract`, which converts a reclassification into a typed result
- Works with `pagination-patterns`, which owns the cap detection that sets `truncated`

## References

- `references/field-register.md` — the full register with response shapes and detection snippets
- `references/empty-response-triage.md` — the decision tree for a clean empty response, per platform
