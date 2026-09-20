# The backfill procedure

The step that decides whether your first-touch attribution is a measurement or
a tautology. Run it, test that it ran, and publish its horizon.

---

## 1. What backfill is

Anonymous→known stitching is **retroactive by nature**. The identification
event tells you something about the *past*: those earlier anonymous sessions
belonged to a person you can now name.

```
day 0   anonymous session, Paid Social          cookie A
day 4   anonymous session, Organic Search       cookie A
day 19  anonymous session, Direct               cookie A
day 19  form fill  →  person P identified       cookie A ↔ person P
```

Without backfill, person P's journey starts on day 19 with Direct. Their first
touch is Direct. Paid Social — the channel that created the demand — appears
nowhere. Scale that across an organisation and the budget moves away from the
channels that work, justified by a report that is internally consistent and
completely wrong.

---

## 2. The runner

### Step 1 — extract bridge events

A bridge event is any event where an anonymous identifier and a known
identifier appear together: an `identify` call, a login, a form submission with
a cookie present, an order placed by a signed-in customer.

```sql
CREATE OR REPLACE TABLE marts.identity_bridge
PARTITION BY DATE(bridged_at) AS
SELECT
  e.from_id                       AS anon_id,
  e.from_type                     AS anon_type,
  g.canonical_person_id,
  MIN(e.observed_at)              AS bridged_at,      -- FIRST identification wins
  ARRAY_AGG(DISTINCT e.source)    AS bridge_sources,
  MIN(e.confidence)               AS bridge_confidence
FROM marts.identity_edges e
JOIN marts.identity_graph g
  ON  g.identifier      = e.to_id
  AND g.identifier_type = e.to_type
  AND e.observed_at    >= g.valid_from
  AND (g.valid_to IS NULL OR e.observed_at < g.valid_to)
WHERE e.from_type IN ('cookie', 'device')
  AND e.method LIKE 'deterministic%'
GROUP BY 1, 2, 3;
```

**`MIN(observed_at)`, not `MAX`.** The first identification is the one that
bounds the backfill; a later login on the same cookie tells you nothing new
about the past.

**One anonymous ID bridging to more than one person is a shared device.** It
does not merge the people (see `merge-detection.md` §1.5) and it makes the
backfill for that cookie **ambiguous** — those touches are attributed to
neither person and are counted in the ambiguous bucket.

```sql
-- shared-device exclusion, computed not assumed
SELECT anon_id, COUNT(DISTINCT canonical_person_id) AS persons
FROM marts.identity_bridge
GROUP BY 1 HAVING persons > 1;
```

### Step 2 — attach prior activity

```sql
CREATE OR REPLACE TABLE marts.fact_touchpoint_resolved
PARTITION BY DATE(event_ts)
CLUSTER BY canonical_person_id AS
WITH exclusive_bridge AS (
  SELECT * FROM marts.identity_bridge
  WHERE anon_id NOT IN (
    SELECT anon_id FROM marts.identity_bridge
    GROUP BY 1 HAVING COUNT(DISTINCT canonical_person_id) > 1
  )
)
SELECT
  t.*,
  b.canonical_person_id,
  b.bridged_at,
  t.event_ts < b.bridged_at                             AS is_pre_identification,
  DATE_DIFF(DATE(b.bridged_at), DATE(t.event_ts), DAY)  AS days_before_identification,
  CASE
    WHEN b.canonical_person_id IS NOT NULL THEN 'matched'
    WHEN t.anon_id IN (SELECT anon_id FROM marts.identity_bridge) THEN 'ambiguous'
    ELSE 'unmatched'
  END                                                   AS resolution_status
FROM marts.fact_touchpoint t
LEFT JOIN exclusive_bridge b
  ON b.anon_id = t.anon_id;
```

Note what this does **not** do: it does not drop unmatched touches. They stay,
labelled, and are counted in every coverage statement. Dropping them is how an
unmatched population silently becomes zero.

### Step 3 — recompute first touch

```sql
CREATE OR REPLACE TABLE marts.person_first_touch AS
SELECT
  canonical_person_id,
  ARRAY_AGG(STRUCT(event_ts, channel, campaign_id, is_pre_identification)
            ORDER BY event_ts LIMIT 1)[OFFSET(0)] AS first_touch
FROM marts.fact_touchpoint_resolved
WHERE canonical_person_id IS NOT NULL
GROUP BY 1;
```

Run this **after** backfill, never before. A first-touch table built before the
backfill and refreshed incrementally afterwards keeps the pre-backfill answer
forever.

---

## 3. The tests that prove backfill ran

Three assertions. The first is the important one.

```sql
-- T1. A material share of touches must predate identification.
--     Essentially zero means backfill is not running.
SELECT
  COUNTIF(is_pre_identification)                        AS backfilled,
  COUNT(*)                                              AS total,
  SAFE_DIVIDE(COUNTIF(is_pre_identification), COUNT(*)) AS pre_identification_share,
  SAFE_DIVIDE(COUNTIF(is_pre_identification), COUNT(*)) < 0.05 AS failed
FROM marts.fact_touchpoint_resolved
WHERE canonical_person_id IS NOT NULL;

-- T2. The first-touch channel mix must not be dominated by Direct and Branded Search.
--     That signature IS the missing-backfill symptom.
SELECT
  first_touch.channel,
  COUNT(*) AS persons,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) AS share
FROM marts.person_first_touch
GROUP BY 1 ORDER BY persons DESC;

-- T3. Every identified person with pre-identification activity must have a
--     first touch at or before their bridge time.
SELECT COUNT(*) AS violations
FROM marts.person_first_touch f
JOIN (SELECT canonical_person_id, MIN(bridged_at) AS bridged_at
      FROM marts.identity_bridge GROUP BY 1) b USING (canonical_person_id)
JOIN (SELECT canonical_person_id, COUNTIF(is_pre_identification) AS pre
      FROM marts.fact_touchpoint_resolved GROUP BY 1) p USING (canonical_person_id)
WHERE p.pre > 0 AND f.first_touch.event_ts > b.bridged_at;
```

T1 belongs in `data-quality-harness` as a gating test. It is cheap, and it
catches the highest-consequence silent defect in the whole pack.

The 5% floor in T1 is a **starting threshold, tuned from your own data** — a
pure-login product with no anonymous browsing legitimately sits near zero, and
that is a fact about the product, not a defect. Record which case you are in.

---

## 4. The backfill horizon

You can only backfill as far back as the anonymous identifier survives.
**ITP/ETP-capped first-party cookies mean weeks, not months on Safari**, so a
long consideration cycle is partially unrecoverable by construction.

```sql
SELECT
  APPROX_QUANTILES(days_before_identification, 100)[OFFSET(50)] AS horizon_median_days,
  APPROX_QUANTILES(days_before_identification, 100)[OFFSET(90)] AS horizon_p90_days,
  MAX(days_before_identification)                               AS horizon_max_days
FROM marts.fact_touchpoint_resolved
WHERE is_pre_identification;
```

**Publish it with every first-touch analysis**, in one sentence: *"First touch
is recovered a median of 9 days and a p90 of 31 days before identification;
anything earlier than that in a longer sales cycle is not in these numbers, so
upper-funnel channels are understated rather than absent."*

That sentence names the direction of the error, which is what makes the number
usable rather than merely caveated.

---

## 5. Incremental backfill, and why it is not "append"

The backfill is **retroactive**: today's identification changes *last month's*
touch attribution. An incremental job that only processes new touches will
never revisit them.

The correct incremental shape:

1. Find bridges created since the last run.
2. For each, find **all historical touches** for that anonymous ID, regardless
   of age.
3. Reprocess those touches' partitions — not just the recent ones.
4. Recompute `person_first_touch` for the affected persons only.
5. **Record the restatement**: which persons changed first touch, from what to
   what, on what date.

Step 5 is what turns "the number changed" from an argument into a record.
Combined with the bitemporal `known_from` / `known_to` columns, it lets you
answer both "what is true now" and "what did the report say in June, and why",
which are different questions that people ask in the same sentence.

**A restated first-touch number is a better number, not a bug.** Say that
plainly when it happens, mark it on the timeline, and never let it be read as
a trend.
