# Sessionization and the completeness report

---

## 1. A session is constructed, not given

No source hands you a session that means what your analysis needs. Every option
is a construction with a convention inside it.

| Source | What exists | What you build |
|---|---|---|
| **GA4 BigQuery export** | `ga_session_id` in `event_params`, **no session table** | `CONCAT(user_pseudo_id, '.', ga_session_id)` as the session key, aggregated yourself |
| **GA4 Data API** | `sessions` as an aggregate metric | nothing row-level — **person-level journey work needs the export** |
| **PostHog** | `$session_id` on events | usable directly; note the project timezone affects day bucketing in insights but not in HogQL |
| **Amplitude** | `session_id` | bucketed in the **project timezone**, which is a project setting and differs between projects in one company |
| **Mixpanel** | session is a project-level definition | reconstruct, or accept the project definition and state it |
| **Raw warehouse stream** | nothing | the inactivity-gap construction below |

### The inactivity-gap construction

```sql
WITH ordered AS (
  SELECT
    canonical_person_id,
    event_ts,
    touchpoint_id,
    LAG(event_ts) OVER (PARTITION BY canonical_person_id ORDER BY event_ts) AS prev_ts
  FROM marts.fact_touchpoint
  WHERE canonical_person_id IS NOT NULL
),
flagged AS (
  SELECT *,
    IF(prev_ts IS NULL
       OR TIMESTAMP_DIFF(event_ts, prev_ts, MINUTE) > @gap_minutes, 1, 0) AS new_session
  FROM ordered
)
SELECT *,
  CONCAT(canonical_person_id, '.',
         CAST(SUM(new_session) OVER (PARTITION BY canonical_person_id
                                     ORDER BY event_ts) AS STRING)) AS session_id
FROM flagged;
```

**The 30-minute gap is a convention.** Pin it in the journey contract, version
it, and state it in any session-denominated output.

Consequences to state rather than discover:

- **Changing the gap changes every session-denominated metric** with no change
  in behaviour. 30 → 60 minutes lowers session counts and raises every
  per-session rate.
- **Your session count will not match the vendor's.** GA4 restarts a session at
  midnight in the property timezone and on a campaign change; your gap-based
  construction does neither. This is expected, not a reconciliation target —
  see `cross-system-reconciliation` for when to stop trying.
- **Sessions are not joined to event counts.** A "sessions with events" join
  yields neither a session count nor an event count.

---

## 2. The completeness report

Ships with every journey build, and with every attribution result derived from
it.

```json
{
  "journey_contract_version": "4",
  "identity_graph_version": "2026-09-20T02:14:00Z",
  "window": {"start": "2026-07-01", "end": "2026-09-30"},
  "lookback_days": 90,
  "conversions": 4212,
  "journey_completeness": 0.73,
  "multi_touch_coverage": 0.61,
  "conversions_with_no_journey": 1137,
  "median_path_length": 6,
  "median_days_first_touch_to_conversion": 34,
  "capped_journeys_share": 0.03,
  "direct_share": 0.19,
  "unclassified_share": 0.04,
  "self_referral_share": 0.011,
  "non_converter_paths": 184203,
  "non_converter_sampling": {"sampled": true, "rate": 0.1, "weight_applied": true},
  "identity": {"matched": 0.878, "ambiguous": 0.008, "unmatched": 0.113},
  "account_level": {"journey_completeness": 0.86, "accounts": 1204}
}
```

### Reading it

- **`journey_completeness` is the gate.** Below the declared floor, multi-touch
  attribution does not run.
- **`multi_touch_coverage` is the second gate**, and it is lower than
  completeness by definition. A single-touch journey makes every multi-touch
  model degenerate to last touch, so a model run over a population that is
  mostly single-touch is a last-touch model wearing a different name.
- **Account-level completeness is usually higher** than person-level in B2B,
  because any buying-group member's touches count toward the account's journey.
  Report both; they answer different questions.
- **`conversions_with_no_journey` is a count of real conversions**, not a
  rounding error. They happened. They are excluded from attribution and must be
  named in the same sentence as any attributed total, or the attributed total
  reads as the whole business.

---

## 3. Diagnosing low completeness

Work in this order — it is ordered by frequency, not by effort.

| Rank | Cause | Check | Fix |
|---|---|---|---|
| 1 | **Missing anonymous→known backfill** | `is_pre_identification` share near zero | run the backfill (see `identity-resolution` `references/backfill-procedure.md`) |
| 2 | **Lookback shorter than the sales cycle** | median days first-touch-to-conversion against `lookback_days` | lengthen the lookback; if the data does not go back far enough, that is the honest bound |
| 3 | **Touch data assembled only for the reporting window** | first touches clustering suspiciously at the window start | assemble `lookback_days` **before** the window start |
| 4 | **Identity match rate low** | the identity coverage report | fix the spine first; nothing here helps until it is fixed |
| 5 | **Offline conversions with no digital touches** | conversion source mix | genuine — inside-sales and partner-sourced deals may have no digital journey, and should be reported as a named segment rather than as missing data |
| 6 | **Tagging gaps** | Direct and Unclassified shares | UTM discipline, link builder, weekly audit |

Rank 5 deserves emphasis: **some conversions legitimately have no digital
journey.** Reporting them as a data quality failure is as wrong as reporting
them as Direct. Segment them, name them, and exclude them from attribution with
their count stated.

---

## 4. The non-converter set

| Decision | Options | Effect |
|---|---|---|
| Who counts as a non-converter | anyone with ≥1 touch in the window who did not convert **by the window end** | a person who converts the following week was in progress, not a non-converter — this is **censoring**, and it must be declared |
| Observation window | equal to the lookback, or longer | too short overstates non-conversion; too long includes people who cannot yet have converted |
| Sampling | full, or a stated rate with weights | full is correct and sometimes unaffordable; **a stated 1-in-10 sample with weights carried through is honest**, a silent drop is not |
| Bot and internal traffic | excluded, by a declared rule | bots are a large share of non-converters and they distort every transition probability |

The Markov requirement, stated once more because it is where implementations
cheat: **without non-converting paths the transition matrix is conditioned on
success.** Every channel then appears to lead to conversion, the removal effect
of every channel is small and similar, and the resulting allocation is noise
with decimal places. If you cannot assemble non-converters, say so and do not
run Markov — `attribution-rule-based` still works and is honest about what it
is.

---

## 5. Path-length caps, quantified

```sql
SELECT
  @path_length_cap                                        AS cap,
  COUNTIF(path_length > @path_length_cap)                 AS capped_journeys,
  SAFE_DIVIDE(COUNTIF(path_length > @path_length_cap), COUNT(*)) AS capped_share,
  APPROX_QUANTILES(path_length, 100)[OFFSET(50)]          AS median_length,
  APPROX_QUANTILES(path_length, 100)[OFFSET(95)]          AS p95_length,
  MAX(path_length)                                        AS max_length
FROM marts.journey;
```

Interpretation, and say it in these terms:

- **capped_share below ~5%** — the cap's effect on channel ranking is
  negligible; say so and move on.
- **5–20%** — state the cap and the policy next to the result, since mid-funnel
  channels are systematically under-credited under `keep_first_and_last`.
- **above 20%** — **the model is measuring the cap.** Raise it or report path
  analysis descriptively instead of running a credit-allocating model.

`keep_most_recent` destroys first touch, which is the single touch upper-funnel
channels depend on. It is the worst default and the most common one, because it
is the cheapest to implement.
