# Stability testing for clusterings

The tests that decide whether a segmentation is real. Run all three; report all
three.

---

## 1. Adjusted Rand Index, by hand

ARI measures agreement between two partitions of the same records, corrected for
chance. Identical partitions score 1.0; random agreement scores ~0.

```python
from collections import Counter
from itertools import combinations


def _c2(n):
    return n * (n - 1) // 2


def adjusted_rand_index(a, b):
    """a, b: cluster labels for the same records, any hashable labels."""
    assert len(a) == len(b) and len(a) > 1
    n = len(a)
    cont = Counter(zip(a, b))
    sum_ij = sum(_c2(v) for v in cont.values())
    sum_i = sum(_c2(v) for v in Counter(a).values())
    sum_j = sum(_c2(v) for v in Counter(b).values())
    expected = sum_i * sum_j / _c2(n)
    maximum = (sum_i + sum_j) / 2
    denom = maximum - expected
    return 1.0 if denom == 0 else (sum_ij - expected) / denom


if __name__ == "__main__":
    import random
    x = [0, 0, 0, 1, 1, 1, 2, 2, 2]
    assert adjusted_rand_index(x, x) == 1.0
    relabelled = [2, 2, 2, 0, 0, 0, 1, 1, 1]          # same partition, new names
    assert abs(adjusted_rand_index(x, relabelled) - 1.0) < 1e-12
    random.seed(0)
    noise = [random.randrange(3) for _ in range(900)]
    other = [random.randrange(3) for _ in range(900)]
    assert abs(adjusted_rand_index(noise, other)) < 0.05      # ~0 for random
    print("ARI ok")
```

**ARI is label-invariant**, which is why it is the right measure — a refit that
renumbers the same clusters scores 1.0, not 0.

---

## 2. The bootstrap stability harness

```python
def cluster_stability(X, fit_labels, cluster_fn, B=50, rng=None):
    """
    X          : the scaled feature matrix (numpy array)
    fit_labels : base clustering labels for all rows of X
    cluster_fn : callable(X_subset) -> labels, using IDENTICAL settings
    returns    : mean/p10 ARI and per-cluster mean Jaccard
    """
    import numpy as np
    rng = rng or np.random.default_rng(0)
    n = len(X)
    aris, jacc = [], {c: [] for c in set(fit_labels)}
    for _ in range(B):
        idx = np.unique(rng.integers(0, n, n))         # bootstrap, unique rows
        lab = cluster_fn(X[idx])
        aris.append(adjusted_rand_index(list(fit_labels[idx]), list(lab)))
        for c in jacc:                                  # best-matching cluster
            base = set(np.where(fit_labels[idx] == c)[0])
            if not base:
                continue
            best = 0.0
            for c2 in set(lab):
                other = set(np.where(lab == c2)[0])
                if other:
                    best = max(best, len(base & other) / len(base | other))
            jacc[c].append(best)
    return {
        "mean_ari": float(np.mean(aris)),
        "p10_ari": float(np.percentile(aris, 10)),
        "per_cluster_jaccard": {c: float(np.mean(v)) for c, v in jacc.items() if v},
    }
```

**Points that matter:**

- `cluster_fn` must use **identical settings**, including the same k and the same
  scaler parameters. Re-fitting the scaler inside each resample conflates scaler
  variance with cluster variance — which is legitimate if the scaler is part of
  the pipeline, but say which you did.
- Report the **10th percentile** of ARI, not only the mean. A mean of 0.72 built
  from runs of 0.95 and 0.45 is a different situation from a tight 0.72.
- Bootstrap resamples contain duplicates; `np.unique` removes them so density-based
  algorithms are not handed artificial density. For k-means either is defensible.

### Interpretation scale (working conventions, not laws)

| Mean ARI | Verdict | What to do |
|---|---|---|
| > 0.75 | Stable | Ship |
| 0.60–0.75 | Usable, disclose | Expect boundary churn; avoid person-level targeting on the boundary |
| 0.40–0.60 | Weak | Report the broad shape; do not assign individuals |
| < 0.40 | Not reproducible | Report as such. Reduce k, change features, or use a rule |

| Per-cluster Jaccard | Verdict |
|---|---|
| > 0.7 | Solid cluster |
| 0.5–0.7 | Real but fuzzy at the edges |
| < 0.5 | **Not a cluster.** Merge into a remainder |

---

## 3. Stability across k — the most decision-relevant plot

```python
results = {}
for k in range(2, 11):
    labels_k = fit(X, k)
    results[k] = {
        "silhouette": silhouette_score(X, labels_k),
        "stability": cluster_stability(X, labels_k, lambda Z: fit(Z, k))["mean_ari"],
        "sizes": Counter(labels_k),
    }
```

Plot silhouette and stability on the same axis against k. The usual GTM shape:
silhouette drifts slowly downward while stability falls off a cliff at some k.
**Take the k just before the cliff**, then check the profiles are namable.

If stability is below 0.5 at every k, there is no cluster structure in this
feature space. That is a real finding and should be reported as one — with the
rule-based alternative attached, not as a failure.

---

## 4. Temporal stability

Two different questions, and separating them is the whole point:

| Procedure | Measures |
|---|---|
| **Re-score** period 2 with the frozen model from period 1 | **Genuine customer movement** between segments |
| **Refit** on period 2 and compare partitions | **Algorithmic instability** plus movement, combined |

```sql
-- re-score: frozen model, new period
select p1.cluster as was, p2.cluster as now, count(*) as n
from   assignments_p1 p1 join rescored_p2 p2 using (entity_id)
group by 1, 2;

-- the headline number
select sum(case when p1.cluster = p2.cluster then 1 else 0 end)::float / count(*)
         as diagonal_share
from   assignments_p1 p1 join rescored_p2 p2 using (entity_id);
```

**Report both diagonals.** "12% move under re-scoring, 31% under refitting" says
that customers are fairly stable and the algorithm is not — which tells you to
freeze the model and re-score between refits.

**The operational threshold:** a segmentation whose membership turns over more
than roughly a third between adjacent periods cannot support a multi-touch
programme. That number belongs next to the cluster names in the deliverable, not
in an appendix.

---

## 5. What to do when stability fails

In order of preference:

1. **Reduce k.** The commonest fix by a wide margin. Instability is usually two
   clusters splitting a single blob.
2. **Fix the scaling.** An unscaled or badly scaled monetary feature creates
   clusters that move with outliers.
3. **Drop correlated duplicates.** Three versions of the same concept triple its
   weight and make the solution brittle.
4. **Change the algorithm.** If the base is "one diffuse mass plus a few dense
   groups", HDBSCAN expresses that and k-means cannot.
5. **Add records.** Below ~30 rows per feature, instability is expected.
6. **Use a rule instead**, and say so. A stable, explicable RFM-style
   segmentation beats an unstable statistical one on every operational measure.

Never fix instability by picking the seed that gives the nicest chart.
