# Decay, caps and exclusions

---

## 1. Decay functions

### Exponential (the default)

```
weight(age_days) = 0.5 ^ (age_days / half_life_days)
```

Smooth, memoryless, one parameter. At the half-life the contribution is halved;
at twice the half-life it is a quarter.

### Linear-to-zero

```
weight(age_days) = max(0, 1 − age_days / horizon_days)
```

Simpler to explain, reaches exactly zero at the horizon. Less natural — it treats
a 1-day-old and a 2-day-old action as nearly identical, then drops sharply near
the horizon.

### Step / windowed

```
weight(age_days) = 1 if age_days <= window else 0
```

The most explicable and the most brittle: an action at 31 days contributes
nothing while one at 29 contributes fully, so the score jumps as records age past
the boundary. **A legitimate choice when explicability outweighs smoothness** —
say which you used.

```python
def decayed_score(activities, as_of, half_life_days=30, horizon_days=365):
    """activities: [(occurred_at_days_before_as_of, points)]"""
    total = 0.0
    for age, points in activities:
        if age < 0 or age > horizon_days:
            continue
        total += points * 0.5 ** (age / half_life_days)
    return total


if __name__ == "__main__":
    fresh = decayed_score([(0, 10)], as_of=None)
    assert fresh == 10.0
    at_half_life = decayed_score([(30, 10)], as_of=None, half_life_days=30)
    assert abs(at_half_life - 5.0) < 1e-9
    ancient = decayed_score([(400, 10)], as_of=None)
    assert ancient == 0.0                          # beyond the horizon cut-off
    future = decayed_score([(-5, 10)], as_of=None)
    assert future == 0.0                           # point-in-time: no future rows
    # an old pile loses to one fresh strong signal
    old_pile = decayed_score([(200, 10)] * 8, as_of=None)
    assert old_pile < decayed_score([(1, 30)], as_of=None)
    print(f"decay ok: half-life={at_half_life}, old_pile={old_pile:.2f}")
```

The last assertion is the whole point of decay: **eight old actions lose to one
fresh strong signal.** Without decay they win, and the score measures history
instead of intent.

---

## 2. Half-life sensitivity testing

```python
from statistics import mean


def spearman(a, b):
    def rank(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            avg = mean(range(i + 1, j + 2))
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r
    ra, rb = rank(a), rank(b)
    n = len(a)
    ma, mb = mean(ra), mean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
    return num / den if den else 0.0


if __name__ == "__main__":
    assert abs(spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1.0) < 1e-9
    assert abs(spearman([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-9
    assert abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1.0) < 1e-9
    print("spearman ok")
```

**The procedure:**

1. Score the population at half-lives of 15, 30 and 60 days.
2. Compute the rank correlation between each pair.
3. Compute the share of records that change tier.

| Rank correlation across half-lives | Reading |
|---|---|
| > 0.9 | The half-life barely matters. Pick one and move on |
| 0.7–0.9 | Material but not decisive. **State the choice in the output** |
| **< 0.7** | **Load-bearing assumption.** The half-life must be justified from the sales cycle and stated prominently |

**Also compute the rank correlation between score and record age.** A behaviour
score correlating strongly with how long a record has existed is measuring
tenure, not behaviour — and that single number is the fastest way to prove a
decay-free score is broken.

---

## 3. Cap patterns

```sql
-- layered caps: per-day dedupe, then per-period, then per-category
with per_day as (
  select person_id, action_type, date(occurred_at) as day,
         max(points) as points                       -- one event per action per day
  from   activities
  where  occurred_at <= :as_of
  group by 1, 2, 3
),
per_action_period as (
  select *, row_number() over (partition by person_id, action_type
                               order by day desc) as rn
  from   per_day
  where  day >= :as_of - interval '90 days'
),
kept as (
  select * from per_action_period where rn <= :max_per_action
),
per_category as (
  select *, row_number() over (partition by person_id, category
                               order by points desc, day desc) as crn
  from   kept join action_taxonomy using (action_type)
)
select person_id,
       least(:total_cap,
             sum(points * power(0.5, date_diff('day', day, :as_of)
                                     / :half_life_days))) as score
from   per_category
where  crn <= :max_per_category
group by 1;
```

**Cap before decay.** Capping after decay means a burst scores fully on the day
it happens and only shrinks later — and the day it happens is precisely when
someone acts on the score.

| Cap | Typical value | Prevents |
|---|---|---|
| Per action per day | 1 | Refresh loops |
| Per action per 30d | 3–5 | A habitual visitor outscoring a buyer |
| Per category per 30d | 5–10 | Downloading the whole resource library |
| Lifetime per action | 3 | Repeated low-value actions accumulating forever |
| Total per 30d | A ceiling near the MQL threshold | Runaway totals from any cause |

---

## 4. Exclusions

```sql
-- exclusions applied before scoring, with the volume reported
select reason, count(*) as excluded_events
from  (select case
                when ua ~* '(bot|crawler|spider|monitor|preview)' then 'bot_user_agent'
                when email_domain in (select domain from internal_domains) then 'internal'
                when ip in (select ip from internal_ips)                   then 'internal_ip'
                when action_type = 'email_click'
                     and date_diff('second', sent_at, occurred_at) < 5     then 'scanner_click'
                when action_type = 'email_open'
                     and opens_within_minute > 3                           then 'proxy_prefetch'
              end as reason
       from activities) x
where reason is not null
group by 1;
```

| Exclusion | Signature | Why it matters |
|---|---|---|
| **Scanner clicks** | Click within seconds of send; often every link including unsubscribe | Makes security-conscious enterprises look like your most engaged leads |
| **Proxy opens** | Many opens in the same minute; open at delivery time | Opens are inflated **unevenly**, so they compare recipients' mail providers |
| Bot user agents | Known strings | |
| Internal traffic | Employee domains and office IPs | Inflates scores on accounts your own team researches |
| Monitoring tools | Regular-interval hits on the same pages | |

**Report the excluded volume.** Removing 18% of email clicks silently changes
every score, and someone will notice the drop and attribute it to demand.

---

## 5. Point-in-time scoring

Every rule above filters on `occurred_at <= :as_of`. Three consequences:

1. **Recompute the score as of a past date** by changing one parameter — which is
   what makes historical scores available for `ml-lead-scoring` training
   features.
2. **Snapshot the score anyway.** Rules change, and a recomputed historical score
   under today's rules is not the score that existed then. Both are useful; they
   are different things and must not be mixed.
3. **Activity arriving late** (a sync catching up, a batch import) changes
   historical scores retroactively. If reproducibility matters, snapshot at
   scoring time — the same restatement discipline as any settling source.
