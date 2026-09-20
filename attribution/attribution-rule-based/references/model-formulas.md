# The eight models as executable pseudocode

Every function takes one journey — an ordered list of touches ending in a
conversion — and returns a mapping from touch to credit. **Every function
returns credits summing to exactly 1.0, or raises `not_applicable`.** A model
that returns 0.98 has leaked credit in an edge case.

```python
Touch = namedtuple("Touch", "id channel ts source_system is_first is_lead is_opp is_close")

def allocate(journey: list[Touch], model: str, T: datetime, H: float = 7.0):
    ...
```

Preconditions asserted once, before any model runs:

```python
assert len({t.source_system for t in journey}) == 1      # v1 scope boundary
assert all(a.ts <= b.ts for a, b in zip(journey, journey[1:]))
assert journey[0].ts >= T - timedelta(days=lookback_days)
```

---

## first_touch

```python
def first_touch(j):
    return {j[0].id: 1.0}
```

The first touch **inside the lookback window**. If `j[0].ts` is within one day
of the window's lower edge, set `flags.first_touch_at_boundary = True` — the
journey probably started before your retention does.

---

## last_touch

```python
def last_touch(j):
    return {j[-1].id: 1.0}
```

---

## last_non_direct

```python
def last_non_direct(j):
    for t in reversed(j):
        if t.channel != "Direct":
            return {t.id: 1.0}
    flags.direct_fallback += 1          # counted and reported, never silent
    return {j[-1].id: 1.0}
```

The fallback count is an output field, not a log line. If 30% of journeys take
the fallback path, last-non-direct is last-touch with extra steps and the
readout must say so.

---

## linear

```python
def linear(j):
    return {t.id: 1.0 / len(j) for t in j}
```

Duplicate touches on the same channel each get their own share — that is the
model's defining flaw (§5), not a bug to patch. Do not collapse repeated touches
into one unless you say you did, in which case you are running a different model
and must name it.

---

## time_decay

```python
def time_decay(j, T, H=7.0):
    w = {t.id: 2 ** (-(T - t.ts).total_seconds() / 86400.0 / H) for t in j}
    total = sum(w.values())
    return {k: v / total for k, v in w.items()}
```

Properties worth knowing before you defend it to a stakeholder:

- Scale-free in the sense that only `age/H` matters — doubling `H` is the same
  as halving every age.
- As `H → 0`, it converges to last-touch. As `H → ∞`, it converges to linear.
  **Time-decay is a dial between the two most-criticised models, and `H` is
  where you set the dial.** That framing is the clearest way to explain to a
  non-technical stakeholder why the parameter matters.
- The sweep at `H ∈ {1, 3, 7, 14, 30}` therefore traverses most of the space
  between last-touch and linear. If a channel's share is stable across it, the
  channel is robust to the whole family.

---

## u_shaped

```python
def u_shaped(j):
    n = len(j)
    if n == 1: return {j[0].id: 1.0}
    if n == 2: return {j[0].id: 0.5, j[1].id: 0.5}
    mid = 0.20 / (n - 2)
    return {j[0].id: 0.40, j[-1].id: 0.40, **{t.id: mid for t in j[1:-1]}}
```

The `n == 2` case is where implementations diverge in the wild: some split
40/40 and discard 20%, some give 50/50, some give 40/60. **Ours sums to 1.0 and
is symmetric.** When reconciling against a vendor's U-shaped number, check their
two-touch rule first — it explains more discrepancies than the middle weight.

---

## w_shaped

```python
def w_shaped(j):
    first = j[0]
    lead  = next((t for t in j if t.is_lead), None)
    opp   = next((t for t in j if t.is_opp),  None)
    if lead is None or opp is None:
        raise NotApplicable("milestone_unstamped", missing=[...])

    credit = defaultdict(float)
    for t in (first, lead, opp):
        credit[t.id] += 0.30                        # duplicates ADD, by design

    rest = [t for t in j if t.id not in credit]
    if rest:
        for t in rest:
            credit[t.id] += 0.10 / len(rest)
    else:
        share = 0.10 / len(credit)                  # no middles: redistribute
        for k in credit:
            credit[k] += share
    return dict(credit)
```

Three edge cases, all resolved deliberately:

| Case | Rule | Why |
|---|---|---|
| A touch is both first and lead-creating | credits **add** to 0.60 | de-duplicating to 0.30 leaks 0.30 and breaks the sum |
| No touches outside the milestones | redistribute the 10% across the milestone touches | the alternative is a 0.90 total |
| A milestone has no stamped touch | `not_applicable` for this journey | substituting the nearest touch invents a milestone, and the invented version is indistinguishable from the real one downstream |

**`not_applicable` is per journey, not per analysis.** Report it as a coverage
figure: "W-shaped ran on 61% of journeys; the remaining 39% lack an
opportunity-creation stamp." A W-shaped column computed on 61% of journeys and
placed next to a linear column computed on 100% is not comparable — normalise to
the common subset, and show both.

---

## full_path

```python
def full_path(j):
    first = j[0]
    lead  = next((t for t in j if t.is_lead),  None)
    opp   = next((t for t in j if t.is_opp),   None)
    close = next((t for t in j if t.is_close), None)
    if None in (lead, opp, close):
        raise NotApplicable("milestone_unstamped", missing=[...])

    credit = defaultdict(float)
    for t in (first, lead, opp, close):
        credit[t.id] += 0.225
    rest = [t for t in j if t.id not in credit]
    ...                                              # same 10% rule as W-shaped
```

**Open opportunities have no close milestone and are therefore absent from
full-path entirely.** The model does not under-weight them; it excludes them.
Report `open_pipeline_excluded_share` alongside the column, because a full-path
readout for a recent period is a readout about fast-closing deals only, and
fast-closing deals are not a random sample of deals.

---

## Revenue allocation

```python
def allocate_revenue(journey_credits, deal_amount):
    return {tid: c * deal_amount for tid, c in journey_credits.items()}
```

**Never join touches to deals and sum `deal_amount` per touch.** That is the
fan-out that produces channel revenue exceeding company revenue, and it is the
single most common implementation error in this family. The check is one line:

```sql
-- must hold to floating-point tolerance, per model, per window
select abs(sum(allocated_revenue) - (select sum(amount) from conversions)) < 0.01
from attribution_credits
```

If it fails, the join multiplied, the milestone stamps duplicated, or a journey
appears under two conversions. Fix the join; do not scale the output to match.

---

## Currency

Allocated revenue inherits the currency of the source deal. **Multi-currency
journeys are not summable without a declared FX basis** — see `provenance-block`
for the per-platform currency source, and state the rate and the rate date in
the output rather than converting silently.
