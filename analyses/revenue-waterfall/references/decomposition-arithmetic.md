# Decomposition arithmetic

---

## 1. Multiplicative decomposition, both conventions

For `R = x · y · z`:

### Sequential (chained)

```
Δ_x = (x₁ − x₀) · y₀ · z₀
Δ_y =  x₁ · (y₁ − y₀) · z₀
Δ_z =  x₁ ·  y₁ · (z₁ − z₀)
ΔR  = Δ_x + Δ_y + Δ_z        # exact, no residual
```

Reconciles exactly by construction. **Order-dependent**: the factor evaluated
first gets none of the interaction; the factor evaluated last gets all of it. A
different order gives different component sizes and can change which component
ranks second.

### Pure effects plus interaction

```
Δ_x = (x₁ − x₀) · y₀ · z₀
Δ_y =  x₀ · (y₁ − y₀) · z₀
Δ_z =  x₀ ·  y₀ · (z₁ − z₀)
interaction = ΔR − (Δ_x + Δ_y + Δ_z)
```

Order-independent, and the interaction is visible rather than absorbed.

### Choosing

| Prefer | When |
|---|---|
| **Pure + interaction** | the interaction is material, or the audience will question the order, or two components are close in rank |
| **Sequential** | a clean chart matters and the interaction is small — **and the order is declared** |

**Never switch conventions between periods.** A component that grew because the
convention changed is a reporting artefact that will be read as a business change.

---

## 2. Worked, both conventions

| | Base | Current |
|---|---|---|
| Opportunities | 420 | 380 |
| Win rate | 22.0% | 20.5% |
| Average deal size | 48,000 | 51,000 |
| **Revenue** | **4,435,200** | **3,972,900** |

`ΔR = −462,300` = −10.42%

### Sequential — order: count, win rate, deal size

```
Δ_count = (380 − 420) × 0.220 × 48,000 = −422,400
Δ_win   =  380 × (0.205 − 0.220) × 48,000 = −273,600
Δ_size  =  380 × 0.205 × (51,000 − 48,000) = +233,700
                                    total = −462,300  ✓
```

### Pure effects plus interaction

```
Δ_count = (380 − 420) × 0.220 × 48,000 = −422,400
Δ_win   =  420 × (0.205 − 0.220) × 48,000 = −302,400
Δ_size  =  420 × 0.220 × (51,000 − 48,000) = +277,200
          sum of pure effects             = −447,600
          interaction                     =  −14,700
                                    total = −462,300  ✓
```

**The win-rate component differs by 28,800 between the two conventions** — about
10%. The ranking is unchanged here, which is worth saying explicitly when
reporting; where it would change, the convention becomes a substantive choice and
both versions should be shown.

### Expressing components as points of the base

```
component_pp = component / R₀ × 100
```

| Component | Sequential | pp of base |
|---|---|---|
| Opportunity count | −422,400 | −9.52 |
| Win rate | −273,600 | −6.17 |
| Deal size | +233,700 | +5.27 |
| **Total** | **−462,300** | **−10.42** |

Points of base are the right unit for a narrative, because they add to the
headline percentage. **Absolute values are the right unit for a decision**,
because a point of base means nothing to someone sizing a response.

---

## 3. Mix decomposition

```
R = Σ_s  w_s · r_s

Δ_mix         = Σ_s (w_s¹ − w_s⁰) · r_s⁰
Δ_rate        = Σ_s  w_s⁰ · (r_s¹ − r_s⁰)
Δ_interaction = Σ_s (w_s¹ − w_s⁰) · (r_s¹ − r_s⁰)
```

### The signature of a missed mix effect

**The blended metric moved and no segment's metric moved in that direction.**
Whenever that is true, the movement is mix, and reporting it as a rate change is
wrong.

Run the mix decomposition on at least these dimensions before concluding any rate
changed:

| Dimension | Masquerades as |
|---|---|
| Segment | win rate, ASP |
| Product | pricing |
| Geography | ASP, FX |
| New vs renewal | win rate |
| Channel | conversion rate |

`churn-retention-analysis` carries a fully worked case where blended retention
improves 1.85 points while both segments decline. Same arithmetic, different
metric.

---

## 4. The subscription identity

```
starting_ARR + new + expansion − contraction − churn + reactivation = ending_ARR
```

**This is an identity. It must close to the cent.** When it does not, a movement
is miscategorised. The usual culprits, in order of frequency:

| Symptom | Likely cause |
|---|---|
| Ending ARR too high | a downgrade-then-churn counted once as contraction and once as churn, or not at all |
| Ending ARR too low | a reactivation classified as new, then its prior churn never reversed |
| Persistent small gap | mid-period amendments not captured at the movement grain |
| Gap equals one account | a currency change on renewal, or a term change re-based the annualisation |
| Gap grows over time | a movement type being dropped entirely — check for a category with zero rows |

Localise it by account:

```sql
select account_id,
       starting_arr + new + expansion - contraction - churn + reactivation
         - ending_arr as gap
from arr_movements
where period = :period
  and abs(starting_arr + new + expansion - contraction - churn
          + reactivation - ending_arr) > 0.01
order by abs(gap) desc;
```

**Find it. Do not plug it.** A plugged identity produces a waterfall that
balances and a movement category that is quietly wrong in every subsequent
period.

---

## 5. Assertions to run

```python
assert abs(sum(components) + residual - total_variance) < 0.01
assert convention in ("sequential", "pure_plus_interaction")
assert order_declared or convention == "pure_plus_interaction"
assert comparability_verdict == "proceed"
assert abs(start + new + expansion - contraction - churn + reactivation
           - end) < 0.01                                   # subscription only
assert residual_reported_as_own_line
```

The last one cannot be checked mechanically and is the one that matters. **A
residual folded into the largest component produces a chart whose bars sum
correctly and whose story is wrong**, and there is no test for it except reading
the code that built the chart.
