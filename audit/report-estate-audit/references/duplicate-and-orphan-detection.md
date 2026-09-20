# Duplicate and orphan detection, and the consolidation decision

---

## 1. Duplicate clustering

**Cluster on what the artefact computes, not on what it is called.**

### The clustering key

```
cluster_key = hash(
  sorted(underlying_models),
  sorted(metric_definitions_used),
  sorted(dimensions_used),
  sorted(filters_applied)
)
```

Two artefacts with the same key are computing the same thing from the same
place. That is a duplicate regardless of title, owner or folder.

### Near-duplicates, which are more common

Relax one component at a time and record which:

| Relaxed component | Interpretation |
|---|---|
| filters only | **one dashboard plus a parameter**, not two dashboards |
| dimensions only | one dashboard with an extra breakdown |
| models only | same metrics from different sources; **this is a reconciliation question, not a duplicate** |
| **metric definitions differ** | **NOT a duplicate.** See §2. |

### Why title similarity fails

- Misses: "Revenue Overview" and "Exec Dashboard" computing identical things.
- Falsely clusters: "Pipeline (Sales)" and "Pipeline (Marketing)", which are
  frequently genuinely different, at different grains, for different audiences.

Use title similarity as a hint for human review, never as the clustering key.

---

## 2. The rule that stops a consolidation making things worse

**If two candidate duplicates use different metric definitions, they are not
duplicates.**

They are a definition divergence wearing a duplicate's clothes. Merging them
silently picks one definition, and half the audience starts getting a different
number with no announcement. That is how a tidy-up destroys trust more
efficiently than the mess did.

```
cluster_id: c7
members: ["Revenue Overview", "Exec Dashboard"]
clustering_basis: same model, same dimensions, same filters
definitions_match: FALSE
  Revenue Overview uses win_rate v1 (close-date, no-decision as Lost)
  Exec Dashboard   uses win_rate v2 (no-decision excluded)
status: blocked_pending_definition_decision
```

Route it to `metric-definition-audit`, resolve the definition, then
consolidate. Not the other way round.

---

## 3. Orphan detection

### The threshold

**A report nobody has opened in six months is a candidate for retirement
regardless of how good it looks.**

Candidate, not a decision. Three checks before acting.

### Check 1: is there a scheduled delivery?

**A scheduled delivery counts as usage even with zero interactive views.**
Someone is receiving it, and they will notice. Inventory:

| Platform | Deliveries |
|---|---|
| Looker | scheduled plans |
| Tableau | subscriptions, extract refresh tasks |
| Power BI | subscriptions, scheduled refresh |
| Salesforce | report subscriptions (**5 per user, 5 notifications per user**) |
| Platform-native | digest emails, Slack integrations |

Capture recipients, cadence and last run status for each.

### Check 2: is the usage seasonal rather than absent?

A board pack opened four times a year and an annual planning model are not
orphans. Look at the **pattern**, not the count:

```sql
select artefact, date_trunc('month', viewed_at) as m, count(*) views
from   usage
where  viewed_at > current_date - interval '24 months'
group by 1,2;
-- regular quarterly or annual spikes: seasonal, keep
-- a cliff to zero on a date: genuinely abandoned, and the date is a clue
```

A cliff to zero on a specific date is usually a person leaving or a process
changing, and that date is worth knowing before retirement.

### Check 3: is it upstream of something else?

An artefact nobody opens may feed something that is opened: an embedded view,
a reverse-ETL source, a spreadsheet connector. Check `data-lineage-tracer`
downstream edges, **including unevidenced ones**, before retiring it.

---

## 4. Broken content

| Platform | Signature |
|---|---|
| **Looker** | non-empty `errors` block from `lookml_model_explore` |
| **Tableau** | references to retired fields; failed extract refreshes |
| **Power BI** | reports bound to datasets refreshed away or deleted |
| **PostHog** | API-created insights the UI cannot render |
| **Any** | a scheduled delivery whose last run failed |

**Broken and still scheduled is the worst case.** It fails quietly and the
recipient assumes no news is good news. Sort broken content by
`still_scheduled` descending; those are the ones to fix first, regardless of
view counts.

---

## 5. The consolidation recommendation

Four buckets, and the fourth is the one that keeps a consolidation honest.

```yaml
keep:
  - artefact, reason (usage, exclusivity, ownership)
retire:
  - artefact, last_viewed, deliveries_to_migrate[], owner_to_notify
merge:
  - cluster_id, survivor, absorbed[], definitions_match: true,
    deliveries_to_repoint[]
blocked_pending_definition_decision:
  - cluster_id, members[], the definition difference, who decides
```

For every `retire` and `merge`, the deliveries must be migrated or repointed
explicitly. **A retirement that drops a subscription is a silent outage for
whoever was receiving it**, and they find out by the absence of an email they
had stopped consciously noticing.

---

## 6. Sizing the estate honestly

State the enumeration method with the count. Always.

```
412 artefacts total:
  Salesforce   3,114 reports (SOQL on Report; NOT the 200 from
                              /analytics/reports)
  Tableau        214 dashboards (hidden worksheets excluded; List Views
                              would report 1,402, which is wrong)
  Looker      88 dashboards + 340 Looks (deleted=false; 412 Looks
                              including soft-deleted, which is not the estate)
  Power BI    partial: 61 of 340 workspaces scanned before the hourly
                              scan limit
```

Then the decision-driving counts:

```
68 not opened in 6 months
  of which 31 have an active scheduled delivery
24 duplicates across 9 clusters
  of which 3 clusters are blocked on a definition decision
11 broken
  of which 4 are still scheduled
```

**Lead with these, not with the inventory table.** The table is the evidence;
the counts are the answer.
