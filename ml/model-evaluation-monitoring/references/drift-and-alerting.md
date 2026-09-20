# Drift measurement and alerting

---

## 1. Population Stability Index

```python
import math


def psi(expected, actual, bins=None, n_bins=10, eps=1e-6):
    """
    expected : training-set values (the baseline)
    actual   : scoring-population values
    bins     : precomputed bin edges from TRAINING deciles; computed if None
    """
    exp = sorted(float(v) for v in expected)
    act = [float(v) for v in actual]
    if bins is None:
        qs = [exp[min(len(exp) - 1, int(len(exp) * i / n_bins))]
              for i in range(1, n_bins)]
        bins = sorted(set(qs))
    edges = [-math.inf] + list(bins) + [math.inf]

    def shares(vals):
        counts = [0] * (len(edges) - 1)
        for v in vals:
            for i in range(len(edges) - 1):
                if edges[i] < v <= edges[i + 1]:
                    counts[i] += 1
                    break
        n = max(1, len(vals))
        return [max(c / n, eps) for c in counts]

    e, a = shares(exp), shares(act)
    return sum((ai - ei) * math.log(ai / ei) for ei, ai in zip(e, a))


if __name__ == "__main__":
    base = list(range(1000))
    assert psi(base, base) < 0.01                       # identical => ~0
    shifted = [v + 500 for v in base]                   # large shift
    assert psi(base, shifted) > 0.25, psi(base, shifted)
    mild = [v + 30 for v in base]
    p_mild = psi(base, mild)
    assert 0 < p_mild < 0.25, p_mild
    print(f"psi ok: identical~0, mild={p_mild:.3f}, shifted>0.25")
```

**Three rules:**

1. **Bin on the training deciles**, computed once and persisted, never
   recomputed on the current population. Recomputing makes drift invisible by
   construction — the bins move with the data.
2. **Categorical features** use level frequencies as the bins, plus an explicit
   `unknown` bucket that catches levels absent from training.
3. **Thresholds are conventions**: `> 0.1` investigate, `> 0.25` act. Report the
   number, not just the verdict.

---

## 2. The three channels, and the diagnostic

| Channel | Computed on | Frequency | Lag |
|---|---|---|---|
| Feature drift | Scoring-population features vs training baseline | Every scoring run | None |
| Prediction drift | Score distribution vs training-time score distribution | Every scoring run | None |
| Outcome drift | Base rate and realised lift | Weekly | **One label horizon** |

```sql
-- prediction drift: score deciles now vs at acceptance
with now as (
  select ntile(10) over (order by score) as d, count(*) as n
  from scores where scored_at >= current_date - 7 group by 1
),
base as (select decile as d, share from accepted_score_distribution)
select now.d,
       now.n::float / sum(now.n) over () as actual_share,
       base.share                        as expected_share
from now join base using (d) order by 1;
```

### The diagnostic table

| Feature | Prediction | Outcome | Cause | First action |
|---|---|---|---|---|
| — | **drift** | — | Scoring pipeline changed | **Check the reference cohort** |
| **drift** | drift | — | Input mix changed | Investigate the source |
| — | — | **drift** | Relationship changed | Retrain |
| **drift** | drift | drift | Business changed | Retrain + reframe |
| — | — | calibration only | Base-rate shift | Recalibrate |
| **drift**, one feature 100% null | drift | — | **Pipeline break** | Page. Do not retrain |

**Always check the reference cohort before anything else.** It costs one query
and eliminates the most common cause.

---

## 3. The reference cohort

Freeze a few hundred historical records with their features **as they were**.
Score them every run.

```sql
create table reference_cohort as
select entity_id, as_of_ts, <feature columns>
from   features
where  as_of_ts between :a and :b
order by random() limit 500;

-- every run
insert into reference_cohort_scores
select :run_date, entity_id, score(features) from reference_cohort;
```

```sql
-- the check
select run_date,
       avg(score)                                             as mean,
       max(abs(score - first_value(score) over w))            as max_abs_drift
from   reference_cohort_scores
window w as (partition by entity_id order by run_date)
group by 1 order by 1 desc limit 10;
```

**Their features cannot change, so their scores must not change.** Any movement
is the model artefact, the feature transformation code, or a library version.
Never the market. This is the single highest-value monitoring artefact in the
list and almost nobody builds it.

---

## 4. Pipeline checks — fire first, loudest

```sql
-- run after every scoring batch, before the scores are used
select 'all_null'      as check, feature_name, null_rate
from   scoring_feature_stats where null_rate = 1.0
union all
select 'constant', feature_name, distinct_count
from   scoring_feature_stats where distinct_count = 1
union all
select 'row_count', 'batch', abs(rows - :expected)::float / :expected
from   scoring_batch where abs(rows - :expected)::float / :expected > 0.3
union all
select 'stale_feature', feature_name, hours_since_update
from   scoring_feature_stats
where  hours_since_update > declared_max_lag_hours;
```

Any row returned is **critical**: it means the scores from this batch are not
what the model was accepted on, and they should not be used.

**A broken pipeline and a market shift look identical on a metric chart.** These
checks distinguish them for the cost of one query, which is why they fire before
any statistical drift measure is consulted.

---

## 5. The alert schema

```yaml
- alert: <name>
  measure: "<exact computation>"
  threshold: <value>
  window: "<rolling window>"
  severity: critical | high | medium
  owner: "<role>"
  action: |
    <numbered, executable steps>
  expected_frequency: "<how often this should fire if healthy>"
  suppression: "<declared windows where it is muted>"
  escalation: "<what happens if unacknowledged>"
```

**`expected_frequency` is the discipline.** Compare the observed firing rate
against it monthly. An alert firing an order of magnitude more often than
expected is mistuned and gets retired or re-thresholded — because an alert people
ignore is worse than no alert, since it provides false assurance that something
is being watched.

**`action` must be executable by the owner without further analysis.** "Investigate
the model" is not an action. "Check the reference cohort; if it moved, diff the
scoring pipeline against last week's; if not, check feature PSI" is.

---

## 6. Monitoring when the label lags

The horizon problem: a 90-day churn model's realised performance for today's
scores arrives in 90 days.

| Available now | Available at the horizon |
|---|---|
| Feature drift | Realised lift |
| Prediction drift | Calibration against actuals |
| Reference-cohort stability | Base-rate drift |
| Pipeline health | Segment-level realised performance |

**Structure the reporting accordingly:** the drift channels are leading
indicators and are reported weekly; realised performance is a lagging
confirmation and is reported at the horizon on a rolling basis.

**Never wait for realised performance before investigating a drift signal**, and
never treat drift alone as proof of degradation — a changed input mix with a
stable relationship is not a broken model.

A cheap partial fix where a **short-horizon proxy** exists: if 90-day churn
correlates strongly with a 14-day engagement collapse, monitor the proxy weekly
and confirm at the horizon. State that it is a proxy and report its historical
correlation with the real outcome.
