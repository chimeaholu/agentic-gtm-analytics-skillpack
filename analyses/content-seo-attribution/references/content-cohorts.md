# Content cohorts and matched-age comparison

A snapshot of current content performance is dominated by pieces published years
ago. It tells you what is working now; it tells you nothing about whether the
programme is getting better or worse. Cohorts tell you that.

---

## 1. Construction

```
cohort            = publication month (or quarter, for lower volume)
age_months        = months elapsed since publication, per piece
contribution(p,a) = outcome attributed to piece p within a months of publication
```

Then compare **at matched age**: every cohort's month-3 figure against every other
cohort's month-3 figure.

```sql
select publication_cohort,
       age_months,
       count(distinct piece_id)                      as pieces,
       percentile_cont(0.5) within group (order by sessions)  as median_sessions,
       sum(attributed_pipeline)                      as pipeline
from content_performance
where age_months <= 24
group by 1, 2;
```

**Report the median per piece as well as the cohort total.** A cohort total rises
simply by publishing more; the median says whether the pieces got better.

---

## 2. The date basis decision

**Content is edited.** A piece published two years ago and substantially
rewritten last month is a new piece wearing an old date, and it will distort
whichever cohort it is assigned to.

| Basis | Use when | Caution |
|---|---|---|
| **First published** | measuring the programme's output over time | substantial rewrites are misattributed to old cohorts, flattering them |
| **Last substantive update** | measuring current content quality | churns pieces between cohorts; a refresh programme will look like new output |
| **Both, reported separately** | the honest default when refresh activity is material | costs a column |

**"Substantive" needs a definition.** A typo fix is not a republication. Pick a
threshold — a share of body text changed, or an explicit editorial flag — and
state it. Without one, the CMS `modified` timestamp changes on every touch and
the basis becomes meaningless.

---

## 3. Annotations that change the reading

Mark these on every cohort chart. A cohort that launched into one of them is not
comparable to its neighbours, and the chart will not say so.

| Event | Effect |
|---|---|
| **Search algorithm updates** | a cohort launching into one can underperform for reasons unrelated to its quality |
| **Site migrations and URL changes** | redirects lose some signal; pre-migration cohorts may be undercounted after |
| **Tracking or tagging changes** | a measurement break read as a content decline |
| **Analytics property or filter changes** | same |
| **Editorial strategy shifts** | a change in what the programme publishes; the point of the analysis, so date it precisely |

**A cohort chart without annotations invites attribution of every dip to content
quality.** The annotations are what make it a diagnostic rather than a verdict.

---

## 4. Reading the programme-level picture

### The decline that a snapshot cannot show

| Cohort | Pieces | Median sessions at month 3 | Pipeline at month 6 |
|---|---|---|---|
| 8 quarters ago | 22 | 840 | high |
| 6 quarters ago | 26 | 710 | medium |
| 4 quarters ago | 31 | 520 | medium |
| 2 quarters ago | 34 | 380 | low |

Total content traffic can be rising across this whole period, because the old
cohorts keep compounding. **Per-piece performance at matched age has halved.**
That is the programme finding, and only the cohort view shows it.

Before concluding the programme declined, rule out three alternatives:

1. **Topic mix shifted** toward lower-volume, higher-intent topics — which is
   often deliberate and correct. Check pipeline at month 6, not sessions at
   month 3.
2. **Competitive difficulty increased** in the topic space. Check position
   attained at matched age rather than traffic.
3. **Measurement changed.** Check the annotation list first, always.

### The compounding curve

Plot cumulative contribution by age for each cohort. Two shapes recur:

- **Front-loaded** — most of the contribution in the first 90 days, then flat.
  Typical of news-reactive and launch content. **Its value is knowable quickly**,
  which makes it the better candidate for testing editorial changes.
- **Compounding** — slow start, still growing at month 18. Typical of
  evergreen and category content. **Its value cannot be assessed at 90 days**,
  and judging it at 90 days is how evergreen programmes get cancelled.

**Report which shape a cohort has before judging it.** Applying a 90-day bar to
compounding content is a category error, and it is the most common way a content
budget gets cut on evidence that could not have shown anything yet.

---

## 5. Attributing pipeline to a piece

Same discipline as `attribution-rule-based`, applied at piece grain:

- **Run several models and report the spread**, which for content is wide.
- **Report the join coverage** at each step: session → person → CRM record →
  opportunity. The final figure is a **floor**.
- **Do not multiply a deal amount across the pieces in a journey.** Credit is
  split by model weight; a 40,000 deal touching four pieces contributes 40,000 of
  allocated pipeline in total, not 160,000.
- **A piece with one attributed deal has a number, not a rate.** Piece-level
  attribution is below the volume floor almost everywhere — aggregate to topic
  cluster, content type or funnel stage before ranking anything.

That last point is worth stating to stakeholders early: **piece-level pipeline
attribution is usually noise.** Cluster-level attribution is usually signal. The
request will always be for the piece-level table.
