---
name: behavioural-activity-scoring
description: Use when building or reviewing a behavioural or engagement score — points for content, email, web, product or event activity. Applies recency decay so old activity does not accumulate forever, caps repeatable actions so one person refreshing a pricing page cannot outscore a genuine buying signal, and validates the point weights against actual conversion evidence. Prevents a score that mostly measures how long a record has existed.
---

# Behavioural Activity Scoring

Behaviour is "what they did". It moves fast, it only exists after engagement
starts, and it is the axis where **the default implementation — add points for
each action, forever — produces a score that measures record age.**

Four disciplines fix that: **decay**, **caps**, **evidence-based weights**, and
**inflation monitoring.** Everything else in this skill is detail on those four.

---

## 1. Recency decay is mandatory

**Without decay, the score measures how long the record has existed, and the
oldest records always win.** A contact who downloaded three whitepapers in 2023
outranks one who booked a demo yesterday. Sales notices, and stops trusting the
score.

### Exponential decay, the default

```
score_now = Σ over activities of  points_i × 0.5 ^ (age_days_i / half_life_days)
```

```sql
select person_id,
       sum(a.points * power(0.5, date_diff('day', a.occurred_at, :as_of)
                                 / :half_life_days)) as behaviour_score
from   scored_activities a
where  a.occurred_at <= :as_of                        -- point-in-time
  and  a.occurred_at >= :as_of - interval '365 days'  -- horizon cut-off
group by 1;
```

### Choosing the half-life

**Derive it from your own sales cycle, do not inherit it.**

| Sales cycle | Sensible half-life | Reasoning |
|---|---|---|
| Transactional, days | 3–7 days | Intent evaporates quickly |
| SMB, weeks | 14–21 days | |
| Mid-market, 1–3 months | **30 days** — the common default | Activity a month old is half as relevant |
| Enterprise, 6–12 months | 60–90 days | Long evaluations; early research still matters |

**Sensitivity-test it, exactly as with time-decay attribution.** Recompute the
score at 15, 30 and 60 days, and look at how much the ranking moves (rank
correlation) and how many records change tier. **If the top decile is materially
different at 15 and 60 days, the half-life is a load-bearing assumption and must
be stated in the output**, not buried in a config file.

### The alternative: windowed scoring

```
score = points from the last 30 days only
```

Simpler, easier to explain, and a hard cliff — an action 31 days old contributes
nothing while one at 29 days contributes fully. Decay is smoother and better
behaved; **a window is more explicable and a legitimate choice.** Say which you
used.

### Horizon cut-off

Even with decay, keep a hard cut-off (365 days is reasonable). Beyond it the
decayed contribution is negligible but the query cost is not, and an ancient
record with thousands of tiny contributions can still accumulate a meaningful
total.

---

## 2. Cap repeatable actions

**Ten pricing-page views in one afternoon is one signal, not ten.**

| Cap type | Rule | Catches |
|---|---|---|
| **Per action per day** | Max 1 scoring event per action type per person per day | Refresh loops, tab-reopening |
| **Per action per period** | Max N per 30 days | A habitual visitor |
| **Per action lifetime** | Max N ever | Repeated newsletter opens |
| **Per category per period** | Max N points from "content downloads" per month | Someone downloading the whole library |
| **Total per period** | Ceiling on all points earned in a window | Runaway totals from any cause |

```sql
-- deduplicate to one scoring event per person per action per day, then cap per period
with deduped as (
  select person_id, action_type, date(occurred_at) as day, max(points) as points
  from   activities
  where  occurred_at <= :as_of
  group by 1, 2, 3
),
capped as (
  select *, row_number() over (partition by person_id, action_type
                               order by day desc) as rn
  from   deduped
  where  day >= :as_of - interval '30 days'
)
select person_id,
       sum(points * power(0.5, date_diff('day', day, :as_of) / :half_life_days))
         as behaviour_score
from   capped
where  rn <= :max_per_action_per_period
group by 1;
```

**Cap before decay.** Capping after decay lets a burst of activity accumulate
full points on the day it happens and only shrink later — so the day-of score is
still wrong, which is exactly when someone acts on it.

### The bot and automation problem

Score inflation from non-human activity is real and it is not always obvious:

- **Email security scanners click every link** in an email before delivery,
  including unsubscribe links. Those clicks look identical to human ones.
- **Privacy proxies pre-fetch images**, so opens are inflated and unevenly so
  across recipients. **Opens are the weakest email signal for this reason.**
- **Monitoring and uptime tools** hit your pages on a schedule.
- **Internal traffic** from employees browsing the site or testing a form.

Exclude what you can identify — known bot user agents, internal IP ranges and
domains, click timestamps within seconds of send — and **report the excluded
volume** rather than removing it invisibly. A score built on unexcluded scanner
clicks says the most security-conscious enterprises are your most engaged leads.

---

## 3. Validate weights against conversion evidence

**Assigning points by intuition is how a score ends up rewarding webinar
attendance at the same rate as a pricing-page visit.**

```sql
-- conversion lift per action type: did people who did this convert more?
select a.action_type,
       count(distinct a.person_id)                        as people_who_did_it,
       avg(o.converted::int)                              as conv_rate_with,
       (select avg(converted::int) from outcomes)         as conv_rate_overall,
       avg(o.converted::int)
         / nullif((select avg(converted::int) from outcomes), 0) as lift
from   activities a
join   outcomes o using (person_id)
where  a.occurred_at < o.outcome_window_start            -- strictly before
group by 1
having count(distinct a.person_id) >= 50
order by lift desc;
```

**Four rules:**

1. **Activity must precede the outcome window.** An action taken during the sales
   process predicts the sales process. This is the leakage rule from
   `ml-foundations-marketing`, applied here.
2. **Volume floor per action type.** An action taken by 9 people cannot support a
   weight.
3. **Set weights proportional to lift**, then round to something human — a table
   of 3, 5, 10, 20 is more usable and more defensible than 3.7, 5.2, 9.8.
4. **Report the actions whose assigned weight the data does not support.** That
   list is the most valuable output of this skill, and it is the one nobody
   produces.

### The unsupported-weight report

| Action | Current points | Observed lift | Verdict |
|---|---|---|---|
| Pricing page view | 5 | 3.1× (n=840) | **Under-weighted** |
| Webinar attendance | 20 | 1.1× (n=310) | **Over-weighted — the data does not support it** |
| Whitepaper download | 10 | 1.3× (n=1,240) | Over-weighted |
| Demo request | 30 | 6.2× (n=190) | Correct, if anything under |
| Email open | 2 | 1.0× (n=9,800) | **No signal. Consider removing** |

**The caveat that must accompany it:** actions that are *symptoms* of intent
score high lift but are not *causes* — this is a ranking of predictiveness, not a
recommendation about what to promote. A demo request predicts conversion because
people who want to buy request demos.

---

## 4. Negative scoring and disqualification

Negative signals are part of the model, not an afterthought bolted on later.

| Signal | Treatment |
|---|---|
| **Unsubscribe** | Large negative, or **suppression** — this is a stated preference |
| **Hard bounce / invalid email** | Suppression, and a data-quality flag |
| Careers-page visit | Negative — usually a job seeker, not a buyer |
| Support or documentation-only usage | Context-dependent: negative for a new lead, **positive for an expansion motion** |
| Competitor or partner domain | Disqualify, or route to a separate track |
| Free-mail domain on a B2B form | Weak negative, **not** a disqualification — plenty of real buyers use one |
| Student or academic domain | Usually disqualify for commercial motions |
| Role change / left the company | **Reset the score.** The person is gone; the account's history is not the new contact's |
| Long inactivity | **Handled by decay**, not by a separate penalty. Double-penalising is a common bug |

**Two rules:**

- **Disqualification is different from a low score.** A disqualified record should
  be removed from the scored population, not left to sit at the bottom of the
  list consuming attention.
- **Negative scores must not go below a floor.** A record at −300 cannot recover
  even with genuine engagement, which makes the score useless if that person
  comes back with real intent.

---

## 5. Score inflation is the normal failure mode

**MQL counts get gamed by score inflation**, and it does not look like gaming —
it looks like demand growth.

```sql
select date_trunc('month', scored_at)                    as month,
       count(*)                                          as scored,
       avg(score)                                        as mean_score,
       percentile_cont(0.9) within group (order by score) as p90_score,
       avg((score >= :mql_threshold)::int)               as mql_rate,
       avg(converted::int)                               as conversion_rate
from   score_snapshots group by 1 order by 1;
```

**The diagnostic:**

| Score distribution | Conversion rate | Reading |
|---|---|---|
| Rising | Rising proportionally | **Genuine improvement.** Lead quality really did improve |
| **Rising** | **Flat or falling** | **Inflation.** A definition problem, not demand growth |
| Flat | Rising | Improvement not captured by the score — the criteria may be stale |
| Rising sharply in one month | Any | Check for a rules change, a tracking change or a new integration first |

**Treat a rightward drift with flat conversion as a definition problem.** The
usual causes: a new tracking integration adding events that were always happening
but never scored, a new content programme generating cheap points, an uncapped
action, or a rule added without removing one.

**Fixing it:** re-anchor the threshold to a **fixed conversion rate** rather than
a fixed score. "MQL = the score at which historical conversion is 8%" survives
inflation; "MQL = 100 points" does not.

---

## 6. Activity capture is incomplete and unevenly so

The same caveat as sales activity analytics, and it matters as much here.

| Gap | Effect on the score |
|---|---|
| Rep email/calendar sync not enabled for everyone | Contacts of unsynced reps score lower |
| Calls logged manually | Under-recorded, and unevenly by rep |
| Web tracking blocked by consent or ad blockers | Under-recorded, and **correlated with technical sophistication** |
| Anonymous sessions never stitched to a person | Pre-conversion research invisible; see `identity-resolution` |
| Product events not instrumented for every feature | Whole usage categories invisible |
| Email opens inflated by proxies, clicks by scanners | Over-recorded, unevenly |

**Report score coverage alongside the score.** A person scored on web plus email
plus product is not comparable to one scored on email alone, and
`comparability-rules` applies within a single scoring model.

**The direction of error, stated plainly:** behaviour scores **understate**
engagement for privacy-conscious visitors and for contacts of reps whose activity
is not synced. That sentence belongs in the deliverable.

---

## 7. Person scores roll up to accounts with an explicit rule

**Six people at 20 is a different signal from one person at 120.** In B2B the
account is the buying unit, and a person-level score read as an account signal
misses the multithreading that predicts B2B outcomes better than almost anything
else.

| Roll-up | What it captures | Misses |
|---|---|---|
| `max` | The strongest champion | Breadth |
| `sum` | Total account energy | Dominated by one heavy user |
| `mean` | Average engagement | Diluted by dormant contacts |
| `count of engaged contacts` | **Multithreading — the strongest B2B signal** | Intensity |
| `sum of top N` | A compromise | |
| **Several together** | Lets the downstream model or rule weigh them | More columns |

**Ship several and let the consumer choose.** A single roll-up rule decided in
SQL erases a distinction the business needs.

```sql
select account_id,
       max(person_score)                                      as max_person_score,
       sum(person_score)                                      as sum_person_score,
       count(*) filter (where person_score >= :engaged_floor)  as engaged_contacts,
       count(*) filter (where person_score >= :engaged_floor
                          and seniority in ('vp','c_level'))   as senior_engaged,
       count(distinct function) filter (where person_score >= :engaged_floor)
                                                              as functions_engaged
from   person_scores group by 1;
```

**The roll-up depends entirely on identity resolution.** Unlinked contacts make
an account look unengaged, and the error direction is always "understates".
Report the unmatched rate alongside.

---

## 8. Rules are versioned

```yaml
behaviour_rules:
  version: "behaviour-v5"
  effective_from: "2026-09-01"
  method: exponential_decay
  half_life_days: 30
  sensitivity_tested: [15, 30, 60]
  top_decile_stability_across_half_lives: 0.81      # rank correlation
  horizon_cutoff_days: 365
  actions:
    - {type: pricing_page_view, points: 15, cap_per_day: 1, cap_per_30d: 4,
       evidence_lift: 3.1, n: 840}
    - {type: webinar_attend, points: 5, cap_lifetime: 3,
       evidence_lift: 1.1, n: 310, note: "reduced from 20; data does not support"}
  negative:
    - {type: careers_page_view, points: -10}
    - {type: unsubscribe, action: suppress}
  score_floor: -50
  exclusions: [known_bots, internal_domains, clicks_within_5s_of_send]
  mql_threshold: {basis: "score at 8% historical conversion", current_value: 112}
  supersedes: "behaviour-v4"
```

**A trendline crossing a rules change is not a trend.** Mark it, and expect the
change itself to move MQL volume — which is why re-anchoring the threshold to a
conversion rate (§5) matters.

---

## 9. Output

```yaml
model:
  version, method: decay | window, half_life_days, horizon_cutoff
  sensitivity: {half_lives_tested, rank_correlation, tier_change_share}
weights:
  - {action, points, cap_rules, evidence_lift, n, verdict}
unsupported_weights:
  - {action, current_points, observed_lift, n, recommendation}
negative_and_disqualification:
  rules: [...], score_floor, suppressed_count
exclusions:
  bots, internal, scanner_clicks: {rule, volume_excluded}
distribution:
  by_period: [{period, mean, p90, mql_rate, conversion_rate}]
  inflation_verdict: genuine_improvement | inflation | stale_criteria | rules_change
coverage:
  by_channel: {web, email, product, calls, meetings}
  scored_on_all_channels_share: <v>
  direction_of_error: "understates for privacy-conscious and unsynced contacts"
account_rollup:
  rules_emitted: [max, sum, engaged_contacts, senior_engaged, functions_engaged]
  identity_unmatched_rate: <v>
thresholds:
  mql: {basis, value, recomputed_on: <cadence>}
```

---

## 10. Answering

**Answer first: the score, then the one thing wrong with it.**

> **Your behaviour score is mostly measuring record age, and three of your eight
> point values are not supported by the data.**
>
> There is no decay: a whitepaper download from 2023 contributes the same 10
> points as one from yesterday. The clearest evidence is that the rank
> correlation between behaviour score and record age is 0.62, which is not what a
> behaviour score should look like. With a 30-day half-life — matched to your
> ~2-month cycle — that drops to 0.09 and the top decile changes by 61%.
>
> **On the weights**, measured on activity strictly preceding the outcome window:
> pricing-page views carry 5 points and show 3.1× conversion lift (n=840), while
> webinar attendance carries 20 points and shows 1.1× (n=310). Email opens carry
> 2 points and show no signal at all (1.0×, n=9,800) — and opens are inflated by
> privacy proxies pre-fetching images, so they are measuring the recipient's mail
> provider as much as their interest. Revised weights are in the output.
>
> **Two caveats, one sentence each.** The half-life is a load-bearing assumption —
> at 15 days the top decile is materially different, so it is stated rather than
> buried. And 31% of your contacts are scored on email only because their reps'
> activity sync is not enabled, so **their scores understate** and are not
> comparable to the rest.
>
> **One thing to change today regardless:** cap pricing-page views at one per day.
> Right now your highest-scoring contact this month is a single person who
> refreshed a pricing page 34 times in one afternoon.
>
> Does not claim causality: these actions predict conversion, they do not cause
> it, so this is not a recommendation about which content to produce.

**Withhold only** what cannot be computed: a weight recommendation for an action
below the volume floor (give the count and say the evidence is insufficient), a
conversion-lift figure where activity cannot be placed before the outcome window
(say so — it would be leakage), and an account roll-up where identity resolution
has not run. Never withhold the score itself or the unsupported-weight list.

---

## Calls

- `answer-contract` — scores, lifts, coverage and the inflation verdict
- `provenance-block` — **timezone on every activity timestamp** (day boundaries
  decide which window an action falls in), rules version, source and freshness
- `comparability-rules` — before comparing scores across rule versions, periods,
  or contacts with different channel coverage
- `warning-field-reader` — activity extract caveats become coverage numbers
- `rate-limit-governor` — activity backfills across marketing platforms are
  exactly the workload that exhausts a quota
- `pagination-patterns` — a capped activity extract produces scores that are
  silently lower bounds

## References

- `references/decay-and-caps.md` — decay maths, half-life sensitivity testing,
  cap patterns and the bot-exclusion rules
- `references/weight-validation.md` — the conversion-lift procedure, volume
  floors, the unsupported-weight report and inflation monitoring

## Related skills

- `demographic-fit-scoring` — the other axis; never collapsed into this one
- `ml-lead-scoring` — the model that may replace or augment these rules
- `scoring-model-evaluation` — proves whether the tiers separate outcomes
- `journey-assembler` — assembles the activity stream this scores
- `identity-resolution` — without it, anonymous research is invisible and account
  roll-ups understate
- `funnel-model-designer` — the MQL stage definition this threshold feeds
- `sales-activity-analytics` — the same capture-coverage caveat, on the sales side
