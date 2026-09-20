# Identification without a randomised trial

When randomisation did not happen. Each method, its assumption, its test, and
the words to use.

**The rule that governs all of them: compute the number, label it correctly, name
what would settle it.** Refusing outright sends the requester to a spreadsheet
where they compute the naive difference with no caveat at all.

---

## 1. Propensity score matching / weighting

**What it does.** Models the probability of being treated from pre-treatment
covariates, then compares treated and control records with similar propensities —
by matching, stratification, or inverse-probability weighting.

**Assumption.** *No unmeasured confounding*: every variable influencing both
treatment and outcome is observed and included.

**Why it usually fails in GTM.** The selection mechanism is often a human
judgement that was never recorded. A rep called the account because the buyer
sounded enthusiastic on a call. That enthusiasm predicts both treatment and
conversion, and it is in no table.

**Test.** Covariate balance after matching:

```sql
select feature_name,
       (avg(value) filter (where arm='treated')
        - avg(value) filter (where arm='control'))
         / nullif(stddev(value), 0) as standardised_diff
from   matched_pairs_features group by 1 order by abs(2) desc;
```

Post-match standardised differences should be under 0.1. **Balance on observed
covariates is necessary and not sufficient** — it says nothing about the
unobserved ones, and saying so is part of the deliverable.

**Sensitivity.** Report how strong an unmeasured confounder would have to be to
overturn the result (a Rosenbaum-style bound, or the E-value). "An unmeasured
confounder would need to be associated with both treatment and outcome at a risk
ratio above 2.1 to explain this away" is a genuinely useful sentence.

**Wording.** *"Adjusted association after matching on observed covariates. This
is not an effect estimate unless no unmeasured confounding holds, which cannot be
tested here."*

---

## 2. Difference-in-differences

**What it does.** Compares the *change* in the treated group against the *change*
in a comparison group over the same period. Time-invariant differences between
the groups cancel.

```
DiD = (Y_treated,post − Y_treated,pre) − (Y_control,post − Y_control,pre)
```

**Assumption.** *Parallel trends*: absent treatment, the two groups' outcomes
would have moved together.

**Test.** Plot both series over several pre-periods. Parallel before treatment is
supporting evidence; diverging before treatment kills the design.

```sql
select period, arm, avg(outcome) as rate
from   panel where period < :treatment_start
group by 1, 2 order by 1, 2;
-- the two arms' slopes should be indistinguishable
```

**Warnings.** Staggered adoption across many units breaks the simple two-way
fixed-effects estimator — use a modern staggered-DiD estimator, and say which.
Anticipation effects (behaviour changing before treatment because it was
announced) violate the design quietly.

**Wording.** *"Difference-in-differences estimate under the parallel-trends
assumption, which holds visually over the four pre-periods shown."*

---

## 3. Regression discontinuity

**What it does.** Where treatment is assigned by a threshold on a continuous
running variable — lead score ≥ 80 gets the SDR call, spend ≥ X gets the account
manager — records just above and just below the cutoff are as good as randomised.

**Assumption.** Continuity at the cutoff: nothing else changes discontinuously
there, and the running variable cannot be manipulated.

**Test.** Density of the running variable around the cutoff (a sharp pile-up just
above means manipulation — reps nudging scores over the line), and continuity of
pre-treatment covariates across the cutoff.

**Why it matters in GTM.** Threshold rules are everywhere — scoring thresholds,
tier boundaries, spend cutoffs — and they are **the most credible identification
strategy routinely available without running an experiment.** Look for one before
reaching for matching.

**Limit.** The estimate is local: it identifies the effect **at the cutoff**, for
records near it. It says little about the effect on records far from the
threshold, and that must be stated.

**Wording.** *"Local effect at the score threshold, for leads near 80. Not an
estimate of the effect on high-scoring leads."*

---

## 4. Instrumental variables

Needs a variable that shifts treatment but affects the outcome only through
treatment. **Genuine instruments are rare in GTM.** Candidates occasionally
worth examining: rep availability driven by an unrelated roster, a randomised
send-time, an arbitrary routing rule.

Weak instruments produce badly biased estimates that look fine. Report the
first-stage F statistic; below about 10, the instrument is weak and the estimate
should not be used.

**Usually the honest answer is "no valid instrument is available here", and that
is a complete answer** when it names the alternatives.

---

## 5. Synthetic control and geo-lift

For aggregate units — markets, regions, channels — a weighted combination of
untreated units is constructed to match the treated unit's pre-period, then the
post-period divergence is the estimate.

Needs many untreated units and a long, well-fitting pre-period. **This is the
right tool for channel-level and market-level questions**, and it belongs to
`incrementality-and-mmm`. Mature open-source implementations exist; compose, do
not reimplement.

---

## 6. The decision order

1. **Was anything randomised?** Even a small holdout. If yes, use it.
2. **Is there a threshold rule?** → regression discontinuity.
3. **Was there a staged rollout with pre-periods?** → difference-in-differences.
4. **Are the units aggregate?** → synthetic control / geo-lift.
5. **Otherwise:** matching or weighting, reported as an adjusted association with
   a sensitivity bound.
6. **In every case:** name the experiment that would settle it, and its cost. A
   5% randomised holdout on the next campaign is usually cheap, and it makes
   every future question in this area answerable.

---

## 7. What never to do

- Report a matched estimate as an "incremental effect".
- Compare treated records against *all* untreated records with no adjustment and
  call the difference uplift.
- Use post-treatment variables as covariates — they are affected by the
  treatment, and conditioning on them opens a bias path.
- Present an observational quadrant assignment (persuadables, sleeping dogs) as
  if it were estimated from a trial. The quadrants are defined by counterfactuals
  that only randomisation can approximate.
- Refuse to produce any number. Produce it, label it, name the fix.
