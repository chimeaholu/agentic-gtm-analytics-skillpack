---
name: uplift-and-causal-models
description: Use when deciding whom to target with an intervention — a discount, a retention offer, an outbound sequence, a campaign — rather than predicting who will convert anyway. Covers uplift modelling and treatment-effect estimation, the four persuadability quadrants, the randomised data requirement that makes uplift estimable at all, and the observational methods available when randomisation was not run. Prevents the most expensive targeting error in GTM: spending retention budget on the customers who were never going to leave.
---

# Uplift and Causal Models

A propensity model answers "who will convert". An uplift model answers "who will
convert **because we acted**". They are different questions, they rank people
differently, and **the propensity model targets the wrong people by
construction** — it puts the customers who were already going to buy at the top
of the list, because they are the most likely to buy.

That is why a retention campaign targeting "high churn risk" often shows a
wonderful save rate and no measurable effect on retention.

---

## 1. The four quadrants

Every person sits in one of four cells, defined by what they do treated versus
untreated:

| | **Converts if treated** | **Does not convert if treated** |
|---|---|---|
| **Converts if untreated** | **Sure things** — would have converted anyway. Spend is wasted | **Sleeping dogs** — treatment *stops* them. Spend is actively harmful |
| **Does not convert if untreated** | **Persuadables** — the only group worth spending on | **Lost causes** — never respond. Spend is wasted |

```
uplift(x) = P(convert | treated, x) − P(convert | untreated, x)
```

- Persuadables: large positive uplift
- Sure things and lost causes: uplift ≈ 0, from opposite directions
- **Sleeping dogs: negative uplift**

**Sleeping dogs are real and they are expensive.** A renewal reminder that
prompts a customer to reconsider. A discount offer that signals the product is
overpriced. A re-engagement email to a dormant subscriber that produces an
unsubscribe instead of a session. **A propensity model cannot see them at all**,
because they convert at a perfectly ordinary rate when left alone.

**The individual treatment effect is never observed.** You see one arm per
person, never both. Everything in this skill is machinery for estimating a
difference you cannot measure directly — which is why the data requirement in §2
is not negotiable.

---

## 2. Randomisation is what makes uplift estimable

Without randomised assignment you are estimating a conditional difference
confounded by **whoever was selected for treatment**, and in GTM the selection is
never innocent: reps call the accounts that look promising, campaigns target
engaged segments, retention offers go to the customers who complained.

Estimating "uplift" on that data produces a number with the right units and the
wrong meaning. **It will look exactly like a valid uplift score.**

### What counts as randomised enough

| Source | Verdict |
|---|---|
| A designed A/B test with a proper holdout | **Yes.** The gold standard |
| A campaign with a randomly-selected holdout that was actually enforced | **Yes**, if the holdout was not quietly worked anyway — verify in the activity data, do not take it on trust |
| A staged rollout randomised by unit | **Yes** |
| Randomisation by an arbitrary-but-non-random key (alternating IDs, alphabetical) | **Check it.** Often correlated with something; test balance |
| "We treated everyone we thought would respond" | **No.** Observational |
| Geographic or temporal rollout, not randomised | **No**, but a geo or difference-in-differences design may identify it — see §6 |

### The balance check, run before anything else

```sql
-- treated vs control on every pre-treatment covariate
select feature_name,
       avg(case when arm = 'treated' then value end) as treated_mean,
       avg(case when arm = 'control' then value end) as control_mean,
       (avg(case when arm = 'treated' then value end)
        - avg(case when arm = 'control' then value end))
         / nullif(stddev(value), 0)                  as standardised_diff
from   pre_treatment_features
group by 1
order by abs(3) desc;
```

**Standardised difference above 0.1 on any meaningful covariate means the arms
are not comparable.** Either the randomisation failed, or something after
assignment broke it — differential attrition, an opt-out, a rep working the
holdout. Say which, and if it cannot be established, say that.

---

## 3. When there is no randomisation

**Say so, and offer the observational alternatives with their assumptions stated
— do not produce an uplift number that looks the same and means something
different.**

| Method | What it needs | Assumption that must hold | Honest description |
|---|---|---|---|
| **Propensity score matching / weighting** | Rich pre-treatment covariates | **No unmeasured confounding** — everything driving both treatment and outcome is observed. Untestable, and usually false in GTM because rep judgement is unrecorded | "Adjusted association, not effect" |
| **Difference-in-differences** | Pre and post periods for both groups | **Parallel trends** — the groups would have moved together absent treatment. Testable in the pre-period | Good when the rollout is staged |
| **Regression discontinuity** | A threshold rule assigning treatment (score ≥ X gets the offer) | Continuity at the cutoff; no manipulation of the running variable | **Strong when a threshold exists.** GTM has these more often than people realise — score thresholds, spend tiers |
| **Instrumental variables** | An instrument affecting treatment but not the outcome directly | Relevance and exclusion. Genuine instruments are rare in GTM | Usually not available; say so |
| **Synthetic control / geo-lift** | Many untreated units, long pre-period | A good pre-period fit | The right tool for channel and market-level questions |

**The rule for wording:** an observational estimate is reported as *"adjusted
association under the stated assumption"*, never as *"incremental effect"*, and
the assumption is named in the same sentence.

**And give the number.** Refusing to compute anything sends the requester to a
spreadsheet where they will compute the naive difference with no caveat at all.
Compute it, label it, and name the design that would settle it.

---

## 4. Estimation approaches

| Approach | How | Strengths | Weaknesses |
|---|---|---|---|
| **Two-model (T-learner)** | Fit one model per arm, subtract | Trivial to implement; uses any classifier | **Each model optimises its own accuracy, not the difference.** Differencing two noisy estimates is noisier still — poor when the base rate is small |
| **Single-model (S-learner)** | One model with treatment as a feature | Simple; shares data across arms | The model may **ignore** the treatment feature if its effect is small relative to other signal, producing uplift ≈ 0 everywhere |
| **X-learner** | T-learner, then model the imputed effects, weight by propensity | **Good when the arms are very unbalanced** — the common case with a small holdout | More moving parts |
| **Transformed outcome** | Relabel `z = y·(t−p)/(p(1−p))` and regress on it | Directly targets uplift with any regressor | High variance; needs the treatment propensity `p` |
| **Uplift trees / causal forests** | Split on the criterion that maximises the *difference* between arms | **Directly optimises what you care about**; honest confidence intervals from causal forests | Needs a library; more data than a T-learner |

**Sensible default:** start with the T-learner because it is transparent and
takes an hour. If the base rate is under ~5% or the arms are very unbalanced, go
to X-learner or a causal forest. Report which you used and why — the estimates
differ, and a stakeholder who sees two numbers deserves to know why.

```python
# T-learner, the whole thing
m_t = clone(base).fit(X[t == 1], y[t == 1])
m_c = clone(base).fit(X[t == 0], y[t == 0])
uplift = m_t.predict_proba(X_new)[:, 1] - m_c.predict_proba(X_new)[:, 1]
```

**Calibrate both arm models before subtracting.** Two uncalibrated probabilities
differenced is not an uplift; it is the difference of two rankings, and the
distortions do not cancel.

---

## 5. Evaluation is different — Qini, not AUC

**AUC is meaningless for uplift** because the individual treatment effect is
never observed, so there is no per-record ground truth to rank against.

### The uplift curve

Sort by predicted uplift descending. At each depth *k* of the population:

```
cumulative_uplift(k) = (Y_t(k) / N_t(k) − Y_c(k) / N_c(k)) × (N_t(k) + N_c(k))
```

where `Y_t(k)`, `N_t(k)` are outcomes and counts among the treated within the top
k, and likewise for control. This is the **incremental conversions gained** by
treating the top k.

### The Qini coefficient

Area between the uplift curve and the random-targeting diagonal. Higher is
better; **zero means the model is no better than treating at random**, which is
the honest baseline. Qini is not comparable across datasets — compare within a
dataset, against random and against propensity-ranked targeting.

### The decile table that gets used

```
decile | n_treat | n_ctrl | rate_treat | rate_ctrl | uplift_pp | ci | incremental
   1   |   1,204 |  1,190 |      0.112 |     0.061 |     +5.1  | ±1.8 |    +61
   2   |   1,198 |  1,205 |      0.089 |     0.071 |     +1.8  | ±1.7 |    +22
  ...
  10   |   1,201 |  1,198 |      0.043 |     0.058 |     -1.5  | ±1.5 |    -18   ← sleeping dogs
```

**The confidence interval column is not optional.** The uplift in each decile is
a difference of two rates on a tenth of the data, and its interval is wide. A
decile table without intervals invites people to act on noise, and the bottom
decile's apparent negative uplift is frequently indistinguishable from zero.

```
se(uplift) = sqrt( p_t(1−p_t)/n_t + p_c(1−p_c)/n_c )
95% CI      = uplift ± 1.96 · se
```

---

## 6. Power: uplift costs far more sample than propensity

You are estimating a **difference of two small rates**, so the variance is the
sum of both arms' variances. Sample sizes that comfortably support a propensity
model will not support uplift.

```
n per arm ≈ 16 · p̄(1 − p̄) / δ²      for 80% power at α = 0.05
                                       δ = the absolute uplift to detect
```

| Base rate | Uplift to detect | n per arm |
|---|---|---|
| 10% | +2 pp (10% → 12%) | ~ 7,400 |
| 10% | +1 pp | ~ 29,000 |
| 5% | +1 pp | ~ 15,000 |
| 3% | +0.5 pp | ~ 37,000 |
| 20% | +3 pp | ~ 14,000 |

**And segment-level uplift needs that sample per segment**, which is where most
uplift projects actually fail — the overall effect is measurable and the
targeting model needs the effect *within* deciles.

**Run the power calculation before promising an uplift model.** Where the sample
cannot support it, the honest answer is: run the experiment to measure the
**average** effect, which is achievable, and revisit personalised targeting when
volume allows. Give the minimum detectable effect as a number — that is the most
useful thing you can say to someone with a small dataset.

---

## 7. Connect to the aggregate causal layer

Individual-level randomisation is impossible for many GTM questions: brand
campaigns, channel budgets, pricing. Those are answered at the aggregate level:

| Question | Layer | Skill |
|---|---|---|
| Whom should we treat? | Individual | This skill |
| Did this channel drive incremental revenue? | Aggregate | `incrementality-and-mmm` |
| How should the budget split across channels? | Aggregate | `incrementality-and-mmm`, `budget-allocation` |
| Did this campaign work at all? | Either | `experiment-design-readout` |

**They are complementary, not competing.** Geo-lift and MMM answer allocation
where individual randomisation cannot run; uplift answers targeting where it can.
A pack that only had one of them would give the wrong answer to half the
questions.

**Compose, do not reimplement.** Mature open-source implementations exist for
MMM, geo-lift and causal inference, and they are better maintained than anything
this pack would write. Name the right one and hand off.

---

## 8. Output

```yaml
design:
  randomised: true | false
  assignment_mechanism: "<how>"
  balance_check: {max_standardised_diff, covariates_failing: [...], verdict}
  holdout_integrity: "<verified in activity data | unverified>"
  identification: rct | did | rdd | psm | iv | none
  assumption_stated: "<the assumption, in one plain sentence>"
estimation:
  method: t_learner | s_learner | x_learner | transformed_outcome | causal_forest
  rationale, arm_models_calibrated: true
  n_treated, n_control, base_rate_treated, base_rate_control
average_effect:
  ate_pp, ci, p_value, incremental_conversions
targeting:
  qini, qini_vs_random, qini_vs_propensity_ranking
  decile_table: [{decile, n_t, n_c, rate_t, rate_c, uplift_pp, ci, incremental}]
  quadrant_shares: {persuadables, sure_things, lost_causes, sleeping_dogs}
  sleeping_dogs_detected: bool, evidence
  recommended_depth: {top_k_pct, expected_incremental, cost, net_value}
power:
  observed_n_per_arm, mde_pp, adequate: bool
  segment_level_adequate: bool
limitations:
  - "individual treatment effects are never observed"
  - "<assumption> must hold for this to be an effect rather than an association"
```

---

## 9. Answering

**Answer first: give the targeting recommendation and the number it is worth.**

> **Treat the top three deciles, not everyone, and expect about 180 incremental
> saves rather than the 640 the propensity model implies.**
>
> The uplift model, fitted on your randomised holdout (n = 11,900 treated,
> 11,850 control), concentrates the effect: decile 1 shows +5.1pp (±1.8), decile
> 2 +1.8pp (±1.7), and everything below decile 3 is indistinguishable from zero.
> Qini is 0.041 against 0 for random targeting and 0.009 for propensity ranking —
> so the propensity list is barely better than random **at this question**, which
> is expected: it ranks sure things first.
>
> **One finding worth acting on.** Decile 10 shows −1.5pp (±1.5). That is
> consistent with sleeping dogs — the offer reminding people they could leave —
> but the interval includes zero, so treat it as a hypothesis, not a fact.
> Suppressing that decile costs nothing and is worth doing on the asymmetry
> alone.
>
> **At your cost of 40 per offer and 900 per save:** treating the top 30% gives
> roughly 180 saves against 7,100 offers — about 162k of value against 284k of
> cost, which does not clear. **The top 10% alone gives 61 saves for 1,190
> offers: 55k against 48k.** That is the defensible depth, and it is a much
> smaller programme than the one currently planned.
>
> **Caveat, one sentence:** the holdout's integrity is verified in the activity
> data — 3% of the control group was contacted anyway, which biases the measured
> uplift downward slightly, so the true effect is if anything a touch larger.

**Withhold only** what cannot be honestly computed:

- **A causal uplift claim with no randomisation and no identification strategy.**
  Give the adjusted association, name the assumption it rests on, and name the
  design that would settle it. That is an annotated answer, not a refusal.
- **Decile-level uplift where the decile has too few outcomes.** Report the
  average effect, which is estimable, plus the minimum detectable effect at the
  decile level.
- **A sleeping-dog claim from an interval that includes zero.** State it as a
  hypothesis with the asymmetric-cost argument for acting on it anyway.

---

## Calls

- `answer-contract` — every effect estimate, interval and targeting
  recommendation; and the `unavailable` result where causality is not identified
- `provenance-block` — treatment window, outcome window, timezone, and the
  assignment mechanism as part of provenance
- `comparability-rules` — treated and control must be comparable before any
  difference is taken; this contract is the balance check's home
- `warning-field-reader` — extract caveats on outcome data propagate into the
  effect estimate
- `write-gate` — suppression lists and treatment assignment pushed to a platform
  are writes

## References

- `references/estimation-methods.md` — the learners worked, Qini computation, and
  the decile table with intervals
- `references/identification-without-rct.md` — DiD, RDD, matching and synthetic
  control, each with its assumption, its test and its honest wording

## Related skills

- `experiment-design-readout` — designs the randomisation this skill needs, and
  reads out the test
- `incrementality-and-mmm` — the aggregate-level counterpart for channel and
  budget questions
- `supervised-propensity-models` — the model this one exists to correct; also
  supplies the arm models
- `churn-prediction-models` — produces the risk score; **this skill decides whom
  to act on**
- `ml-foundations-marketing` — the gate, the split, and the power discipline
- `segmentation-model-support` — turning the targeting decision into an
  activatable segment with a suppression list
