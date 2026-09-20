---
name: clustering-and-persona-discovery
description: Use when discovering customer, account or behavioural segments from data rather than defining them by rule — persona discovery, product-usage segmentation, or finding structure in a customer base. Chooses the algorithm from the data shape, validates that clusters are stable rather than an artefact of initialisation, and tests whether the segments actually differ on outcomes that matter. Prevents a beautifully-named segmentation that reshuffles next month and predicts nothing.
---

# Clustering and Persona Discovery

Clustering always returns an answer. Ask for four clusters on random noise and
you get four clusters, with centroids, sizes, and a tidy profile table. **Nothing
in the algorithm tells you whether the structure is real.**

So this skill is mostly about the two tests that nobody runs: **is it stable**,
and **does it differ on anything that matters.** A segmentation that fails either
is a description, not a tool, and shipping it costs a year of campaigns built on
a fiction.

---

## 1. Before clustering: is this a clustering problem?

| Situation | Better tool |
|---|---|
| The segments are already known and defined by policy | Write the rule. Clustering will not rediscover your pricing tiers, it will find a noisy approximation of them |
| You want to predict an outcome | Supervised model. Clustering optimises separation in feature space, which is unrelated to separating the outcome |
| You want value tiers on a handful of behavioural variables | **RFM or a rule-based value segmentation.** Simpler, stable, explicable, and it usually wins. See `rfm-and-value-segmentation` |
| You need the segmentation applied to new records in real time | Possible, but requires a published scoring function — plan for §7 up front |
| Fewer than ~30 rows per feature | Not enough data. Say so, give the rule-based alternative |

**Clustering earns its place when** the structure is genuinely unknown, the
feature space has more dimensions than a human can partition by hand, and the
answer will be checked against outcomes. Say which of those applies.

---

## 2. Feature scaling determines the result

**This is the single largest lever and it is a modelling decision, not a
preprocessing step.** Distance-based algorithms treat a variable's scale as its
importance. An unscaled monetary feature with a range of 0–2,000,000 and a
recency feature with a range of 0–365 produces a clustering of the monetary
feature alone, wearing a coat.

| Scaler | Effect | Use for |
|---|---|---|
| `StandardScaler` (z-score) | Equal variance per feature | Roughly symmetric features. The default |
| `RobustScaler` (median/IQR) | Outlier-resistant | **GTM monetary features — the tail otherwise dominates the variance** |
| `MinMaxScaler` | Fixed 0–1 range | Bounded features; sensitive to outliers |
| Log then standardise | Compresses the tail before scaling | Revenue, counts, session durations. **The usual right answer for GTM** |
| Rank / quantile transform | Distribution-free, kills all outlier influence | When you care about order, not magnitude |

**Correlated features are double-weighted.** Three engagement metrics that
correlate at 0.9 give the engagement concept triple the weight of a single
uncorrelated firmographic one. Either drop to one representative, or reduce
dimensionality first (PCA on the correlated block), and **say which you did**
because it changes the clustering.

**Mixed types.** k-means on one-hot categoricals is a common mistake: a binary
column contributes a distance of 1 while a scaled numeric contributes typically
±2, so the categorical is silently underweighted — and one-hot expansion of a
high-cardinality field means dozens of near-empty dimensions. Use Gower distance
with hierarchical clustering, or k-prototypes, or convert the categorical into a
meaningful numeric (e.g. an industry's historical conversion rate, computed
out-of-fold).

**Declare the scaling in the output.** Two analysts with the same data and
different scalers produce different segmentations and both are "correct".

---

## 3. Algorithm selection from the data shape

| Algorithm | Use when | Fails when |
|---|---|---|
| **k-means** | Scaled numeric features, roughly spherical, you can name k, you need speed and a simple scoring rule | Elongated or nested shapes; outliers pull centroids; forces every point into a cluster |
| **Hierarchical (Ward)** | **The tree itself is the insight** — nested segments, sub-personas. Deterministic, so no initialisation instability | O(n²) memory; impractical much past ~50k rows without sampling |
| **DBSCAN / HDBSCAN** | Cluster count unknown, **noise should stay noise**. Excellent for finding a few dense behavioural clusters in a diffuse base | Varying densities; needs `eps`/`min_samples` tuned; high-dimensional spaces |
| **Gaussian mixture** | Soft membership is meaningful ("60% this persona, 40% that"), elliptical clusters | Assumes Gaussian components; more parameters, so more data needed |
| **k-medoids / PAM** | You need an actual **exemplar customer** per cluster, or a non-Euclidean distance | Slower than k-means |

**The under-used option is HDBSCAN**, because GTM customer bases genuinely are
"a large diffuse mass plus a few distinct behavioural clusters", and k-means is
structurally unable to express that — it will slice the diffuse mass into
arbitrary wedges and report them as segments.

**k-means initialisation matters.** Use `k-means++`, `n_init` ≥ 10, and a fixed
`random_state` — then verify (§4) that the result does not depend on that seed.
If it does, you have found the instability, not a segmentation.

---

## 4. Stability validation is mandatory

**Most persona clusters are not reproducible, and almost nobody checks.** This is
the section that distinguishes a segmentation from a picture.

Three tests. All three ship in the output.

### 4.1 Resample stability (the core test)

```
1. Draw B = 50 bootstrap resamples of the data.
2. Cluster each resample with identical settings.
3. For records present in both the base fit and the resample, measure
   agreement with the base clustering using the Adjusted Rand Index (ARI).
4. Report mean and the 10th percentile of ARI, not just the mean.
```

**Interpretation, stated as a working scale:**

| Mean ARI | Verdict |
|---|---|
| **> 0.75** | Stable. Ship it |
| **0.60 – 0.75** | Usable with the instability disclosed; expect membership churn at the boundaries |
| **0.40 – 0.60** | Weak. The broad shape may be real; individual assignments are not. Do not use for person-level targeting |
| **< 0.40** | **Not reproducible. This is noise with names on it** |

These thresholds are working conventions, not laws — say that when you quote
them. The number itself is what matters, and it should always be reported.

### 4.2 Per-cluster stability

The aggregate hides the usual pattern: two clusters are rock solid and the other
three dissolve into each other.

```
For each base cluster, measure the Jaccard similarity between its membership
and the best-matching cluster in each resample. Report mean Jaccard per cluster.
```

**A cluster with mean Jaccard below ~0.5 is not a cluster.** Keep the stable ones
and report the rest as an undifferentiated remainder — that is a more honest and
more useful deliverable than five equally-named segments of which two are real.

### 4.3 Temporal stability

Refit on an adjacent time period and measure how much membership moves. This is
the test that predicts what actually happens in operation.

```sql
-- cross-tab of period-1 assignment against period-2 assignment
select p1.cluster as period_1, p2.cluster as period_2, count(*) as n
from   assignments_period_1 p1
join   assignments_period_2 p2 using (entity_id)
group by 1, 2 order by 1, 2;
```

Read the diagonal. **A segmentation where 40% of members change segment between
adjacent months cannot support a multi-touch programme**, and that number belongs
in the deliverable next to the cluster names. Distinguish two causes: genuine
customer movement (which may be the finding) versus algorithmic instability
(which is a defect) — refitting versus re-scoring with the frozen model
separates them.

---

## 5. Choosing k is not solved by one metric

Use three and admit that the last step was judgement.

| Method | What it shows | Weakness |
|---|---|---|
| **Elbow (inertia)** | Where added clusters stop reducing within-cluster variance | Often no visible elbow. Inertia always falls, so the reading is subjective |
| **Silhouette** | Cohesion versus separation, per point and averaged | Biased towards convex equal-sized clusters; can prefer k=2 on data with real finer structure |
| **Gap statistic** | Compares inertia against a uniform null | Expensive, and assumes a reference distribution |
| **Davies–Bouldin / Calinski–Harabasz** | Alternative separation measures | Same convexity bias |
| **Stability across k** (§4) | **Which k gives a reproducible answer** | The most decision-relevant, and the least used |
| **Business interpretability** | Can the business name and act on each segment? | Subjective — and legitimate |

**The honest procedure:** compute silhouette and stability for k in a candidate
range, plot both, take the k where stability is high and silhouette has not
collapsed, then check the profiles are namable. **Say in the output that the
final choice was partly judgement, and what the alternatives would have given.**

A frequent and honest finding: *the data supports k=3, the business wanted 6, and
the 6-cluster solution has ARI 0.44.* Report that rather than delivering six
names.

---

## 6. Outcome differentiation is the acceptance test

**If segments do not differ on outcomes, they are a description, not a tool.**

Test against every outcome the segmentation is meant to inform:

```sql
select cluster,
       count(*)                                      as n,
       avg(converted::int)                           as conversion_rate,
       avg(retained_12m::int)                        as retention_12m,
       avg(revenue_12m)                              as mean_revenue,
       percentile_cont(0.5) within group (order by revenue_12m) as median_revenue
from   assignments join outcomes using (entity_id)
group by 1 order by 1;
```

Then the statistics, which are the part that gets skipped:

- **Confidence intervals on every cell.** Five segments of 200 records each
  produce differences that look large and are not. A 95% CI on a rate is
  `p ± 1.96·sqrt(p(1−p)/n)`.
- **An overall test before the pairwise ones** — chi-square across clusters for a
  rate, Kruskal–Wallis for a skewed continuous outcome (not ANOVA; GTM revenue is
  not normal).
- **Correct for multiple comparisons.** Ten pairwise tests at α=0.05 give roughly
  a 40% chance of at least one false positive. Holm or Benjamini–Hochberg.
- **Effect size, not only significance.** With 50,000 records everything is
  significant. A segment converting at 4.1% versus 4.3% is statistically real and
  operationally meaningless.

**Verdict rule:** a segmentation passes if at least one outcome shows a
materially different rate between at least two clusters, with a confidence
interval that excludes the difference being trivial. Otherwise report: *the
clusters are internally coherent but do not differentiate on any outcome tested*
— and name the outcomes tested, because "we did not find it on these three" is
different from "there is nothing".

---

## 7. Reproducibility: publish cut points or a scoring function

**A segmentation that cannot be applied to a new customer dies on delivery.**
This is the most common operational failure: a beautiful analysis, no way to
assign the record that arrives tomorrow.

Two acceptable forms:

**(a) A published scoring function.** Persist the scaler parameters and the
centroids, and assign by nearest centroid.

```python
# what must be persisted for k-means — all four, or it is not reproducible
artifact = {
    "features":      [...],          # exact order matters
    "scaler":        {"type": "robust", "center": [...], "scale": [...]},
    "transforms":    {"revenue_12m": "log1p"},
    "centroids":     [[...], [...]],  # in scaled space
    "assign":        "nearest centroid, euclidean",
    "fit_window":    ["2026-01-01", "2026-06-30"],
    "version":       "seg-v2",
}
```

**(b) Human-readable cut points.** A decision tree fitted to predict the cluster
assignment from the raw features, pruned to a handful of splits. Accuracy of
85–95% against the true assignment is typical and usually good enough.

```python
from sklearn.tree import DecisionTreeClassifier, export_text
surrogate = DecisionTreeClassifier(max_depth=3, min_samples_leaf=50)
surrogate.fit(X_raw, cluster_labels)
print(export_text(surrogate, feature_names=list(X_raw.columns)))
# report surrogate.score(X_raw, cluster_labels) — the fidelity of the rules
```

**Form (b) is usually more valuable than (a)**, because a rule a human can read
gets implemented in the CRM, discussed in a meeting, and argued with — and its
fidelity number is honest about what the simplification costs.

**Refit cadence is part of the deliverable**, and refitting is not free: a refit
renumbers clusters, and downstream systems keyed on cluster IDs break silently.
**Freeze the scoring function and re-score between refits**; refit on a declared
schedule with an explicit remapping step.

---

## 8. Personas are built from clusters, not instead of them

A persona is a communication artefact. It makes a cluster memorable so a team can
act on it. It is not evidence.

**The rules:**

1. **Every persona attribute traces to a measured cluster statistic.** If the
   data says median 40 seats and top-quartile weekly logins, the persona says
   that. It does not say "values efficiency and dislikes long onboarding" unless
   research measured that.
2. **Carry the numbers into the persona card**, not just the adjectives. The
   number is what survives a challenge.
3. **State the cluster's size, stability and outcome profile on the card.** A
   persona card with no ARI and no n is a marketing asset pretending to be
   analysis.
4. **Never add attributes from a stereotype.** "Sarah, 34, VP Marketing at a
   Series B, frustrated by manual reporting" invents three facts the clustering
   did not produce. If qualitative research produced them, cite it as a separate
   source with its own sample size.
5. **A persona cannot be more confident than its cluster.** A cluster with
   Jaccard 0.45 gets a persona card that says so in plain words: *this group is
   not clearly separated from its neighbour; treat it as indicative.*

---

## 9. Output

```yaml
preparation:
  features: [...]
  transforms: {<feature>: log1p | none}
  scaler: {type, params_persisted: true}
  correlated_blocks_handled: "<dropped | PCA | kept, with the consequence>"
  rows: <n>, rows_per_feature: <n>
algorithm:
  name, params, random_state, n_init
k_selection:
  candidates: [...]
  silhouette_by_k: {...}
  stability_by_k: {...}
  chosen: <k>
  rationale: "<including the explicit judgement component>"
  runner_up: "<k and what it would have given>"
stability:
  resample: {method: bootstrap, B: 50, mean_ari, p10_ari, verdict}
  per_cluster_jaccard: {<cluster>: <v>}
  unstable_clusters: [...]          # reported as a remainder, not as segments
  temporal: {period_1, period_2, diagonal_share, refit_vs_rescore_attribution}
profiles:
  - cluster, n, share, defining_features: [{feature, cluster_value, overall_value}]
outcome_differentiation:
  outcomes_tested: [...]
  table: [{cluster, n, rate, ci_low, ci_high}]
  omnibus_test: {name, p}
  pairwise: {correction: holm, significant_pairs: [...]}
  effect_sizes: {...}
  verdict: differentiates | does_not_differentiate_on_tested_outcomes
reproducibility:
  scoring_artifact: <persisted>
  surrogate_rules: "<tree text>"
  surrogate_fidelity: <accuracy vs true assignment>
  refit_cadence, remapping_procedure
personas:
  - name, cluster, evidence_backed_attributes, n, stability_note
```

---

## 10. Answering

**Answer first: give the segmentation, then the stability number in the same
breath.**

> **Three stable segments, not the six you were hoping for.**
>
> At k=6 the clustering has a mean ARI of 0.44 across bootstrap resamples — under
> half of individual assignments reproduce, so six is noise with names on it. At
> k=3 the ARI is 0.79 and every cluster holds together (Jaccard 0.71–0.84).
>
> The three differ on what matters: 12-month retention is 81% / 64% / 39%
> (n = 2,140 / 3,880 / 1,455; the intervals do not overlap, chi-square p < 0.001).
>
> **Two caveats, both small.** I log-transformed revenue before scaling, without
> which revenue alone drives the whole solution — a different scaling choice
> gives a different and equally "correct" answer, so the choice is recorded.
> Between adjacent months, 12% of accounts change segment, which is genuine
> movement rather than instability (re-scoring with the frozen model moves only
> 12%, refitting moves 31%).
>
> **For activation:** the surrogate rules reproduce the assignment at 91%
> accuracy and read as three thresholds anyone can implement — they are in the
> output and they are what I would put in the CRM.
>
> If you need six for a campaign structure, split the largest stable segment on a
> business rule rather than asking the clustering for six. That is defensible;
> k=6 is not.
>
> Does not claim causality: segment membership predicts retention here, it does
> not cause it.

**Withhold only** what cannot be computed: per-cluster outcome rates where a
cluster has too few records (give the count and the detectable difference), a
stability verdict where only one time period exists (report resample stability,
say temporal is unavailable, name what resolves it), and persona attributes no
data supports.

---

## Calls

- `answer-contract` — the segmentation verdict, every rate and every interval
- `provenance-block` — fit window, source, timezone and freshness on the
  clustering inputs
- `comparability-rules` — before comparing segment rates across periods, sources
  or segmentation versions; a refit is a version change
- `warning-field-reader` — sampling or thresholding in the source extract
  distorts cluster shapes, not just totals

## References

- `references/stability-testing.md` — ARI and Jaccard procedures, the bootstrap
  harness, and the temporal cross-tab
- `references/algorithm-selection.md` — scaling recipes, mixed-type distance,
  algorithm parameters and the surrogate-rule procedure

## Related skills

- `rfm-and-value-segmentation` — the rule-based alternative, and usually the
  better first answer
- `ml-foundations-marketing` — the gate, including "would a rule do this"
- `feature-engineering-gtm` — the feature space being clustered, point-in-time
- `segmentation-model-support` — turning cluster assignments into activatable
  segments with cut points and a refresh cadence
- `model-evaluation-monitoring` — drift on cluster sizes and profiles over time
