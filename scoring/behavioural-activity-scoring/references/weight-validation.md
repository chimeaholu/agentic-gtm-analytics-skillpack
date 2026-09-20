# Validating weights and monitoring inflation

---

## 1. The conversion-lift procedure

```sql
with eligible as (                  -- people with a resolved outcome window
  select person_id, outcome_window_start, converted
  from   outcomes
  where  outcome_window_start between :start and :end
),
did as (                            -- actions STRICTLY BEFORE the window
  select distinct a.person_id, a.action_type
  from   activities a
  join   eligible e using (person_id)
  where  a.occurred_at < e.outcome_window_start
)
select d.action_type,
       count(distinct d.person_id)                      as n_people,
       avg(e.converted::int)                            as conv_with,
       (select avg(converted::int) from eligible)       as conv_overall,
       avg(e.converted::int)
         / nullif((select avg(converted::int) from eligible), 0) as lift,
       1.96 * sqrt(avg(e.converted::int) * (1 - avg(e.converted::int))
                   / nullif(count(*), 0))               as ci_halfwidth
from   did d join eligible e using (person_id)
group by 1
having count(distinct d.person_id) >= 50
order by lift desc;
```

**The `a.occurred_at < e.outcome_window_start` clause is the whole integrity of
this analysis.** Without it you measure actions taken during the sales process,
which predict the sales process. A "demo scheduled" event inside the window has
a lift of 8× and means nothing.

### Turning lift into points

```python
def weights_from_lift(lifts, base_points=5, max_points=30):
    """lifts: {action: (lift, n)}. Returns human-round point values."""
    out = {}
    for action, (lift, n) in lifts.items():
        if n < 50:
            out[action] = {"points": None, "verdict": "insufficient_evidence", "n": n}
            continue
        raw = base_points * max(0.0, lift - 1.0)
        # round to a human ladder
        ladder = [0, 2, 3, 5, 10, 15, 20, 30]
        pts = min(ladder, key=lambda p: abs(p - raw))
        out[action] = {"points": min(pts, max_points), "lift": lift,
                       "n": n, "verdict": "evidenced"}
    return out


if __name__ == "__main__":
    w = weights_from_lift({
        "pricing_page": (3.1, 840),
        "webinar": (1.1, 310),
        "email_open": (1.0, 9800),
        "rare_action": (5.0, 12),
    })
    assert w["pricing_page"]["points"] > w["webinar"]["points"]
    assert w["email_open"]["points"] == 0            # no lift => no points
    assert w["rare_action"]["verdict"] == "insufficient_evidence"
    assert w["rare_action"]["points"] is None
    print("weights ok:", {k: v["points"] for k, v in w.items()})
```

**The rounding ladder matters.** A table of 3, 5, 10, 20 is arguable and
implementable; 3.7, 5.2, 9.8 invites a debate about precision the evidence does
not support.

---

## 2. The unsupported-weight report

The output nobody produces and everybody needs:

| Action | Current | Evidence lift | n | Recommended | Verdict |
|---|---|---|---|---|---|
| Pricing page view | 5 | 3.1× | 840 | 10 | **Under-weighted** |
| Demo request | 30 | 6.2× | 190 | 30 | Correct |
| Webinar attendance | 20 | 1.1× | 310 | 0 | **Over-weighted — not supported** |
| Whitepaper download | 10 | 1.3× | 1,240 | 2 | Over-weighted |
| Email open | 2 | 1.0× | 9,800 | 0 | **No signal; consider removing** |
| Case-study view | 0 | 2.4× | 420 | 5 | **Missing from the model** |
| Partner-page view | 5 | — | 31 | — | Insufficient evidence |

**Two things to say alongside it:**

1. **This ranks predictiveness, not causality.** A demo request predicts
   conversion because people who want to buy request demos. This is not a content
   strategy.
2. **Changing the weights will change MQL volume**, immediately and possibly
   substantially. Re-anchor the threshold at the same time (§4) or the change
   looks like a demand collapse.

---

## 3. The email-signal hierarchy

Worth stating explicitly, because email actions are usually the highest-volume
inputs to a behaviour score and the least reliable:

| Signal | Reliability | Why |
|---|---|---|
| **Reply** | Highest | Requires a human to compose something |
| Meeting booked from an email | Highest | Explicit intent |
| **Click** | Good, with a caveat | **Security scanners click every link**; exclude clicks within seconds of send |
| **Open** | **Weakest** | **Privacy proxies pre-fetch images**, so opens are inflated unevenly across recipients. An open often measures the recipient's mail provider |
| Delivered | Not a signal | It says the address works |

**Opens measured across a mixed recipient base are not comparable between
recipients.** If opens are used at all, weight them low and say what they
include.

---

## 4. Inflation monitoring

```sql
select date_trunc('month', snapshot_at)                       as month,
       count(*)                                               as scored,
       avg(score)                                             as mean_score,
       percentile_cont(0.9) within group (order by score)     as p90,
       avg((score >= :threshold)::int)                        as mql_rate,
       avg(converted::int)                                    as conversion_rate,
       avg(converted::int) filter (where score >= :threshold) as mql_conversion_rate
from   score_snapshots
group by 1 order by 1;
```

**`mql_conversion_rate` is the number that matters.** If MQL volume rises and
MQL conversion falls, the definition loosened — more leads are crossing the line
and they are worse. That is inflation, and it is a definition problem, not
demand growth.

| Volume | MQL conversion | Verdict |
|---|---|---|
| Up | Flat | **Inflation** |
| Up | Down | **Inflation, and the threshold is now wrong** |
| Up | Up | Genuine improvement |
| Flat | Up | Lead quality improved; the score is not capturing it |
| Sharp one-month jump | Any | **Check for a rules, tracking or integration change first** |

### Re-anchoring the threshold

```sql
-- the score at which historical conversion equals the target rate
select min(score) as threshold
from  (select score,
              avg(converted::int) over (order by score desc
                                        rows between unbounded preceding
                                        and current row) as cumulative_conv
       from score_snapshots
       where snapshot_at >= current_date - interval '180 days') x
where cumulative_conv >= :target_conversion_rate;
```

**"MQL = the score at which historical conversion is 8%" survives inflation.
"MQL = 100 points" does not.** Recompute the threshold on a declared cadence —
quarterly is usually right — and mark the trendline where it changes.

---

## 5. What to check first when the score jumps

In order, because the cheap causes are also the common ones:

1. **A rules change.** Check the version log before anything else.
2. **A new tracking integration** adding events that were always happening.
3. **An uncapped action** newly available — a new content type, a new page.
4. **Bot or scanner traffic** from a new source.
5. **A data backfill** loading historical activity that now scores.
6. **Genuine demand change.** Last, because it is the least likely explanation
   for a sharp single-month move and the first one anyone reaches for.
