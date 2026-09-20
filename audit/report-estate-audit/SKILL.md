---
name: report-estate-audit
description: Use when taking over an unfamiliar analytics estate, before a BI migration or consolidation, or when asked which reports actually matter. Inventories every report, dashboard, Look, insight and scheduled delivery across the stack, joins each to its usage and its underlying definitions, and identifies duplicates, orphans, broken content and reports nobody has opened. Prevents an inventory that over-counts by including hidden sheets, soft-deleted content and recently-viewed-only lists.
---

# Report Estate Audit

The obvious "list the reports" call is wrong on several platforms, in both
directions. Some return a fraction of the estate, some return content that no
longer exists. An inventory built on the obvious call is wrong before anyone
looks at it.

---

## 1. Enumerate correctly, per platform

### Salesforce: the obvious call returns almost nothing

**`GET /analytics/reports` returns only up to 200 *recently-viewed* reports for
the running user.** An agent that "lists the reports" from it reports a
near-empty org.

**SOQL the `Report` object for the real catalogue:**
```sql
SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate,
       LastModifiedDate, OwnerId
FROM   Report
ORDER  BY FolderName, Name
```
Also note: report **execution** has a 2,000-row cap with no pagination, which
matters when you go on to read what a report returns.

### Tableau: the obvious call over-counts

**`List Views` includes hidden worksheets that back dashboards.** A dashboard
assembled from six worksheets appears as seven items. An inventory will wildly
over-count unless filtered to dashboards, or unless worksheets are attributed
to their parent dashboard.

Also: Tableau Cloud and Server content has a **30-day Recycle Bin**, and
content IDs stay resolvable for a window after deletion.

### Looker: the obvious call returns deleted content

**`search_looks` and `search_dashboards` return soft-deleted content
(`deleted: true`, roughly a 90-day trash) unless filtered.** Pass the filter
explicitly; the default is not what anyone expects.

`lookml_model_explore` returns an **`errors` block**: a broken model is a
finding, and an ignored errors block silently truncates the inventory.

### Power BI: two opposite problems

- **Admin scanner APIs can return items users can no longer see.**
- **Deleted Fabric items sit in a Recycle Bin** and may still appear.
- Scanner APIs need **Fabric Administrator**, are **asynchronous**, and are
  historically limited to roughly **16 workspace-scan requests per hour**.
  **Do not inventory a tenant with per-item calls**; batch workspaces into the
  scan request and poll.

### PostHog

**Insights created via the API can be unrenderable in the UI.** An inventory
that lists them as working content is wrong. Round-trip or flag any
API-created insight.

### Amplitude

**Chart IDs are opaque and come from the UI URL.** Discovery needs
`get_charts` / `search` rather than an enumerable ID space.

### The rest, briefly

| Platform | Note |
|---|---|
| **GA4** | Explorations have **no API at all**. They cannot be inventoried programmatically. Say so. |
| **Looker Studio** | `assets:search` lists assets; it **cannot read report content or configuration**. A name-only inventory. |
| **HubSpot** | no endpoint takes a report ID and returns rows; reports can be listed but not read |
| **Spreadsheets** | not enumerable. Ask, and list what you are told, marked as reported rather than discovered. |

---

## 2. Usage is the most informative column

| Source | Signal |
|---|---|
| **Looker System Activity** | query counts per Look, dashboard, explore, field, user |
| **Power BI usage metrics** | report and dashboard view counts per workspace |
| **Tableau view stats** | view counts; plus `downstreamDashboards` for structural usage |
| **dbt `exposures`** | which models feed which artefacts, with owner and URL |
| **Warehouse `QUERY_HISTORY` / `ACCESS_HISTORY`** | which objects are actually read, by which service account, how often |
| **BigQuery `JOBS_BY_PROJECT`** | referenced tables per job |

**A report nobody has opened in six months is a candidate for retirement
regardless of how good it looks.**

Two caveats before acting on that:

- **A scheduled delivery counts as usage** even with zero interactive views.
  Someone is receiving it. See §5.
- **Seasonal reports** exist: a board pack opened four times a year and an
  annual planning model are not orphans. Check the usage pattern, not just the
  count.

---

## 3. Duplicate detection works on the query, not the title

**Two dashboards with different names computing the same metric from the same
model are one dashboard.**

Cluster on:

1. **The underlying model or dataset.** Same source is the precondition.
2. **The metric set.** The same measures, from `metric-definition-audit`.
3. **The dimension set.** Same breakdowns.
4. **The filter set.** A "EMEA Revenue" and a "Revenue" dashboard differing
   only by one filter are a duplicate plus a parameter, not two dashboards.

Title similarity is a weak signal and should never be the clustering key. It
misses "Revenue Overview" versus "Exec Dashboard" computing identical things,
and it falsely clusters "Pipeline (Sales)" with "Pipeline (Marketing)" which
are frequently genuinely different.

---

## 4. Broken content is a finding, not noise

| Platform | Broken signature |
|---|---|
| **Looker** | `lookml_model_explore` returns a non-empty `errors` block |
| **Tableau** | content references retired fields; extract refresh failures |
| **Power BI** | reports bound to datasets that were refreshed away or deleted |
| **PostHog** | API-created insights the UI cannot render |
| **Any** | a scheduled delivery whose last run failed |

Broken content that is still scheduled is the worst case: it fails quietly,
and the recipient assumes no news is good news.

---

## 5. Scheduled deliveries are part of the estate

**They are frequently the only thing keeping a dead report alive.**

| Platform | What to inventory | Limit worth knowing |
|---|---|---|
| **Looker** | scheduled plans | |
| **Tableau** | subscriptions, and extract refresh tasks | |
| **Power BI** | subscriptions and scheduled refresh | |
| **Salesforce** | report subscriptions | **5 per user, and 5 notifications per user** |
| **Platform-native** | digest emails, Slack integrations | |

For each: recipients, cadence, last run status, and the artefact it delivers.
A retirement recommendation that does not account for the delivery list is
incomplete, because the people who will notice are not the people looking at
the dashboard.

---

## 6. Every artefact is joined to its metric definitions

**So a consolidation does not silently merge two different definitions into one
report.**

This is the failure that makes a tidy-up worse than the mess: two dashboards
are identified as duplicates on structure, merged, and the surviving one uses
one of the two definitions. Half the audience now gets a different number than
before, with no announcement.

Join every artefact to the metric definitions it renders, using
`metric-definition-audit`. Where two candidate duplicates use different
definitions, they are **not duplicates**; they are a definition divergence
wearing a duplicate's clothes, and the definition question is resolved first.

---

## 7. The inventory declares its own coverage

Which locations were reachable with the supplied credentials and which were
not. See `permission-effect-audit`.

```yaml
coverage:
  reached: [looker, tableau, salesforce]
  partial:
    - tableau: "Metadata API returned NODE_LIMIT_EXCEEDED; inventory is
                capped at 20,000 nodes. Paged by workbook for the top 40
                workbooks; the remainder is not enumerated."
  unreachable:
    - power_bi: "scanner APIs require Fabric Administrator; the supplied
                 credential is a workspace member"
  not_enumerable_by_design:
    - ga4_explorations: "no API exists"
    - looker_studio: "assets:search gives names only, no configuration"
    - spreadsheets: "not enumerable; 6 reported by name, unverified"
```

---

## 8. Output

```
inventory[]:
  artefact_name, artefact_type, platform, location, owner,
  last_viewed, view_count_90d, has_scheduled_delivery,
  underlying_model, metric_definitions_used[],
  status (live | broken | soft_deleted | unrenderable),
  is_hidden_worksheet: bool
duplicate_clusters[]:
  cluster_id, members[], clustering_basis,
  definitions_match: bool          # if false, this is NOT a duplicate
orphans[]:
  artefact, last_viewed, has_delivery, recommendation
broken[]:
  artefact, failure, evidence, still_scheduled: bool
deliveries[]:
  artefact, platform, recipients, cadence, last_run_status
consolidation_recommendation:
  keep[], retire[], merge[], blocked_pending_definition_decision[]
coverage: (see §7)
```

---

## 9. Answering

**Answer first.** Lead with the counts that drive a decision: "412 artefacts;
68 have not been opened in six months, 31 of those have an active scheduled
delivery so somebody is still receiving them; 24 are duplicates in 9 clusters;
11 are broken and 4 of those are still scheduled."

**Give the inventory even when coverage is partial**, with the coverage block
attached. A partial inventory of a 400-artefact estate is the most useful thing
anyone has had in years; withholding it pending complete credentials helps
nobody.

Withhold only: a claim that the inventory is complete, when it is not. And
never present a count built on a recently-viewed list, hidden worksheets or
soft-deleted content as the estate size. **State the enumeration method
alongside the count**, because the count is only interpretable with it.

## References

- `references/enumeration-per-platform.md` — the correct calls, the wrong ones,
  and what each returns
- `references/duplicate-and-orphan-detection.md` — clustering, usage
  thresholds, and the consolidation decision

## Related skills

- `metric-definition-audit` supplies the definitions each artefact renders.
- `data-lineage-tracer` supplies the model-to-artefact edges and blast radius.
- `permission-effect-audit` supplies the coverage declaration.
