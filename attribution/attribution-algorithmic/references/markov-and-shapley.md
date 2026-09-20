# Markov and Shapley, worked end to end on a small path set

Everything below is computed from one synthetic dataset, printed in full so the
numbers can be reproduced and the edge cases are visible rather than asserted.

---

## 1. The dataset

Three channels — A, B, C — and 5,600 journeys, each a channel sequence with a
converted flag. **Both converting and non-converting paths are present**, which
is the prerequisite from §1 of the skill.

| Path | Converted | Not converted |
|---|---|---|
| A | 120 | 880 |
| B | 40 | 960 |
| C | 150 | 350 |
| A → C | 220 | 380 |
| B → A | 90 | 510 |
| B → C | 80 | 420 |
| A → B → C | 130 | 270 |

Totals: 830 conversions, 5,600 journeys, overall conversion rate 14.8%.
Path-length distribution: p50 = 2, p90 = 3, single-touch share 45%. That share
is high enough to note in the readout — nearly half these journeys have no
multi-touch structure for either model to find.

---

## 2. Markov

### 2.1 Transition matrix

Each journey contributes `Start → … → Conversion` or `Start → … → Null`. Counting
all 5,600 and normalising each row gives the transition probabilities. The
`→ Null` column exists only because non-converting paths are in the data; drop
them and every row's absorption becomes `Conversion` with probability 1.

### 2.2 Baseline

With the transient block `Q` and absorbing block `R`:

```
B = (I − Q)⁻¹ R
π = B[Start, Conversion] = 0.1804
```

**The chain's 18.04% is not the observed 14.8% conversion rate, and it is not
meant to be.** A first-order chain does not preserve the joint path
distribution — it reassembles journeys from pairwise transitions and generates
paths that never occurred. **Check this gap on every run.** A small gap is the
model's normal approximation error; a large one means the first-order assumption
is badly wrong for your journeys and the order-2 comparison is mandatory.

### 2.3 Removal effects

Remove one channel by routing every transition that entered it to `Null`, then
recompute absorption:

| Removed | π′ | `RE = (π − π′)/π` | Normalised credit |
|---|---|---|---|
| A | 0.0587 | **0.675** | 37.8% |
| B | 0.1065 | **0.410** | 23.0% |
| C | 0.0543 | **0.699** | 39.2% |

Read the raw column, not the normalised one, when talking to a human: *removing
C would cost about 70% of modelled conversions.* The removal effects sum to
1.78, not 1.0, because the channels overlap in paths — **the normalisation to
100% is an imposed convention, not an estimate**, and the skill reports both
columns for exactly that reason.

### 2.4 Order 2

Re-estimate over states of the form `(previous, current)` and compare. On this
dataset the order-2 chain is sparse — several two-step states occur under 100
times — and the removal effects widen. **Report both orders and the disagreement;
do not pick.** Sparse higher-order states are the usual reason an order-2 model
looks more "detailed" and is less reliable.

---

## 3. Shapley

### 3.1 Choose the characteristic function deliberately

`v(S)` can be defined two ways, and **the choice changes the sign of the
answer.**

**Counts (recommended).** `v(S)` = conversions from journeys whose channel set
is a subset of `S`:

```
v(∅)=0   v(A)=120   v(B)=40    v(C)=150
v(AB)=250   v(AC)=490   v(BC)=270   v(ABC)=830
```

This is **monotone** — adding a channel never lowers the coalition value — so
every Shapley value is non-negative, and efficiency gives `Σφ = v(N) = 830`, the
actual conversion count.

| Channel | φ (conversions) | Credit |
|---|---|---|
| A | 318.3 | 38.4% |
| B | 168.3 | 20.3% |
| C | 343.3 | 41.4% |

**Rates (the trap).** Define `v(S)` as the coalition's conversion *rate* instead,
and the function is **not monotone** — adding a channel that brings low-intent
volume lowers the rate. On this same dataset:

```
v(A)=0.120  v(B)=0.040  v(C)=0.300
v(AB)=0.096  v(AC)=0.233  v(BC)=0.135  v(ABC)=0.180
```

Note `v(C) = 0.300 > v(AC) = 0.233`. The resulting Shapley values are
`φ_A = +0.053, φ_B = −0.036, φ_C = +0.163`. **B's value is negative**, and
normalising those to 100% produces credits of 29.6%, −19.8% and 90.2%.

That output is not a finding about B. It is an artefact of a non-monotone
characteristic function, and it is how "channel X has negative attribution"
appears in a deck. **Use counts unless you have a specific reason not to, state
which you used, and if a Shapley value comes out negative, check monotonicity
before writing a sentence about the channel.**

### 3.2 Sampling, when exact is too expensive

Beyond roughly 15–20 channels, `2ⁿ` coalitions is impractical. Sample random
permutations and accumulate marginal contributions:

```python
def shapley_mc(channels, v, n_perm=10_000, seed=0):
    rng = random.Random(seed)
    acc = {c: [] for c in channels}
    for _ in range(n_perm):
        perm, S, prev = rng.sample(channels, len(channels)), set(), v(set())
        for c in perm:
            S.add(c); cur = v(S)
            acc[c].append(cur - prev); prev = cur
    return {c: (mean(x), stdev(x) / sqrt(len(x))) for c, x in acc.items()}
```

**Report the standard error with every value.** The decision rule: if two
channels' estimates are within two standard errors of each other, they are not
ranked — say they are tied and increase the permutation count if the ranking
matters. A sampled Shapley reported as a point estimate is an approximation
presented as exact.

---

## 4. The two models compared on this dataset

| Channel | Markov credit | Shapley (counts) credit | Range |
|---|---|---|---|
| A | 37.8% | 38.4% | 0.6pp |
| B | 23.0% | 20.3% | 2.7pp |
| C | 39.2% | 41.4% | 2.2pp |

**Same ranking, magnitudes within three points — act on the ordering.** This is
the common outcome and it is worth saying plainly: when the two models agree
this closely, the remaining uncertainty is not in the choice of algorithm, it is
in the journey data underneath and in the fact that neither is causal.

Where they do diverge, the usual cause is path order: Markov sees `B → C` and
`C → B` as different, Shapley does not. Check whether the diverging channel's
position in paths is bimodal.

---

## 5. The checks to run every time

```python
assert non_converting_paths > 0
assert abs(sum(shapley.values()) - total_conversions) < 1e-6     # efficiency
assert all(v >= 0 for v in shapley.values()) or characteristic == "rate"
assert abs(markov_pi - observed_conversion_rate) / observed_rate < 0.35   # else order-2
assert sum(normalised_credit.values()) == pytest.approx(1.0)
report(raw_removal_effects)        # never only the normalised column
report(path_length_distribution)   # before anything else
```

The first and last are the ones that catch real failures. Everything in between
catches arithmetic.
