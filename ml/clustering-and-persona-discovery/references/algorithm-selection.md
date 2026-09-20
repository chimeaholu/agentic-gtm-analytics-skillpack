# Algorithm selection, scaling and surrogate rules

---

## 1. Scaling recipes for GTM features

| Feature type | Recipe |
|---|---|
| Revenue, ARR, order value | `log1p` then `RobustScaler`. The log compresses the tail; robust scaling stops the remaining outliers dominating |
| Event and session counts | `log1p` then `StandardScaler` |
| Recency in days | `StandardScaler`, or invert to a decayed score first (`exp(-days/half_life)`) if you want recency to behave like intensity |
| Rates and shares (0–1) | Already comparable. `StandardScaler` only if mixing with other scales |
| Seats, employees | Band it, or `log1p` |
| Tenure | `StandardScaler` |
| Binary flags | Leave at 0/1 and **accept that they are underweighted** relative to scaled numerics, or scale deliberately |
| High-cardinality categorical | Do not one-hot into k-means. Map to a numeric with meaning (out-of-fold historical rate), or use Gower + hierarchical |

```python
# the standard GTM pipeline
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import RobustScaler, StandardScaler, FunctionTransformer
import numpy as np

log_then_robust = Pipeline([
    ("log", FunctionTransformer(np.log1p, validate=False)),
    ("scale", RobustScaler()),
])

pre = ColumnTransformer([
    ("money", log_then_robust, ["revenue_12m", "aov"]),
    ("counts", log_then_robust, ["orders_12m", "events_28d"]),
    ("plain", StandardScaler(), ["tenure_days", "recency_days"]),
])
# persist `pre` — the scaler parameters are part of the segmentation artefact
```

**The scaler parameters are part of the model.** Without them the segmentation
cannot be applied to a new record, and §7 of the skill fails.

---

## 2. Correlated features

```python
import numpy as np
corr = np.corrcoef(X_scaled, rowvar=False)
# any |corr| > 0.8 block is one concept wearing several names
```

Three responses, all acceptable if declared:

1. **Keep one representative per block.** Simplest, most explicable.
2. **PCA the block** to 1–2 components. Keeps the information, costs
   interpretability.
3. **Keep them all deliberately**, because you *want* that concept weighted more
   heavily. Legitimate — but it must be a stated decision, not an accident.

---

## 3. Mixed-type distance

```python
def gower_distance(a, b, numeric_idx, categorical_idx, ranges):
    """Gower: mean of per-feature normalised distances. 0 = identical."""
    total = 0.0
    for i in numeric_idx:
        r = ranges[i]
        total += abs(a[i] - b[i]) / r if r else 0.0
    for i in categorical_idx:
        total += 0.0 if a[i] == b[i] else 1.0
    return total / (len(numeric_idx) + len(categorical_idx))


if __name__ == "__main__":
    ranges = {0: 100.0, 1: 10.0}
    a = [50, 5, "smb", "eu"]
    assert gower_distance(a, a, [0, 1], [2, 3], ranges) == 0.0
    b = [100, 5, "smb", "eu"]                    # half the range on one numeric
    assert abs(gower_distance(a, b, [0, 1], [2, 3], ranges) - 0.125) < 1e-9
    c = [50, 5, "ent", "us"]                     # both categoricals differ
    assert abs(gower_distance(a, c, [0, 1], [2, 3], ranges) - 0.5) < 1e-9
    print("gower ok")
```

Feed the resulting distance matrix to hierarchical clustering or k-medoids.
Memory is O(n²), so sample above ~20k rows and assign the remainder by nearest
medoid — and say you sampled.

---

## 4. Algorithm parameters worth setting deliberately

### k-means
```python
KMeans(n_clusters=k, init="k-means++", n_init=20, random_state=42)
```
`n_init=20` rather than the library default; GTM feature spaces have many poor
local optima. If results differ materially between seeds at fixed `n_init`, that
is instability, not a seed problem.

### Hierarchical (Ward)
```python
AgglomerativeClustering(n_clusters=k, linkage="ward")   # ward => euclidean only
```
Deterministic, so there is no initialisation instability — but it is still
subject to **sampling** instability, so §4 of the skill still applies. Keep the
dendrogram; the tree is frequently the actual deliverable.

### HDBSCAN
```python
HDBSCAN(min_cluster_size=max(50, int(0.01 * n)), min_samples=10)
```
`min_cluster_size` is the business question in disguise: the smallest group worth
naming. **Noise points stay noise** — report the noise share, and resist the urge
to force-assign it. "62% of the base has no distinct behavioural signature" is a
finding, and often the most useful one.

### Gaussian mixture
```python
GaussianMixture(n_components=k, covariance_type="full", n_init=10, random_state=42)
```
Use `covariance_type="diag"` when features outnumber a few hundred records per
component. Soft membership is the reason to choose GMM: report the maximum
posterior probability per record, and **flag records whose top membership is
below ~0.6 as genuinely between segments** rather than assigning them.

---

## 5. Surrogate rules for reproducibility

```python
from sklearn.tree import DecisionTreeClassifier, export_text

surrogate = DecisionTreeClassifier(max_depth=3, min_samples_leaf=50,
                                   random_state=42)
surrogate.fit(X_raw, labels)          # RAW features — the rules must be readable
fidelity = surrogate.score(X_raw, labels)
print(export_text(surrogate, feature_names=list(X_raw.columns)))
print(f"surrogate fidelity: {fidelity:.3f}")
```

Typical output:

```
|--- revenue_12m <= 12400.00
|   |--- orders_12m <= 2.50   -> cluster 2
|   |--- orders_12m >  2.50   -> cluster 1
|--- revenue_12m >  12400.00
|   |--- recency_days <= 45.00 -> cluster 0
|   |--- recency_days >  45.00 -> cluster 1
surrogate fidelity: 0.913
```

**Report the fidelity number.** 0.91 means roughly one record in eleven is
assigned differently by the rules than by the model — which is fine for
activation and must be said, not hidden. Where fidelity is below ~0.85, either
deepen the tree by one level or ship the scoring artefact instead and accept that
nobody will be able to read it.

Fit the surrogate on **raw** features, never scaled ones. A rule reading
`scaled_revenue <= 0.42` is unimplementable by a human and unarguable in a
meeting, which defeats the purpose.
