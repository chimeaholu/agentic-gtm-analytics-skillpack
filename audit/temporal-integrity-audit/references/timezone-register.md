# The timezone register

Per platform: the rule, where to confirm it, and what goes wrong.

---

## CRM and marketing automation

### Salesforce
- **Rule:** report output uses the **running user's** timezone. Field values
  are stored in UTC and rendered in the user's timezone.
- **Confirm:** the integration user's `TimeZoneSidKey` on the User record.
- **Goes wrong:** two people run the same report and get different daily
  numbers, and both are correct. An integration user in a different timezone
  from the analyst produces a report that cannot be matched to the UI.
- **Compounding:** report output also honours the running user's sharing and
  field-level security, so timezone is not the only identity effect. See
  `permission-effect-audit`.

### HubSpot
- **Rule:** **date** properties are UTC midnight. **Datetime** properties are
  not. The portal has a timezone setting that affects the UI, not the stored
  value.
- **Confirm:** the property type from the properties API; the portal timezone
  from account settings.
- **Goes wrong:** a date property compared to a datetime property, where the
  date is UTC midnight and the datetime is local, shifts records across day
  boundaries in one direction only.

### Marketo
- **Rule:** instance timezone.
- **Confirm:** the instance setting; activity timestamps in API responses carry
  an offset.
- **Goes wrong:** activity extracts bucketed by local date while the warehouse
  buckets by UTC.

### Pardot / MCAE
- **Rule:** the **export creator's** timezone.
- **Confirm:** the user account that created the export.
- **Goes wrong:** two exports of the same data, created by two people, have
  different day boundaries. This one is genuinely hard to detect after the
  fact, because nothing in the file records who created it.

### Braze
- **Rule:** workspace timezone. **Revenue is already converted to USD.**
- **Confirm:** workspace settings.
- **Goes wrong:** a second currency conversion applied downstream
  double-converts. Braze's conversion is not always obvious in the API
  response.

### Klaviyo
- **Rule:** account timezone. **Only the `metric-aggregates` endpoint accepts
  an explicit `timezone` parameter**; everything else uses the account setting.
- **Confirm:** account settings API.
- **Goes wrong:** an agent passes a timezone to an endpoint that ignores it and
  believes the result is in the requested zone.
- **Also:** changing the attribution window **restates all history
  retroactively**, which is a temporal integrity issue as much as an
  attribution one.

---

## Product analytics

| Platform | Rule | Confirm from | Goes wrong |
|---|---|---|---|
| **Amplitude** | project timezone | project settings | two projects in one org with different zones |
| **Mixpanel** | project timezone | project settings | computed custom properties evaluated at query time do not exist in the raw export, so a warehouse recomputation differs |
| **PostHog** | project timezone | project settings | HogQL date functions use project time; raw event timestamps are UTC |

---

## Advertising and web

| Platform | Rule | Confirm from |
|---|---|---|
| **GA4** | property timezone | `ResponseMetaData.timeZone` on every Data API response |
| **Google Ads** | account timezone | `customer.time_zone` via GAQL |
| **Meta** | account timezone | account-level field on the ad account |
| **LinkedIn Ads** | account timezone | account settings |

GA4's response field makes it the easiest to confirm in the whole stack. There
is no excuse for an `assumed` status on GA4.

Ad platform day boundaries matter more than they look: spend is billed on the
account's day, so a UTC-bucketed spend series will never exactly match an
invoice.

---

## Warehouse

### Snowflake
- **Rule:** the session `TIMEZONE` parameter, **which frequently defaults to
  America/Los_Angeles.**
- **Confirm:** `SHOW PARAMETERS LIKE 'TIMEZONE'` in the session you are
  actually using.
- **Goes wrong:** an organisation that believes its warehouse is UTC is
  producing Pacific day boundaries, including through daylight saving
  transitions, which makes two days a year have 23 or 25 hours.
- **Set it explicitly** in the connection, every time:
  ```sql
  ALTER SESSION SET TIMEZONE = 'UTC';
  ```

### BigQuery
- **Rule:** UTC by default. `TIMESTAMP` is absolute; `DATETIME` has no zone.
- **Confirm:** it is the default, but check for `AT TIME ZONE` conversions in
  view definitions, which is where a local zone sneaks in.
- **Goes wrong:** a view that converts to a local zone for one consumer, read
  by another consumer expecting UTC.

---

## BI

| Platform | Rule | Notes |
|---|---|---|
| **Looker** | per-query `query_timezone` | the most controllable; also means two Looks can disagree legitimately |
| **Tableau** | data source / server timezone, **no per-query override** | you cannot fix it at query time; it is a data source property. `TRUNC_WEEK` also follows the site's start-of-week. |
| **Power BI** | **service UTC versus Desktop local** | the same report shows different days in the browser and on a laptop. A frequent and confusing support ticket. |
| **Cube** | explicit `timezone` query parameter | good, as long as it is actually passed |

---

## Conversion patterns

### Convert at the boundary, once

Do the conversion where data enters the warehouse, store both, and never
convert again downstream.

```sql
select
  event_timestamp_utc,
  event_timestamp_utc at time zone 'America/New_York' as event_timestamp_local,
  date(event_timestamp_utc at time zone 'America/New_York') as event_date_local,
  'America/New_York' as source_timezone,
  'confirmed'        as timezone_status
from stg_source;
```

Storing the zone name and the status alongside the value is what makes the
downstream `provenance-block` possible.

### Do not compare a converted series to an unconverted one

The single most common practical failure. If one fact is bucketed on local
date and another on UTC date, a join on date is a join across a boundary shift,
and the error concentrates in the edge days, so short windows are hit hardest.

### Daylight saving

Two days a year have 23 or 25 hours in any zone that observes it. A
"same hour last week" comparison across a DST boundary compares different
hours. Where hourly comparison matters, compare on UTC instants and label the
local rendering.

---

## The confirmation probe

For each source, one call that establishes the zone. Run it, record the result
and the date.

| Source | Probe |
|---|---|
| GA4 | any Data API report; read `ResponseMetaData.timeZone` |
| Google Ads | `SELECT customer.time_zone FROM customer` |
| Meta | read the account object's timezone field |
| Salesforce | the integration user's `TimeZoneSidKey` |
| HubSpot | the property type (date vs datetime) plus portal settings |
| Klaviyo | account settings; and note which endpoint you are calling |
| Snowflake | `SHOW PARAMETERS LIKE 'TIMEZONE'` **in the live session** |
| BigQuery | default UTC; grep view definitions for `AT TIME ZONE` |
| Looker | the query object's `query_timezone` |
| Tableau | the data source's timezone property |
| Power BI | whether the number came from the service or from Desktop |
| Cube | whether the `timezone` parameter was passed |

A source with no probe run is `unconfirmed`, not `assumed`. **Assumed means
you have documentation; unconfirmed means you have nothing.**
