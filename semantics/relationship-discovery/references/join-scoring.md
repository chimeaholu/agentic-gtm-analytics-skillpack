# Join scoring, profiling and path search

## 1. The scoring model

```
confidence(edge) = base(source) × adjustments
cost(edge)       = 1 / confidence(edge) × cardinality_penalty
```

### Base confidence by source

| Source | Base |
|---|---|
| Looker explore `joins` (relationship + `sql_on`) | 0.95 |
| Power BI `INFO.RELATIONSHIPS()` | 0.95 |
| dbt entity `primary` ↔ `foreign` match | 0.90 |
| Snowflake `SEMANTIC_RELATIONSHIPS` | 0.90 |
| Cube `joins` in model files | 0.90 |
| dbt `relationships` test (passing) | 0.85 |
| BigQuery `TABLE_CONSTRAINTS` declared | 0.70 |
| Observed in ≥20 production queries | 0.60 |
| Observed in 1-19 production queries | 0.45 |
| Value-overlap profiling, high overlap and right-unique | 0.50 |
| Naming convention only | 0.30 |
| Fuzzy name or domain similarity | **prohibited, not scored** |

### Adjustments

| Condition | Effect |
|---|---|
| profiled cardinality matches the declared one | × 1.0 |
| profiled cardinality **contradicts** the declared one | **× 0.4 and raise a finding** |
| key overlap below 50% of the left side's distinct keys | × 0.7 |
| key column is nullable and >5% null | × 0.8 |
| edge crosses systems with no maintained mapping field | × 0.6 |
| dbt `relationships` test currently failing | × 0.5 |

### Cardinality penalty on cost

| Cardinality | Penalty |
|---|---|
| one-to-one | 1.0 |
| many-to-one (fact to dimension) | 1.0 |
| one-to-many | 2.0 |
| many-to-many | 5.0 |

The penalty is on **cost**, not confidence. A many-to-many edge can be
perfectly well evidenced; it is still an expensive way through the graph
because it needs an aggregation step before the measure is safe.

---

## 2. Profiling queries

### Uniqueness

```sql
select
  count(*)                              as rows,
  count(k)                              as non_null_keys,
  count(distinct k)                     as distinct_keys,
  count(*) - count(distinct k)          as duplicate_rows,
  1.0 * count(k) / nullif(count(*),0)   as fill_rate
from t;
```

`fill_rate` below 0.95 on a join key is a finding in itself: the unmatched rows
are not random, they are the records that predate a field being made required.

### Overlap

```sql
select
  (select count(distinct k) from a)                       as a_keys,
  (select count(distinct k) from b)                       as b_keys,
  (select count(*) from
     (select distinct k from a intersect select distinct k from b)) as shared,
  1.0 * (select count(*) from
     (select distinct k from a intersect select distinct k from b))
      / nullif((select count(distinct k) from a),0)       as a_coverage;
```

`a_coverage` is the ceiling on how many left rows can ever match. If it is
0.61, no amount of join tuning gets you past 61%, and the right answer is to
find the missing key rather than to run the join and hope.

### Format sanity, before you trust an overlap

Two columns can overlap by value and still not be the same thing: an
`account_id` that is an 18-character Salesforce ID and an `account_id` that is
a numeric MAP internal ID will show 0% overlap even though the relationship is
real. Conversely, two sequential integer surrogate keys from different systems
will overlap heavily and mean nothing.

```sql
select min(length(k)), max(length(k)),
       count(*) filter (where k ~ '^[0-9]+$')        as numeric_like,
       count(*) filter (where k ~ '^[a-zA-Z0-9]{15,18}$') as sfid_like
from t;
```

**High overlap between two sequential-integer columns is the classic false
positive.** Check the format before scoring the overlap.

---

## 3. Path search, worked

Question: revenue by marketing channel. Tables required: `fact_order` and
`dim_channel`. Neither joins to the other directly.

Available edges:

| From | To | Key | Source | Confidence |
|---|---|---|---|---|
| `fact_order` | `dim_person` | `person_id` | dbt entity primary↔foreign | 0.90 |
| `dim_person` | `fact_touchpoint` | `person_id` | dbt entity primary↔foreign | 0.90 |
| `fact_touchpoint` | `dim_campaign` | `campaign_id` | naming convention | 0.30 |
| `dim_campaign` | `dim_channel` | `channel_key` | dbt `relationships` test, passing | 0.85 |
| `fact_order` | `dim_campaign` | `utm_campaign` string | value overlap 0.41 | 0.50 × 0.7 = 0.35 |

**Path A:** order → person → touchpoint → campaign → channel
- cost: 1/0.9 + 1/0.9 (×2.0, one-to-many) + 1/0.3 + 1/0.85 = 1.11 + 2.22 + 3.33 + 1.18 = **7.84**
- min_confidence: **0.30** (the naming-convention edge)

**Path B:** order → campaign → channel
- cost: 1/0.35 + 1/0.85 = 2.86 + 1.18 = **4.04**
- min_confidence: **0.35**

Path B is cheaper and marginally better evidenced, but **both paths are weak
and the weak edge is different in each**. The honest output is not "use path
B"; it is:

```
Both available paths are inferred, not discovered.
Path B (order -> campaign via utm_campaign string) has the lower cost but
41% key overlap, so at most 41% of orders can be attributed to a campaign.
Path A depends on an unevidenced campaign_id join and additionally fans out
through the one-to-many person-to-touchpoint edge, so order amounts would
need aggregating before the join.

Computable now: revenue by channel for the 41% of orders with a resolvable
utm_campaign, stated as a lower bound and as a biased sample (orders with
utm tags skew to paid).
Resolving change: a campaign_id foreign key on fact_order, or a maintained
utm-to-campaign mapping table.
```

That output is more useful than either number alone, and it still contains a
number.

---

## 4. Coverage disclosure template

Run this for every edge actually executed and put the result in the answer.

```sql
with right_counts as (
  select key, count(*) as n from right_table group by 1
)
select
  count(*)                                                as left_rows,
  count(r.key)                                            as matched,
  count(*) - count(r.key)                                 as unmatched,
  count(*) filter (where r.n > 1)                         as ambiguous,
  sum(l.amount)                                           as left_total,
  sum(l.amount) filter (where r.key is null)              as unmatched_total,
  sum(l.amount) filter (where r.n > 1)                    as ambiguous_total
from left_table l
left join right_counts r on l.key = r.key;
```

Then say it in one sentence:

> Matched 94% of opportunities carrying 99% of the amount. The 6% unmatched
> are concentrated in records created before the CRM migration and total
> [amount]. The number below excludes them, so it is a lower bound.

**Ambiguous rows are the ones people forget.** An ambiguous row is not a
matched row; joining it multiplies the left measure. Either resolve the
ambiguity with a stated rule (primary flag, most recent, highest amount) or
aggregate the right side first.

---

## 5. When the profiled cardinality contradicts the declared one

This is a finding, not a scoring adjustment to quietly apply.

```
FINDING: the Looker explore declares
  join: contacts { relationship: many_to_one }
but profiling dim_contact shows 12,400 rows over 11,980 distinct contact_ids
(420 duplicate rows). The declared relationship is wrong for the current data.

Effect: any measure on the left side is over-stated by roughly 3.5% through
this join, and the error is not uniform, because the duplicated contacts are
concentrated in one source system.

Resolve: deduplicate dim_contact with a stated rule, or change the declared
relationship and handle the many side by aggregation.
```

Report it to whoever owns the model. A wrong declared cardinality poisons every
query anyone runs through that explore, not just yours.
