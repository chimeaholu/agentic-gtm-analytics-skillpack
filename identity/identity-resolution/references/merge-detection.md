# Over-merge and under-merge detection

Two failure directions, asymmetric damage, and only one of them is easy to see.

| | Over-merge | Under-merge |
|---|---|---|
| Effect on person count | too low | too high |
| Effect on per-person rates | inflated | deflated |
| Effect on journeys | **two people's touches interleaved into one fictional journey** | one person's journey split into fragments, each looking like a bounce |
| Effect on attribution | credit assigned to a channel that touched a **different person** | first touch lost, last touch over-credited |
| Visibility | **low — the output looks coherent** | high — counts drift visibly |
| Reversibility | hard: the evidence that they were separate is gone unless edges are append-only | easy: a new edge merges them |

**This is why `identity_edges` is append-only.** An over-merge you can unwind
is an incident; an over-merge you cannot unwind is a permanent corruption of
every historical number.

---

## 1. Over-merge detection

### 1.1 Identifier-count distribution

```sql
WITH per_person AS (
  SELECT canonical_person_id,
         COUNTIF(identifier_type = 'email')  AS emails,
         COUNTIF(identifier_type = 'cookie') AS cookies,
         COUNTIF(identifier_type = 'device') AS devices,
         COUNTIF(identifier_type = 'phone')  AS phones
  FROM marts.identity_graph
  WHERE valid_to IS NULL
  GROUP BY 1
)
SELECT
  APPROX_QUANTILES(emails,  100)[OFFSET(50)] AS emails_p50,
  APPROX_QUANTILES(emails,  100)[OFFSET(99)] AS emails_p99,
  APPROX_QUANTILES(cookies, 100)[OFFSET(50)] AS cookies_p50,
  APPROX_QUANTILES(cookies, 100)[OFFSET(99)] AS cookies_p99,
  COUNTIF(emails > 3)   AS suspects_by_email,
  COUNTIF(cookies > 50) AS suspects_by_cookie
FROM per_person;
```

**Set the thresholds from your own distribution, not from a constant.** A
consumer product with heavy multi-device use has a legitimately fat cookie
tail; a B2B tool does not. The p99 of your own graph is the starting point, and
the threshold lives in `config` with a reason.

Three or more **emails** on one person is the strongest single signal, because
unlike cookies, emails do not accumulate naturally.

### 1.2 Role-address denylist

```sql
SELECT canonical_person_id, identifier
FROM marts.identity_graph
WHERE identifier_type = 'email'
  AND valid_to IS NULL
  AND REGEXP_CONTAINS(identifier,
      r'^(info|sales|support|admin|billing|accounts|hello|contact|team|office|help|no-?reply|donotreply|mail|enquiries|inquiries)@');
```

A role address is **an organisation, not a person**. Treating one as a person
merges everyone who ever used it. Exclude role addresses from person identity
at ingestion; keep them as an account-level contact attribute, which is what
they actually are.

Maintain the prefix list in `config`, because every industry has its own
(`orders@`, `bookings@`, `dispatch@`).

### 1.3 Impossible concurrency

```sql
SELECT canonical_person_id,
       COUNT(DISTINCT geo_country) AS countries,
       COUNT(DISTINCT device_type) AS device_types,
       COUNT(*)                    AS events
FROM marts.fact_touchpoint_resolved
WHERE event_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
GROUP BY 1
HAVING countries > 1;
```

One person, two countries, one hour. Sometimes a VPN; often an over-merge;
occasionally a shared kiosk or a support agent impersonating a user. All three
are worth knowing about.

A stronger variant, where session data exists: **overlapping concurrent
sessions on different devices**. Two sessions that overlap in time on different
devices are either a genuine multi-device user or two people.

### 1.4 Behavioural implausibility

Activity volume far above the population p99 — a "person" with a thousand
sessions a month — is usually a merge of many people, a bot, or an internal
tool account. All three should be excluded from person-level analysis, and
**excluded visibly**, with the count reported.

### 1.5 Shared-device signals

A cookie or device ID that has been bridged to **more than one distinct known
email** is the canonical household or shared-workstation case. It is not an
error in the data: the device really was used by two people. The error is
merging the two people because of it.

**Rule: a shared device is evidence about the device, not about the people.**
The cookie's edges to each person stay; the people do not merge.

---

## 2. Under-merge detection

Cheaper to find, safer to act on, still never automatic.

```sql
-- same local part, same domain, different canonical ids
WITH parts AS (
  SELECT canonical_person_id, identifier,
         SPLIT(identifier, '@')[OFFSET(0)] AS local_part,
         SPLIT(identifier, '@')[OFFSET(1)] AS domain
  FROM marts.identity_graph
  WHERE identifier_type = 'email' AND valid_to IS NULL
)
SELECT
  REGEXP_REPLACE(local_part, r'\+.*$', '') AS base_local,
  domain,
  COUNT(DISTINCT canonical_person_id)      AS distinct_persons,
  ARRAY_AGG(DISTINCT identifier LIMIT 10)  AS identifiers
FROM parts
GROUP BY 1, 2
HAVING distinct_persons > 1;
```

Other under-merge signals worth computing:

- **Plus-addressing** where the policy is "keep" — expected, but quantify it so
  the person-count inflation is known rather than suspected.
- **Guest checkout share** in B2C — the hard ceiling on person-level analysis,
  and a single number worth publishing.
- **Unbridged cookie volume** — anonymous identifiers that never reached a
  known person. Usually most of them, which is normal. Report the rate.
- **Cross-device orphans** — a known person with exactly one cookie in a
  population whose median is three suggests missing bridge events, often a
  login page that does not fire the identify call.

---

## 3. The review queue, not the auto-merge

Detection produces **candidates**, and candidates go to a human.

```sql
CREATE TABLE IF NOT EXISTS quality.identity_review_queue (
  candidate_id   STRING    NOT NULL,
  kind           STRING    NOT NULL,  -- over_merge | under_merge
  detector       STRING    NOT NULL,  -- which heuristic fired
  person_ids     ARRAY<STRING>,
  identifiers    ARRAY<STRING>,
  evidence       JSON      NOT NULL,  -- the rows that triggered it
  detected_at    TIMESTAMP NOT NULL,
  reviewed_at    TIMESTAMP,
  decision       STRING,              -- split | merge | no_action
  decided_by     STRING,
  rationale      STRING
);
```

**An automatic merge on a heuristic is how over-merge happens.** The queue is
the control. A decision writes a `manual_merge` edge into `identity_edges` with
its evidence, closes the affected `identity_graph` intervals, and goes through
`write-gate` with the blast radius stated: *"merges N persons, which changes
person counts and every per-person rate for all periods since <date>, and
restates M historical reports."*

---

## 4. The two rates that ship with the graph

```sql
SELECT
  SAFE_DIVIDE(COUNTIF(kind = 'over_merge'  AND decision IN ('split',  'no_action')),
              (SELECT COUNT(*) FROM marts.identity_graph WHERE valid_to IS NULL))
    AS over_merge_suspect_rate,
  SAFE_DIVIDE(COUNTIF(kind = 'under_merge' AND decision IN ('merge', 'no_action')),
              (SELECT COUNT(DISTINCT canonical_person_id) FROM marts.identity_graph WHERE valid_to IS NULL))
    AS under_merge_candidate_rate
FROM quality.identity_review_queue
WHERE detected_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);
```

Both go in the coverage report. They are **suspect rates, not error rates** —
say so, because a reviewed suspect is often legitimate. What they give you is a
bound: if the over-merge suspect rate is 0.4%, person counts are wrong by at
most a few tenths of a percent in the direction of undercounting, and that is a
sentence you can put next to a number instead of a shrug.

---

## 5. Tuning without switching off

The same discipline as anchors in `data-quality-harness`:

1. Thresholds live in `config.identity_thresholds` with `effective_from` and a
   reason.
2. **A detector that fires constantly is mis-tuned, not useless.** Retune it in
   config, do not delete it.
3. A detector nobody reviews is off. If the queue is not being worked, report
   that as a coverage gap in the verification inventory — `NOT_TESTED`, not a
   silent pass.
