# Leakage catalogue — GTM patterns, detection and the replay harness

Leakage is not one bug. It is a family, and each member has a different tell.
This is the working catalogue plus the one test that catches all of them.

---

## 1. The catalogue

| # | Pattern | Typical fields | Tell | Fix |
|---|---|---|---|---|
| L1 | Post-outcome state | stage name, stage age, probability, close reason, loss reason | single-feature AUC > 0.9 | use the state as of the prediction point, from a snapshot or history table |
| L2 | Recency computed against `now()` | "days since last activity", "days since created" | correlates perfectly with closed-ness | compute against the prediction timestamp, not `current_date` |
| L3 | Outcome-process writes | owner at handoff, lifecycle stage, lead status, re-written source | value changes on the same timestamp as the outcome | exclude, or take the pre-transition value |
| L4 | Backfilled enrichment | firmographics, technographics, normalised industry | coverage flat across all creation cohorts | use only enrichment whose observation date precedes the prediction point |
| L5 | Retroactive recalculation | attribution touchpoint weights, revenue attributed under a changed window | the same query returns different numbers on different days with no source edit | snapshot the attributed values at read time and train on the snapshot |
| L6 | Target-derived aggregates | target encoding, "campaign conversion rate", full-dataset scaling | test score far above cross-validated score | compute out-of-fold and as-of |
| L7 | Identity features | record id, email domain in a one-domain-one-outcome set, single-week campaign | model importance concentrated on a high-cardinality key | drop, or group to a level with many records per value |
| L8 | Duplicate records across the split | the same account as multiple opportunities; deduplicated-in-source-but-not-in-extract rows | near-identical rows in train and test | group split on the entity key |
| L9 | Label horizon not elapsed | recent records labelled 0 | negative rate rises sharply in the most recent weeks | embargo one full horizon |
| L10 | Currency and amount edits | deal amount edited at close; home-currency conversion snapshotted at close | amount distribution differs between open and closed records | use the amount as of the prediction point |

---

## 2. Detection queries

### Coverage-by-cohort test for backfill (L4)

```sql
select date_trunc('quarter', created_at)                       as cohort,
       count(*)                                                as records,
       avg((enriched_employee_count is not null)::int)         as coverage
from   accounts
group by 1
order by 1;
```

Genuine enrichment-on-creation: coverage rises over time as the vendor improved,
and older cohorts are patchy. Backfill: coverage is flat and high everywhere,
including cohorts that predate the vendor contract.

### Write-timestamp clustering (L3, L4)

```sql
select date_trunc('day', field_modified_at) as write_day,
       count(*)                             as fields_written
from   field_history
where  field_name = 'industry'
group by 1
order by 2 desc
limit 10;
```

One day holding most of the writes across all record ages is a bulk backfill.

### Outcome-coincident update test (L3)

```sql
select avg((abs(extract(epoch from field_modified_at - outcome_at)) < 3600)::int)
         as share_written_within_an_hour_of_the_outcome
from   records
where  outcome_at is not null;
```

Above roughly 0.3 on a feature field, treat it as written by the outcome process.

### Single-feature AUC screen (L1, L7)

```python
# ponytail: rank-based AUC, no sklearn needed for the screen itself
from statistics import mean

def auc(scores, labels):
    pairs = sorted(zip(scores, labels))
    ranks, i = {}, 0
    # average ranks for ties
    while i < len(pairs):
        j = i
        while j + 1 < len(pairs) and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        r = mean(range(i + 1, j + 2))
        for k in range(i, j + 1):
            ranks[k] = r
        i = j + 1
    pos = [ranks[k] for k, (_, y) in enumerate(pairs) if y == 1]
    n_pos, n_neg = len(pos), len(pairs) - len(pos)
    if n_pos == 0 or n_neg == 0:
        return None
    return (sum(pos) - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


if __name__ == "__main__":
    # a perfectly leaking feature scores 1.0; noise scores near 0.5
    leaky = [0, 1, 2, 3, 4, 5]
    labels = [0, 0, 0, 1, 1, 1]
    assert auc(leaky, labels) == 1.0
    assert auc([1, 1, 1, 1, 1, 1], labels) == 0.5      # all ties
    print("auc screen ok")
```

Flag anything at or above 0.80 for manual review before it enters the model.

---

## 3. The point-in-time replay harness

This is the definitive test. Everything above is a shortcut to it.

**Claim under test:** the feature vector the model would have seen on date *d*
equals the feature vector the pipeline produces today when asked for date *d*.

```
1. Pick 200 records at random, each with a prediction date d in the past.
2. Compute the feature vector for each as of d, using today's pipeline.
3. Compare against the stored feature snapshot written on d.
4. Report, per feature: % of records where the two differ, and the direction.
```

```sql
select f.feature_name,
       avg((s.value is distinct from r.value)::int) as mismatch_rate,
       avg(case when s.value is null and r.value is not null then 1 else 0 end)
         as filled_in_after_the_fact
from   feature_snapshot s
join   feature_replay   r using (record_id, as_of_date, feature_name)
join   feature_dict     f using (feature_name)
group by 1
having avg((s.value is distinct from r.value)::int) > 0.01
order by 2 desc;
```

**Any feature with a non-trivial mismatch rate is not point-in-time correct.**
`filled_in_after_the_fact` above zero is the backfill signature specifically.

If no stored snapshot exists — the common case on a first build — this test
cannot be run, and that is the honest answer: *point-in-time correctness is
unverified, the proxies above passed, and the snapshot logging starts now.* Do
not claim the stronger result.

---

## 4. The plausibility prior

| Problem | Honest test AUC band on point-in-time features |
|---|---|
| B2B lead → SQL | 0.65 – 0.78 |
| B2B opportunity → won | 0.68 – 0.80 |
| B2C trial → paid | 0.70 – 0.85 |
| Subscription churn, 90-day horizon | 0.70 – 0.82 |
| Involuntary (payment-failure) churn | 0.85 – 0.95 — legitimately high, and a different model |

These are priors from general practice, not measurements from the platform
research. Use them to decide where to look, not as acceptance thresholds. A
result above the band is a prompt to run §3, not a reason to celebrate — except
for involuntary churn, where a high score is expected because card-expiry data
genuinely is that predictive.
