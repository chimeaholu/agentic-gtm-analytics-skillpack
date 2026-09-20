# Enrichment coverage, provider conflict and decay

---

## 1. The coverage audit

```sql
select attribute,
       avg(known)                                        as coverage_overall,
       avg(known) filter (where country = 'US')          as coverage_us,
       avg(known) filter (where country <> 'US')         as coverage_non_us,
       avg(known) filter (where employee_band in ('1-10','11-50'))
                                                         as coverage_small,
       avg(known) filter (where employee_band in ('1000+'))
                                                         as coverage_large,
       avg(known) filter (where created_at >= current_date - 365)
                                                         as coverage_recent
from   account_attribute_long
group by 1 order by coverage_overall;
```

**Coverage differences between segments are a finding**, not background. A score
built on attributes with 85% US coverage and 55% non-US coverage produces
systematically lower grades outside the US, and nothing in the model says so.

**The standard coverage gradient**, stated once:

| Segment | Coverage |
|---|---|
| Large, US, public | Best |
| Large, non-US, public | Good |
| Mid-market, US, private | Moderate |
| Small, US, private | Poor |
| **Small, non-US, private, recently founded** | **Worst** |

That last row is often where growth is. Scoring its missing values as zero is a
score that penalises your next market.

---

## 2. Scoring with missing attributes

### The normalisation approach (preferred)

```python
def fit_score(attributes, weights, values):
    """Score on what is known; express as a share of the achievable maximum."""
    earned = achievable = 0.0
    known = 0
    for a in attributes:
        w = weights[a]
        v = values.get(a)
        if v is None:
            continue                       # missing: excluded from BOTH sides
        achievable += w
        earned += w * v                    # v in [0, 1]
        known += 1
    if achievable == 0:
        return {"score": None, "confidence": "none", "known": 0,
                "status": "unavailable"}
    coverage = achievable / sum(weights[a] for a in attributes)
    return {"score": earned / achievable,
            "known": known,
            "coverage": coverage,
            "confidence": "high" if coverage >= 0.8
                          else "medium" if coverage >= 0.5 else "low",
            "status": "scored"}


if __name__ == "__main__":
    attrs = ["size", "industry", "region", "tech"]
    w = {"size": 0.4, "industry": 0.3, "region": 0.2, "tech": 0.1}
    full = fit_score(attrs, w, {"size": 1.0, "industry": 1.0,
                                "region": 1.0, "tech": 1.0})
    assert full["score"] == 1.0 and full["confidence"] == "high"
    partial = fit_score(attrs, w, {"size": 1.0, "industry": 1.0})
    assert partial["score"] == 1.0                    # perfect on what is known
    assert partial["confidence"] == "medium"          # 0.7 of weight available
    none_known = fit_score(attrs, w, {})
    assert none_known["status"] == "unavailable"
    zero_scored = fit_score(attrs, w, {"size": 1.0, "industry": 0.0,
                                       "region": 0.0, "tech": 0.0})
    assert abs(zero_scored["score"] - 0.4) < 1e-9     # genuine zeros DO count
    print("fit_score ok")
```

**The key property:** an account with two known attributes, both excellent,
scores as excellent **with low confidence** — not as mediocre. A genuine zero
still counts as a zero; only *missing* is excluded. That distinction is the whole
point, and it is the same `answer-contract` distinction between observed zero and
missing.

### The confidence flag in use

| Grade | Confidence | Sales action |
|---|---|---|
| A | High | Work it |
| A | **Low** | **Work it, and enrich it** — the grade may not survive more data |
| C | High | Deprioritise confidently |
| C | **Low** | **Enrich before deciding.** A C on two attributes is not a C |
| — | None | `unavailable`. Route to enrichment |

---

## 3. Provider normalisation

| Attribute | The disagreement | Normalisation |
|---|---|---|
| Employee count | Legal entity vs group vs professional-network headcount. Order-of-magnitude differences for multinationals | **Band it.** 200–500 survives what 347 does not |
| Revenue | Reported vs modelled vs headcount-derived | Band it; **record whether the figure is reported or modelled** |
| Industry | Standard codes vs vendor taxonomies of different granularity | Map to one taxonomy; **version the mapping** |
| Country | Registered vs HQ vs billing vs contact country | Pick one field, name it, use it everywhere |
| Technographics | Page-source tag vs DNS vs job-posting mention vs purchased-licence data | Record the **detection method** alongside the detection |

```sql
-- conflict detection across providers
select account_id,
       max(employee_band) filter (where provider = 'a') as band_a,
       max(employee_band) filter (where provider = 'b') as band_b
from   account_enrichment
group by 1
having max(employee_band) filter (where provider = 'a')
    is distinct from max(employee_band) filter (where provider = 'b');
```

**Report the conflict rate.** A 30% disagreement rate on employee band between
two providers means any grade built on the blend is arbitrary at the margin, and
sales is right to distrust it.

**One provider per attribute per model.** If a priority order is used, record the
winning provider as its own field so the grade can be traced.

---

## 4. Technographic decay

```sql
select account_id, technology,
       detected_at,
       date_diff('day', detected_at, current_date)                as age_days,
       exp(-date_diff('day', detected_at, current_date) / 180.0)  as decayed_weight
from   technographics;
```

| Age | Treatment |
|---|---|
| < 90 days | Full weight |
| 90–180 days | Decayed |
| > 180 days | Weak evidence — flag it, do not drop it silently |
| > 365 days | **Treat as unknown**, not as absent |

**Three rules:**

1. **State the observation date** wherever a technographic is used in a score or
   a rationale. "Uses X" is a claim about a date.
2. **Not detected ≠ not present.** Detection misses server-side and
   internally-hosted tools entirely. Absence is `missing`, not a zero.
3. **Make the half-life explicit and sensitivity-test it.** 90, 180 and 365 days
   produce materially different scores; if the grade distribution is sensitive to
   the choice, say so rather than picking one quietly.

**The competitor-detection tautology:** detecting a competitor's product means
both "they buy this category" (positive) and "they are already served"
(negative). Which dominates is an empirical question — split the win rate by
competitor-detected and let the data answer it. Do not assign the sign by
intuition.
