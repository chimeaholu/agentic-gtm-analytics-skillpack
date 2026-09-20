# Enumeration per platform: the right call and the wrong one

The pattern across this whole file: **the obvious call is wrong on several
platforms, in both directions.** Some return a fraction of the estate, some
return content that no longer exists.

---

## Salesforce

### Wrong
```
GET /services/data/vXX.X/analytics/reports
```
Returns **only up to 200 recently-viewed reports for the running user**. In an
org with 3,000 reports this returns a near-empty list, and it returns a
*different* list for a different user. An inventory built on it is not a
sample; it is a record of what one person opened recently.

### Right
```sql
SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate,
       LastModifiedDate, CreatedDate, OwnerId, Description
FROM   Report
ORDER  BY FolderName, Name
```

Dashboards similarly:
```sql
SELECT Id, Title, DeveloperName, FolderName, LastModifiedDate, RunningUserId
FROM   Dashboard
```

**`Dashboard.RunningUserId` is worth capturing**: a dashboard's numbers depend
on the running user's sharing, so two dashboards on the same report can show
different figures legitimately. See `permission-effect-audit`.

### Related limits
- Report **execution** has a **2,000-row cap with no pagination**. A report
  returning more is truncated, and the truncated result is a **lower bound**,
  not a total.
- Report subscriptions: **5 per user, and 5 notifications per user**.

---

## Tableau

### Wrong
```
GET /api/3.x/sites/{site-id}/views
```
**`List Views` includes hidden worksheets that back dashboards.** A dashboard
built from six worksheets appears as seven items, so an estate of 200
dashboards can enumerate as 1,400 "views".

### Right

Enumerate workbooks, then dashboards within them, and attribute worksheets to
their parent:

```graphql
{
  workbooks {
    id name projectName owner { name email }
    dashboards { id name }
    sheets { id name }          # worksheets: attribute to parent, do not count
  }
}
```

Or use `GET /views?filter=sheetType:eq:dashboard` where the filter is
supported.

### Also
- **30-day Recycle Bin**; content IDs stay resolvable for a window after
  deletion, so a deleted dashboard can still be fetched by ID.
- Metadata API is capped at **20,000 nodes** with `NODE_LIMIT_EXCEEDED` for
  partial results, **permission-filtered with no error**, **asynchronously
  indexed**, and **must be explicitly enabled on Tableau Server**.
- View stats give view counts; `downstreamDashboards` gives structural usage
  where counts are unavailable.

---

## Looker

### Wrong
```
GET /api/4.0/looks/search
GET /api/4.0/dashboards/search
```
without a deleted filter. **These return soft-deleted content (`deleted: true`,
roughly a 90-day trash) by default.** An estate inventory inflates by however
much was deleted in the last quarter.

### Right
```
GET /api/4.0/looks/search?deleted=false&fields=id,title,folder,user_id,
    last_accessed_at,view_count,query_id
GET /api/4.0/dashboards/search?deleted=false
```

### Also
- `lookml_model_explore` returns an **`errors` block**. A non-empty block means
  a broken model, which returns fewer fields and **silently truncates the
  inventory**. Read it on every explore.
- **System Activity** is the usage source: query counts per Look, dashboard,
  explore, field and user. The best usage data in the stack.
- **Scheduled plans** are a separate enumeration and are frequently the only
  thing keeping a Look alive.

---

## Power BI / Fabric

### Wrong
Per-item enumeration across a tenant. **Admin scanner APIs are historically
limited to roughly 16 workspace-scan requests per hour.** A loop over 340
workspaces rate-limits long before it finishes and produces a partial inventory
that looks complete.

### Right
```
POST /admin/workspaces/getInfo          # batch workspaces into one request
GET  /admin/workspaces/scanStatus/{id}  # poll
GET  /admin/workspaces/scanResult/{id}  # fetch
```
Preceded by `GET /admin/workspaces/modified` to scope to what changed.

Requires **Fabric Administrator**. Asynchronous throughout.

### Also
- **Scanner APIs can return items users can no longer see.**
- **Deleted Fabric items sit in a Recycle Bin** and may still appear.
- Usage metrics per workspace give view counts.
- **Report-level content is not in the semantic model**: report-level measures,
  implicit measures and visual filters live in the report artefact. An
  inventory that stops at the model misses where numbers are shaped.

---

## PostHog

```
GET /api/projects/{id}/insights/
GET /api/projects/{id}/dashboards/
```

**Insights created via the API bypass UI validation, so it is possible to have
an insight the UI cannot render.** An inventory that lists these as working
content is wrong. Flag any API-created insight as `status: unrenderable` until
round-tripped.

---

## Amplitude

**Chart IDs are opaque and come from the UI URL**, so there is no enumerable ID
space to walk. Discovery needs `get_charts` / `search`.

Note also that **Amplitude's Dashboard REST API cannot create charts or
dashboards** (Amplitude's own documentation), so an inventory here is read-only
by construction.

---

## Not enumerable, state it plainly

| Surface | Status |
|---|---|
| **GA4 Explorations** | **no API at all.** They cannot be inventoried programmatically. |
| **Looker Studio reports** | `assets:search` gives names and permissions. It **cannot read report content or chart configuration.** A name-only inventory. |
| **HubSpot custom reports** | can be listed; **no endpoint takes a report ID and returns rows** |
| **Marketo reports** | **no reporting API of any kind** |
| **Pardot / MCAE report objects** | none; B2B Marketing Analytics needs a separate CRM Analytics licence |
| **Snowsight dashboards** | not meaningfully exposed via public API |
| **Spreadsheets** | not enumerable. Ask, list what you are told, mark as reported rather than discovered. |

**An estate audit that omits these surfaces without saying so will be read as
complete.** List them in `not_enumerable_by_design` with the reason.

---

## Warehouse-side usage, which covers what the BI APIs miss

### Snowflake
```sql
select
  value:objectName::string as object_name,
  count(*)                 as reads,
  count(distinct user_name) as distinct_users,
  max(query_start_time)    as last_read
from   snowflake.account_usage.access_history,
       lateral flatten(base_objects_accessed)
where  query_start_time > dateadd('day', -180, current_timestamp())
group by 1 order by reads desc;
```

### BigQuery
```sql
select ref.dataset_id, ref.table_id, count(*) jobs, max(creation_time) last_job
from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT, unnest(referenced_tables) ref
where creation_time > timestamp_sub(current_timestamp(), interval 180 day)
group by 1,2 order by jobs desc;
```

This catches the artefacts the BI inventory missed: a table read four hundred
times a month by a service account that belongs to a tool nobody mentioned.

---

## The enumeration-method footnote

**State the enumeration method alongside every count**, because the count is
only interpretable with it.

```
Salesforce: 3,114 reports (SOQL on the Report object, full catalogue)
            NOT the 200 that /analytics/reports returns
Tableau:    214 dashboards (workbook-scoped, hidden worksheets excluded)
            1,402 views would be the figure from List Views, which is wrong
Looker:     88 dashboards, 340 Looks (deleted=false)
            412 Looks including soft-deleted, which is not the estate
Power BI:   partial. 61 of 340 workspaces scanned before the hourly scan
            limit; the remainder is not enumerated.
```

A count without its method is the finding most likely to be quoted back
incorrectly for the next two years.
