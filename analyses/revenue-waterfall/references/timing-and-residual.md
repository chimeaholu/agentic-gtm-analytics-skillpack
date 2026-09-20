# Timing effects and the residual

Two components that are routinely folded into others, and both invert the
conclusion when they are not.

---

## 1. Slipped is not lost

**In a period-end snapshot, a deal that slipped and a deal that was lost both
show as "did not close this quarter".** They have opposite implications and only
stage history distinguishes them.

| | Evidence | Implication |
|---|---|---|
| **Slipped** | still open at period end; close date moved forward | **timing effect.** The pipeline still holds the value |
| **Lost** | stage is closed-lost | **win-rate effect.** The value is gone |
| **Pulled forward** | closed in this period, originally dated in the next | **timing effect that flatters this period and depletes the next** |
| **Disqualified** | closed with a no-decision or disqualified reason | **neither** — it belongs in the opportunity-count effect, not the win rate. See the four win-rate denominators in `gtm-metric-dictionary` |

**A quarter that missed on slippage has a full pipeline and a process problem. A
quarter that missed on losses has an empty pipeline and a demand problem. Same
number, opposite response** — and a waterfall that does not separate them gives
the same chart for both.

### Computing it

```sql
-- deals expected in the period that did not close in it, split by outcome
with expected as (
  select opportunity_id, amount, close_date_at_period_start
  from opportunity_history
  where close_date_at_period_start between :period_start and :period_end
)
select
  case
    when o.is_closed and o.is_won               then 'won_in_period'
    when o.is_closed and not o.is_won
         and o.loss_reason in ('no_decision','disqualified')
                                                then 'disqualified'
    when o.is_closed and not o.is_won           then 'lost'
    when not o.is_closed and o.close_date > :period_end then 'slipped'
    else 'other'
  end                                            as outcome,
  count(*)                                       as deals,
  sum(e.amount)                                  as value
from expected e join opportunities o using (opportunity_id)
group by 1;
```

The critical field is **`close_date_at_period_start`**, not the current close
date. Reading the current close date makes slipped deals invisible — they now
sit in a future period and were never "expected" in this one, which is precisely
how slippage disappears from a quarterly review.

**Reconstructing it requires stage or field history**, which has retention limits
on most CRMs. See `data-lineage-tracer` and `temporal-integrity-audit`. **If
history is unavailable, say the timing effect cannot be separated and name that
as the gap** — do not attribute the whole miss to win rate by default, which is
the silent assumption in its absence.

### The pull-forward check

The mirror image, and it matters for the *next* period's forecast:

```sql
select count(*), sum(amount)
from opportunities
where closed_in = :period
  and close_date_at_period_start > :period_end;
```

A period that beat plan partly on pull-forward has borrowed from the next one.
**Report it whether or not anyone asked**, because it is the single most useful
input to the following period's expectation and it is never in the headline.

---

## 2. The residual

```
residual = ΔR_total − Σ components
```

### What produces one legitimately

| Cause | Typical size | Pursue? |
|---|---|---|
| Rounding and FX at the cent level | negligible | no |
| An unallocated adjustment, credit or write-off | small to medium | name it, usually no |
| A dimension not broken out in the extract | medium | **yes if it exceeds the second-largest component** |
| An incomplete driver set | can be large | yes — the KPI tree is missing a branch |
| A definition change mid-period | any size | **stop.** This is a comparability failure, not a residual |

### Reporting it

Three sentences, always:

1. **Size.** In the metric's units and as a share of the total variance.
2. **Likely composition.** Named, not "other". "Probably the multi-currency
   renewals, which this extract cannot break out by original currency."
3. **Whether it was pursued, and why not.** "Under 3% of the variance and smaller
   than every named component, so not pursued."

### The rule

**Never absorb the residual into the largest component.** It makes the chart sum
correctly and the story wrong, and the inflated component is the one someone
acts on. If a residual is large enough to be embarrassing, that is information
about the driver set, and the honest version is:

> **Components explain 71% of the variance. The remaining 29%, about 134k, is not
> attributable from this data.** It is most likely concentrated in the services
> line, which is not broken out by segment in this extract. Obtaining that split
> would close most of it; until then, treat the named components as a partial
> explanation rather than a complete one.

That is a better deliverable than four bars that happen to sum.

---

## 3. Ranking and presentation

1. **Rank components by absolute magnitude**, not by the order of the formula.
2. **Lead with the top two**, and put everything else in a table beneath.
3. **Name offsetting components explicitly.** A component that reduced the miss is
   part of the story — omitting it makes a decline look uniform when it is not.
4. **State the convention and the order** in the chart footnote, not only in the
   appendix.
5. **Show the residual as a bar**, not as a note.
6. **Use absolute values for decisions and points-of-base for the narrative**, and
   label which is which.

A waterfall with eleven bars is a data dump. The answer is almost always in the
first two or three, and the discipline of saying so is most of what makes the
chart useful.
