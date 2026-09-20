# When to stop paginating

Pagination is the right tool for hundreds to low thousands of rows. Past that it
is usually the slow, expensive, cap-limited version of something the vendor
already built.

## The switch signals

| Signal | Action |
|---|---|
| The API caps below what the question needs | switch surface entirely. There is no pagination to add |
| More than a few thousand rows on a token-costed or cost-modelled API | bulk or warehouse path |
| The same extraction runs on a schedule | scheduled export or warehouse connector, not a paginated pull each time |
| The question needs event-level rather than aggregate data | the event export, which usually also drops sampling and thresholding |
| The page count would exhaust the rate budget | `rate-limit-governor` decides; the budget is the constraint, not the row count |
| The extraction would take longer than the cursor or token stays valid | keyset on a stable key, or bulk |

## The escape hatch per platform

| Platform | Bulk path | What it costs you |
|---|---|---|
| GA4 | **BigQuery Export** | setup and BigQuery cost. **Gains: no sampling, no thresholding, no `(other)` row.** Often better data, not just more of it |
| Google Ads | `SearchStream`, or BigQuery Data Transfer Service for history | `SearchStream` counts as one operation regardless of batch count |
| Meta | the async insights flow is the **default** path, not an escape hatch | polling latency. Run IDs expire after 30 days |
| **LinkedIn** | **none exists** | slice by date or facet in your own loop and stitch. No async, no CSV export |
| Amplitude | S3 export | Amplitude's own recommendation above the Export API's 4 GB ceiling |
| Mixpanel | Raw Export streaming NDJSON; Data Pipelines for real volume | Data Pipelines is a paid add-on |
| PostHog | `/batch_exports` to S3, BigQuery, Snowflake, Redshift, Postgres | a destination to configure. The correct path for warehouse work |
| **Salesforce** | **Bulk API 2.0 against the objects** | you lose the report's own groupings and formula columns, and rebuild them in SQL. **Unavoidable above 2,000 rows** |
| HubSpot | Exports API: create, poll, fetch a signed URL | the export reflects the *view's* columns, not an arbitrary field list |
| Marketo | **Bulk Extract is the only viable path** above tens of thousands of rows | create → enqueue → poll → file. **Activity extracts capped at 31 days per job** |
| Pardot / MCAE | Export API | queued and sequential per account, 150 fields max, collection fields not exportable, 7-day expiry, file order not guaranteed |
| Braze | `/users/export/segment` to your own S3, Azure or GCS bucket; Currents for event streams | you provide the bucket. Not an HTTP body |
| Iterable | `POST /api/export/start`, poll, `get_export_files` | **files arrive progressively; do not read the list before the job reports complete** |
| **Klaviyo** | **none exists** | paginate under 2/min and 225/day, or use a warehouse connector |
| Looker | `create_query_task` async, or a scheduled plan writing to GCS or S3 | the admin's max-rows-to-download setting still binds interactive paths |
| Tableau | read the warehouse directly using the lineage from the Metadata API | VDS streams post-2026.1 with no 1 GB cap, which means an unbounded query can flood you. Set `rowLimit` |
| Power BI | Arrow DAX endpoint (Premium or Fabric only), or read the Lakehouse directly | licence-gated |
| Snowflake | `async=true` with a handle, or `COPY INTO <stage>` | staging and retrieval |
| BigQuery | **Storage Read API** (gRPC, Arrow or Avro, parallel sessions), or `EXPORT DATA` to GCS | a different client library. Worth it above roughly a million rows |
| Cube | SQL API or a pre-aggregation export | — |
| Segment | **no bulk event export via the Public API.** Warehouse connector or Data Lakes | — |
| RudderStack | **no bulk event export by design.** The warehouse is the export | — |

## The two dead ends

State these plainly rather than letting a user wait for a workaround.

**Salesforce reports above 2,000 rows.** There is no pagination parameter, no
async report variant that returns more rows, and no cursor. The report API
cannot return row 2,001. The answer is to stop using the report API and query
the objects. You then rebuild the report's groupings yourself, which is real
work, and saying so up front is better than discovering it at row 2,000.

**LinkedIn `adAnalytics` above 15,000 elements.** No pagination, no async job,
no CSV export. Slicing in your own loop is the entire solution space. If the
slice itself returns 15,000 elements, split the slice further and recurse.

## The sentence to write when switching

> That extraction needs about 40,000 rows. The report API caps at 2,000 with no
> pagination, so the report surface cannot answer it at any page size. Querying
> the objects through the bulk API returns the full set; it loses the report's
> built-in grouping, which I will rebuild. That takes a few minutes longer and
> returns a complete answer instead of a truncated one.

Naming the cap, the reason, the alternative and its cost is a decision the user
can make. "The report is too large" is not.
