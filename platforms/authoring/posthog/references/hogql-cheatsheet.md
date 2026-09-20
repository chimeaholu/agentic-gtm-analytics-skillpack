# HogQL cheat sheet — ClickHouse SQL, not Postgres

Load this before writing any HogQL. The failure mode is not a syntax error, it is a query
that runs and returns a subtly wrong number because a Postgres idiom has a different
meaning in ClickHouse.

Availability of individual functions depends on the ClickHouse version behind the
instance. On self-hosted or older deployments, verify with a one-row probe
(`SELECT <function>(...) LIMIT 1`) before building an analysis on it.

---

## The tables

| Table | What it holds | Notes |
|---|---|---|
| `events` | one row per captured event | the workhorse; always filter `timestamp` |
| `persons` | one row per person, current state | properties are latest-value-wins |
| `sessions` | session-level aggregates | availability is version-dependent; verify |
| `groups` | group analytics entities | only if group analytics is in use |
| `cohort_people` | cohort membership | membership is evaluated at query time |

Useful `events` columns: `uuid`, `event`, `timestamp`, `distinct_id`, `person_id`,
`properties`, and the virtual `person` join (`person.id`, `person.properties.<name>`,
`person.created_at`).

## Property access

```sql
properties.$current_url              -- managed property, returns a string
properties.plan                      -- custom property, unvalidated, may be misspelled elsewhere
person.properties.email              -- CURRENT person state, not state at event time
toFloat(properties.revenue)          -- properties are strings until you cast them
JSONExtractString(properties, 'plan')       -- explicit extraction
JSONExtractFloat(properties, 'revenue')     -- explicit numeric extraction
JSONHas(properties, 'plan')                 -- presence test, distinct from empty string
```

**Cast before arithmetic.** `properties.revenue` compares and sums as a string unless
cast. `sum(properties.revenue)` is a silent wrong answer waiting to happen; use
`sum(toFloat(properties.revenue))` and decide what a non-numeric value should become.

## Dates and time

| Need | ClickHouse / HogQL | The Postgres habit that breaks |
|---|---|---|
| truncate to day | `toStartOfDay(timestamp)` | `date_trunc('day', ts)` |
| truncate to week | `toStartOfWeek(timestamp, 1)` for Monday weeks | `date_trunc('week', ts)` |
| truncate to month | `toStartOfMonth(timestamp)` | `date_trunc('month', ts)` |
| difference | `dateDiff('day', start, end)` — **unit first, then start, then end** | `end - start` |
| add or subtract | `dateAdd(day, 7, ts)`, `dateSub(day, 7, ts)`, or `ts - INTERVAL 7 DAY` | `ts + interval '7 days'` |
| now / today | `now()`, `today()` | `now()`, `current_date` |
| render in a timezone | `toTimeZone(timestamp, 'America/New_York')` | `ts at time zone '...'` |
| format | `formatDateTime(timestamp, '%Y-%m-%d')` | `to_char(ts, 'YYYY-MM-DD')` |

`dateDiff` argument order is the single most common silent inversion: `dateDiff('day', a,
b)` is `b - a`, so swapping the arguments gives you the negative of the answer, which then
disappears into a `>= 0` filter.

## Aggregates

```sql
count()                              -- rows
countIf(event = '$pageview')         -- conditional count, cheaper and clearer than sum(case when)
uniq(person_id)                      -- approximate distinct, fast
uniqExact(person_id)                 -- exact distinct, slower; use when the number is quoted
argMin(properties.utm_source, timestamp)   -- first-touch value per group
argMax(properties.plan, timestamp)         -- last-known value per group
quantile(0.5)(toFloat(properties.duration))  -- median; note the two-argument-list form
groupArray(event)                    -- collect into an array
```

`uniq` is approximate. If the number is going into a report a human will quote, use
`uniqExact` and say which one you used.

## Safe division

ClickHouse does not raise on float division by zero; it yields `inf` or `nan`, which then
formats as a nonsense rate. Every rate calculation gets a guard:

```sql
if(denominator = 0, NULL, numerator / denominator) AS conversion_rate
```

## Conditionals, strings, arrays

```sql
if(cond, a, b)
multiIf(c1, v1, c2, v2, fallback)
coalesce(properties.utm_source, 'direct')
concat(properties.utm_source, ' / ', properties.utm_medium)
properties.$current_url ILIKE '%/pricing%'
splitByChar('?', properties.$current_url)[1]     -- arrays are 1-indexed, not 0-indexed
arrayJoin(some_array)                            -- the ClickHouse equivalent of UNNEST
has(some_array, 'value')
```

Arrays are **1-indexed**. A Postgres-trained off-by-one here returns the wrong URL segment
without erroring.

## Joins and set operations

- `FULL OUTER JOIN` is unavailable on older versions. Prefer `LEFT JOIN` plus a `UNION
  ALL` of the missing side, or restructure with a conditional aggregate.
- `LIMIT n BY expr` is a ClickHouse feature with no Postgres equivalent and it is the
  cleanest way to take the first row per person:

```sql
SELECT person_id, event, timestamp
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
ORDER BY person_id, timestamp
LIMIT 1 BY person_id
```

- CTEs (`WITH ... AS (...)`) and window functions (`OVER (PARTITION BY ... ORDER BY ...)`)
  are available and behave as expected.

---

## Patterns worth copying

**Daily active users, 30 days, bounded:**

```sql
SELECT toStartOfDay(timestamp) AS day, uniqExact(person_id) AS dau
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY AND timestamp < now()
GROUP BY day
ORDER BY day
```

**Conversion rate between two events, per person, with a safe denominator:**

```sql
SELECT
  uniqExact(person_id) AS visitors,
  uniqExactIf(person_id, event = 'signup_completed') AS signups,
  if(uniqExact(person_id) = 0, NULL,
     uniqExactIf(person_id, event = 'signup_completed') / uniqExact(person_id)) AS cvr
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND event IN ('$pageview', 'signup_completed')
```

State the grain in the answer: this is person-level conversion within a fixed calendar
window, not a cohorted journey conversion. Those are different numbers and
`funnel-model-designer` governs which one the question wants.

**Ordered funnel with a time window** (verify `windowFunnel` availability on the instance
first):

```sql
SELECT level, count() AS people
FROM (
  SELECT person_id,
         windowFunnel(86400)(timestamp,
           event = '$pageview',
           event = 'signup_started',
           event = 'signup_completed') AS level
  FROM events
  WHERE timestamp >= now() - INTERVAL 30 DAY
  GROUP BY person_id
)
GROUP BY level
ORDER BY level
```

`windowFunnel` counts the longest prefix of the step list each person completed within the
window, in order. A person at level 2 is also counted in the level-1 population when you
build cumulative step counts, so build them with a running sum from the top rather than
reading the levels as step totals.

**First-touch source per person, correctly** (using the event property, not the person
property):

```sql
SELECT person_id,
       argMin(coalesce(properties.utm_source, 'direct'), timestamp) AS first_source,
       min(timestamp) AS first_seen
FROM events
WHERE timestamp >= now() - INTERVAL 90 DAY
GROUP BY person_id
```

This is first-touch **within the queried window**, not first-touch ever. If a person's
real first touch predates the window, this attributes them to whatever they did first
inside it. Widen the window or state the bound in the answer.

**Keyset page over raw events** (never `OFFSET`):

```sql
SELECT timestamp, uuid, event, distinct_id
FROM events
WHERE timestamp >= {start} AND timestamp < {end}
  AND (timestamp, uuid) > ({last_ts}, {last_uuid})
ORDER BY timestamp ASC, uuid ASC
LIMIT 10000
```

---

## Performance rules

PostHog's own docs state that the burden of performance falls on you. HogQL is not
query-planned for you.

1. Always bound `timestamp`. An unbounded scan of a large event table is the most common
   cause of a timeout that gets misreported as a platform outage.
2. Filter on `event` early; it is highly selective.
3. Prefer materialized properties and materialized views where the project has them.
4. Use `uniq` for exploration, `uniqExact` for the number you publish.
5. Send anything non-trivial with `refresh: "async"` and poll, rather than holding an HTTP
   connection open.
