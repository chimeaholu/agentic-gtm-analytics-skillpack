# Decomposition methods

Four methods, each exactly additive, each right for a different metric shape.
Plus the cases where none of them applies, which is the part that keeps the
narrative honest.

---

## 0. Pick the method from the metric's algebra

| The metric is | Method | §|
|---|---|---|
| a product of factors (`R = N × W × A`) | sequential substitution, or LMDI | 1, 2 |
| a sum of parts (`revenue = Σ segments`) | additive contribution | 3 |
| an average or rate over a mixed population | within/mix split | 4 |
| a stock moved by flows (ARR, headcount, pipeline) | flow waterfall | 5 |

**Getting this wrong produces a decomposition that does not sum**, and a
decomposition that does not sum is worse than no decomposition: an executive adds
the parts, gets a different number from the headline, and discounts everything
else in the pack.

---

## 1. Sequential substitution (chained)

Change one factor at a time in a declared order, holding already-substituted
factors at their new values.

```python
def sequential_substitution(f0: dict, f1: dict, order: list[str]):
    """f0, f1: factor name -> value. Their products are the metric in each period.
    Returns name -> contribution. Contributions sum exactly to prod(f1) - prod(f0)."""
    cur = dict(f0)
    out = {}
    for name in order:
        before = prod(cur.values())
        cur[name] = f1[name]
        out[name] = prod(cur.values()) - before
    return out

def prod(vals):
    r = 1.0
    for v in vals: r *= v
    return r
```

**Exact by construction** — the intermediate products telescope.

**Order-dependent.** The interaction term goes to whichever factor moves first.
With volume −12% and win rate −5%, substituting volume first credits volume with
the −12% × −5% interaction; substituting win rate first credits win rate. The gap
is second-order and usually small, but it is not zero and somebody will find it.

Rules that make it defensible:

- **Declare the order in the output**, every time.
- **Use the same order every period.** Switching order between periods makes the
  driver series incomparable, which defeats the purpose.
- **Order volume → conversion → price** by default, because it matches how GTM
  teams think about the funnel and reads naturally.
- **Report the interaction magnitude** when it exceeds about 5% of the total
  change, or switch to LMDI.

---

## 2. LMDI — order-independent and exact

Use when the decomposition will be argued about: a board pack, a
compensation-relevant number, or any context where "you chose the order that
blamed my team" could be said out loud.

```python
from math import log

def lmdi(f0: dict, f1: dict):
    r0, r1 = prod(f0.values()), prod(f1.values())
    L = r1 if r1 == r0 else (r1 - r0) / log(r1 / r0)     # logarithmic mean
    return {k: L * log(f1[k] / f0[k]) for k in f0}
```

The logarithmic mean `L(a,b) = (a−b)/ln(a/b)` sits between the arithmetic and
geometric means and is exactly what makes the contributions sum to `r1 − r0` with
no residual and no order dependence.

**Requires every factor and both totals strictly positive.** A zero opportunity
count, a zero win rate, or revenue that changes sign breaks the logarithm. Handle
it, do not let it raise:

```python
if any(v <= 0 for v in {**f0, **f1}.values()) or r0 <= 0 or r1 <= 0:
    return None     # decomposition unavailable — report the change, name the reason
```

**LMDI contributions are harder to explain than substitution contributions.**
"Volume accounts for 11.9 points" is the same sentence either way, but if someone
asks how it was computed, substitution is a table and LMDI is a logarithm. Default
to substitution; reach for LMDI when order-dependence is contentious.

---

## 3. Additive contribution

For a metric that is a sum over parts, the decomposition is the per-part change,
and the only real work is ranking and rolling up.

```python
def additive(parts0: dict, parts1: dict, top_n: int = 3):
    keys = set(parts0) | set(parts1)
    deltas = {k: parts1.get(k, 0) - parts0.get(k, 0) for k in keys}
    total = sum(deltas.values())
    ranked = sorted(deltas.items(), key=lambda kv: abs(kv[1]), reverse=True)
    top = dict(ranked[:top_n])
    return {**top, 'all other parts': total - sum(top.values())}    # always closes
```

Three rules:

1. **Rank by absolute contribution, not percentage change.** A part that fell 80%
   from a base of 12 is not the story; one that fell 9% from a base of 40,000 is.
2. **`set(parts0) | set(parts1)`** — a part present in one period and absent in
   the other is often the most informative result, and an intersection deletes it.
3. **Always emit the "all other parts" remainder** so the decomposition visibly
   closes. A top-3 list that does not state what the rest did invites the reader
   to assume the rest was zero.

---

## 4. Within-segment versus mix

For averages and rates over a heterogeneous population.

```python
def within_mix(w0, r0, w1, r1):
    """w: segment share of the denominator (sums to 1). r: segment rate."""
    within = sum(w0[k] * (r1[k] - r0[k]) for k in r0)
    mix    = sum((w1[k] - w0[k]) * r1[k] for k in r0)
    return {'within_segment': within, 'mix_shift': mix}
```

The two terms sum exactly to `blended1 − blended0`. (The symmetric variant —
`w1×Δr` plus `Δw×r0` — is equally exact and splits the interaction the other way;
pick one and keep it.)

**Simpson's paradox is not a curiosity here, it is a recurring GTM result.**
Every segment improves and the blend declines, because the mix moved. Narrating
that as a performance decline sends a team to fix something that is not broken.

**When the mix term dominates, the mix change is the story.** Why did the
lower-converting segment grow? Targeting change, a campaign shift, a pricing
change, a competitor exit? That is the question the narrative should raise —
`kpi-tree-builder` for where it sits in the tree.

**Where segment definitions changed between periods, this is `unavailable`.**
Shares and rates computed under different segment definitions are not comparable,
and the decomposition will produce a confident number describing a taxonomy
change. Check first.

---

## 5. Flow waterfall for a stock metric

ARR, open pipeline, headcount and active subscriptions are stocks. Their change is
the sum of named flows, and the identity must close exactly:

```
ARR₁ = ARR₀ + new + expansion − contraction − churn
```

```python
def waterfall_check(start, flows: dict, end, tolerance=0.005):
    implied = start + sum(flows.values())
    residual = end - implied
    if abs(residual) > tolerance * max(abs(end), 1):
        raise ValueError(
            f"waterfall does not close: residual {residual:,.0f} "
            f"({residual / max(abs(end),1):.2%}). A flow is missing or double-counted. "
            f"Usual causes: currency revaluation, a reclassified account moved between "
            f"segments, or a mid-period plan change counted as both churn and new.")
    return residual
```

**A residual is a finding, not a rounding line.** The three usual causes are named
in that error message because they cover most real cases, and each one has a
different fix. See `revenue-waterfall`, which owns this identity; this skill
narrates its output.

---

## 6. When decomposition is unavailable

Say so and report what you have. Each of these is a real, recurring case:

| Case | Why it breaks | What to report instead |
|---|---|---|
| A factor is zero or negative | logarithms undefined; substitution gives meaningless attribution through zero | the total change, and which factor hit zero — usually the whole story anyway |
| The factor product ≠ the metric | a factor is missing from the model | the change, plus the size of the residual and your best hypothesis for the missing factor |
| A definition changed mid-period | the factors describe different quantities either side | the change, flagged as spanning a definition change, with the pre/post series shown separately |
| Currency basis changed | part of the movement is FX, not business | the change in constant currency **and** the FX effect as a named fourth driver |
| A segment below the volume floor | a rate on single-digit denominators is noise with a percentage sign | the segment's absolute change only, with the rate withheld and the floor named |

**Never drop a factor to make the arithmetic work.** A decomposition with a
silently omitted factor sums perfectly and attributes that factor's movement to
whichever factor is adjacent — which is worse than no decomposition, because it
is confidently wrong in a specific, actionable direction.

---

## 7. Sanity checks before narrating

Run all five. They take seconds and they catch the errors that make an executive
stop trusting the pack.

```python
assert abs(sum(contributions.values()) - (metric1 - metric0)) < 0.005 * abs(metric1 or 1), \
    "contributions do not sum to the change"
assert set(factors0) == set(factors1),              "factor set changed between periods"
assert definition_id0 == definition_id1,            "definition changed; not comparable"
assert currency_basis0 == currency_basis1,          "currency basis changed; decompose FX separately"
assert equal_coverage(window0, window1),            "unequal covered days; compare per covered day"
```

The last two produce the most common wrong narratives in practice: a currency
revaluation narrated as a pricing win, and a comparison window containing a
holiday or a tracking gap narrated as a demand drop. `comparability-rules` and
`temporal-integrity-audit` own both checks; this skill refuses to narrate until
they pass.
