# Readout checklist

Run these in order. The health checks come before the outcome, because a failed
health check means the outcome must not be read at all.

---

## 1. Health, before anything else

### Sample-ratio mismatch

```
chi-square goodness of fit: observed arm counts vs intended split
```

**A significant SRM invalidates the test.** Assignment was not random. Do not
analyse the outcome; find the cause.

| Cause | Signature |
|---|---|
| Redirect or load failure on one variant | the slower arm is under-represented |
| Bot filtering applied unevenly | large, sudden imbalance |
| Assignment logged after a step that differs by arm | imbalance grows with funnel depth |
| Bucketing logic that is not uniform | consistent imbalance from day one |
| Caching that pins users to one arm | imbalance concentrated in a traffic source |

SRM is the highest-value automated check in experimentation and it costs one
query. Run it on every test, including the ones that "look fine".

### Tracking parity

Instrumentation must fire identically in both arms. **If the variant changed a
page such that an event no longer fires, the outcome difference is a measurement
difference.** Check raw event volumes per arm for the events feeding the metric.

### Exclusions applied identically

Internal traffic, test accounts, bots, employees. **Applied to both arms by the
same rule**, and the rule stated.

---

## 2. The comparison contract

Before comparing arms, confirm: same population definition, same window, same
metric definition, same timezone. See `comparability-rules`.

The ones that actually occur:

- One arm launched a day late and its window is a day shorter.
- The metric was redefined mid-test.
- A region or a plan was excluded from one arm only.
- The assignment system and the analytics system are on different timezones, so
  edge-of-window events land in different days per arm.

---

## 3. The primary outcome

Report, in this order:

```
effect (absolute and relative)
confidence interval
p-value
MDE from the design
interpretation: detected | not_detected_above_MDE
comparison against the decision threshold
```

### Null template

> **No detectable effect. The interval runs from A to B, and this test was
> powered to detect X or larger.**
>
> That is not evidence the variant does nothing — it is evidence that any effect
> is smaller than X, and most likely smaller than B. [If B is below the decision
> threshold:] **Since the effect worth shipping for was T, this is a decisive
> result.** [If the interval spans the threshold:] The interval still contains
> effects worth having, so this is genuinely unresolved; a test with N per arm
> would settle it.

### Positive template

> **The variant increased [metric] by E, interval A to B, p = P.**
>
> The lower bound of A is [above / below] the threshold of T that justified
> shipping. [If SRM, novelty or family size apply, name them here, in one
> sentence each.] The estimate is from a [D]-day test covering [C] full business
> cycles; new and returning users showed [similar / different] effects, [and the
> blended figure is a mix weighted by this test's traffic composition].

---

## 4. Multiple comparisons and segments

```
family_size = primary + secondary metrics + segment cuts + time slices
```

At α = 0.05, the probability of at least one false positive across `k`
independent tests is `1 − 0.95^k`:

| k | P(at least one false positive) |
|---|---|
| 1 | 5% |
| 5 | 23% |
| 10 | 40% |
| 20 | 64% |

**Report the family size.** If a correction was applied, say which. If not, label
every non-primary result exploratory — explicitly, in the same sentence, not in a
footnote.

The sentence to have ready, because this request always comes:

> The 14% lift in the mobile-tablet segment is not a finding. It is one of eleven
> segment cuts examined, and at α = 0.05 at least one crossing the threshold by
> chance was more likely than not. It is worth a dedicated test if the hypothesis
> is interesting; it is not worth shipping on.

---

## 5. Novelty, primacy and composition

- **Report new-user and returning-user results separately** for anything shipped
  to an existing base. They frequently diverge, and the blended number is a mix
  weighted by this test's traffic composition, which will not match next
  quarter's.
- **Plot the effect over time.** An effect that decays over the first week is
  novelty; one that grows is primacy wearing off. Both change what the long-run
  effect will be, and neither is visible in the pooled number.
- **State the run length and whether it covered whole business cycles.**

---

## 6. Three worked readouts

### (a) Decisive null

> **No detectable effect on checkout completion. Interval −1.2% to +2.8%,
> powered to detect 4%.**
>
> Any effect is below 4% and most likely below 2.8%. The bar for shipping was 5%,
> so **this is a decisive result: don't ship it.** The narrow interval is what
> makes it decisive — a wider one would have left the question open. Sample-ratio
> check passed, tracking parity confirmed, 14 days covering two full weeks.

### (b) Positive with a caveat that matters

> **Trial starts rose 11%, interval 4% to 18%, p = 0.008.**
>
> The lower bound clears the 3% threshold that justified building it, so ship.
> Two things to carry: the effect was 18% in the first three days and 8%
> thereafter, which is a novelty signature, so **plan on the 8%**. And returning
> users showed no effect at all — the entire gain is in new users, which matters
> if new-user share changes.

### (c) Invalidated

> **This test cannot be read. The arms split 54/46 against an intended 50/50,
> which is far outside chance at this sample size.**
>
> Assignment was not random, so any outcome difference is confounded with
> whatever caused the imbalance. The imbalance grows with funnel depth, which
> points at assignment being logged after a step that differs between arms.
>
> The outcome difference was +7%, and **I am not reporting it as a result** —
> under a broken assignment it is not an estimate of anything. Fix the
> instrumentation and re-run; the design itself was sound and the power
> calculation still holds.
