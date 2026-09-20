# Evaluation and feedback-loop control

> Provisional content — see this skill's `README.md`.

---

## 1. Offline metrics, defined

For a top-k list per user, against a held-out set of items the user actually
took:

```
precision@k = |recommended_k ∩ relevant| / k
recall@k    = |recommended_k ∩ relevant| / |relevant|
hit_rate@k  = share of users with at least one hit in the top k
MAP@k       = mean over users of the average precision within the top k
NDCG@k      = DCG@k / IDCG@k, with DCG = Σ rel_i / log2(i + 1)
```

```python
import math


def ndcg_at_k(recommended, relevant, k=3):
    rel = set(relevant)
    dcg = sum(1.0 / math.log2(i + 2)
              for i, item in enumerate(recommended[:k]) if item in rel)
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(k, len(rel))))
    return dcg / ideal if ideal else 0.0


if __name__ == "__main__":
    assert abs(ndcg_at_k(["a", "b", "c"], {"a", "b", "c"}, 3) - 1.0) < 1e-12
    assert ndcg_at_k(["x", "y", "z"], {"a"}, 3) == 0.0
    top_first = ndcg_at_k(["a", "x", "y"], {"a"}, 3)
    top_last = ndcg_at_k(["x", "y", "a"], {"a"}, 3)
    assert top_first > top_last                       # position matters
    print("ndcg ok:", round(top_first, 3), round(top_last, 3))
```

**Always report the baseline's value for the same metric on the same split.** A
precision@3 of 0.24 is meaningless alone.

**Use a temporal split**, not a random one: train on interactions before a date,
evaluate on interactions after it. A random split on interaction data leaks the
future exactly as it does for supervised models.

---

## 2. Coverage and diversity

```python
def coverage_report(recommendations, catalogue, all_users):
    """recommendations: {user: [item, ...]}"""
    shown = {i for items in recommendations.values() for i in items}
    return {
        "catalogue_coverage": len(shown) / len(catalogue) if catalogue else 0.0,
        "user_coverage": len(recommendations) / len(all_users) if all_users else 0.0,
        "aggregate_diversity": len(shown),
    }
```

| Observation | Reading |
|---|---|
| Catalogue coverage < ~0.2 | The recommender is a popularity list. Say so |
| User coverage < 1.0 | Some users get nothing — usually cold accounts. Name them and give them the fallback |
| Intra-list diversity near zero | Three variants of one product is one recommendation |
| Novelty falling run over run | The feedback loop is closing (§4) |

---

## 3. The online test, minimum honest version

Full design belongs to `experiment-design-readout`. The minimum this skill
insists on:

1. **Randomised assignment** at the level the recommendation acts on — account,
   user or session. Assignment is sticky; a user who flips arms mid-test is
   noise in both.
2. **A primary metric fixed before launch**, and it is a **business outcome**:
   attach rate, revenue per account, expansion rate. **Widget click-through is a
   proxy, not the metric** — a recommender can raise clicks and lower revenue by
   cannibalising a higher-margin purchase.
3. **A power calculation before launch.** Recommender effects are small relative
   to revenue variance, so a test on a few hundred accounts will usually be
   underpowered. Compute the minimum detectable effect and say it out loud; if
   the MDE is larger than the effect anyone expects, the test cannot settle the
   question and the honest move is to say so before spending the quarter.
4. **A permanent holdout after launch**, not just during the test. It is the only
   way to detect later degradation and the only unbiased training data you will
   ever have.
5. **Guardrail metrics.** Unsubscribes, support tickets, margin mix. A
   recommender that raises attach rate and shifts the mix to low-margin items
   has not won.

---

## 4. Feedback-loop controls

The loop: the recommender shows items → those items get bought → the next model
learns those items are good → it shows them more → the catalogue narrows.

### The log that makes everything else possible

```sql
create table recommendation_log (
  shown_at        timestamp not null,
  entity_id       string    not null,
  surface         string    not null,   -- where it appeared
  item_id         string    not null,
  position        int       not null,   -- 1-indexed; needed for debiasing
  model_version   string    not null,
  score           double,
  arm             string    not null,   -- treatment | control | exploration
  filtered_items  string,               -- what the rule layer removed, and why
  outcome         string,               -- resolved later
  outcome_at      timestamp
);
```

**Without `position` you cannot debias. Without `arm` you cannot evaluate.
Without `filtered_items` you cannot explain an output.** Build this on day one;
it cannot be reconstructed later.

### Inverse-propensity weighting for position bias

```
weight_i = 1 / P(examined | position_i)
```

Estimate the examination propensity from a position-swap experiment where the
logs support it. Where they do not, **say the training data is position-biased
and unweighted** rather than assuming it away.

### Exploration

Give a share of slots to items the model is uncertain about — epsilon-greedy at
5–10% is enough and is easy to explain to a stakeholder. It costs a little
precision and buys the evidence that stops the catalogue collapsing.

### Coverage monitoring

```sql
select date_trunc('month', shown_at) as month,
       count(distinct item_id)::float / (select count(*) from catalogue)
         as catalogue_coverage
from   recommendation_log group by 1 order by 1;
```

A monotone decline is the loop closing. It is the cheapest early warning
available and almost nobody watches it.

---

## 5. What offline evaluation cannot tell you

State this in the output, plainly, every time:

- Whether a recommendation **caused** a purchase. Offline data contains no
  counterfactual.
- Whether the purchase would have happened anyway — the recommender equivalent of
  targeting "sure things". `uplift-and-causal-models` is the honest frame for
  that question.
- Whether the recommendation **cannibalised** a better purchase.
- How users respond to items they were never shown.
- Whether the effect persists past the novelty period.

Each of those needs an experiment. Give the offline numbers, name which of these
the experiment would settle, and do not let the offline metric carry a claim it
cannot support.
