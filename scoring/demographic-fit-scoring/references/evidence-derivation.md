# Deriving fit from outcome evidence

---

## 1. The univariate table, done properly

```sql
select :attribute                                           as attribute,
       attribute_value                                      as level,
       count(*)                                             as n,
       count(*) filter (where is_won)                       as wins,
       avg(is_won::int)                                     as win_rate,
       1.96 * sqrt(avg(is_won::int) * (1 - avg(is_won::int))
                   / nullif(count(*), 0))                   as ci_halfwidth,
       avg(amount_home_currency) filter (where is_won)      as mean_won_amount,
       percentile_cont(0.5) within group (order by days_to_close)
         filter (where is_won)                              as median_cycle_days,
       avg(retained_12m::int) filter (where is_won)         as retention_12m
from   opportunity_facts
where  closed_at between :start and :end
group by 1, 2
order by win_rate desc;
```

**Four things this query does that the naive version does not:**

1. **Includes closed-lost** in `n`. Closed-won-only describes who you sold to.
2. **Carries the interval.** Two bands at 22% and 27% on n=40 each are the same
   band, and the interval says so.
3. **Carries three other outcomes.** A high win rate with poor retention and a
   nine-month cycle is not a good fit.
4. **Uses home-currency amounts.** Raw amounts across currencies do not sum to
   anything meaningful.

### The volume floor

```python
def level_verdict(n, wins, floor=30):
    if n < floor:
        return {"verdict": "insufficient_evidence", "n": n, "floor": floor}
    p = wins / n
    half = 1.96 * (p * (1 - p) / n) ** 0.5
    return {"verdict": "evaluated", "n": n, "win_rate": p,
            "ci": (max(0.0, p - half), min(1.0, p + half))}


if __name__ == "__main__":
    thin = level_verdict(6, 4)
    assert thin["verdict"] == "insufficient_evidence", thin
    thick = level_verdict(180, 56)
    assert thick["verdict"] == "evaluated"
    lo, hi = thick["ci"]
    assert lo < thick["win_rate"] < hi
    assert hi - lo < 0.15                         # tight enough to act on
    print("level_verdict ok:", round(thick["win_rate"], 3),
          [round(v, 3) for v in thick["ci"]])
```

**Report levels below the floor as `insufficient_evidence`, never drop them.** A
level with no data is not a level with a bad rate, and silently dropping it makes
the segment invisible to the ICP rather than merely unproven.

---

## 2. Multivariate derivation

Single-attribute rates confound. A size band may look strong because it
correlates with a strong region or a strong product.

### Regularised logistic regression on firmographics only

```python
# firmographics ONLY — no behaviour, or the axes are already collapsed
model = LogisticRegression(penalty="l2", C=0.5, class_weight="balanced")
model.fit(X_firmographic, y_won)
# coefficients -> weights, after banding and one-hot encoding
```

Coefficients are directly readable as weights, which is what makes this
preferable to a tree ensemble here — the output of this skill is a **scoring
rule people will argue with**, and an arguable rule beats an accurate opaque one.

### Shallow decision tree for the rules

```python
tree = DecisionTreeClassifier(max_depth=3, min_samples_leaf=50)
tree.fit(X_firmographic, y_won)
print(export_text(tree, feature_names=list(X_firmographic.columns)))
```

The tree's paths are the ICP criteria, in the form a RevOps team can implement:

```
|--- employee_band in {200-500, 500-1000}
|   |--- industry_norm = services        -> win rate 0.34 (n=142)
|   |--- industry_norm != services       -> win rate 0.19 (n=98)
|--- employee_band not in {...}          -> win rate 0.11 (n=612)
```

**Keep the univariate table alongside.** The tree is more correct; the table is
what gets discussed, and the discussion is where the strategic intent surfaces.

---

## 3. The disagreement report

```sql
select c.attribute,
       c.stated_value,
       e.best_evidence_level,
       e.evidence_win_rate,
       e.n,
       case when c.stated_value = e.best_evidence_level then 'confirmed'
            when e.n < 30                               then 'insufficient_evidence'
            else 'disagrees' end                        as verdict
from   stated_icp c
left join evidence_summary e using (attribute);
```

**Presenting it.** Three columns: what the business says, what the history shows,
and the verdict. Then one line per disagreement explaining the magnitude.

**Do not automatically side with the data.** Three legitimate reasons the stated
ICP may be right and the history wrong:

1. **Deliberate strategy change.** The company decided to move upmarket six
   months ago; the history is the old motion.
2. **Selection effect.** You win mid-market because that is where you have been
   selling. The enterprise win rate is low partly because those deals were
   attempted without an enterprise motion.
3. **Value, not volume.** Enterprise wins less often and is worth much more.
   Win rate alone will always favour the easier segment.

**Name which of these might apply** rather than declaring the data the winner.
The output is evidence plus interpretation, and the interpretation belongs to the
business.

---

## 4. Weighting the attributes

Two defensible methods:

**(a) From model coefficients.** Normalise the logistic coefficients to weights
summing to 1. Principled, and it handles correlation between attributes.

**(b) From lift ratios.** `weight ∝ (level win rate / overall win rate) − 1`,
floored at zero. Simpler and easier to explain, but double-counts correlated
attributes.

**Whichever you use:**

- **Cap the weight on any low-coverage attribute.** An attribute known for 42% of
  accounts cannot carry 40% of the score without making the score mostly about
  coverage.
- **Sensitivity-test.** Perturb each weight by ±30% and see whether the grade
  distribution moves materially. A score that is robust to weight perturbation is
  a score worth defending; one that is not should be simplified.
- **Fewer attributes, more robust.** Five well-evidenced attributes beat fifteen
  with three good ones and twelve noisy ones.

---

## 5. Setting the grade cuts

**Not at round scores.** Two defensible routes:

| Route | Method |
|---|---|
| **Capacity** | A = the top N by fit score, where N is what the team can work. See `segmentation-model-support` §1 |
| **Separation** | Cut where the win rate steps down materially, with non-overlapping intervals either side |

Then verify:

```sql
select fit_grade, count(*) as n,
       avg(is_won::int) as win_rate,
       1.96 * sqrt(avg(is_won::int) * (1 - avg(is_won::int)) / count(*)) as ci
from   scored_opportunities group by 1 order by 1;
```

**A-grade and B-grade win rates must not have overlapping intervals.** If they
do, the grades are a label rather than a filter, and either the cut is in the
wrong place or the criteria do not separate. `scoring-model-evaluation` runs the
formal version of this test.
