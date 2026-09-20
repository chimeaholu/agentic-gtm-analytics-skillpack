# Cut points, hysteresis and membership stability

---

## 1. Deriving the three thresholds

```python
def thresholds(scores, weekly_capacity, cost_of_action=None,
               value_of_conversion=None):
    """scores: calibrated probabilities for one scoring cycle."""
    s = sorted(scores, reverse=True)
    out = {"n_scored": len(s)}
    if s:
        idx = min(weekly_capacity, len(s)) - 1
        out["capacity_threshold"] = s[idx]
        out["capacity_list_size"] = idx + 1
    if cost_of_action and value_of_conversion:
        t = cost_of_action / value_of_conversion
        out["cost_threshold"] = t
        out["cost_list_size"] = sum(1 for v in s if v > t)
        out["untouched_positive_ev"] = max(
            0, out["cost_list_size"] - out.get("capacity_list_size", 0))
    return out


if __name__ == "__main__":
    scores = [i / 1000 for i in range(1000)]          # 0.000 .. 0.999
    t = thresholds(scores, weekly_capacity=200,
                   cost_of_action=25, value_of_conversion=1200)
    assert abs(t["capacity_threshold"] - 0.800) < 1e-9     # 200th from the top
    assert abs(t["cost_threshold"] - 25 / 1200) < 1e-12
    assert t["cost_list_size"] > t["capacity_list_size"]
    assert t["untouched_positive_ev"] == t["cost_list_size"] - 200
    print("thresholds ok:", {k: round(v, 4) if isinstance(v, float) else v
                             for k, v in t.items()})
```

**The `untouched_positive_ev` number is usually the most valuable output of this
skill.** It converts "we should hire another SDR" from an opinion into a
quantity, and it costs nothing to compute once the score is calibrated.

---

## 2. Measuring membership churn

```sql
with snapshots as (
  select snapshot_date, entity_id
  from   segment_membership
  where  segment = :segment
     and snapshot_date in (:w1, :w2)
)
select
  count(*) filter (where snapshot_date = :w1)                    as size_w1,
  count(*) filter (where snapshot_date = :w2)                    as size_w2,
  count(*) filter (where snapshot_date = :w1
                     and entity_id in (select entity_id from snapshots
                                       where snapshot_date = :w2)) as retained
from snapshots;
```

```
churn_rate = 1 − retained / size_w1
```

Compute over several consecutive pairs, not one — a single pair can be an
artefact of one bad scoring run.

### Diagnosing the cause

```sql
select avg(abs(b.score - a.score))                        as mean_score_move,
       avg((abs(a.score - :threshold) < 0.02)::int)       as share_near_boundary,
       corr(a.score, b.score)                             as score_rank_stability
from   scores a join scores b using (entity_id)
where  a.scored_at = :w1 and b.scored_at = :w2;
```

| `mean_score_move` | `share_near_boundary` | Cause | Fix |
|---|---|---|---|
| Low | **High** | **Boundary crowding** | **Hysteresis** — cheapest, most effective |
| **High** | Low | **Score volatility** | Smooth the score, or fix the underlying feature instability |
| High | High | Both | Hysteresis first, then investigate the features |
| Low | Low | Genuine movement | Nothing to fix; the customers really moved |

---

## 3. Hysteresis

Two thresholds instead of one: enter high, exit low.

```python
def apply_hysteresis(prev_members, scores, enter, exit_, dwell_days=None,
                     entered_at=None, today=None):
    """Returns the new member set. prev_members: set of ids currently in."""
    members = set()
    for eid, s in scores.items():
        if eid in prev_members:
            held = (dwell_days and entered_at and today
                    and (today - entered_at.get(eid, today)).days < dwell_days)
            if s >= exit_ or held:
                members.add(eid)                 # stay in
        elif s >= enter:
            members.add(eid)                     # join
    return members


if __name__ == "__main__":
    scores = {"a": 0.75, "b": 0.65, "c": 0.55}
    fresh = apply_hysteresis(set(), scores, enter=0.70, exit_=0.60)
    assert fresh == {"a"}                        # only a clears the entry bar
    sticky = apply_hysteresis({"a", "b"}, scores, enter=0.70, exit_=0.60)
    assert sticky == {"a", "b"}                  # b stays: above the exit bar
    dropped = apply_hysteresis({"c"}, scores, enter=0.70, exit_=0.60)
    assert dropped == {"a"}                      # c falls below the exit bar, a joins
    print("hysteresis ok")
```

**Choosing the two thresholds.** Set `enter` from capacity (§1). Set `exit` about
one decile of score below it — wide enough that ordinary score noise does not
push a record out, narrow enough that a genuinely cooling record leaves.

**The effect is large.** Boundary-crowded segments routinely drop from 35–40%
weekly churn to 10–15% with nothing else changed, because most of the churn was
records oscillating across a single line.

**The cost:** the segment is slightly larger and slightly less precise at the
margin, and a record that cooled takes longer to leave. For a multi-touch
programme that is a good trade; for a one-shot high-cost action it may not be.
State the trade rather than applying it silently.

---

## 4. Minimum dwell time

Once a record enters, it stays for N days regardless of score.

Use it when the **programme has a fixed duration** — a five-touch sequence over
three weeks needs its audience present for three weeks. Set `dwell ≥ programme
length`, otherwise people exit mid-sequence and the sequence's measured
performance is polluted by partial exposure.

Dwell and hysteresis compose: dwell guarantees the programme completes,
hysteresis prevents re-entry churn afterwards.

---

## 5. Smoothing a volatile score

```sql
select entity_id,
       avg(score) over (partition by entity_id
                        order by scored_at
                        rows between 4 preceding and current row) as smoothed
from   scores;
```

Use when `mean_score_move` is high — the score itself is unstable, not just the
boundary. **Smoothing adds lag**: a genuine change takes k runs to show. On a
daily score with a 5-run window that is a week of delay, which matters for an
intent signal and does not for a fit score.

**Prefer fixing the underlying instability.** A score that moves this much
usually has a feature with a broken or late-arriving pipeline behind it; check
`feature-engineering-gtm` §drift before smoothing over the symptom.

---

## 6. Size over time

```sql
select snapshot_date,
       count(*)                                          as size,
       count(*) filter (where matched)                   as matched_size,
       avg(score)                                        as mean_score
from   segment_membership where segment = :s
group by 1 order by 1;
```

| Pattern | Reading |
|---|---|
| Size trending up, mean score flat | The population is growing. Capacity check needed |
| **Size trending up, mean score rising** | **Score inflation.** A definition problem, not demand growth — see `behavioural-activity-scoring` |
| Size stable, membership churning | Boundary crowding |
| Size collapsed in one period | Pipeline failure. Check before anything else |
| Matched size falling while size holds | Identity or match-rate degradation at the destination |

**A segment whose size doubles without a corresponding outcome shift is
inflation**, and it is one of the most common silent failures in GTM scoring.
