# Decomposition, intervals and the refusal rule

## 1. Mix versus rate

A blended rate moves because segment rates moved, because the segment mix
moved, or both. Narrating a cause before separating them is the most common way
a funnel analysis misleads.

Let `w_s` be segment `s`'s share of the cohort and `r_s` its conversion rate.

```
total rate      R  = Σ_s w_s · r_s
Δtotal             = R₁ − R₀

mix effect         = Σ_s (w_s1 − w_s0) · r_s0
rate effect        = Σ_s w_s0 · (r_s1 − r_s0)
interaction        = Σ_s (w_s1 − w_s0) · (r_s1 − r_s0)

Δtotal = mix effect + rate effect + interaction     (exact, no residual)
```

### Worked example

| Segment | w₀ | r₀ | w₁ | r₁ |
|---|---|---|---|---|
| Inbound | 0.82 | 0.190 | 0.66 | 0.187 |
| Paid list | 0.18 | 0.040 | 0.34 | 0.041 |

```
R₀ = 0.82(0.190) + 0.18(0.040) = 0.1558 + 0.0072 = 0.1630
R₁ = 0.66(0.187) + 0.34(0.041) = 0.1234 + 0.0139 = 0.1374
Δ  = −0.0256  (−2.56 points)

mix effect  = (0.66−0.82)(0.190) + (0.34−0.18)(0.040)
            = (−0.16)(0.190) + (0.16)(0.040) = −0.0304 + 0.0064 = −0.0240
rate effect = 0.82(0.187−0.190) + 0.18(0.041−0.040)
            = 0.82(−0.003) + 0.18(0.001)     = −0.00246 + 0.00018 = −0.00228
interaction = (−0.16)(−0.003) + (0.16)(0.001) = 0.00048 + 0.00016 = 0.00064

check: −0.0240 − 0.00228 + 0.00064 = −0.02564  ✓
```

**Reading:** 94% of the decline is mix. Inbound performance is flat. The finding
is "we bought a list", not "conversion is deteriorating".

### Rules

- **Report all three terms.** A large interaction means the segments moved
  unevenly and the blended rate is a poor summary of what happened.
- **Run it on source first.** Source mix is the usual culprit, because paid-list
  and syndication inquiries convert at a fraction of inbound.
- **Then segment, then owner/territory.** Stop when one dimension explains most
  of the movement; chasing further dimensions past that point finds noise.
- **The decomposition is arithmetic, not causal.** It says where the movement
  sits, not why the mix changed.

## 2. Small-n: intervals and the refusal rule

### The thresholds

| Purpose | Suggested minimum n | Why |
|---|---|---|
| Report a rate as a point estimate | 30 | below this the interval is wider than most differences anyone cares about |
| Narrate a difference between two rates as a change | 100 per side | two 30-record cells routinely differ by 15 points on noise alone |
| Feed a rate into a forecast | 30 per stage per segment | thin rates produce unstable forecasts that swing quarter to quarter |

These are defaults. Whatever you use, **state it**, and list the cells it
refused rather than leaving holes in a table.

### Wilson score interval

Use Wilson, not the normal approximation, for proportions near 0 or 1 — the
normal approximation produces bounds outside [0,1] and understates uncertainty
on small n.

```
centre     = (p̂ + z²/(2n)) ÷ (1 + z²/n)
half-width = (z ÷ (1 + z²/n)) × √( p̂(1−p̂)/n + z²/(4n²) )
interval   = centre ± half-width
z = 1.96 for 95%
```

**Worked:** p̂ = 0.75, n = 4, z = 1.96.

```
z²/n      = 3.8416/4       = 0.9604
centre    = (0.75 + 0.4802) ÷ 1.9604 = 1.2302 ÷ 1.9604 = 0.6275
p̂(1−p̂)/n = 0.1875/4        = 0.046875
z²/(4n²)  = 3.8416/64      = 0.060025
√(0.046875 + 0.060025)     = √0.1069 = 0.3270
half      = (1.96 ÷ 1.9604) × 0.3270 = 0.3269
interval  ≈ 0.30 to 0.95
```

A "75% conversion rate" that is really "somewhere between 30% and 95%" stops
being a talking point the moment the interval is shown. **Give the interval
rather than withholding the number** — withholding invites someone to compute
the bare 75% in a spreadsheet with no caveat at all.

### Comparing two thin rates

Before narrating a difference, check whether the intervals overlap. Overlapping
Wilson intervals are a sufficient reason to say the difference is not
distinguishable from noise at this sample size; non-overlap is stronger evidence
than a raw gap but is still not a causal claim.

## 3. Definition drift on the timeline

| What changed | Where to look | Effect on the series |
|---|---|---|
| MQL scoring threshold or model | marketing automation scoring rules; audit log | step change in MQL count, usually with a step change in MQL→SQL in the opposite direction |
| Stage added, removed or renamed | CRM stage picklist history; `OpportunityStage` metadata | transitions before and after are different objects |
| Lifecycle-stage automation | workflow edits | records reach stages by a different path |
| Routing or assignment rules | assignment rule history | changes who works what, which changes downstream rates |
| Opportunity creation point (first meeting vs proposal) | process documentation, and the observed distribution of stage-1 durations | identical win rates now mean different things |

**Mark the change date on every output that crosses it**, and refuse a
period-over-period comparison that straddles it unless the rate is recomputed
under a single definition on both sides. Where recomputation is impossible
(the old scoring inputs were not retained), say the two periods are not
comparable and give each one separately.

**The gamed-threshold signature:** MQL count rising while MQL→SQL falls, with
no change in source mix. Report count and downstream rate together, always.

## 4. What the decomposition does not claim

- It attributes movement to mix or rate, not to any cause of either.
- Segments differ in more than the dimension compared; an inbound-versus-paid
  gap is not an estimate of what paid would convert at if it behaved like
  inbound.
- It assumes the segment definitions themselves were stable across both
  periods. If a segment was redefined, decompose after re-segmenting both
  periods under the new rule.
