# Cold start, matrix viability and baselines

> Provisional content — see this skill's `README.md`. General practice, not
> traced to the pack's platform research.

---

## 1. Is the interaction matrix viable for collaborative filtering?

```python
def matrix_viability(n_users, n_items, n_interactions):
    density = n_interactions / (n_users * n_items) if n_users and n_items else 0.0
    per_user = n_interactions / n_users if n_users else 0.0
    per_item = n_interactions / n_items if n_items else 0.0
    if n_users < 1000 or n_items < 20:
        verdict = "cf_not_viable: too few users or items"
    elif density < 0.001 and per_user < 3:
        verdict = "cf_not_viable: too sparse, users have too little history"
    elif per_item < 20:
        verdict = "cf_weak: most items have too few interactions to be placed"
    else:
        verdict = "cf_viable"
    return {"density": density, "interactions_per_user": per_user,
            "interactions_per_item": per_item, "verdict": verdict}


if __name__ == "__main__":
    b2b = matrix_viability(840, 14, 1900)          # typical B2B cross-sell
    assert b2b["verdict"].startswith("cf_not_viable"), b2b
    consumer = matrix_viability(500_000, 4_000, 12_000_000)
    assert consumer["verdict"] == "cf_viable", consumer
    print("viability ok:", b2b["verdict"], "|", consumer["verdict"])
```

The thresholds are working conventions. What matters is reporting the three
numbers — density, interactions per user, interactions per item — so the verdict
is arguable rather than asserted.

**The B2B reality:** most B2B cross-sell matrices fail this check, and the right
response is association rules or content-based scoring, not a smaller
factorisation.

---

## 2. Association rules, computed

```python
from collections import Counter
from itertools import combinations


def association_rules(baskets, min_support=0.02, min_lift=1.2):
    """baskets: iterable of sets/lists of item ids (one per account or order)."""
    baskets = [set(b) for b in baskets]
    n = len(baskets)
    item_count = Counter()
    pair_count = Counter()
    for b in baskets:
        item_count.update(b)
        pair_count.update(frozenset(p) for p in combinations(sorted(b), 2))

    rules = []
    for pair, cnt in pair_count.items():
        a, b = tuple(pair)
        support = cnt / n
        if support < min_support:
            continue
        for ante, cons in ((a, b), (b, a)):
            conf = cnt / item_count[ante]
            lift = conf / (item_count[cons] / n)
            if lift >= min_lift:
                rules.append({"antecedent": ante, "consequent": cons,
                              "support": support, "confidence": conf,
                              "lift": lift, "n_pairs": cnt})
    return sorted(rules, key=lambda r: -r["lift"])


if __name__ == "__main__":
    baskets = [{"a", "b"}] * 30 + [{"a"}] * 20 + [{"b"}] * 10 + [{"c"}] * 40
    rules = association_rules(baskets, min_support=0.05, min_lift=1.0)
    top = next(r for r in rules if r["antecedent"] == "a" and r["consequent"] == "b")
    assert abs(top["confidence"] - 30 / 50) < 1e-9        # 30 of 50 'a' baskets
    assert abs(top["lift"] - 1.5) < 1e-9                  # b is 40/100 overall
    assert all(r["consequent"] != "c" for r in rules)     # c never co-occurs
    print("rules ok:", round(top["lift"], 3))
```

**Reading the three numbers:**

| Metric | Question it answers | Trap |
|---|---|---|
| Support | How often does this pair occur at all? | A rule with support 0.001 is three customers |
| Confidence | Given A, how often B? | High confidence with lift ≈ 1 just means B is popular |
| **Lift** | How much better than chance? | **Rank on this.** Lift below ~1.2 is not a rule |

Set `min_support` from volume, not from habit: with 800 accounts, `min_support =
0.02` is 16 accounts, which is about the floor at which a rule means anything.

**Point-in-time applies here too.** Build baskets only from purchases before the
prediction date, or the rules encode the future.

---

## 3. The baselines, in order of strength

### B0 — global popularity
Most-purchased items overall, excluding what the account already owns. Trivial,
and it is the number everything else must beat.

### B1 — segment-conditioned popularity
Most-purchased within the account's size band and industry. **The real baseline
for B2B**, and frequently the winner on small catalogues.

### B2 — recency-weighted popularity
Weight purchases by recency (`exp(-age_days / half_life)`), which catches
products whose adoption is rising. Cheap, and on a moving catalogue it often
beats B1.

### B3 — rule layer alone
The commercial rules a sales leader would write: eligibility by plan, natural
upgrade paths, margin priority. **Frequently better than anything statistical on
a 14-product catalogue**, because the constraints carry most of the information.

**Report the model against B1 at minimum.** A comparison against B0 alone is a
comparison against a strawman.

---

## 4. Cold-start handling, by case

| Case | Approach | What to say |
|---|---|---|
| New item, no interactions | Content-based on item attributes; a launch rule | "Ranked by attribute similarity; no interaction evidence yet" |
| New account, no history | Segment popularity conditioned on firmographics | **"Not personalised — this is what accounts like yours buy"** |
| New account, no firmographics either | Global popularity | "Not personalised and not segment-matched; the generic list" |
| New system, no interaction data | B1 plus the rule layer | "Baseline only. Start logging; revisit at <n> interactions" |

**Label the degradation on the output.** A segment-popularity list presented as a
personalised recommendation is the quiet dishonesty this skill exists to prevent.

---

## 5. The rule layer is not a hack

Every production GTM recommender needs constraints the model does not know:

- **Eligibility.** The account's plan, region or contract makes some items
  impossible. Recommending them wastes a slot and costs credibility.
- **Sequencing.** Some products only make sense after others.
- **Margin and strategy.** The business may want a product promoted regardless
  of the model.
- **Suppression.** Recently rejected, currently in an open opportunity, in a
  support escalation. **Suppression lists are part of the definition**, not an
  afterthought.
- **Slot limits.** Three recommendations, not thirty.

Apply constraints **after** scoring, as a filter and a re-rank, and **log what
was filtered and why.** A recommender whose output is unexplainable because an
invisible rule removed the top item is worse than one with no rules.
