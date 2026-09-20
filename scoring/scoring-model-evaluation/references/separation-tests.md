# Separation tests

---

## 1. Cohorting correctly

```sql
create table scored_cohort as
select s.person_id,
       s.scored_at,
       s.score,
       s.score_tier,
       s.score_version,
       o.converted,
       o.outcome_at
from   score_snapshots s
left join outcomes o
       on o.person_id = s.person_id
      and o.outcome_at between s.scored_at and s.scored_at + :horizon
where  s.scored_at <= current_date - :horizon      -- horizon has fully elapsed
  and  s.scored_at between :start and :end;
```

**Three cohorting errors that invalidate everything downstream:**

1. **Cohorting by outcome date.** Selecting records that converted and looking up
   their scores measures the past, not the score's ability to predict.
2. **Including unresolved records.** Records scored inside the last horizon
   cannot have converted yet; they enter as negatives and depress every rate.
   Exclude them and **report how many were excluded**.
3. **Using the current score rather than the score at the time.** If the score is
   recomputed, today's value is not what anyone acted on. Use the snapshot.

---

## 2. Lift, gains and intervals

```python
def separation_report(scores, converted, k_pct=0.10, capacity=None):
    """Top-decile lift, lift at capacity, and cumulative gains."""
    pairs = sorted(zip(scores, converted), key=lambda t: -t[0])
    n = len(pairs)
    total_conv = sum(c for _, c in pairs)
    base = total_conv / n if n else 0.0

    def at(k):
        k = max(1, min(k, n))
        conv = sum(c for _, c in pairs[:k])
        prec = conv / k
        rel_se = (1 / conv) ** 0.5 if conv else None
        return {"k": k, "conversions": conv, "precision": prec,
                "lift": prec / base if base else None,
                "relative_se": rel_se,
                "share_of_conversions": conv / total_conv if total_conv else 0.0}

    out = {"base_rate": base, "n": n,
           "top_decile": at(int(n * k_pct)),
           "gains": [{"top_pct": p, **at(int(n * p))}
                     for p in (0.05, 0.10, 0.20, 0.30, 0.50)]}
    if capacity:
        out["at_capacity"] = at(capacity)
    return out


if __name__ == "__main__":
    # perfect score: all conversions at the top
    n = 1000
    scores = list(range(n, 0, -1))
    converted = [1] * 100 + [0] * 900
    perfect = separation_report(scores, converted)
    assert abs(perfect["base_rate"] - 0.10) < 1e-9
    assert abs(perfect["top_decile"]["lift"] - 10.0) < 1e-9
    assert abs(perfect["top_decile"]["share_of_conversions"] - 1.0) < 1e-9
    # random score: lift ~1
    import random
    random.seed(0)
    rnd = [random.random() for _ in range(n)]
    noise = separation_report(rnd, converted)
    assert 0.5 < noise["top_decile"]["lift"] < 1.6, noise["top_decile"]["lift"]
    print("separation ok: perfect lift =", perfect["top_decile"]["lift"])
```

**`relative_se ≈ 1/sqrt(conversions in the top k)`** — that single number tells
you how much of the lift figure to believe:

| Conversions in top k | Relative error | Report as |
|---|---|---|
| 10 | ±32% | "roughly 3×, wide interval on 10 conversions" |
| 31 | ±18% | "3.1× (2.5–3.7)" |
| 100 | ±10% | "3.1× (2.8–3.4)" |
| 400 | ±5% | "3.10× (2.95–3.25)" |

**The cumulative-gains sentence is the one that lands with executives:** *"the top
20% of scored leads contains 54% of the conversions"*. Same information as lift,
in a form people act on.

---

## 3. Do the tiers actually differ?

### The omnibus test first

Chi-square across all tiers. If the omnibus is not significant, no pairwise
comparison is worth running.

### Then pairwise, corrected

Comparing four tiers gives six pairs; at α = 0.05, roughly a 26% chance of at
least one false positive. Correct:

| Correction | Behaviour |
|---|---|
| **Bonferroni** | `α / m`. Conservative, simple |
| **Holm** | Step-down. Uniformly more powerful than Bonferroni. **The default** |
| **Benjamini–Hochberg** | Controls the false-discovery rate. Use when exploring many tiers |

```python
def holm(pvalues):
    """Returns adjusted p-values in the original order."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adj, running = [0.0] * m, 0.0
    for rank, i in enumerate(order):
        val = (m - rank) * pvalues[i]
        running = max(running, min(val, 1.0))      # enforce monotonicity
        adj[i] = running
    return adj


if __name__ == "__main__":
    a = holm([0.01, 0.04, 0.03])
    assert abs(a[0] - 0.03) < 1e-12                # 3 * 0.01
    assert a[1] >= a[2]                            # monotone after ordering
    assert all(0 <= v <= 1 for v in a)
    assert holm([0.5])[0] == 0.5                   # single test unchanged
    print("holm ok:", [round(v, 4) for v in a])
```

### Effect size, not just significance

With 50,000 records everything is significant. **A tier converting at 4.1%
against another at 4.3% is statistically real and operationally meaningless.**

Report the absolute difference, the relative difference, and what it means at the
list length actually worked: *"the difference between B and C is 1.2 percentage
points, which at 200 leads a week is about two extra conversions a month."* That
sentence decides whether anyone should care.

---

## 4. Monotonicity

```sql
select score_tier, avg(converted::int) as conv_rate, count(*) as n
from   scored_cohort group by 1 order by 1;
```

The rates must decrease monotonically from the top tier down. When they do not:

| Pattern | Cause | Fix |
|---|---|---|
| Two adjacent tiers overlap | The cut point between them is arbitrary | **Merge them** |
| A middle tier inverts | The score is not ordering in that range | Investigate the component weights in that band |
| The top tier underperforms the second | **Usually leakage or over-fitting in the score**, or a capacity effect where the very top is routed elsewhere | Check routing before blaming the score |

**Merging tiers that do not differ is a real improvement**, not a retreat. Four
tiers that behave as three make every downstream conversation less clear, and the
fourth tier invites action that the data does not support.

---

## 5. Comparing two scores

At **equal list length**, on the same cohort:

```sql
with ranked as (
  select person_id, converted,
         row_number() over (order by score_a desc) as rank_a,
         row_number() over (order by score_b desc) as rank_b
  from   scored_cohort
)
select 'a' as scorer, avg(converted::int) as precision_at_k,
       count(*) filter (where converted)  as conversions
from   ranked where rank_a <= :k
union all
select 'b', avg(converted::int), count(*) filter (where converted)
from   ranked where rank_b <= :k;
```

**Report the raw conversion counts, not only the rates.** "24 versus 28
conversions in the top 200" is honest about the margin in a way "2.9× versus
3.4×" is not.

**The overlap matters too:** if the two scores' top-200 lists share 170 records,
they are largely the same score, and the difference is 30 records' worth of
disagreement. Report the overlap — it frequently ends the debate.
