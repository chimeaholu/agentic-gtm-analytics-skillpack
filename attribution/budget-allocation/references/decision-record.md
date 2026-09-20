# The decision record

A budget recommendation is reviewed twice: once when it is made, and once six
weeks later when someone asks whether it worked. The second review is impossible
unless the first one wrote down what it assumed. This template exists for the
second review.

---

## 1. Template

```markdown
## Recommendation
Move <amount or share> from <channel> to <channel>. Hold <channels> flat.
Total spend <constant | increased by X>.

## Evidence per channel
| Channel | Verdict | Evidence | Marginal or average | Range / interval |
|---|---|---|---|---|
| … | act / hold / test | geo test, model agreement, MMM curve | marginal | 3% – 15% |

## Economics
Contribution margin: <X%>, source: <finance system / person / date>
Break-even ROAS / MER: <1/margin>
Basis: first-order | lifetime, payback constraint: <n months>

## Bounds
Move capped at <X%> because <precision | observed range | operational ceiling>.
Spend levels after the move are <within | outside> the measured range.

## Reversing assumptions
1. <assumption> — if wrong, <direction>, and <which channels flip>.
2. …

## Test queue
| Channel | Design | Duration | MDE | Opportunity cost |

## Not claimed
- …

## Review date and success criteria
Review on <date>. The recommendation succeeded if <observable>, measured as
<metric, window, grain>. It failed if <observable>.
```

**The last block is the one that gets omitted and the one that matters.** A
recommendation without a written success criterion cannot be wrong, which means
it cannot be learned from either.

---

## 2. Writing reversing assumptions properly

A reversing assumption is not a disclaimer. It names a fact, the direction the
recommendation moves if the fact is different, and which specific decisions flip.

| Weak | Strong |
|---|---|
| "Margin assumptions may vary." | "Contribution margin is taken as 30%. At 20%, break-even ROAS rises from 3.33 to 5.00 and paid social and display both fall below it, which reverses the increase recommended for paid social." |
| "Attribution has limitations." | "Channel credit is not deduplicated across platforms. If overlap is material, paid social is smaller than the table shows, and the case for increasing it weakens in proportion." |
| "Results may not generalise." | "The lift was measured at current spend over four weeks in eight markets. The recommended increase moves spend 15% above that level, which the test did not visit; if the saturation curve bends sooner than modelled, the increase returns less than projected." |

Three to four of these, each one sentence longer than feels necessary. They are
the reason a reviewer can disagree with the recommendation on a specific point
rather than on instinct.

---

## 3. The six-week review

Re-open the record and answer four questions in order. Do not skip to the fourth.

### (a) Did the assumptions hold?
Check each reversing assumption against what is now known. **An assumption that
turned out wrong explains the outcome better than anything in the outcome data**,
and it is the fastest route to a correct diagnosis.

### (b) Did the intended change actually happen?
Spend plans and spend are different objects. Pull actual spend by channel for
the period and compare to the plan. A recommendation that was never executed did
not fail — it was not tested. This check catches more "failed" reallocations than
anything else.

### (c) What moved, and is it attributable to the move?
Uncontrolled before-and-after, no holdout, seasonality unadjusted. **It shows
what happened, not what the reallocation caused.** Say so in the review, in the
same sentence as the number. The exception is if the reallocation was itself run
as a geo test, in which case you have the counterfactual and should use it.

### (d) What does the next decision look like?
The review's output is the next recommendation, with the observed spend range now
extended by whatever the move visited. **That range extension is a permanent
asset** — every future marginal-return question in that region is now estimation
rather than extrapolation.

---

## 4. Worked review

> **Recommendation, six weeks ago:** move 15% of display budget into paid search,
> hold the rest, total spend constant. Justified by a measured 9% lift on paid
> search with a 3–15% interval, against a break-even ROAS of 3.33 at 30%
> contribution margin. Capped at 15% because the test ran at current spend.
>
> **(a) Assumptions.** Contribution margin held at 30%; finance confirmed. The
> cross-platform dedup assumption is still unverified — no shared key was built,
> so paid search's credit may still be overlapping with paid social's.
>
> **(b) Execution.** The move happened, three weeks late. Actual reallocation was
> 11%, not 15%, because display had committed inventory. **The period being
> reviewed is therefore three weeks of an 11% move, not six weeks of a 15% one.**
>
> **(c) Outcome.** Blended MER rose from 3.9 to 4.2 and total conversions rose
> 6%. No holdout ran and Q4 seasonality is in the window, so this is what
> happened, not what the move caused. The direction is consistent with the test's
> lower bound, which is the most that can honestly be said.
>
> **(d) Next.** Paid search spend is now 11% above its previously measured range,
> and CPA held. That extends the observed range and supports one more staged
> increase of the same size, with the same gates. Display remains in the test
> queue — the holdout that would resolve it has still not run, and it is now the
> largest unresolved line in the budget.

Note what the review does not do: it does not claim the reallocation worked. It
reports what is known, corrects the record on what was actually executed, and
converts the outcome into the next decision.
