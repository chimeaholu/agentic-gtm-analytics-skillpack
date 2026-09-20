# GAQL patterns

GAQL looks like SQL and is not SQL. The differences that matter:

- **No `JOIN`.** A query selects from exactly one resource. Related fields are available
  because the API attributes them implicitly (`campaign.name` is selectable `FROM
  ad_group`), not because you joined anything.
- **No `GROUP BY`.** Aggregation is implicit: the grain is the selected resource crossed
  with whatever `segments.*` fields you select. Adding a segment silently changes the grain
  and the row count.
- **Metrics need a date segment.** `WHERE segments.date DURING LAST_30_DAYS` or a
  `BETWEEN` range is what makes a query a report rather than a resource listing.
- **`LIMIT` and `ORDER BY` work as expected.** There is no `OFFSET`; use `next_page_token`
  with `Search`, and pagination does not consume quota.

## Date predicates

```sql
WHERE segments.date DURING LAST_30_DAYS
WHERE segments.date DURING YESTERDAY
WHERE segments.date BETWEEN '2026-08-01' AND '2026-08-31'
```

Relative tokens (`TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_14_DAYS`, `LAST_30_DAYS`,
`THIS_MONTH`, `LAST_MONTH`) resolve in the **account's** timezone. For any number you will
quote later, use explicit `BETWEEN` dates and record the account timezone alongside them.

## Resources worth knowing

| Resource | Grain |
|---|---|
| `customer` | account-level settings and metrics; the place to read `currency_code` and `time_zone` |
| `campaign` | campaign performance |
| `ad_group` | ad group performance |
| `ad_group_ad` | individual ad performance |
| `ad_group_criterion` | keyword and audience criteria as entities |
| `keyword_view` | keyword performance metrics |
| `search_term_view` | actual search queries, **privacy-thresholded** |
| `conversion_action` | conversion action config, including lookback windows |
| `campaign_budget` | budget entities and shared budget membership |
| `geographic_view`, `landing_page_view`, `asset` | as named |

## Metrics and their units

| Field | Unit / meaning |
|---|---|
| `metrics.cost_micros` | micros; divide by 1,000,000 |
| `metrics.average_cpc` | micros |
| `metrics.impressions`, `metrics.clicks` | counts |
| `metrics.ctr` | fraction, not a percentage |
| `metrics.conversions` | attributed to **click date**, can be fractional |
| `metrics.conversions_value` | conversion value, click date, account currency |
| `metrics.conversions_by_conversion_date` | attributed to **conversion date** |
| `metrics.conversions_value_by_conversion_date` | value, conversion date |
| `metrics.all_conversions` | includes conversion actions not in the primary "Conversions" column |

`metrics.conversions` being fractional is not a rounding error: modelled and
data-driven-attribution credit is fractional by design. Do not round it to integers and do
not present it as a count of people.

## The always-include block

```sql
SELECT
  customer.id,
  customer.descriptive_name,
  customer.currency_code,
  customer.time_zone,
  ...
```

Currency and timezone travel with the rows and belong in the provenance block for every
answer. In an MCC context they vary per child account inside one result set.

## Patterns worth copying

**Campaign performance, removed entities excluded deliberately:**

```sql
SELECT campaign.id, campaign.name, campaign.status,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value,
       customer.currency_code, customer.time_zone
FROM campaign
WHERE segments.date BETWEEN '2026-08-01' AND '2026-08-31'
  AND campaign.status != 'REMOVED'
ORDER BY metrics.cost_micros DESC
```

**Conversion-date basis, for anything compared to a CRM or another platform:**

```sql
SELECT campaign.name,
       metrics.conversions_by_conversion_date,
       metrics.conversions_value_by_conversion_date
FROM campaign
WHERE segments.date BETWEEN '2026-08-01' AND '2026-08-31'
```

**Reading the conversion windows before trusting any conversion total:**

```sql
SELECT conversion_action.id, conversion_action.name,
       conversion_action.category, conversion_action.status,
       conversion_action.click_through_lookback_window_days,
       conversion_action.view_through_lookback_window_days,
       conversion_action.primary_for_goal
FROM conversion_action
```

If the returned windows differ across actions, the account's conversion total mixes
windows. Report the spread rather than a single implied window.

**The unsegmented control total, which you pull before any segmented breakdown:**

```sql
-- control
SELECT metrics.conversions, metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS AND campaign.id = 123456789

-- segmented
SELECT segments.device, metrics.conversions, metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_30_DAYS AND campaign.id = 123456789
```

Cost will reconcile. **Conversions may not**, because some conversions cannot be attributed
to a segment. Compute the residual, and present it as a named line rather than distributing
it or hiding it.

**Search terms, knowing they will not reconcile:**

```sql
SELECT search_term_view.search_term, campaign.name,
       metrics.impressions, metrics.clicks, metrics.cost_micros
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
```

Low-volume terms are withheld entirely for privacy, so this will not sum to campaign spend.
Give the campaign total as the anchor and state the visible share.

**Full entity list including zero-impression days:** query the resource without metrics.

```sql
SELECT campaign.id, campaign.name, campaign.status FROM campaign
```

## Paging and streaming

- `SearchStream` for anything over a few thousand rows. One request, one operation, batches
  streamed back.
- `Search` returns `next_page_token`; loop until it is absent. **Pagination is free on
  quota.**
- The gRPC response size cap is **64 MB**. On a size failure, select fewer fields or switch
  to `SearchStream` rather than shrinking the date range, which changes the answer.
- `RESOURCE_EXHAUSTED` means throttled. Back off exponentially; retrying immediately makes
  it worse.
