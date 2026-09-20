# The discount-to-outcome relationship

The observed correlation between discount depth and win rate is one of the most
requested numbers in revenue analytics and one of the least interpretable. This
page says what can be computed, what it means, and what settles it.

---

## 1. Three mechanisms, one correlation

| Mechanism | Direction on measured win rate | Who it applies to |
|---|---|---|
| **Discounts persuade wavering buyers** | up | the causal story everyone wants |
| **Discounts are granted late, to deals already near close** | **up, by selection** | most late-stage discounts |
| **Discounts are granted to struggling deals to rescue them** | **down, by selection** | early and mid-cycle discounts |

The measured correlation is a mixture. **Its sign tells you which selection
dominates in your data, not whether discounting works.**

The clearest way to see why: a deal that never reached the negotiation stage
never received a discount. **Discounted deals are, by construction, deals that got
far enough to be negotiated** — and deals that get far enough win more often
regardless of what happens at the end.

---

## 2. Conditioning on stage at discount

The single most useful correction available from existing data.

```sql
select stage_at_discount,
       discount_band,
       count(*)                                   as n,
       avg(case when is_won then 1.0 else 0 end)  as win_rate,
       avg(cycle_days)                            as avg_cycle
from deals
where discount_granted
group by 1, 2
order by 1, 2;
```

`stage_at_discount` comes from the stage history at the timestamp of the discount
approval, quote version or line-item edit — not from the deal's final stage.

**The pattern that recurs:** pooled across stages, discounts above 20% look
strongly associated with winning. Conditioned on stage, the association at
late-stage narrows sharply, and at early-stage it frequently inverts — early
discounts are associated with *losing*, because they were granted to deals in
trouble.

**Report both the pooled and the conditioned figure.** The gap between them is a
direct measure of how much of the apparent effect is selection, and it is more
informative than either number alone.

---

## 3. What else to control for, and what remains

Control for, because they are confounders you can observe:

- **Deal size band** — larger deals attract larger discounts and have different
  win rates
- **Segment** — enterprise and SMB have different discounting norms and different
  win rates
- **Product mix** — different products have different discount latitude and
  different competitive positions
- **Competitive presence** — where recorded; competitive deals are both
  discounted more and lost more

**What remains uncontrolled, and always will:** the rep's private assessment of
whether the deal would close. That judgement drives the discount decision and is
never in the CRM. **No amount of controlling removes it**, which is the reason
this relationship needs an experiment rather than a better regression.

---

## 4. Cycle length alongside win rate

Look at both, because they separate the mechanisms better than either alone.

| Pattern | Reading |
|---|---|
| Discounted deals win more **and** close faster | consistent with late concessions closing deals already ready |
| Discounted deals win more **and** take longer | consistent with rescue attempts that sometimes work |
| Discounted deals win less **and** take longer | struggling deals, discounted late in a failing process |
| No cycle difference | the discount is not being used as a closing tool — check whether it is policy-driven or renewal-driven instead |

---

## 5. Rep normalisation

**Never rank reps on raw discount. That ranks territories.**

```sql
with bucketed as (
  select d.*,
         ntile(4) over (partition by segment, product_family
                        order by deal_size) as size_quartile
  from deals d where is_closed
),
bucket_median as (
  select segment, product_family, size_quartile,
         percentile_cont(0.5) within group (order by effective_discount) as med
  from bucketed group by 1,2,3
)
select b.rep,
       count(*)                                   as n,
       avg(b.effective_discount - m.med)          as avg_deviation
from bucketed b
join bucket_median m using (segment, product_family, size_quartile)
group by 1
having count(*) >= 15
order by 3 desc;
```

Three rules:

- **Small-n floor, stated.** A rep with six closed deals has no discount profile,
  and the `having` clause above is not optional.
- **Report the deviation, not the raw discount**, and report the bucket
  distribution alongside it so a reader can see what was controlled for.
- **A deviation that disappears after normalisation is not a finding.** Say so
  explicitly — it is the most useful output when someone arrived convinced a rep
  was over-discounting.

What survives normalisation is usually one of: conceding earlier in the cycle,
conceding more on the same profile, or having deals the buckets did not capture —
and the third possibility means the buckets are wrong, not the rep.

---

## 6. The approval-threshold signature

```sql
select width_bucket(effective_discount, 0, 0.5, 50) as pct_bucket,
       count(*)
from deals where is_closed and is_won
group by 1 order by 1;
```

Plot it. A pile-up in the bucket immediately below an approval threshold is not a
coincidence — it means the threshold is being managed rather than respected,
either by structuring the headline to stay under it or by moving value into the
concessions that are not counted.

**Consequence for every other number on this page:** the recorded discount
distribution is partly a description of the approval process. If the pile-up is
large, realised erosion (`references/realised-price.md`) is where the missing
value went, and the two analyses should be read together.

---

## 7. What actually settles it

| Design | Fit | Caution |
|---|---|---|
| **Segment-level list price change**, measured against a comparable segment | good | segments must be genuinely comparable; **the volume effect takes a full sales cycle to appear** |
| **Geo or territory holdout on a discounting policy** | good | the usual choice in B2B, because n is small and feedback is slow |
| **Randomised discount authority by rep or team** | strong causally | operationally and commercially awkward; often rejected for good reasons |
| **Per-deal randomisation** | rarely viable | small n, slow feedback, and reps will not comply with randomisation they disagree with — treat compliance as the binding constraint |
| **Before/after a policy change** | weak | no comparison group; confounded by everything else in the quarter |

Route all of these through `experiment-design-readout` **before** they run. The
power calculation is what determines whether the design can detect the effect
worth acting on, and pricing experiments fail that check more often than any
other kind in GTM because n is small and the effects are modest.

And the standing rule for the readout: **a non-significant price test means the
test could not detect an effect of at least X, not that price does not matter.**
