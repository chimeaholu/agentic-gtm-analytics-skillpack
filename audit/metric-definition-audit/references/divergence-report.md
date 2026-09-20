# Computing and presenting divergence

---

## 1. The divergence record

One per pair of locations that implement the same metric differently.

```yaml
metric_key: win_rate
locations:
  A: {system: bi_tool, location: "Revenue Overview / tile 3", owner: revops}
  B: {system: warehouse, location: "analytics.marts.metric_win_rate", owner: analytics}

difference_dimension: denominator      # see the eight below
detail:
  A: "Won / (Won + Lost)"
  B: "Won / (Won + Lost + No Decision)"

numeric_impact:
  window: "2026-Q2"
  same_source_rows: true
  A_value: 0.312
  B_value: 0.248
  delta: -0.064
  delta_unit: "percentage points"
  driver: "412 opportunities in stage Closed - No Decision"

verdict: both_defensible          # see §4
recommendation: "..."
evidence: ["lookml measure block", "view DDL", "recomputation query"]
```

## 2. The eight difference dimensions, in frequency order

1. **Denominator population.** By a distance the most common and the most
   consequential. Includes: excluded stages, excluded sources, test-record
   filters, active-only filters, and restrictions hidden in a `WHERE`.
2. **Date basis.** Created, entered-stage, close, booked, recognised, event
   time versus load time.
3. **Filters.** Internal accounts, deleted or soft-deleted rows, a region
   exclusion someone added in 2023.
4. **Grain.** Person versus account versus opportunity versus buying group.
5. **Aggregation.** Count versus dollar-weighted; mean versus median; distinct
   versus non-distinct; approximate distinct versus exact.
6. **Time window** and whether the incomplete last period is included.
7. **Currency and FX.** Which rate, on which date, applied where.
8. **Attribution model**, for anything with "attributed" in its name.

## 3. Computing the numeric impact

**Recompute both definitions against the same source rows.** This is the step
that turns a divergence into something that gets fixed.

```sql
with base as (
  select * from analytics.marts.mart_opportunity
  where close_date between date '2026-04-01' and date '2026-06-30'
),
defn_a as (
  select
    count(*) filter (where stage = 'Closed Won')                    as num,
    count(*) filter (where stage in ('Closed Won','Closed Lost'))    as den
  from base
),
defn_b as (
  select
    count(*) filter (where stage = 'Closed Won')                    as num,
    count(*) filter (where stage in ('Closed Won','Closed Lost',
                                     'Closed - No Decision'))        as den
  from base
)
select
  a.num*1.0/nullif(a.den,0)                     as definition_a,
  b.num*1.0/nullif(b.den,0)                     as definition_b,
  a.num*1.0/nullif(a.den,0) - b.num*1.0/nullif(b.den,0) as delta,
  b.den - a.den                                 as rows_driving_the_delta
from defn_a a cross join defn_b b;
```

Three requirements on this query:

- **Same source rows** for both definitions. If the two implementations read
  different tables, that is itself a finding and must be reported before any
  numeric comparison is attempted.
- **Same window, same load.** A numerator and denominator from different loads
  is the trap that makes every rate move for no reason; the same applies when
  comparing two definitions.
- **Report the row count driving the delta**, not just the delta. "6.4 points"
  is an argument; "412 no-decision opportunities" is a fact people can check.

**Where recomputation is not possible** (no warehouse access, the definition is
in a platform you cannot query at row level), say so and give the qualitative
divergence plus the specific access that would make it computable. Do not
estimate a numeric impact you cannot compute and present it as measured.

## 4. Verdicts

| Verdict | Meaning | What the recommendation does |
|---|---|---|
| `one_is_wrong` | one implementation does not match any defensible definition, usually a bug | fix it, and name the bug |
| `both_defensible` | the industry genuinely disagrees | pick one, state which, and note what each implies |
| `different_questions` | they are not the same metric at all | rename one, stop comparing them |
| `same_definition_different_data` | definitions agree, the sources differ | this is `cross-system-reconciliation`, not a definition audit |
| `undeterminable` | the credential cannot read one of them | blind spot, not a finding |

The `different_questions` verdict is underused and often correct. Cohort win
rate and close-date win rate are not two implementations of one metric; they
are two metrics with one name, and the fix is naming, not consolidation.

## 5. The canonical-definition recommendation

Four required parts. A recommendation missing any of them is an opinion.

```
recommended: definition B (no-decision included in the denominator)

because:
  - it is the definition finance uses in the board pack, so consolidating on it
    avoids restating the external number
  - it is queried 340 times in the last 90 days versus 12 for definition A
    (QUERY_HISTORY)
  - it answers the question the exec team actually asks, which is "when a
    customer made a decision, did they pick us"

cost to consolidate:
  - 3 BI tiles rebind to the warehouse view
  - one historical restatement: reported win rate falls ~6pp across the whole
    series, which must be communicated before it appears
  - the no-decision stage value must be populated going forward; it is blank
    on 31% of closed-lost records

alternatives NOT chosen, and why they remain defensible:
  - close-date basis without no-decision answers "of deals that closed, how
    many did we win", which is the right denominator for a quota conversation
  - cohort basis answers "of deals we start, how many will we win", which is
    the right denominator for capacity planning
```

**Where the industry genuinely disagrees, the recommendation presents the
alternatives rather than asserting one.** NRR conventions, ACV, win-rate
denominators, CM2 versus CM3, LTV horizon. In those cases the deliverable is a
decision framed for a human, not a decision made by the audit.

**A canonical definition chosen by seniority is recorded as such.** "Finance's
version wins because finance owns the external number" is often correct and is
not evidentiary. Say which it is.

## 6. The trust-loss framing, which is what the buyer is actually paying for

Two dashboards quietly disagreeing does not cause an argument about the metric.
It causes people to stop believing any number from either dashboard, and that
does not recover when the discrepancy is fixed. The audit's value is not
tidiness; it is that a named, quantified, owned divergence is survivable and an
unexplained one is not.

Which is also why the audit must not add a third definition. The agent's
preferred formula, however well reasoned, is a fourth number in a room that
already has too many.
