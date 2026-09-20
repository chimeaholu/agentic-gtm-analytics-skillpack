# Power, sample size and duration

---

## 1. The formulas

### Two proportions, two-sided

```
n per arm = (z_{1−α/2} + z_{1−β})² · [ p₁(1−p₁) + p₂(1−p₂) ] / (p₂ − p₁)²
```

| α (two-sided) | Power | `(z_{1−α/2} + z_{1−β})²` |
|---|---|---|
| 0.05 | 0.80 | **7.849** |
| 0.05 | 0.90 | 10.507 |
| 0.10 | 0.80 | 6.183 |
| 0.01 | 0.80 | 11.679 |

### Continuous outcome

```
n per arm = 2 · (z_{1−α/2} + z_{1−β})² · σ² / Δ²
```

**Revenue per user is the trap.** Its distribution is heavy-tailed, so the
historical `σ` overstates achievable precision and a test sized on it will be
underpowered in practice. Mitigations, in order:

1. **Winsorise** at a stated percentile (p99 is common) and say you did.
2. **Use a bounded proxy** — conversion rate, or revenue capped at a plan price.
3. **Use variance reduction** — CUPED, regressing out a pre-period covariate,
   commonly cuts required sample materially. State that you used it and what
   covariate.

### Required sample as a function of effect

```
n ∝ 1 / Δ²
```

**Halving the effect you want to detect quadruples the sample.** This single
relationship explains nearly every infeasible test, and it is the fact to lead
with when someone asks for "just a bit more precision".

---

## 2. Worked table: proportions at α = 0.05, 80% power

| Baseline | Relative lift | Absolute | n per arm | Total n |
|---|---|---|---|---|
| 2% | 5% | 0.10pp | 315,203 | 630,406 |
| 2% | 10% | 0.20pp | 80,679 | 161,358 |
| 2% | 20% | 0.40pp | 21,106 | 42,212 |
| 5% | 5% | 0.25pp | 122,121 | 244,242 |
| 5% | 10% | 0.50pp | 31,231 | 62,462 |
| 5% | 20% | 1.00pp | 8,155 | 16,310 |
| 10% | 5% | 0.50pp | 57,760 | 115,520 |
| 10% | 10% | 1.00pp | 14,748 | 29,496 |
| 10% | 20% | 2.00pp | 3,838 | 7,676 |

Two readings worth giving a stakeholder directly:

- **A higher baseline is cheaper to test.** Testing on a segment that converts at
  10% rather than 2% cuts the required sample by a factor of five for the same
  relative lift. **Choosing the test population is a design lever**, not a detail.
- **A 5% relative lift is out of reach for most GTM populations.** Say so early.
  The conversation that follows — "what effect would actually change the
  decision?" — is the useful one, and it usually reveals the real bar is higher
  than 5%.

---

## 3. Duration

```
duration_days = (required_n_per_arm × n_arms) / eligible_units_per_day
```

Then apply three adjustments:

1. **Round up to whole business cycles**, normally whole weeks. A test ending
   mid-week over-weights whichever days it caught.
2. **Minimum one week**, regardless of traffic, to cover the weekly cycle.
3. **Add the outcome lag.** If the outcome is a purchase that happens a median of
   six days after assignment, the last six days of assignment cannot contribute
   outcomes. Either extend, or stop assigning six days before the readout and say
   which.

**A test that would take longer than the thing being tested will remain
unchanged is not a viable test.** Say that out loud at design time.

---

## 4. Sequential and always-valid methods

Fixed-horizon tests are invalidated by peeking. If you need to look, choose a
method designed for it **before starting**.

| Method | Property | Cost |
|---|---|---|
| **mSPRT / always-valid inference** | valid at every look; stop any time | wider intervals; larger expected sample when the effect is small |
| **Group sequential with alpha spending** | valid at pre-specified interim looks | the number and timing of looks must be fixed in advance |
| **Bayesian with a decision rule** | posterior is valid at any look; the decision rule is the thing to pre-register | priors are a choice and must be stated |

**None of these retroactively fixes peeking already done on a fixed-horizon
test.** If a fixed-horizon test was peeked and stopped early, report the result
with the peeking disclosed and treat it as a hypothesis for a clean re-run.

---

## 5. The MDE conversation

When a requested test is infeasible, this is the conversation to have, in this
order:

1. **"What is the smallest effect that would change what you do?"** Frequently
   much larger than the effect people ask to detect, and the honest answer makes
   the test feasible.
2. **"What happens if we detect nothing?"** If the answer is "we ship it anyway",
   the test is decoration and should not be run.
3. **"Can we test on a higher-baseline population?"** Faster, at the cost of
   generalisation to the whole base, which must be stated.
4. **"Is there a more sensitive outcome?"** An earlier funnel step has a higher
   base rate and is a proxy. Say it is a proxy.
5. **"Is a different design available?"** Geo holdout, switchback, or a
   time-based design can work where per-unit randomisation cannot — see
   `incrementality-and-mmm`.

**Do not skip straight to (3) and (4).** Changing the population or the metric
without changing the question is how a test ends up answering something nobody
asked.

---

## 6. Variance reduction, briefly

Where a pre-period covariate correlated with the outcome exists — prior purchase
volume, prior sessions, prior usage — **CUPED-style adjustment reduces variance
and therefore required sample**, often substantially, with no change to the
randomisation.

Requirements: the covariate must be measured **before assignment** (otherwise it
is post-treatment and biases the estimate), and its use must be pre-registered
like everything else. Report both the adjusted and unadjusted estimates; if they
differ materially, that is a signal worth investigating rather than a free
improvement.
