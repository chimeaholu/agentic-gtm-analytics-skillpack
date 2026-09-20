---
name: segmentation-model-support
description: Use when a model score or cluster assignment needs to become an operational segment — an audience to sync to an ad platform or CRM, a list for a campaign, or a tier in a scoring system. Sets cut points deliberately, checks segment stability and size over time, defines the refresh cadence, and handles the activation constraints of the destination platform. Prevents a score becoming a segment by an arbitrary threshold and then churning membership every refresh.
---

# Segmentation Model Support

The step between "the model works" and "the business uses it", and the step where
most model value is lost.

Three things go wrong here, reliably: **the cut point is a round number**, **the
membership churns faster than the programme can act**, and **the destination
cannot do what was promised.** None of them is a modelling problem, and all three
are fatal.

---

## 1. Cut points are set by capacity and cost, not by round numbers

"Top 20%", "score above 80", "the top three deciles" — all arbitrary. The
defensible cut points come from what happens to the records.

### Capacity-derived (the usual binding constraint)

If the team can work 200 leads a week, **the "high" tier is the top 200** and the
threshold is whatever score the 200th record has. Recompute it each cycle,
because the score distribution moves.

```sql
select min(score) as threshold
from  (select score, row_number() over (order by score desc) as rn
       from   scored_records
       where  scored_at >= current_date - 7) x
where rn <= :weekly_capacity;
```

**Capacity is measured in records actually worked, not in headcount times an
assumption.** Ask what happened to last month's list before setting this week's.

### Cost-derived

```
t* = cost_of_acting / value_of_a_conversion
```

Requires a calibrated probability (`supervised-propensity-models` §2). This gives
the threshold at which acting breaks even.

### The gap is the finding

**Report both thresholds and the volume between them.** If the cost-optimal
threshold admits 1,400 records a week and capacity is 200, then 1,200
positive-expected-value records a week are untouched — and that is a staffing or
automation case with a number attached, which is far more valuable than the
threshold itself.

### Three bands beat one cut

| Band | Rule | Action |
|---|---|---|
| High | Above the capacity threshold | Worked now, full sequence |
| Medium | Between `t*` and the capacity threshold | Automated nurture — positive EV, below the line |
| Low | Below `t*` | No spend |

A single cut discards the middle, which is usually the largest positive-EV
population in the database.

---

## 2. Membership churn is a first-class metric

**Measure it before activating anything.**

```sql
-- week-over-week membership churn for a segment
with a as (select entity_id from membership where snapshot = :w1 and segment = :s),
     b as (select entity_id from membership where snapshot = :w2 and segment = :s)
select (select count(*) from a)                                   as size_w1,
       (select count(*) from b)                                   as size_w2,
       (select count(*) from a join b using (entity_id))           as retained,
       1.0 - (select count(*) from a join b using (entity_id))::float
             / nullif((select count(*) from a), 0)                 as churn_rate;
```

| Weekly membership churn | What it can support |
|---|---|
| < 10% | Multi-touch programmes, nurture sequences, ABM plays |
| 10–30% | Single-touch campaigns; sequences need entry/exit logic |
| **> 30%** | **Cannot support a multi-touch programme.** A five-touch sequence will not find the same people at touch three |
| > 60% | The segment is measuring noise. Go back to the model |

**Two causes, different fixes.** Score volatility (the model's output moves)
versus boundary crowding (records sitting near the threshold flip on tiny
changes). Distinguish them:

```sql
select avg(abs(score_w2 - score_w1))                    as mean_score_move,
       avg((abs(score_w1 - :threshold) < 0.02)::int)    as share_near_boundary
from   scores_joined;
```

**Fixes for boundary crowding, in order:**

1. **Hysteresis.** Enter above the threshold, exit only below a lower one
   (`enter ≥ 0.70`, `exit < 0.60`). The cheapest and most effective fix, and it
   is under-used.
2. **Minimum dwell time.** Once in, stay for N days regardless.
3. **Smooth the score.** A trailing average over the last k scoring runs.
4. **Widen the band**, accepting more records for stability.

**Hysteresis is nearly free and typically cuts churn by more than half.** Apply
it by default on any segment feeding a multi-touch programme.

---

## 3. Refresh cadence matched to signal velocity and destination limits

| Signal | Sensible cadence |
|---|---|
| Behavioural / intent, fast-moving | Daily, or on-event where the destination supports it |
| Model propensity scores | Daily to weekly |
| Fit / firmographic scores | Monthly — the inputs change slowly and enrichment refreshes slowly |
| Cluster assignments | **Monthly at most**, and freeze between refits (§6) |
| RFM-style value tiers | Weekly to monthly |

**Two ceilings apply simultaneously:**

- **The signal's velocity.** Refreshing a firmographic fit score daily produces
  identical lists and burns quota.
- **The destination's ingestion limits.** Sync cadence is bounded by the
  platform's rate limits, and a daily full-audience sync to a rate-limited API
  is a quota-exhaustion incident waiting to happen. `rate-limit-governor` governs
  the pacing; **prefer delta syncs over full re-pushes** wherever the destination
  supports them.

**A refresh that outruns the action is waste.** If the SDR team works the list on
Monday, refreshing Tuesday through Friday changes nothing except the audit trail.

---

## 4. Activation constraints per destination

**From the platform research. These are hard limits, not preferences — the skill
must be structurally unable to promise what does not exist.**

| Destination | Constraint |
|---|---|
| **Mixpanel** | Its MCP server states plainly that **audience targeting and cohort editing are not supported via MCP — use the UI.** Cohort *creation* is available through the MCP; editing and targeting are not |
| **Braze** | Its MCP server has **no user-level PII tools at all**. Person-level activation must go through the REST API with a properly-permissioned key. **Attempting person-level activation over that MCP is structurally impossible, not merely restricted** |
| **Iterable** | Its MCP requires explicit `ITERABLE_USER_PII` and `ITERABLE_ENABLE_WRITES` flags before any user-level or write operation. Absent those flags the operation fails, and it fails in a way that looks like a permissions problem |
| **Klaviyo** | Segments are API-manageable. Note the reporting endpoints are severely rate-limited, so **measurement** of the segment is the constrained side, not creation |
| **Amplitude / PostHog** | **Cohorts are query-time constructs.** Exporting "users in cohort X" gives a **snapshot, not a stable set** — the membership is recomputed on every evaluation |
| **Segment / RudderStack** | Audiences are **configuration objects**. Changing one is a config change with downstream effect, and it belongs behind `write-gate` |
| **Salesforce / CRM** | Writing a score to a field is a write; campaign membership is a write. Field-level security and validation rules can silently reject, so **verify the write took effect rather than assuming a 200 means applied** |
| **Ad platforms** | Customer-list audiences have **minimum size floors** and match rates well below 100%. A 1,200-record segment may activate as 600 matched users, or fail the floor entirely |

### The three that catch people

1. **A query-time cohort is not a list.** Anything downstream that assumes a
   stable membership set will drift, silently, because the cohort is recomputed
   each time it is referenced. If you need a stable set, snapshot it and own the
   snapshot.
2. **Person-level activation through a channel that structurally cannot carry
   PII** fails at the platform boundary, not at the permissions layer. Check the
   capability before designing the flow.
3. **Match rates are not disclosed up front.** Size the segment for the floor
   after matching, not before, and report the matched count as the real audience
   size.

---

## 5. Suppression is part of the definition

**The people who must *not* receive the treatment are as much a part of the
segment as the people who must.** A suppression list bolted on afterwards gets
forgotten in the next refresh.

| Suppression class | Why |
|---|---|
| **Unsubscribed / opt-out / do-not-contact** | Legal and contractual. **Non-negotiable** |
| Active support escalation | Outreach during an escalation damages the relationship |
| Open opportunity in a late stage | Marketing touch cuts across the sales motion |
| Recently contacted | Frequency capping across programmes, not just within one |
| Employees, test accounts, internal domains, competitors | Pollutes measurement and embarrasses |
| **Experiment holdout** | **The control group must be suppressed from treatment or the experiment is destroyed** |
| Sleeping dogs from an uplift model | Treatment is actively harmful |

```sql
select s.entity_id, s.segment
from   segment_members s
left join suppression p on p.entity_id = s.entity_id and p.active
where  p.entity_id is null;
```

**Report the suppression count and the reasons alongside the segment size.** A
segment of 1,400 that activates 1,180 after suppression is a different operational
plan from 1,400, and the 220 is not an error.

---

## 6. Versioning, freezing and re-scoring

- **Every segment definition is versioned**, and every sync records which version
  was pushed where and when. Without that, a performance comparison across a
  definition change compares two different segments.
- **Cluster assignments are frozen between refits.** A refit renumbers clusters;
  downstream systems keyed on cluster IDs then point at a different group,
  silently. **Re-score with the frozen model between refits, refit on a declared
  schedule, and run an explicit remapping step** that maps old IDs to new ones by
  membership overlap.
- **A threshold change is a version change.** Mark any trendline that crosses one.
- **Keep a snapshot of what was synced**, not just the definition. When someone
  asks in six weeks why an account got an email, the definition alone will not
  answer it.

```yaml
segment_version:
  id: "high-intent-v3"
  effective_from: "2026-09-20"
  source_model: "propensity-v2"
  cut_points: {enter: 0.70, exit: 0.60}     # hysteresis
  min_dwell_days: 7
  suppression_lists: [opt_out, open_late_stage_opp, experiment_holdout]
  refresh: "daily, delta sync"
  destinations: [{platform, object, last_synced, matched_count}]
  supersedes: "high-intent-v2"
```

---

## 7. Output

```yaml
source: {model_or_clustering, version, calibrated: bool}
cut_points:
  method: capacity | cost | both
  capacity_threshold: {value, weekly_capacity, list_size}
  cost_threshold: {value, cost_of_action, value_of_conversion}
  gap_finding: "<untouched positive-EV volume>"
  bands: [{name, rule, action, size}]
  hysteresis: {enter, exit} | none
  min_dwell_days: <n>
stability:
  weekly_membership_churn: <v>
  cause: score_volatility | boundary_crowding | both
  share_near_boundary: <v>
  supports_multitouch: bool
  post_hysteresis_churn: <v>
size_over_time: [{period, size, matched_size}]
suppression:
  lists_applied: [...]
  suppressed_count: <n>
  reasons: {...}
activation:
  destination, object_type
  platform_constraint: "<the named limit from §4>"
  capability_verified: bool
  sync_mode: full | delta
  cadence, rate_limit_plan
  match_rate: <v>, matched_count: <n>, minimum_size_floor: <n>
  write_verified: bool
versioning:
  segment_version, supersedes, sync_log_retained: bool
  cluster_freeze_and_remap: "<procedure, where applicable>"
```

---

## 8. Answering

**Answer first: the segment, its size, and the one constraint that changes the
plan.**

> **Your high-intent segment is 212 accounts a week, and it needs hysteresis
> before you run a five-touch sequence on it.**
>
> The cut point is capacity-derived — 200 is what the team actually worked last
> month, and the 212 is this week's distribution at that rank. The cost-optimal
> threshold is much lower and would admit about 1,400 a week; **the 1,200 in
> between are positive expected value and nobody touches them**, which is the
> more interesting number on this page.
>
> **On stability:** at a hard threshold, weekly membership churn is 38%, and 31%
> of members sit within 0.02 of the cut. That is boundary crowding, not score
> volatility — so a five-touch sequence would lose a third of its audience by
> touch three. With hysteresis at enter 0.70 / exit 0.60 and a 7-day minimum
> dwell, churn drops to 14%, which supports the sequence. That is the version I
> would ship.
>
> **One constraint on the destination.** Cohorts there are query-time constructs,
> so an export is a snapshot rather than a stable set — the sequence must own its
> own membership snapshot rather than re-querying the cohort at each touch,
> otherwise people silently fall out mid-sequence.
>
> After suppression — opt-outs, open late-stage opportunities and the experiment
> holdout — the activated audience is 178. Push is a delta sync, daily, inside
> the platform's rate limits, and it goes through `write-gate`.

**Withhold only** what cannot be computed: a stability figure with only one
snapshot (say so, give the number of snapshots needed and when), a match rate
before the first sync (give the pre-match size and say the matched count is
unknown until the push), and a cost-optimal threshold with no cost inputs — in
that case give the capacity threshold, which needs none, and name the two inputs
required for the other.

**Never** promise a destination capability the research contradicts. Where the
platform cannot do it, say what it cannot do, name the route that works, and
size the manual alternative.

---

## Calls

- **`write-gate`** — **every activation is a write and passes the gate.** The
  segment version, destination and record count are declared before the push
- `answer-contract` — segment sizes, churn rates and thresholds
- `provenance-block` — model version, segment version, scoring window, freshness
- `comparability-rules` — before comparing segment performance across versions,
  thresholds or refreshes
- `rate-limit-governor` — sync pacing against the destination's limits; batch,
  do not iterate
- `mcp-detect-fallback` — where an MCP server cannot perform the activation,
  detect and fall back to the REST path rather than failing
- `pagination-patterns` — reading the current membership back from a destination
  for reconciliation

## References

- `references/cut-points-and-stability.md` — threshold derivation, hysteresis,
  churn measurement and the dwell-time patterns
- `references/activation-constraints.md` — the per-destination capability table
  with the honest limits and the fallback route for each

## Related skills

- `supervised-propensity-models` — the calibrated score most segments are cut from
- `clustering-and-persona-discovery` — cluster assignments, and the freeze/remap
  requirement
- `churn-prediction-models` — risk tiers
- `rfm-and-value-segmentation` — the rule-based segmentation this composes with
- `uplift-and-causal-models` — supplies the suppression list for sleeping dogs,
  and the targeting depth
- `model-evaluation-monitoring` — segment size and composition drift over time
- `platforms/*` — the module for each destination governs what is actually
  possible there
