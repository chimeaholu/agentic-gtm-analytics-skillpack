# The three-model progression

Build all three. It takes an afternoon and it converts the
accuracy-versus-explanation argument from a preference into a measurement.

---

## 1. Logistic regression — start here

```python
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

logit = make_pipeline(
    StandardScaler(),
    LogisticRegression(penalty="l2", C=0.5, class_weight="balanced",
                       max_iter=2000, random_state=42),
)
logit.fit(X_train, y_train)
```

### Reading the coefficients

On standardised features, `exp(β)` is the **odds ratio per standard deviation**:

```python
import numpy as np
coefs = logit[-1].coef_[0]
for name, b in sorted(zip(feature_names, coefs), key=lambda t: -abs(t[1]))[:10]:
    print(f"{name:35s} beta={b:+.3f}  odds_ratio={np.exp(b):.2f}")
```

```
engaged_contacts_28d                beta=+0.412  odds_ratio=1.51
pricing_page_views_14d              beta=+0.287  odds_ratio=1.33
employee_band_200_500               beta=+0.264  odds_ratio=1.30
days_since_last_event               beta=-0.331  odds_ratio=0.72
free_mail_domain                    beta=-0.198  odds_ratio=0.82
```

**That table is the explanation.** It fits on a slide, a sales leader can argue
with it, and the argument is usually productive — an unexpected sign is either a
real finding or a data bug, and it is a data bug more often.

### What it needs help with

| Limitation | Fix |
|---|---|
| Non-linearity | **Band the continuous features** (employee count, recency) into buckets, then one-hot. Recovers most of the gap against trees |
| Interactions | Add the ones the domain suggests explicitly: fit × behaviour, size × industry |
| High-cardinality categoricals | Group to a taxonomy first; never one-hot a raw campaign field |
| Correlated features | L2 handles it for prediction, but the coefficients become unstable and unreadable. Drop duplicates |
| Missing values | Explicit `*_is_missing` indicator plus a neutral fill — trees handle nulls natively, logistic does not |

**Banding plus two or three hand-built interactions typically closes half the gap
to a boosted model**, and it keeps the coefficient table.

### Where it wins outright

- Few hundred positives, where trees overfit.
- The score will be argued about in a room.
- Nobody will own hyperparameter maintenance.
- **Calibration matters and nobody will run a calibration step** — log-loss
  logistic regression is often well-calibrated out of the box.

---

## 2. Random forest — the robust middle

```python
from sklearn.ensemble import RandomForestClassifier

rf = RandomForestClassifier(
    n_estimators=500,
    max_depth=8,
    min_samples_leaf=25,              # ≈ the positives-per-leaf floor
    max_features="sqrt",
    class_weight="balanced_subsample",
    n_jobs=-1, random_state=42,
)
```

- Interactions and non-linearity handled without manual work.
- **Calibration bias is towards the middle**, the opposite of boosting, and
  usually milder — still check it.
- **Far less tuning-sensitive than boosting.** A reasonable default when nobody
  owns the hyperparameters.
- Scoring is slower at volume; a 500-tree forest is heavy in a real-time path.

**Use built-in importance with care.** Impurity-based importance is biased
towards high-cardinality features. Use **permutation importance on the holdout**
instead.

---

## 3. Gradient boosting — the performance candidate

```python
params = dict(
    n_estimators=2000,
    learning_rate=0.03,
    max_depth=4,                      # shallow: GTM signal is mostly additive
    min_child_weight=20,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_lambda=5.0,
    scale_pos_weight=neg / pos,       # class weighting, not resampling
    eval_metric="aucpr",              # PR, not ROC, on a rare positive
    early_stopping_rounds=100,
    random_state=42,
)
```

### Monotone constraints — cheap trust

```python
params["monotone_constraints"] = {
    "engaged_contacts_28d": 1,        # more engagement never lowers the score
    "pricing_page_views_14d": 1,
    "days_since_last_event": -1,      # more staleness never raises it
}
```

The accuracy cost is typically a fraction of a point. The trust benefit is large:
**a non-monotone blip in a partial-dependence plot destroys credibility faster
than a lower AUC**, because it gives the sceptic a concrete example of the model
being obviously wrong.

### Why `max_depth=4`

GTM signal is mostly additive with a handful of interactions. Deep trees on a few
hundred positives memorise the training set, and the damage surfaces as an
excellent validation curve on a leaking feature. Shallow trees plus more
estimators is the stable configuration.

---

## 4. The comparison protocol

Same split, same features, same holdout, same list length.

```python
results = {}
for name, model in [("logistic", logit), ("forest", rf), ("boosting", gbm)]:
    model.fit(X_train, y_train)
    p_raw = model.predict_proba(X_test)[:, 1]
    cal = calibrate(model, X_calib, y_calib)
    p_cal = cal.predict_proba(X_test)[:, 1]
    results[name] = {
        "pr_auc": average_precision_score(y_test, p_raw),
        "lift_at_k": lift_at_k(y_test, p_raw, k=CAPACITY),
        "ece_pre": ece(y_test, p_raw)[0],
        "ece_post": ece(y_test, p_cal)[0],
        "positives_in_k": positives_in_top_k(y_test, p_raw, CAPACITY),
    }
results["rule"] = {"pr_auc": ..., "lift_at_k": ...}   # the incumbent
```

### Reading the table

```
model    | PR-AUC | lift@200 | positives@200 | ECE pre | ECE post | explainable
rule     |  0.13  |   2.1×   |      17       |   n/a   |   n/a    | fully
logistic |  0.19  |   2.9×   |      24       |  0.021  |  0.018   | coefficients
forest   |  0.21  |   3.2×   |      26       |  0.048  |  0.019   | importance+SHAP
boosting |  0.22  |   3.4×   |      28       |  0.110  |  0.014   | SHAP only
```

**`positives_in_k` is the reality check.** With 24 versus 28 positives in the
top 200, the difference between logistic and boosting is four conversions on
this holdout — well inside the interval. Reporting lift alone makes 2.9× versus
3.4× look decisive; the raw counts show it is not.

### The decision rule

1. **Does the best model beat the rule with non-overlapping intervals?** If not,
   keep the rule and improve it.
2. **Is boosting materially better than logistic?** If the intervals overlap,
   **take logistic** — explicability is a real asset.
3. **Will anyone own hyperparameters and retraining?** If not, take logistic or
   the forest.
4. **Does the score need to be defended in a room?** Logistic.
5. **Is the volume large and the margin real?** Boosting, with calibration and
   SHAP.

**Record the rationale.** "We chose logistic because the boosting gap was four
conversions on the holdout and the sales leader needs to read the model" is a
defensible engineering decision; "we used XGBoost" is not a rationale.

---

## 5. Feature-set discipline

The same features for all three models, so the comparison is about the model:

- **Point-in-time correct** (`feature-engineering-gtm`), or explicitly marked
  unverified.
- **Fit and behaviour both represented**, and identifiable as such in the output.
- **20–60 features** is the usual working range. Beyond that, with a few hundred
  positives, you are fitting noise.
- **Leakage-audited before any model is reported.**
- **Same missing-value handling** across models, so the comparison is not
  measuring imputation.
