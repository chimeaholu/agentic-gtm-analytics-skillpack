---
name: journey-assembler
description: Use before any attribution model, path analysis or multi-touch reporting. Assembles the ordered journey: touchpoints joined to a canonical person and, in B2B, to an account and opportunity, with a declared lookback window, a declared conversion definition, channel normalisation and milestone stamps. Includes non-converting journeys, without which Markov transition matrices are conditioned on success and the removal effects are garbage. Prevents attribution being run as arithmetic on a fiction.
---

# Journey Assembler

**Attribution is a function applied to a customer journey. If you cannot
assemble the journey, no model downstream is meaningful** — and every one of
them will still return a number.

This skill builds that journey, measures how complete it is, and publishes the
completeness rate so the attribution that follows is a measurement rather than
a ceremony.

`identity-resolution` is a **hard prerequisite**. Without a canonical person,
there is no journey, only a pile of touches. Refuse rather than proceed.

---

## 1. The tables

```sql
CREATE TABLE IF NOT EXISTS marts.fact_touchpoint (
  touchpoint_id        STRING    NOT NULL,
  canonical_person_id  STRING,                 -- NULL = unresolved, kept not dropped
  canonical_account_id STRING,                 -- B2B rollup
  event_ts             TIMESTAMP NOT NULL,     -- absolute UTC
  event_date           DATE      NOT NULL,     -- partition key
  channel              STRING    NOT NULL,     -- from the normalisation layer, §4
  channel_rule_version STRING    NOT NULL,     -- which mapping produced it
  campaign_key         STRING,                 -- the conformed key, §3
  campaign_raw         STRING,                 -- exactly as received, never overwritten
  source               STRING,
  medium               STRING,
  content              STRING,
  term                 STRING,
  touch_type           STRING    NOT NULL,     -- impression | click | visit | form | email_open | email_click | call | meeting
  click_id             STRING,                 -- gclid / fbclid / li_fat_id / msclkid where captured
  session_id           STRING,                 -- constructed, §7
  resolution_status    STRING    NOT NULL      -- matched | ambiguous | unmatched
)
PARTITION BY event_date
CLUSTER BY canonical_person_id, channel;

CREATE TABLE IF NOT EXISTS marts.fact_conversion (
  conversion_id        STRING    NOT NULL,
  canonical_person_id  STRING,
  canonical_account_id STRING,
  opportunity_id       STRING,
  conversion_ts        TIMESTAMP NOT NULL,
  conversion_type      STRING    NOT NULL,     -- from the declared definition, §5
  conversion_def_version STRING  NOT NULL,
  value                NUMERIC,
  currency             STRING,
  is_primary           BOOL                    -- one conversion may have several events
);
```

Two design points that people cut and then regret:

- **`campaign_raw` is never overwritten.** Normalisation adds `campaign_key`
  beside it. When the mapping is wrong — and it will be — you need the original
  to fix it without a re-extract.
- **Unresolved touches stay, labelled.** Dropping them turns an unmatched
  population into a silent zero, and it makes the completeness rate in §2
  uncomputable.

---

## 2. The journey-completeness rate, published, with a floor

**This is the number that decides whether attribution runs at all.**

```sql
WITH conv AS (
  SELECT c.conversion_id, c.canonical_person_id, c.conversion_ts
  FROM marts.fact_conversion c
  WHERE c.conversion_ts BETWEEN @start AND @end
),
touches AS (
  SELECT c.conversion_id,
         COUNTIF(t.touchpoint_id IS NOT NULL)                       AS touches,
         COUNTIF(t.channel = 'Direct')                              AS direct_touches,
         MIN(t.event_ts)                                            AS first_touch_ts
  FROM conv c
  LEFT JOIN marts.fact_touchpoint t
    ON  t.canonical_person_id = c.canonical_person_id
    AND t.event_ts <= c.conversion_ts
    AND t.event_ts >  TIMESTAMP_SUB(c.conversion_ts, INTERVAL @lookback_days DAY)
  GROUP BY 1
)
SELECT
  COUNT(*)                                                    AS conversions,
  COUNTIF(touches = 0)                                        AS no_journey,
  COUNTIF(touches = 1)                                        AS single_touch_only,
  COUNTIF(touches >= 2)                                        AS multi_touch,
  SAFE_DIVIDE(COUNTIF(touches >= 1), COUNT(*))                AS journey_completeness,
  SAFE_DIVIDE(COUNTIF(touches >= 2), COUNT(*))                AS multi_touch_coverage,
  SAFE_DIVIDE(SUM(direct_touches), SUM(touches))              AS direct_share
FROM touches;
```

| Metric | Definition | Why it is separate |
|---|---|---|
| `journey_completeness` | share of conversions with **at least one** touch inside the lookback | the floor for any attribution at all |
| `multi_touch_coverage` | share with **two or more** touches | the floor for *multi-touch* attribution — a single-touch journey makes every multi-touch model degenerate to last touch |
| `direct_share` | Direct as a share of all touches | the health check on §6; a high Direct share usually means untagged traffic, not direct demand |

### The floors

| Completeness | Action |
|---|---|
| **≥ 0.80** | run multi-touch models, state the rate |
| **0.50 – 0.80** | run them, and report every result **over the covered population only**, with the excluded share named in the same sentence |
| **< 0.50** | **refuse multi-touch attribution.** Report single-touch descriptive statistics and the completeness rate, and name what would raise it |

The floors are declared, not universal — record the one you used. Below 50%
the model is fitting a minority of journeys and extrapolating to a majority it
never saw, and the resulting channel ranking is not a measurement.

**Refusing here is one of the few genuine withholds in the pack.** It is not
"the number might mislead"; it is "the input to the function does not exist".
Give the completeness rate, the single-touch breakdown and the fix — never
nothing.

---

## 3. Campaign-key normalisation is mandatory

**Campaign naming is the de-facto join key between ad platforms and UTMs, and
it is almost always inconsistent.** `Q3_Brand_US`, `q3-brand-us` and
`Q3 Brand US` are one campaign in three systems.

The normalisation layer, in order:

1. **Exact map first**, from `config.campaign_map`: `(platform, campaign_id) →
   campaign_key`. Platform campaign **IDs** are stable; names are not. Where an
   ID is available, it is the key and naming never enters the picture.
2. **Deterministic transform second**, for UTM-only touches: lowercase, trim,
   collapse separators to `-`, strip a declared list of noise tokens. A
   transform, not a guess.
3. **Structured UTM standard third** — a declared naming convention with
   positional fields, parsed rather than matched.
4. **Unmapped rejects to a review queue.** It does **not** fall into an "other"
   bucket that quietly disappears from the count.

```
<channel>-<region>-<quarter>-<audience>-<asset>
paid-social-emea-2026q3-lookalike-carousel
```

**Drift detection**, because naming conventions decay:

```sql
-- campaign keys appearing this month that never appeared before,
-- and old keys that stopped — both are usually a renaming, not a launch
SELECT campaign_key,
       MIN(event_date) AS first_seen,
       MAX(event_date) AS last_seen,
       COUNT(*)        AS touches
FROM marts.fact_touchpoint
GROUP BY 1
HAVING first_seen >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    OR last_seen  <  DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY);
```

A campaign that "ended" and a near-identical one that "launched" on the same
day is one campaign that was renamed, and treating it as two splits its
performance in half.

---

## 4. Non-converting journeys are mandatory for Markov

**Without non-converting paths the transition matrix is conditioned on success,
the removal effect is meaningless, and every channel looks effective.** This is
where most implementations quietly cheat, because non-converters are the
expensive rows.

```sql
-- the journey set that attribution actually needs
CREATE OR REPLACE TABLE marts.journey AS
WITH person_paths AS (
  SELECT
    t.canonical_person_id,
    c.conversion_id,                                  -- NULL for non-converters
    ARRAY_AGG(STRUCT(t.event_ts, t.channel, t.campaign_key)
              ORDER BY t.event_ts) AS path,
    COUNT(*) AS path_length
  FROM marts.fact_touchpoint t
  LEFT JOIN marts.fact_conversion c
    ON  c.canonical_person_id = t.canonical_person_id
    AND t.event_ts <= c.conversion_ts
    AND t.event_ts >  TIMESTAMP_SUB(c.conversion_ts, INTERVAL @lookback_days DAY)
    AND c.conversion_ts >= @window_start
    AND c.conversion_ts <  @window_end
  WHERE t.canonical_person_id IS NOT NULL
    AND t.event_date BETWEEN @window_start AND @window_end
  GROUP BY 1, 2
)
SELECT *, conversion_id IS NOT NULL AS converted FROM person_paths;
```

Two rules for the non-converter set:

- **Define the observation window explicitly.** A non-converter is a person
  whose journey is complete *as of the window end* — someone who converts the
  following week was not a non-converter, they were in progress. Declare the
  window and the censoring rule, and hold the same rule across model runs.
- **Sample the non-converters if volume demands it, and say so.** A stated
  1-in-10 sample with the weight carried through is honest and cheap. Silently
  dropping them is not.

---

## 5. Lookback window and conversion definition — declared and versioned

**Changing either changes every historical number.** They are contract fields,
not parameters.

```yaml
journey_contract:
  version: 4
  effective_from: 2026-07-01
  lookback_days: 90
  lookback_basis: conversion_ts        # counted back from conversion, not from period start
  conversion_definition:
    type: opportunity_created
    source: crm
    filter: "stage NOT IN ('Disqualified') AND is_test = false"
    dedupe: one_per_opportunity        # not one per contact role
  path_length_cap: 20
  cap_policy: keep_first_and_last      # see §8
  non_converter_window_days: 90
  sessionization_gap_minutes: 30
  channel_rule_version: "channels-v7"
```

Every number produced carries `journey_contract.version`. A change is a
**marked event on the timeline**, never a silent restatement read as a trend
(see `comparability-rules`).

The lookback trap worth naming: **a 90-day lookback over a 30-day reporting
window needs 120 days of touch data.** Assembling the window from only the
reporting period truncates every journey that started before it, which
understates upper-funnel channels specifically and systematically.

---

## 6. Channel classification, and the Direct problem

**"Direct" is a dumping ground**, not a channel. It collects untagged email,
dark social, app-to-web transitions, stripped referrers, QR scans, pasted URLs,
some HTTPS-to-HTTP hops and any click whose referrer the browser declined to
send.

Rules:

1. **Classify Direct explicitly and record how.** A `channel = 'Direct'` row
   must carry the reason it was classified that way: no referrer, referrer not
   in the mapping, self-referral, or a stripped referrer.
2. **Last-non-direct silently reassigns credit by a rule.** It is a defensible
   rule and it is a *choice*. Name it in the output; never let it be an
   unstated default.
3. **Monitor the Direct share as a data-quality metric.** A rising Direct share
   is almost always a tagging regression — a new email template without UTMs, a
   campaign launched untagged — and it is detectable within a day.
4. **Self-referrals are a configuration defect**, not a channel. Your own
   domain in the referrer means a session was broken mid-journey, usually by a
   payment gateway or a subdomain hop.

The channel mapping itself lives in `config.dim_channel`, versioned, with
`source`/`medium`/`referrer` patterns evaluated in a declared order and an
explicit fallthrough. **The fallthrough bucket is named `Unclassified`, not
`Other`, and its volume is reported** — "Other" reads as a residual, whereas
"Unclassified" reads as work to do, which is what it is.

---

## 7. Sessionization, where journeys come from raw events

**GA4 has no session table in BigQuery.** The session key is constructed:

```sql
CONCAT(user_pseudo_id, '.',
       (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id'))
```

For warehouse-native event streams, order events per identity and start a new
session after an inactivity gap:

```sql
SELECT *,
  SUM(new_session) OVER (PARTITION BY canonical_person_id ORDER BY event_ts) AS session_number
FROM (
  SELECT *,
    IF(TIMESTAMP_DIFF(event_ts,
         LAG(event_ts) OVER (PARTITION BY canonical_person_id ORDER BY event_ts),
         MINUTE) > @gap_minutes
       OR LAG(event_ts) OVER (PARTITION BY canonical_person_id ORDER BY event_ts) IS NULL,
       1, 0) AS new_session
  FROM marts.fact_touchpoint
);
```

**A 30-minute gap is a convention, not a law.** Pin it, version it, state it.
Two consequences people meet:

- **Any metric denominated in sessions is invalidated by a change to the gap.**
  Changing 30 to 60 minutes reduces session counts and raises every
  per-session rate, with no change in behaviour.
- **Midnight and timezone boundaries split sessions** in tools that bucket by
  day. Your constructed sessions will not match the vendor's session count, and
  that is expected rather than a reconciliation target.

---

## 8. Milestone stamping for B2B

W-shaped and full-path models need milestones joined to touches:

| Milestone | Source | The trap |
|---|---|---|
| Lead created | CRM `CreatedDate` | list imports create leads with no preceding touch |
| **MQL** | scoring threshold crossing | **the threshold is a choice that changes the whole history when edited** |
| Opportunity created | CRM opportunity `CreatedDate` | different teams create opportunities at different trigger points |
| Closed won/lost | CRM close date | reopened deals produce two closes |

**Most organisations lack clean milestone data**, and the moment a milestone
definition changes the whole history changes with it. Say that before promising
W-shaped attribution, not after delivering it.

Where milestones are unavailable or unreliable, W-shaped and full-path models
are **`unavailable`** — and first-touch, last-touch, linear and time-decay are
still computable and still useful. Give those.

**The account grain is not optional in B2B.** A buying group of six means
person-level journeys are the wrong unit; touches roll up to
`canonical_account_id` and to the opportunity. Publish the account-level
completeness rate separately — it is usually **higher** than the person-level
one, because any member's touches count toward the account's journey.

---

## 9. Path-length caps change the answer

Declare the cap and its policy. A cap is not a performance setting:

| Policy | Effect |
|---|---|
| `keep_first_and_last` | preserves the endpoints, drops the middle — **biases against mid-funnel channels** |
| `keep_most_recent` | **destroys first touch**, which is the one upper-funnel channels depend on |
| `keep_all` | correct, and expensive on long B2B journeys |

**Capping redistributes credit.** State the cap, state the policy, and report
the share of journeys that hit it. If 3% of journeys are capped, the effect is
negligible and you can say so; if 40% are, the model is measuring the cap.

---

## 10. What a journey is not

Include this in the output of any path or flow visualisation, because
`fact_touchpoint` invites exactly this misreading (failure mode F18):

- **Fractional attributed credit is not a count of people.** 4.3 conversions
  attributed to a channel means credit, not four people and a limb.
- **An attributed flow diagram is an aggregate flow, explicitly not an ordered
  user journey.** Nobody walked the path the Sankey shows; it is a sum over
  many different paths.
- **A touch is not an influence.** An ad impression in the path is an
  opportunity to have been influenced, and no rule-based model measures
  causation. Only `incrementality-and-mmm` does.

---

## 11. Answering

**Answer first.** "What's our customer journey look like?" gets the computable
description immediately: median path length, median days from first touch to
conversion, the top five path shapes by frequency, the channel mix of first and
last touch — each with the completeness rate attached in the same breath.

*"Median journey is 6 touches over 34 days; 73% of conversions have a complete
journey inside the 90-day lookback, so these figures describe roughly
three-quarters of conversions and the missing quarter skews toward longer
journeys, which means the real median is a little higher."* That is an answer
with a direction of error.

**Withhold only** multi-touch attribution below the declared completeness
floor, and W-shaped or full-path models where milestones are missing. Both are
"the input to the function does not exist", not "the user might misread it".
In each case give the completeness rate, the models that *are* computable, and
the specific change that would unlock the rest — usually a login-binding event,
UTM discipline on email, or milestone timestamps captured at the CRM.

---

## Core contracts called

- `answer-contract` — the completeness floor produces a genuine `unavailable`
  for multi-touch; partial coverage produces `partial` with the excluded share
  stated.
- `comparability-rules` — journeys assembled under different lookback windows,
  conversion definitions or channel-rule versions are not comparable, and
  attributed credit is not summable with platform-reported conversions.
- `provenance-block` — `journey_contract.version`, `channel_rule_version`,
  lookback, completeness rate and identity graph version ride with every
  attributed number.
- `warning-field-reader` — platform-side sampling, thresholding and `(other)`
  rollup silently remove touches before they reach the journey.
- `write-gate` — a change to the lookback, the conversion definition, the
  channel map or the sessionization gap restates history.

## References

- `references/channel-and-campaign-normalisation.md` — the UTM standard, the
  campaign-key mapping, channel rules and drift detection
- `references/sessionization-and-completeness.md` — session construction per
  source, the completeness queries, and the coverage report

## Related skills

- `identity-resolution` — hard prerequisite, refuse without it.
- `funnel-model-designer` for the unit of analysis and the stage definitions.
- `gtm-metric-dictionary` for the conversion definition.
- All of Tier 5 attribution and `content-seo-attribution` consume this output.
