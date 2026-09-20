# Uplift estimation and evaluation, worked

---

## 1. The learners

### T-learner (two-model)

```python
m_t = clone(base).fit(X[t == 1], y[t == 1])
m_c = clone(base).fit(X[t == 0], y[t == 0])
uplift = p_t(X_new) - p_c(X_new)
```

Transparent, one hour to build, and correct as an estimator. Its weakness is
variance: each model minimises its own error, not the error of the difference,
so at a 3% base rate you are subtracting two noisy numbers and keeping the noise.

**Calibrate both arm models before subtracting.** Differencing two uncalibrated
probabilities produces a quantity with no interpretation.

### S-learner (single model)

```python
X_aug = hstack([X, t])
m = clone(base).fit(X_aug, y)
uplift = m.predict_proba(with_t(X_new, 1))[:, 1] - m.predict_proba(with_t(X_new, 0))[:, 1]
```

Shares data across arms, which helps when one arm is small. **The failure mode is
distinctive:** if the treatment effect is small relative to the other signal, a
regularised model may never split on the treatment feature, and uplift comes back
as approximately zero everywhere. Check that the treatment feature actually
appears in the model before believing a null result.

### X-learner

```
1. Fit m_t on treated, m_c on control (as T-learner).
2. Impute effects:
   D_t = y_t − m_c(X_t)        for the treated
   D_c = m_t(X_c) − y_c        for the control
3. Fit g_t on D_t, g_c on D_c.
4. uplift(x) = g(x) = e(x)·g_c(x) + (1 − e(x))·g_t(x)
   where e(x) is the treatment propensity.
```

**Use when the arms are very unbalanced** — a 5% randomised holdout against 95%
treated, which is the common GTM shape. The weighting leans on the arm with more
data where it is more reliable.

### Transformed outcome

```
z_i = y_i · (t_i − p) / (p · (1 − p))
```

With constant randomisation probability `p`, `E[z | x] = uplift(x)`, so any
regressor fitted to `z` estimates uplift directly. Simple and unbiased; **high
variance**, because `z` takes large positive and negative values. Works better as
an evaluation target than as the production model.

### Uplift trees and causal forests

Split on a criterion that maximises the difference in outcome rates between arms
within the child nodes, rather than node purity. Causal forests additionally give
**asymptotically valid confidence intervals per record**, which is the single
most useful property available in this space — it lets you say "this record's
uplift is +4pp, ±3pp" instead of a bare point estimate.

Use a maintained library. Do not implement causal forests from scratch.

---

## 2. Qini and the uplift curve

```python
def uplift_curve(scores, treated, outcomes, n_points=20):
    """Cumulative incremental outcomes when treating the top-scoring fraction."""
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    pts = []
    for frac in [i / n_points for i in range(1, n_points + 1)]:
        k = max(1, int(frac * len(order)))
        idx = order[:k]
        nt = sum(treated[i] for i in idx)
        nc = k - nt
        yt = sum(outcomes[i] for i in idx if treated[i])
        yc = sum(outcomes[i] for i in idx if not treated[i])
        if nt == 0 or nc == 0:
            pts.append((frac, 0.0))
            continue
        pts.append((frac, (yt / nt - yc / nc) * k))
    return pts


def qini(scores, treated, outcomes, n_points=20):
    """Area between the uplift curve and the random-targeting diagonal."""
    pts = uplift_curve(scores, treated, outcomes, n_points)
    total = pts[-1][1]
    area = 0.0
    prev_x, prev_y = 0.0, 0.0
    for x, y in pts:
        area += (x - prev_x) * ((y + prev_y) / 2 - (x + prev_x) / 2 * total)
        prev_x, prev_y = x, y
    return area


if __name__ == "__main__":
    import random
    random.seed(0)
    n = 8000
    treated, outcomes, scores = [], [], []
    for i in range(n):
        persuadable = i < n // 4                  # first quarter are persuadable
        t = random.random() < 0.5
        base = 0.10
        p = base + (0.25 if (persuadable and t) else 0.0)
        treated.append(t)
        outcomes.append(1 if random.random() < p else 0)
        scores.append(1.0 if persuadable else 0.0)   # a perfect uplift model
    good = qini(scores, treated, outcomes)
    noise = [random.random() for _ in range(n)]
    bad = qini(noise, treated, outcomes)
    assert good > bad, (good, bad)
    assert abs(bad) < abs(good) / 2, (good, bad)
    print(f"qini ok: informative={good:.1f} random={bad:.1f}")
```

**Qini is not comparable across datasets.** Compare within one dataset against
two references: random targeting (zero by construction) and propensity-ranked
targeting. The second comparison is the one that makes the case for uplift, and
it is the one that gets left out.

---

## 3. The decile table with intervals

```sql
with ranked as (
  select *, ntile(10) over (order by uplift_score desc) as decile
  from   scored_holdout
)
select decile,
       count(*) filter (where arm = 'treated')  as n_t,
       count(*) filter (where arm = 'control')  as n_c,
       avg(outcome::int) filter (where arm = 'treated')  as rate_t,
       avg(outcome::int) filter (where arm = 'control')  as rate_c,
       (avg(outcome::int) filter (where arm = 'treated')
        - avg(outcome::int) filter (where arm = 'control')) * 100 as uplift_pp
from   ranked
group by 1 order by 1;
```

Interval on each decile:

```
se = sqrt( p_t(1−p_t)/n_t + p_c(1−p_c)/n_c )
95% CI = (p_t − p_c) ± 1.96·se
```

**Always attach it.** A decile is a tenth of the data and its uplift estimate is
a difference of two rates — the interval is typically ±1.5 to ±2 percentage
points on a realistic GTM sample, which is the same order as the effect itself in
the middle deciles.

Rule for reading: **deciles whose interval includes zero are not distinguishable
from no effect.** Say that, rather than reporting the point estimate as if it
were a measurement.

---

## 4. Quadrant assignment

Quadrants are inferred, not observed — nobody is seen in both arms.

```
persuadable  : uplift significantly > 0
sure thing   : uplift ≈ 0 AND control conversion rate high
lost cause   : uplift ≈ 0 AND control conversion rate low
sleeping dog : uplift significantly < 0
```

Report quadrant **shares with their uncertainty**, and state that assignment is
probabilistic. A record with uplift +1pp ±3pp is not a persuadable; it is
unclassified, and lumping it with the persuadables inflates the targetable
population — which is the error that makes the programme look better than it is.

---

## 5. Turning uplift into a targeting depth

```
net_value(k) = incremental_conversions(k) · value_per_conversion
               − k · cost_per_treatment
```

Evaluate across depths and take the maximum. It is usually **far shallower than
people expect**, because the middle deciles have near-zero uplift and non-zero
cost.

```python
def optimal_depth(curve, n_total, value_per_conv, cost_per_treat):
    """curve: [(fraction, cumulative_incremental_conversions)]"""
    best = max(curve, key=lambda pt: pt[1] * value_per_conv
                                     - pt[0] * n_total * cost_per_treat)
    frac, inc = best
    return {"depth": frac,
            "incremental": inc,
            "net_value": inc * value_per_conv - frac * n_total * cost_per_treat}


if __name__ == "__main__":
    # effect concentrated in the top 20%, flat thereafter
    curve = [(0.1, 60), (0.2, 95), (0.3, 100), (0.5, 103), (1.0, 105)]
    out = optimal_depth(curve, n_total=10_000, value_per_conv=900,
                        cost_per_treat=40)
    assert out["depth"] in (0.1, 0.2), out
    assert out["net_value"] > 0, out
    print("depth ok:", out)
```

**Propagate the interval into the decision.** Where the net value at the optimal
depth is within the interval of zero, say so — the honest recommendation is then
"treat the top decile, where the effect is solid, and test the rest".
