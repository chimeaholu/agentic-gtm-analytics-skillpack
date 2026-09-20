---
name: feature-engineering-gtm
description: Use when preparing features for any GTM machine-learning model — propensity, churn, lead scoring, value prediction or forecasting. Builds point-in-time-correct features from CRM, marketing, product and firmographic data, with an explicit as-of discipline so every feature is one that actually existed when the prediction would have been made. Prevents the most expensive and least visible modelling error in GTM: a feature whose value at scoring time is not the value the model was trained on.
---

# Feature Engineering for GTM

One discipline, stated once: **every feature is computed as of the prediction
timestamp, using only data that had arrived by then.**

Everything below is a consequence of that sentence. The reason it needs a whole
skill is that almost every GTM source table is current-state, so the default
implementation — join the CRM tables, compute the features — is wrong in a way
that improves your offline metrics.

---

## 1. The as-of contract

Every feature table has two timestamps and they are not the same:

| Column | Meaning |
|---|---|
| `as_of_ts` | the prediction point. Features describe the world at this instant |
| `available_ts` | the earliest wall-clock time this row could actually have been computed, i.e. `as_of_ts` + the slowest contributing source's availability lag |
| `label_ts` | when the outcome resolved. Must be > `as_of_ts` + nothing, and the gap is the horizon |

**The row is only usable for training if `available_ts` ≤ the time the model
would really have scored it.** A feature whose source arrives 48 hours later
cannot serve a score produced at form-submit time, regardless of how predictive
it looked in training.

```sql
-- every feature build ends with this assertion
select count(*) as violations
from   features
where  available_ts > scoring_deadline_ts      -- would not have arrived in time
   or  label_ts    <= as_of_ts;                -- label precedes the prediction
-- must be 0
```

### The three questions per feature

1. **Did this value exist at `as_of_ts`?** (point-in-time correctness)
2. **Had it arrived by the time we would have scored?** (availability lag)
3. **Will the same computation be possible at real scoring time?** (train/serve
   parity)

A feature passing 1 and 2 but failing 3 is the classic training-serving skew:
the training pipeline runs in SQL over the warehouse, the scoring pipeline runs
in the application, and the two compute "sessions in the last 30 days"
differently.

---

## 2. Latest-value-wins fields are not historical features

**This is the default mistake and it is nearly universal.** Most GTM person and
account records are Type-1: the field holds the *current* value and the previous
value is gone.

| Source | The trap |
|---|---|
| **Product analytics person properties** | Person properties are latest-value-wins, not point-in-time. Querying `person.properties.plan` gives today's plan, not the plan at event time. A "plan at signup" feature built from them is wrong for every customer who ever upgraded |
| **CDP user traits** | `identify` traits overwrite. The `users` table is a current-state projection of the trait stream |
| **CRM lifecycle stage / lead status** | Current stage only. There is no "stage in March" field |
| **CRM owner, segment, tier** | Reassignments overwrite. A model trained on current owner learns the post-handoff owner |
| **Marketing-automation score and grade** | Current values with no exposed history. You cannot reconstruct "what was this prospect's score in March" from the API — if score trends matter, snapshot on a schedule yourself |
| **Enriched firmographics** | The vendor writes today's employee count onto a record created four years ago |

### The four legitimate sources of historical state, in preference order

1. **Event-time properties.** The property captured *on the event*, at the time.
   In product analytics this is the event property, not the person property.
   This is the only source that is correct by construction.
2. **A field-history or object-history table** where the platform exposes one
   (CRM stage history, field history tracking). Coverage is usually limited to
   fields someone enabled tracking on, often after the fact — check the earliest
   history row before trusting the depth.
3. **Your own snapshots.** A daily or weekly capture of the current-state table
   into an SCD2 or dated-snapshot model. This is what `data-model-designer`
   builds, and it is the only route for platforms that expose no history at all.
4. **Reconstruction from the event stream** where a warehouse export of raw
   events exists. Expensive, and only as complete as the export's retention.

**If none of the four exists for a feature, the feature is not point-in-time
correct.** Say so, mark it in the dictionary, and offer the model both with and
without it so the cost of excluding it is visible rather than argued about.

### Snapshot design, minimum viable

```sql
-- daily current-state capture; cheap, and it is the thing nobody starts early enough
create table snap_account (
  snapshot_date date    not null,
  account_id    string  not null,
  owner_id      string,
  segment       string,
  employee_band string,
  plan          string,
  arr_band      string,
  primary key (snapshot_date, account_id)
);

-- point-in-time read
select f.*, s.segment, s.plan
from   prediction_points f
join   snap_account s
  on   s.account_id = f.account_id
 and   s.snapshot_date = date(f.as_of_ts);
```

Daily granularity is enough for almost every GTM feature. Start it today even if
the model is a year away — **the reason teams cannot build a point-in-time model
later is that they have current-state history only, and that is unrecoverable.**

---

## 3. Availability lag is a property of every feature

A feature's training-time value is irrelevant if it will not have arrived at
scoring time. Record the lag per source, from the platform research:

| Source class | Typical availability | Consequence for features |
|---|---|---|
| **Paid social insights** | settles over roughly **28 days** | Ad-derived features are provisional for four weeks. Never use a 7-day ad-spend feature in a real-time score |
| **Paid search conversions** | back-fills up to **90 days** | A conversion-count feature changes retroactively; snapshot it or it silently restates training data |
| **Web analytics (GA4-class)** | reprocesses over **24–48 hours** | Same-day session features are incomplete |
| **Ad demographics / video metrics** | demographics lag **12–24h**, video **48h** | Unusable for intraday scoring |
| **Product analytics (Amplitude-class)** | within roughly **2 hours** | Usable for hourly batch, not for sub-minute |
| **Messaging platforms (Braze-class)** | the vendor advises ~**5 minutes** between dependent calls | Affects extraction pacing, not feature freshness |
| **CRM via API** | near-real-time for reads, but **sync jobs are scheduled** | The lag is your pipeline's, not the vendor's. Measure it |
| **Enrichment vendors** | on-demand or batch, often weekly | Treat as a slow-moving attribute with an observation date |
| **Warehouse metadata views** | typically **45 minutes to 3 hours** of latency | Do not build freshness features from them and call them real-time |

```yaml
# the entry every feature carries in the dictionary
- name: paid_clicks_28d
  source: paid_social
  grain: account-day
  availability_lag: "28 days to settle; provisional before that"
  point_in_time: partial          # value restates after the fact
  scoring_viable_for: ["weekly batch", "monthly batch"]
  not_viable_for: ["real-time form-submit scoring"]
  restatement_handling: "snapshot at as_of_ts; never recompute from the live API"
```

**The restatement trap in one line:** if you rebuild training features from a
restating source today, you train on numbers that were not knowable then, and
the model learns the backfill.

---

## 4. The canonical GTM feature families

Five families. Most working models use twenty to sixty features drawn from them.

### 4.1 Firmographic (account-level, slow-moving)

Employee count and band, revenue band, industry (normalised — see §6), country
and region, entity age, funding stage, public/private, parent-child structure,
technographic detections.

- All carry an **observation date**. A technology detected 14 months ago may
  have been removed; state the observation date and consider a decay.
- Coverage is partial and biased — see `demographic-fit-scoring` §3. **Missing is
  not low.**

### 4.2 Behavioural (event-derived, fast-moving)

The workhorse family. Built as **count / recency / intensity over declared
windows**:

| Shape | Example | Notes |
|---|---|---|
| Count in window | `pageviews_30d`, `product_events_7d` | Declare the window; keep it identical in training and scoring |
| Distinct-day count | `active_days_28d` | More robust than raw counts to one heavy session |
| Recency | `days_since_last_event` | **Computed against `as_of_ts`, never `now()`** |
| Trend / ratio | `events_7d / (events_28d / 4)` | Acceleration. Often stronger than either level |
| First-time flags | `first_pricing_view_in_window` | Distinguishes a new signal from a habit |
| Depth | `distinct_features_used_28d`, `session_depth_p50` | Breadth of use beats volume of use for retention |
| Content class | `views_of_bottom_funnel_content_14d` | Requires a content taxonomy; without one, do not invent categories |

### 4.3 Engagement (two-way interaction)

Emails delivered/opened/clicked (with the tracking caveat below), replies,
meetings booked and held, calls connected, **multithreading** (distinct engaged
contacts at the account — one of the strongest B2B account features), seniority
mix of engaged contacts, inbound-vs-outbound initiation, response latency.

- **Email opens are inflated and unevenly so** by privacy proxies that pre-fetch
  images. Opens are not a clean signal; clicks and replies are cleaner. If opens
  are used, say what they include.
- **Activity capture is incomplete and unevenly so** across reps and channels.
  Report coverage alongside any activity feature.

### 4.4 Commercial

Plan and tier, seat count, price point, discount depth, contract length,
billing period, payment method class, expansion/contraction history, days to
renewal, prior purchase count and recency.

- **Amount fields in multi-currency systems need the home-currency variant.**
  Summing raw deal amounts across currencies produces a number that will not
  match any report the business trusts. The home-currency conversion is
  snapshotted per record at its own rate, so it is itself a point-in-time value.

### 4.5 Relational (account roll-ups of person features)

```sql
-- person → account roll-up, as of the prediction point
select a.account_id,
       f.as_of_ts,
       count(distinct p.person_id)                             as contacts_known,
       count(distinct case when p.events_28d > 0 then p.person_id end)
                                                               as contacts_engaged_28d,
       max(p.score)                                            as max_person_score,
       sum(p.score)                                            as sum_person_score,
       count(distinct case when p.seniority in ('vp','c_level')
                           then p.person_id end)               as senior_engaged
from   prediction_points f
join   accounts a       on a.account_id = f.account_id
left join person_features p
       on p.account_id = a.account_id and p.as_of_ts = f.as_of_ts
group by 1, 2;
```

**Keep both `max` and `sum`.** Six people at 20 is a different signal from one
person at 120, and a single roll-up rule erases the difference. This is the same
point `behavioural-activity-scoring` makes about person-to-account rules, and the
model should be allowed to learn which matters rather than having it decided in
the SQL.

---

## 5. Windows: declare them, and keep them identical

- **Every window feature names its window in its own name.** `clicks_30d`, not
  `recent_clicks`. A name that does not carry the window is a future bug.
- **The window must be identical in training and scoring.** A 30-day count at
  training and a 28-day count at scoring is a silent distribution shift, and
  nothing errors.
- **Align windows to the prediction point, not to the calendar.** "Last calendar
  month" varies from 28 to 31 days and shifts meaning by day-of-month.
- **Test 2–3 window lengths per behavioural signal** (7 / 28 / 90 is a good
  default set) and keep the ones that earn their place. Correlated windows are
  fine for trees, bad for linear models — regularise or pick one.
- **Timezone.** The window boundary depends on the source's timezone, and GTM
  sources disagree. Carry the timezone through from `provenance-block`; a day
  boundary that differs between the training extract and the scoring path shifts
  every window feature by up to a day.

---

## 6. High-cardinality categoricals

Campaign, source, medium, industry, job title, country, referring domain. All
have long tails and all get a new value tomorrow.

| Technique | When | Warning |
|---|---|---|
| **Group to a taxonomy** | Always first. Map campaigns to a channel; titles to a seniority × function grid; industries to a standard set | The mapping is a business artefact and it is versioned |
| **Frequency/rare grouping** | Collapse anything under a volume floor into `other` | Declare the floor. A campaign with 3 records cannot support its own level |
| **Target encoding** | Trees, high cardinality, enough data | **Out-of-fold and as-of only.** In-fold target encoding is leakage L6 |
| **One-hot** | Low cardinality after grouping | Explodes otherwise |
| **Ordinal/label encoding** | Trees only, and only where the order is meaningless-but-harmless | Never for linear models |

**Unseen categories at scoring time are certain, not hypothetical.** A campaign
launched this morning has no level. The pipeline must map unknown → `other`
deterministically and **count how often it fires**; a rising unknown rate is a
taxonomy that has stopped being maintained, and it degrades the model silently.

```sql
select date_trunc('week', as_of_ts) as wk,
       avg((channel = 'other')::int) as unknown_rate
from   scored_records group by 1 order by 1 desc limit 12;
-- rising = the mapping is stale
```

### The normalisation trap across providers

Employee count, revenue and industry come from **different providers with
different definitions**. One counts the legal entity, another the group; one uses
a 4-digit standard classification, another its own 27 categories. Joining them
without normalising produces conflicting values for the same account and a model
that learns which provider covered the record.

**One provider per attribute per model, or an explicit normalisation with a
priority order and the provider recorded as its own feature.**

---

## 7. Missing is information

In CRM data a null is usually a *process* signal, not an absence of reality:
nobody filled the field, the enrichment did not cover this segment, the
integration was not connected yet.

- **Add an explicit `*_is_missing` indicator** for any field with meaningful
  missingness, then impute the value itself with something neutral. Trees can
  use the indicator directly; linear models need it.
- **Never impute a firmographic with the mean.** A missing employee count
  imputed to the dataset mean silently assigns mid-market status to every
  uncovered company, and coverage gaps skew towards small, non-US and privately
  held companies — exactly the segments that may be growing.
- **Missingness that correlates with the label is a leakage tell.** If a field is
  only populated on records that converted, the indicator is the label.
- **Check missingness drift over time.** A field that was 80% populated last year
  and 20% now signals a broken integration, and the model built on it is already
  degrading.

```sql
select date_trunc('month', created_at) as cohort,
       avg((industry is null)::int)    as missing_rate,
       avg(label)                      as positive_rate
from   records group by 1 order by 1;
-- missing_rate trending = integration change; missing_rate correlating with
-- positive_rate = investigate for leakage before using the indicator
```

---

## 8. The feature dictionary is the deliverable

Not a nice-to-have. It is what makes the model auditable and what lets the next
person rebuild it.

```yaml
- name: distinct_engaged_contacts_28d
  description: "Contacts at the account with ≥1 tracked engagement in the 28 days before as_of_ts"
  family: relational
  grain: account
  source: [crm.activity, marketing.email_event]
  window: 28d aligned to as_of_ts
  timezone: <source timezone, carried from provenance-block>
  point_in_time: correct
  historical_source: event-time records
  availability_lag: "activity sync, measured p95 4h"
  missing_rate: 0.11
  missing_meaning: "no tracked activity — capture is incomplete, see coverage"
  coverage_caveat: "activity capture varies by rep and channel; coverage 0.78"
  transform: none
  used_by: [ml-lead-scoring, churn-prediction-models]
  train_serve_parity: verified 2026-09-20 by replay
```

**Separately, a flagged list of features that cannot be made point-in-time
correct**, with what each would need. That list is a data-engineering backlog
with a measurable payoff, and it is often the most valuable artefact this skill
produces.

---

## 9. Drift monitoring is set up at build time

Not after the model degrades. At build time you still know what the training
distribution was.

Store, per feature, from the training set: mean/median, standard deviation, the
deciles, missing rate, and for categoricals the level frequencies. Then monitor
the scoring population against it.

| Signal | Measure | Default alert |
|---|---|---|
| Numeric drift | Population Stability Index against training deciles | PSI > 0.1 investigate, > 0.25 act |
| Categorical drift | Level-frequency PSI + unknown rate | unknown rate > 2× baseline |
| Missing drift | Missing rate per feature | ±10 percentage points absolute |
| Pipeline break | Any feature 100% null or 100% constant | **Immediate, louder than any metric move** |

```
PSI = Σ over bins of  (actual% − expected%) × ln(actual% / expected%)
```

**A broken feature pipeline and a genuine market shift look identical on a
metric chart.** The pipeline check is cheap and unambiguous, so it fires first.
`model-evaluation-monitoring` owns the alerting; this skill owns emitting the
baseline that the alerting compares against.

---

## 10. Output

```yaml
feature_table:
  grain: "<entity>-<as_of>"
  rows: <n>
  as_of_range: [<start>, <end>]
  columns: [as_of_ts, available_ts, entity_id, label_ts, <features...>]
feature_dictionary: [ <one entry per feature, §8 schema> ]
point_in_time_report:
  correct: <n>
  partial: <n>          # restating sources, snapshotted
  violating: <n>        # excluded, with reason
  unverified: <n>       # no snapshot exists to replay against
excluded_features:
  - name, reason, what_would_fix_it
availability:
  slowest_source, max_lag, scoring_modes_supported
drift_baseline:
  per_feature: {mean, sd, deciles, missing_rate, level_freqs}
assertions_run: [available_ts, label_ts, window_parity, unknown_rate]
```

---

## 11. Answering

**Answer first.** When someone asks whether a feature can be used, give the
verdict and the workaround in the same breath.

> **You can use plan tier, but not from the person-properties table.** Those are
> latest-value-wins, so "plan at signup" built from them returns today's plan for
> every customer who has ever upgraded — which biases the feature towards
> whatever the successful customers upgraded to, and makes the model look better
> than it is.
>
> Three routes, best first: the plan property captured on the signup event
> itself, if it was captured; a daily snapshot table if one exists; otherwise
> reconstruct from subscription change records, which is accurate but only as
> far back as that table goes.
>
> If none exist, the feature is excluded and I will report the model with and
> without it, so the cost of the gap is visible. And start a daily snapshot now —
> the reason this is hard is that nobody started one two years ago.

**Withhold only** a point-in-time correctness verdict you cannot establish: with
no snapshot and no history table, replay cannot run, and the honest result is
`unverified` with the proxy checks reported — not a claim of correctness.

---

## Calls

- `provenance-block` — every feature carries source, timezone, freshness and
  window; the feature dictionary is a provenance artefact
- `answer-contract` — feature viability verdicts and coverage numbers
- `warning-field-reader` — sampling, thresholding and truncation on the
  extraction propagate into the feature table as coverage caveats
- `pagination-patterns` — the extraction behind a feature build must be complete;
  a capped extract produces features that are silently lower bounds
- `rate-limit-governor` — batch feature backfills are exactly the workload that
  exhausts a platform's quota

## References

- `references/point-in-time-recipes.md` — SCD2 and snapshot join patterns, the
  as-of join, and the replay harness
- `references/feature-families.md` — the full feature catalogue with definitions,
  windows, and the per-source availability register

## Related skills

- `ml-foundations-marketing` — the gate; sets the prediction point and horizon
  this skill builds to
- `data-model-designer` — builds the SCD2 and snapshot tables that make
  point-in-time features possible
- `identity-resolution` — the entity keys every roll-up depends on
- `sql-transformation-builder` — where the feature SQL lives
- `model-evaluation-monitoring` — consumes the drift baseline emitted here
- `behavioural-activity-scoring` — the rule-based cousin of the behavioural family
