---
name: recommendation-systems
description: PROVISIONAL, low research backing — see this skill's README. Use when building product, content or next-best-action recommendations on GTM data — cross-sell and upsell suggestions, content recommendations, or ranking which action a rep should take next. Covers collaborative filtering, content-based and hybrid approaches, the cold-start problem that dominates B2B where item and user counts are small, and offline-versus-online evaluation. Prevents a recommender evaluated only offline being shipped as if the offline metric predicted business impact. For who to influence rather than what to suggest, use uplift-and-causal-models.
---

# Recommendation Systems (provisional)

> **Status: provisional.** This skill's subject matter is not covered by the
> platform research behind the rest of the pack. It is written from general
> practice, it is deliberately conservative, and it makes **no platform
> capability claims**. See `README.md` in this directory. Treat it as a
> reasonable default, not as a researched position.

The honest summary, before any technique: **most GTM recommendation problems are
too small for collaborative filtering and are better served by a content-based
or rule-augmented approach, and most "next best action" questions are uplift
questions wearing a recommender's clothes.**

---

## 1. Decide which problem you actually have

| Problem | Right tool |
|---|---|
| Which product should we suggest to this existing customer? | Content-based or hybrid recommender. This skill |
| Which content should we surface to this visitor? | Content-based, or popularity if the catalogue is small. This skill |
| **Which action should the rep take next?** | **`uplift-and-causal-models`.** The action space is small, the feedback is slow and confounded by rep discretion, and the question is which action *changes* the outcome |
| Who should we target with this offer? | `uplift-and-causal-models` |
| Which accounts should we prioritise? | `supervised-propensity-models` plus `segmentation-model-support` |
| Which products are bought together? | Association rules (§4). Simpler, explicable, and often the whole answer |

**Route rather than build wherever the table says so.** A recommender is the
wrong shape for a targeting question, and dressing a propensity ranking as a
recommendation hides that it cannot say whether the action helped.

---

## 2. Cold start dominates B2B, and it is structural

Consumer recommenders work because the interaction matrix is large: millions of
users, thousands of items, enough overlap for "users like you" to mean something.

A B2B cross-sell problem is typically **hundreds to a few thousand accounts and
tens of products**. The matrix is small *and* sparse *and* the rows are not
exchangeable — an enterprise account and an SMB account are not two draws from
one population.

| Matrix shape | What works |
|---|---|
| < ~1,000 users **or** < ~20 items | **Collaborative filtering will not fill the matrix.** Content-based, association rules, or a rule |
| ~1k–50k users, dozens of items, dense-ish | Item-item collaborative filtering; content-based hybrid |
| > 50k users, hundreds of items | Matrix factorisation becomes reasonable |
| Any size, new items arriving constantly | Content-based for new items regardless; CF cannot score an item with no interactions |

**Say this out loud rather than shipping a matrix factorisation that cannot fill
its matrix.** A factorisation on a sparse 800 × 14 matrix returns numbers; they
are noise with a low reconstruction error.

### The three cold-start cases, each with a different answer

- **New item.** CF has nothing. Content-based on item attributes, or a launch
  rule, until interactions accumulate.
- **New user/account.** No history. Use firmographics and the segment's
  aggregate behaviour — effectively "what do accounts like this one buy",
  which is a segment popularity model.
- **New system.** No interaction data at all. **Popularity plus a business rule
  is the correct v1**, and it is often not beaten for a long time.

---

## 3. Popularity is the baseline, and it is strong

**A recommender that does not beat "recommend the most-bought item the customer
does not already own" is not earning its keep.** Segment-conditioned popularity —
most-bought within the account's size band and industry — is a stronger baseline
still, and on small B2B catalogues it is frequently the winner.

```sql
-- segment-conditioned popularity baseline, excluding owned items
select a.account_id, p.product_id,
       p.purchase_count,
       row_number() over (partition by a.account_id order by p.purchase_count desc) as rank
from   accounts a
join   (select segment, product_id, count(distinct account_id) as purchase_count
        from   purchases join accounts using (account_id)
        where  purchased_at < :as_of                      -- point-in-time
        group by 1, 2) p
  on   p.segment = a.segment
left join purchases owned
  on   owned.account_id = a.account_id
 and   owned.product_id = p.product_id
 and   owned.purchased_at < :as_of
where  owned.product_id is null                            -- exclude owned
qualify rank <= 5;
```

**Report the baseline's offline metrics next to the model's, always.** The
frequent and honest result is that the model's precision@3 is 0.21 against the
baseline's 0.19, with overlapping intervals — which means ship the baseline.

---

## 4. Approaches, conservatively

### Association rules — start here for cross-sell

Support, confidence and lift on item pairs. Explicable, cheap, and it is what
most "customers also bought" questions actually want.

```
support(A→B)    = P(A and B)                         how common the pair is
confidence(A→B) = P(B | A)                           how reliable the rule is
lift(A→B)       = P(B | A) / P(B)                    how much better than chance
```

**Lift is the one to rank on.** High confidence with lift ≈ 1 means B is just
popular; the rule adds nothing. Require a minimum support so a pair seen three
times does not produce a rule.

### Content-based

Score items by similarity between item attributes and what the account already
uses. Handles new items natively, works at any scale, and the explanation is
free: "recommended because it is similar to what you already have, on these
attributes."

### Collaborative filtering

- **Item-item** (cosine or adjusted cosine on the co-occurrence matrix) is more
  robust than user-user on sparse GTM data and easier to explain.
- **Matrix factorisation** (ALS, implicit feedback) needs the scale in §2.
- **Implicit feedback is not a rating.** A purchase is a positive signal with no
  negative counterpart — a non-purchase may mean "not offered" or "not needed" or
  "bought elsewhere". Use an implicit-feedback formulation with confidence
  weights, not a rating-prediction one.

### Hybrid

Content-based for cold items and cold accounts, CF where the interaction data
supports it, a rule layer on top for commercial constraints. **This is the
realistic architecture for GTM**, and the rule layer is not a hack — it encodes
the eligibility, sequencing and margin constraints that a pure model ignores.

---

## 5. Coverage and diversity matter as much as accuracy

**A recommender that always suggests the top three products is a merchandising
rule with extra steps** — and it will score well on precision@k, because popular
items are popular.

Report, on every evaluation:

| Measure | Definition | Why |
|---|---|---|
| **Catalogue coverage** | Share of items that appear in anyone's top-k | Low coverage means the long tail is invisible |
| **User coverage** | Share of accounts receiving any recommendation | Cold accounts silently get nothing |
| **Aggregate diversity** | Distinct items across all recommendation lists | The concentration measure |
| **Intra-list diversity** | Mean pairwise dissimilarity within one list | Three near-identical SKUs is one recommendation |
| **Novelty** | Mean inverse popularity of recommended items | Whether it tells anyone anything they did not know |
| **Serendipity** | Relevant *and* unexpected | The actual business goal, hardest to measure |

A recommender with precision@3 of 0.28 and 6% catalogue coverage is a popularity
list. Say so.

---

## 6. Offline metrics do not predict business impact

This is the section that matters most, and it is the one most often skipped.

Precision@k, recall@k, MAP and NDCG evaluate against **historical behaviour that
the recommender would have changed**. The held-out purchase happened under the
old system. An item the recommender surfaces that the customer never saw counts
as a false positive — so **offline evaluation systematically penalises exactly
the discovery behaviour you are trying to create.**

| Offline metric | Use |
|---|---|
| Precision@k / Recall@k | Model selection between candidates. Not a business claim |
| MAP, NDCG | Ranking quality when position matters. Same caveat |
| Coverage, diversity, novelty | **Report alongside, always** — they catch the popularity-list failure |
| Hit rate on a temporal split | The most honest offline proxy: train on before, evaluate on after |

**The acceptance test is an online experiment.** Route to
`experiment-design-readout` for the design. The minimum honest version:

- Randomised assignment of accounts (or sessions) to recommended versus control.
- A **primary metric decided in advance**, which is a business outcome — revenue
  per account, attach rate, expansion — not click-through on the widget.
- A power calculation before launch. Recommender effects are usually small
  relative to baseline variance, so underpowered tests are the norm.
- A holdout kept running after launch, so degradation is detectable later.

**Never declare victory offline.** Give the offline numbers, say plainly what
they do and do not establish, and name the test that would settle it.

---

## 7. Feedback loops poison the next training set

Once a recommender is live, the interaction data it learns from is data **it
caused**. Items it surfaces get bought; items it never surfaces accumulate
evidence of being unwanted. Retrain on that and the model confirms itself, with
the catalogue narrowing each cycle.

**Mitigations, in order of value:**

1. **Log the recommendation alongside the outcome.** Which items were shown, in
   what position, to whom, and what happened. Without this log, none of the
   others are possible and the loop is invisible. **Do this from day one.**
2. **Keep a randomised holdout permanently.** A small share of accounts receive
   no recommendations or randomised ones. That slice is the only unbiased data
   you will have, and it is what makes future evaluation honest.
3. **Inject exploration.** A share of slots given to items the model is uncertain
   about. Costs a little precision, buys the data that prevents collapse.
4. **Position-debias the training data.** Position-one items get clicked because
   they are first. Weight by inverse propensity of exposure where the logs
   support it.
5. **Monitor catalogue coverage over time.** A coverage number falling run over
   run is the loop closing, and it is the cheapest early warning.

---

## 8. Output

```yaml
provisional: true        # this skill's status, carried into every output
problem_routing:
  question_type: product_recommendation | content | next_best_action
  routed_elsewhere: <skill or null, with reason>
data:
  users: <n>, items: <n>, interactions: <n>
  density: <interactions / (users × items)>
  cold_start_assessment: "<which of the three cases apply>"
  matrix_shape_verdict: "cf_viable | cf_not_viable, with the reason"
approach:
  chosen: association_rules | content_based | item_item_cf | mf | hybrid
  rationale: "<why, against the §2 table>"
  rule_layer: "<eligibility, sequencing, margin constraints applied>"
baseline:
  definition: "segment-conditioned popularity, excluding owned items"
  offline_metrics: {...}
offline_evaluation:
  split: temporal
  precision_at_k, recall_at_k, ndcg, hit_rate
  vs_baseline: {delta, overlapping_intervals: bool}
  coverage: {catalogue, user}
  diversity: {aggregate, intra_list}
  novelty: <v>
  limitations_statement: "evaluated against behaviour the recommender would have changed"
online_test:
  status: not_run | designed | running | complete
  design: <link to experiment-design-readout output>
  primary_metric: "<business outcome, not widget CTR>"
  power: {mde, n_required, duration}
feedback_loop_controls:
  recommendation_logging: in_place | missing
  randomised_holdout_share: <v>
  exploration_share: <v>
  coverage_trend: [...]
```

---

## 9. Answering

**Answer first, with the recommendation and the honest status of the evidence.**

> **Here are the top three cross-sell candidates per account, and they come from
> association rules rather than a collaborative filter.**
>
> With 840 accounts and 14 products the interaction matrix is too small and too
> sparse for collaborative filtering — a factorisation would return numbers, but
> they would be noise with a good reconstruction error. Association rules on the
> same data give explicable rules with real lift: the strongest is
> A → B at lift 2.7, support 0.11, confidence 0.38.
>
> **Against the baseline, the gain is real but modest.** Precision@3 is 0.24
> versus 0.19 for segment-conditioned popularity, on overlapping intervals — so
> treat the ranking as useful and the improvement as unproven.
>
> **What the offline number does not establish.** It is measured against what
> customers bought under the old process, so it penalises exactly the discovery
> you want. The only thing that settles business impact is an online test: a
> randomised account split with attach rate as the primary metric — not widget
> clicks — and at this account count you would need roughly a quarter to detect a
> 20% relative lift.
>
> **Two things to do before launch, regardless.** Log every recommendation shown
> alongside the outcome, and keep 5% of accounts as a permanent randomised
> holdout. Without those, the next retrain learns from its own output and the
> catalogue narrows.
>
> Note: this skill is provisional — its subject matter is outside the research
> base behind the rest of this pack.

**Withhold only** what cannot be computed: a business-impact claim from offline
metrics (give the offline numbers and name the test), recommendations for
accounts with no history and no firmographics (give the segment popularity list
instead and say it is not personalised), and any platform-specific delivery
capability, which is governed by the relevant `platforms/` module rather than
asserted here.

---

## Calls

- `answer-contract` — every recommendation set, metric and verdict, and the
  provisional status
- `provenance-block` — interaction window, source and freshness on the training
  data
- `comparability-rules` — before comparing offline metrics across periods,
  catalogues or model versions
- `write-gate` — pushing a recommendation set into any system is a write

## References

- `references/cold-start-and-baselines.md` — matrix viability, association rules
  worked, and the baseline recipes
- `references/evaluation-and-feedback.md` — offline metric definitions, the
  online test minimum, and feedback-loop controls

## Related skills

- `uplift-and-causal-models` — **next-best-action belongs there**, and so does
  any question about whether the recommendation changed anything
- `experiment-design-readout` — the online test that is the real acceptance
  criterion
- `identity-resolution` — recommendations at account level need the contacts
  linked, or the interaction matrix is fragmented
- `feature-engineering-gtm` — item and account attributes, point-in-time
- `model-evaluation-monitoring` — coverage and diversity drift after launch
- `segmentation-model-support` — activation constraints where recommendations are
  delivered as segments
