---
name: relationship-discovery
description: Use when a question spans tables and the join path is not declared — no foreign keys, no semantic layer, or a semantic layer that hides join conditions. Discovers candidate relationships from declared constraints, naming conventions, value-overlap profiling and observed query history, scores each edge, and resolves the cheapest path as a scored graph search that carries the minimum confidence along the path. Classifies every join's rows as matched, unmatched or ambiguous and discloses the remainders. Prevents an agent inventing a join and prevents fuzzy name or domain matching being used as an identity key.
---

# Relationship Discovery

A join is a claim that two rows describe the same thing. An unevidenced join is
an unevidenced claim, and it does not fail loudly: it multiplies revenue, or it
drops a third of the rows, and the number looks fine.

---

## 1. Declared beats inferred, in a fixed precedence

| Rank | Source | What you get | Confidence |
|---|---|---|---|
| 1 | **Looker explore `joins`** | `relationship` (cardinality), `sql_on`, `type`, `foreign_key` | 0.95 |
| 2 | **Power BI `INFO.RELATIONSHIPS()`** | from/to columns, cardinality, **cross-filter direction**, `IsActive` | 0.95 |
| 3 | **dbt entity types** | `primary` / `foreign` / `unique` / `natural`; MetricFlow resolves joins by matching primary to foreign | 0.9 |
| 4 | **Snowflake `SEMANTIC_RELATIONSHIPS`** | declared relationships on a semantic view | 0.9 |
| 5 | **Cube `joins` in model files** | `relationship` and `sql` | 0.9 |
| 6 | **dbt `relationships` tests** | a declared foreign key in everything but name, **and it is tested** | 0.85 |
| 7 | **BigQuery `TABLE_CONSTRAINTS` / `KEY_COLUMN_USAGE`** | PK/FK **when declared**; BigQuery does not enforce them | 0.7 |
| 8 | **Observed query history** | joins the business actually runs | 0.6 |
| 9 | **Value-overlap profiling** | key candidates by distribution | 0.5 |
| 10 | **Naming convention** | `account_id` in two tables | 0.3 |

**Everything from rank 7 down is labelled `inferred` in the output.** The
distinction between discovered and inferred is not pedantry; it is the
difference between "the model says these join" and "these two columns look
alike".

Run `semantic-layer-introspector` first. Most of ranks 1 to 6 arrive free from
it.

---

## 2. Join path as a scored graph search

Treat discovered relationships as a weighted graph. Nodes are tables, edges are
relationships with a confidence and a cost.

```
cost(edge)  = 1 / confidence(edge), with a penalty for many-to-many
path_cost   = Σ cost(edge)
path_confidence = MIN(confidence(edge)) over the path
```

**Carry the minimum confidence along the path as the confidence of the whole
join. A chain is only as trustworthy as its weakest edge.** A four-hop path
through three declared edges and one naming-convention guess is a 0.3
confidence path, not a 0.85 one.

Search for the cheapest path connecting the required tables, then report:

```
join_path:
  edges: [ {from, to, key, cardinality, confidence, declared|inferred, source} ]
  total_cost: 4.7
  min_confidence: 0.3
  weakest_edge: "fact_touchpoint.email -> dim_person.email (naming convention)"
```

If `min_confidence` is below your threshold, **say which edge is the problem**
rather than reporting a low overall confidence with no locus.

---

## 3. Matched / unmatched / ambiguous is mandatory

Every join used in an answer classifies its rows and **discloses the
remainders**.

| Class | Meaning |
|---|---|
| matched | exactly one row on the right |
| unmatched | zero rows on the right |
| ambiguous | more than one row on the right, when one was expected |

```sql
select
  count(*)                                              as left_rows,
  count(r.key)                                          as matched_rows,
  count(*) - count(r.key)                               as unmatched_rows,
  sum(case when r.n > 1 then 1 else 0 end)              as ambiguous_rows,
  sum(l.amount)                                         as left_amount,
  sum(case when r.key is null then l.amount else 0 end) as unmatched_amount
from left_table l
left join (select key, count(*) n from right_table group by 1) r
  on l.key = r.key;
```

**`unmatched_amount` is the field that matters.** 8% of rows unmatched sounds
tolerable until those rows carry 40% of the revenue, which is the usual shape:
big accounts have messier records.

**A join that matched 62% of rows and was reported as if it matched all of them
is a wrong number with no warning attached.** The remainders go in the answer,
not in a log.

---

## 4. Deterministic key precedence, and one prohibition

Joins run only through a declared precedence of deterministic keys. For GTM
identity, typically:

1. platform-native primary key (`opportunity_id`, `contact_id`)
2. cross-system mapping key deliberately maintained (`crm_id` on the MAP record)
3. normalised email (lowercased, plus-addressing stripped only if you have
   decided that policy and written it down)
4. a hashed user identifier passed through the stack
5. a deterministic cookie-to-user binding captured at login

**Fuzzy name or email-domain similarity matching is prohibited outright.**

Two companies at `acme.com` are not necessarily the same account: shared
domains, subsidiaries, resellers and free-mail domains all break it. Name
similarity is worse. "Acme Corp" and "Acme Corporation" may be the same
company; "Acme Holdings" may be a different legal entity with a different
contract. A similarity score above a threshold is not evidence, it is a guess
with a decimal point on it.

Where deterministic keys genuinely do not exist, the answer is `unavailable`
for the joined question, plus **the marginal totals from each side separately**,
plus the specific change that would resolve it (a shared key, an identity
resolution step, a CRM mapping field).

**A monetary amount is never multiplied across multiple touches.** If four
touches preceded a deal, the deal amount is not four times anything. Credit
allocation is an attribution decision with a stated model; see
`attribution-rule-based`.

---

## 5. Cardinality checks before trusting a path

Profile the keys before you join, not after you get a strange total.

```sql
-- uniqueness on each side
select count(*) rows, count(distinct k) keys, count(*) - count(distinct k) dupes
from   t;

-- overlap, which tells you whether the join is even plausible
select
  (select count(distinct k) from a)                                as a_keys,
  (select count(distinct k) from b)                                as b_keys,
  (select count(distinct a.k) from a join b on a.k = b.k)          as shared_keys;
```

| Left dupes | Right dupes | Actual cardinality | Risk |
|---|---|---|---|
| no | no | one-to-one | safe |
| yes | no | many-to-one | safe, this is the normal fact-to-dimension shape |
| no | yes | one-to-many | **left measures will fan out** |
| yes | yes | many-to-many | **both sides fan out; do not join directly** |

**A many-to-many edge presented as many-to-one is the fan-out that multiplies
revenue.** A declared `many_to_one` in LookML or `INFO.RELATIONSHIPS()` is a
claim about the model, not a guarantee about the data. Where the number
matters, verify it.

Power BI is the only platform here that also gives **cross-filter direction**.
Record it. A bidirectional relationship produces totals that change depending
on what else is filtered, and is a frequent cause of "the number is different
on this page".

---

## 6. Empirical lineage where declared lineage is absent

When nothing is declared, look at what the business actually runs. Observed
joins are weaker evidence than a declared model but stronger than a naming
convention, and they have one advantage over declared lineage: they cannot
drift from reality.

**Snowflake** `ACCOUNT_USAGE.ACCESS_HISTORY` gives `base_objects_accessed` and
`objects_modified`, which is real column-level lineage derived from actual
query execution. `QUERY_HISTORY` tells you which tables matter and how often.

**BigQuery** `INFORMATION_SCHEMA.JOBS_BY_PROJECT` with `UNNEST(referenced_tables)`
gives the tables each job touched. Dataplex's lineage API harvests the same
thing at table and column level.

**Looker** System Activity gives explore and field usage.

Parse the observed SQL for `JOIN ... ON` clauses, count how often each column
pair appears, and treat a pair used in fifty production queries as a much
stronger candidate than one that merely shares a name.

Two caveats worth carrying: zero-copy clones make `ACCESS_HISTORY` show the
clone rather than the origin, and BigQuery `_TABLE_SUFFIX` wildcards silently
include tables nobody meant to reference.

---

## 7. Platform gaps, stated honestly

| Platform | Gap |
|---|---|
| **Tableau** | does not expose join keys, cardinality or referential-integrity settings. `logicalTableId` hints at the logical table and no more. The options are inference or parsing `.twb` XML. **The better option is usually not to join at all: query through VizQL Data Service and let Tableau resolve its own joins.** |
| **BigQuery** | without declared constraints this is inference, not discovery. Most teams have declared nothing, and BigQuery does not enforce constraints even when declared. |
| **Cube** | `joins` live in model files, not in `/v1/meta`. Without repo access you do not have the join graph. |
| **GA4, ad platforms** | no join graph exists at all; these are extract-only and cross-platform joins happen in your model, at your risk. |

**Say which one you did.** "Discovered from the Looker explore join graph" and
"inferred from a shared column name" are different claims and the answer must
distinguish them.

---

## 8. Output

```
join_path:
  edges[]:
    from_table, from_column, to_table, to_column,
    cardinality, cross_filter_direction,
    confidence, declared: bool, source, evidence
  total_cost, min_confidence, weakest_edge
coverage[]:                     # one per edge actually executed
  edge, left_rows, matched, unmatched, ambiguous,
  left_measure_total, unmatched_measure_total
label: "discovered" | "inferred, not discovered"
prohibited_paths[]:             # what was rejected and why
```

`prohibited_paths` earns its place: recording that a name-similarity join was
considered and rejected stops the next run from quietly trying it.

---

## 9. Answering

**Answer first.** Where a path exists at acceptable confidence, run it and
report the number with the coverage figures attached, in plain language:
"matched 94% of opportunities carrying 99% of the amount; the 6% unmatched are
concentrated in records created before the CRM migration."

**Where the only available path runs through a prohibited edge**, the joined
number is `unavailable`. Give the marginal totals from each side, say exactly
which key is missing, and name the change that would create it. That is a
genuine withhold: the number cannot honestly be computed, not merely misread.

**Never report a joined number with the remainders undisclosed**, even when
coverage is high. High coverage stated is useful; coverage not stated is a
number nobody can check.

## References

- `references/join-scoring.md` — the scoring model, profiling queries and
  worked path searches
- `references/identity-keys.md` — deterministic key precedence for GTM, and
  why fuzzy matching is prohibited

## Related skills

- `semantic-layer-introspector` supplies the declared edges.
- `identity-resolution` owns the person and account spine; this skill does not
  invent one.
- `data-model-designer` for where fan-out comes from structurally.
- `cross-system-reconciliation` consumes the coverage figures.
