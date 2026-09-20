# Per-platform provenance field sources

Every field, every platform the pack covers. Where a field is "not applicable",
say so in the block rather than leaving it blank, because a blank reads as
"unknown" and unknown triggers a caveat that need not fire.

## Query identity

`query_text_or_spec` and `api_version_or_revision`.

| Platform | Query to record | Version handle |
|---|---|---|
| GA4 | the full `runReport` request body | Data API v1beta; note `v1alpha` for `reportTasks`, `runFunnelReport`, `chat` |
| Google Ads | the GAQL string | API version in the endpoint path, e.g. `v21` |
| Meta | endpoint, `fields`, `breakdowns`, `action_attribution_windows`, `time_range` | Graph API version in the path |
| LinkedIn | the full request including `fields`, `pivot`, `timeGranularity`, `dateRange` | `LinkedIn-Version` header, `YYYYMM` |
| Salesforce | report ID plus filter overrides, or the SOQL | API version in the path |
| HubSpot | endpoint plus the search request body | v3 / v4 per object |
| Marketo | endpoint plus filter, or the bulk job spec | REST v1 |
| Klaviyo | endpoint plus filter | the `revision` header date, which is the version |
| Braze | endpoint plus `length`, `ending_at` | none exposed; record the endpoint |
| Iterable | endpoint plus campaign IDs | none exposed |
| Amplitude | endpoint plus the chart spec or saved chart ID | Dashboard REST |
| Mixpanel | the segmentation or funnel query | Query API |
| PostHog | the HogQL text | `/api/projects/:id/query/` |
| Looker | the query body or the Look ID, plus the model and explore | API 4.0 |
| Tableau | the VDS request body, or the REST endpoint, or the GraphQL document | REST version, VDS version |
| Power BI | the DAX in `executeQueries`, or the XMLA statement | REST v1.0 |
| Snowflake | the SQL text | SQL API v2 |
| BigQuery | the SQL text plus the job configuration | v2 |
| Cube | the JSON query or the SQL API text | API v1 |
| Segment / RudderStack | the endpoint and filters | Public API |

**Record the query text, not a description of it.** "Pulled last month's spend"
is not reproducible. The GAQL string is.

## Attribution window and basis

Set these on every ad-platform result even when the user did not ask, because
the next skill that touches the number will need them.

| Platform | `attribution_window` | `attribution_basis` |
|---|---|---|
| Google Ads | per conversion action, 1 to 90 days, default 30 click; 1 day view-through; 3 days engaged-view | data-driven by default on eligible accounts, set per conversion action |
| Meta | `action_attribution_windows`, API default `7d_click`; Ads Manager ad-set default 7d click + 1d view; `7d_view` and `28d_view` removed 2026-01-12 | the ad-set level setting; the API now mirrors Ads Manager |
| LinkedIn | `postClickAttributionWindowSize` 1/7/30, default 30; `viewThroughAttributionWindowSize` 1/7/30, default 7 | `LAST_TOUCH_BY_CAMPAIGN`, which counts once **per campaign** |
| GA4 | acquisition lookback 30 days by default, 30 or 90 for paid and organic; engaged-view 3 days; no view-through counting | data-driven by default, last-click available |
| CRM campaign influence | the influence model's own lookback | the configured influence model. Name it |
| Warehouse-computed | whatever your model applies | your model. Publish the rule |

## Date basis

The question "what date does this row belong to" has a different answer on every
platform, and the answer changes the number.

| Platform | `date_basis` |
|---|---|
| Google Ads | click date; conversions back-fill onto the original click date for up to 90 days |
| Meta | impression or click date; restates for 28 days. `action_report_time` can change this, so record which was used |
| LinkedIn | conversion event date |
| GA4 | session or event date, in the property timezone |
| Email and lifecycle platforms | send date by default; some metrics offer conversion-time basis. Braze exposes both `conversions` and `conversions_by_send_time` in one response |
| CRM pipeline | close date, created date, or stage-entry date. These produce three different quarters for the same deal |
| Product analytics | event timestamp as sent, which is client time on some SDKs and server receipt time on others. Amplitude's export window keys on `server_upload_time`, which is why export and chart disagree |

## Freshness

| Platform | `data_as_of` source | `settles_after` |
|---|---|---|
| GA4 | request time minus processing lag | 24 to 48 hours, standard properties |
| Google Ads | request time | up to 90 days for conversion back-fill |
| Meta | request time | 28 days |
| LinkedIn | request time | short, but daily granularity is only available for the trailing 6 months |
| Klaviyo, Braze, Iterable | request time | engagement metrics accrue for days after send; opens are unreliable regardless |
| Tableau | `extractLastRefreshTime` where `hasExtracts` is true | extract schedule |
| Power BI | dataset last refresh | refresh schedule |
| Looker | query time for direct queries; PDT build time for persisted tables | PDT rebuild cadence |
| Cube | pre-aggregation last refresh | the refresh key |
| Snowflake, BigQuery | the pipeline's watermark, not the query time | your ingest cadence |
| dbt-modelled | the model's last successful run | your schedule. `manifest.json` `metadata.generated_at` is the artefact's age, not the model's |

## Credential identity

Record the identity and, where knowable, what it could not see.

| Platform | Identity to record | Scope note to record |
|---|---|---|
| GA4 | service account email or OAuth subject | any `schemaRestrictionResponse` in the response |
| Google Ads | login customer ID and the operating customer ID | access tier, which caps daily operations |
| Meta | app ID and the system user or person token | access tier from `ads_api_access_tier` |
| LinkedIn | the person the token is bound to; LinkedIn tokens are person-bound | which ad accounts that person can read |
| Salesforce | the running user of the report, which determines both rows and timezone | profile and FLS restrictions |
| HubSpot | private app or OAuth app | **a private-app token ignores user permissions**, so it sees more, not less |
| Klaviyo, Braze, Iterable | the API key's name and scope set | which scopes were granted |
| Looker | the API user | which model sets and explores that user can see |
| Tableau | the connected user under OAuth 2.1 | per-user content permissions |
| Power BI | the service principal or user | workspace role |
| Snowflake | user and active role | masking policies in effect |
| BigQuery | service account | row-level security policies in effect |

## Integrity flags by source field

| Flag | Populated from |
|---|---|
| `sampled` | GA4 `samplingMetadatas[]` ratio below 1; any platform's own sampling disclosure |
| `thresholded` | GA4 `subjectToThresholding`; minimum-audience floors; masked columns |
| `other_row` | GA4 `dataLossFromOtherRow` |
| `truncated` | Salesforce `allData: false`; HubSpot 10,000 search ceiling; LinkedIn 15,000 element cap; Tableau `NODE_LIMIT_EXCEEDED`; Power BI value cap; any page-cap exhaustion |
| `cached` | BI caches, pre-aggregations, extracts |
| `modelled` | Google data-driven attribution; Meta modelled conversions; GA4 behavioural modelling; any agent-applied coefficient |
| `approximate` | Cube `countDistinctApprox`; warehouse HLL functions; any sketch-based distinct count |

## Not applicable, and say so

- Attribution window on a warehouse row count.
- Currency on a session count.
- View window on a platform that does not count view-throughs, which includes GA4.

Writing "not applicable" is cheaper than leaving a blank that a downstream skill
reads as unknown and caveats unnecessarily.
