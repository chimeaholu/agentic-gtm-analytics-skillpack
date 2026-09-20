# Action coverage and the self-fulfilling prophecy

The analysis that settles the marketing-versus-sales scoring argument, and the
caveat that must accompany every lift figure.

---

## 1. The coverage query

```sql
select s.score_tier,
       count(*)                                                   as leads,
       count(a.person_id)                                         as touched,
       avg((a.person_id is not null)::int)                        as touched_rate,
       percentile_cont(0.5) within group (
         order by date_diff('hour', s.scored_at, a.first_touch_at))
         filter (where a.first_touch_at is not null)              as median_hours_to_touch,
       avg(a.touch_count)                                         as mean_touches,
       avg((a.touch_count >= 3)::int)                             as worked_properly_rate,
       count(distinct a.owner_id)                                 as distinct_owners
from   scored_cohort s
left join activity_rollup a
       on a.person_id = s.person_id
      and a.first_touch_at >= s.scored_at            -- activity AFTER scoring
group by 1 order by 1;
```

**`a.first_touch_at >= s.scored_at` is essential.** Activity before the score was
produced cannot have been caused by it, and counting it makes every tier look
equally worked.

---

## 2. The four diagnoses

| Tier A touched rate | Tier A conversion vs C | Diagnosis | Fix |
|---|---|---|---|
| High (>80%) | Materially higher | **Score works and is used** | Nothing. Tune the threshold to capacity |
| **Low (<50%)** | Similar to C | **Adoption failure** | Routing and SLA. **The score is untested, not disproven** |
| High | Similar to C | **Model failure** | The list was worked and did not convert. Rebuild the score |
| Low | **Higher anyway** | **Works but under-used** | **The largest available win.** Route it and measure again |

**The fourth row is common and it is the cheapest revenue in the analysis** —
the score is carrying real signal despite being ignored, and the fix is process
rather than modelling.

**The second row is the one that ends the argument.** When sales says "the leads
are bad" and only 41% of tier A leads were ever touched, the score has not been
tested. That is not a rebuttal of sales — untouched leads convert badly for
obvious reasons — it is a statement that the disagreement is about process, and
the process is measurable.

---

## 3. Does effort vary more by rep than by tier?

```sql
select 'by_tier' as dimension,
       stddev(touched_rate) as variation
from  (select score_tier, avg((touched)::int) as touched_rate
       from scored_cohort group by 1) t
union all
select 'by_owner',
       stddev(touched_rate)
from  (select owner_id, avg((touched)::int) as touched_rate
       from scored_cohort where owner_id is not null
       group by 1 having count(*) >= 50) o;
```

**If variation by owner exceeds variation by tier, rep behaviour dominates the
score**, and no model improvement will change outcomes. The finding is about
enablement and routing, and it should be reported as such — it is more useful
than another scoring iteration.

Check region and channel the same way. A score that is followed diligently in one
region and ignored in another produces a segment-level performance difference
that looks like a model problem and is not.

**The capture caveat:** activity logging is itself incomplete and uneven. A rep
whose email sync is off looks like a rep who does not work leads. **Report
activity-capture coverage alongside the coverage analysis**, or a data-quality
problem gets diagnosed as a behaviour problem.

---

## 4. Bounding the self-fulfilling prophecy

**High-scoring leads get worked harder, so they convert better partly because of
the score.** Every lift figure carries some of this. State it, then bound it.

### 4.1 Condition on action (cheapest, usually available)

```sql
select score_tier, count(*) as n, avg(converted::int) as conv_rate
from   scored_cohort
where  touch_count between 3 and 5           -- comparable effort
group by 1 order by 1;
```

If tiers still separate within an equally-worked population, the score carries
signal beyond the effort. **The confound:** *why* those records got 3–5 touches
is not random — a rep may persist with a lead that responded well. It is
evidence, not proof, and should be described that way.

### 4.2 Natural experiments (look for these; they usually exist)

- **Capacity gaps.** A week when volume exceeded capacity and high scorers went
  unworked.
- **Vacation or attrition windows.** A territory unstaffed for a period.
- **Territory transitions.** Records in limbo during a reassignment.
- **A routing outage.** Leads that never reached a queue.

```sql
select score_tier,
       avg(converted::int) filter (where touched)      as conv_if_touched,
       avg(converted::int) filter (where not touched)  as conv_if_untouched,
       count(*) filter (where not touched)             as n_untouched
from   scored_cohort
where  scored_at between :gap_start and :gap_end
group by 1;
```

**If untouched tier A still converts materially better than untouched tier C,
the score is measuring lead quality rather than effort.** That is the strongest
evidence available without running an experiment, and the data for it usually
already exists.

### 4.3 Threshold discontinuity

Where a hard routing rule exists ("score ≥ 80 goes to an AE"), records just above
and below the cut are as good as randomised. Compare them.

**The estimate is local** — it identifies the effect of the routing at the
threshold, not across the whole range — and that limit must be stated.

### 4.4 Randomised holdout (the clean answer)

Deliberately withhold prioritisation from a random share of high-scoring leads.
Route to `experiment-design-readout`.

**The cost is real** — you are knowingly under-working good leads — so size it
tightly. Even 5% for one quarter is usually enough to bound the effect, and it
makes every subsequent scoring conversation in the organisation evidence-based.

---

## 5. Reporting the caveat

**Always present. One sentence.** Three variants by evidence level:

> *No bound available:* "High-scoring leads are also worked harder here, so some
> of this lift is the follow-up rather than the lead. A randomised holdout of 5%
> for one quarter would separate them."

> *Conditioned on action:* "Within leads receiving 3–5 touches, tier A still
> converts at 10.1% against tier C's 6.4%, so the score is carrying signal beyond
> the effort — though which leads received that effort was not random."

> *Natural experiment:* "During the March capacity gap, untouched tier A leads
> converted at 7.2% against untouched tier C's 2.9% (n=310), which is close to
> clean evidence that the score measures lead quality rather than effort."

**Never omit it, and never let it become a reason to withhold the lift figure.**
The number is real and useful; the caveat tells the reader how much of it to
attribute to the score.
