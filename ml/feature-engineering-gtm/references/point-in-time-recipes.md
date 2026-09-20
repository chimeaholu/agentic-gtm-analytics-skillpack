# Point-in-time recipes

The SQL patterns that make an as-of feature table correct. All examples are
ANSI-ish; warehouse-specific syntax differs but the shape does not.

---

## 1. The as-of join against an SCD2 dimension

```sql
-- dim_account_scd2(account_id, valid_from, valid_to, segment, owner_id, plan)
-- valid_to is exclusive; the open row has valid_to = timestamp '9999-12-31'

select p.entity_id,
       p.as_of_ts,
       d.segment,
       d.owner_id,
       d.plan
from   prediction_points p
left join dim_account_scd2 d
       on d.account_id = p.entity_id
      and p.as_of_ts >= d.valid_from
      and p.as_of_ts <  d.valid_to;
```

Two things that go wrong here:

- **Overlapping or gapped validity ranges** silently fan out or drop rows.
  Assert before use:

```sql
select account_id, count(*) as overlaps
from  (select account_id, valid_from,
              lag(valid_to) over (partition by account_id order by valid_from) as prev_to
       from dim_account_scd2) x
where prev_to is not null and valid_from <> prev_to
group by 1;
-- any row returned = a gap or an overlap
```

- **`left join` with no match is a real state**, not a bug to be joined away. It
  means the entity did not exist yet, or the dimension's history does not go back
  that far. Distinguish the two — the second is a coverage limit that belongs in
  the dictionary.

---

## 2. The as-of join against dated snapshots

Simpler and usually sufficient. One row per entity per snapshot date.

```sql
select p.entity_id, p.as_of_ts, s.plan, s.segment
from   prediction_points p
left join snap_account s
       on s.account_id     = p.entity_id
      and s.snapshot_date  = date(p.as_of_ts);
```

If snapshots are weekly, take the latest snapshot **at or before** the as-of
date, never the nearest:

```sql
left join lateral (
  select * from snap_account s
  where s.account_id = p.entity_id
    and s.snapshot_date <= date(p.as_of_ts)
  order by s.snapshot_date desc
  limit 1
) s on true;
```

**"Nearest" is the leak.** A snapshot three days after the prediction point
contains post-prediction information.

---

## 3. Windowed event aggregates, as-of

```sql
select p.entity_id,
       p.as_of_ts,
       count(*)                                        as events_28d,
       count(distinct date(e.event_ts))                as active_days_28d,
       max(e.event_ts)                                 as last_event_ts,
       date_diff('day', max(e.event_ts), p.as_of_ts)   as days_since_last_event,
       count(*) filter (where e.event_ts >= p.as_of_ts - interval '7 days')
                                                       as events_7d
from   prediction_points p
left join events e
       on e.entity_id  = p.entity_id
      and e.event_ts  <  p.as_of_ts                      -- strictly before
      and e.event_ts >= p.as_of_ts - interval '28 days'
group by 1, 2;
```

Three rules visible in that query:

- `<` not `<=` on the upper bound. An event at exactly the prediction instant is
  ambiguous; exclude it and be consistent.
- `days_since_last_event` is computed against `p.as_of_ts`. Against `now()` it is
  leakage L2.
- `count(*)` over a `left join` returns 1 for entities with no events because the
  null row counts. Use `count(e.event_id)` or `count(*) filter (where e.event_id
  is not null)`. This single bug has shipped more broken recency features than
  any other.

**On event arrival time.** Where the event table records both an event time and
an ingestion time, the correct filter for strict point-in-time is
`ingested_at < as_of_ts` as well — late-arriving events were not knowable at the
prediction point even though their event time precedes it. Use both bounds when
the source has meaningful ingestion lag; use event time alone when it does not,
and record which you used.

---

## 4. Out-of-fold, as-of target encoding

```sql
-- encode campaign by its conversion rate using ONLY prior, resolved outcomes
select p.entity_id,
       p.as_of_ts,
       p.campaign_id,
       coalesce(h.conv_rate, g.global_rate) as campaign_conv_rate_prior,
       coalesce(h.n, 0)                     as campaign_prior_n
from   prediction_points p
left join lateral (
  select avg(label::int) as conv_rate, count(*) as n
  from   resolved_outcomes r
  where  r.campaign_id = p.campaign_id
    and  r.label_ts   <  p.as_of_ts          -- resolved before the prediction
) h on true
cross join (select avg(label::int) as global_rate from resolved_outcomes) g;
```

Two guards:

- **Smooth towards the global rate** when `campaign_prior_n` is small:
  `(n*rate + k*global) / (n + k)` with k around 20. Without it, a campaign with
  two records and one conversion encodes as 0.5 and the model believes it.
- Ship `campaign_prior_n` as its own feature. The model should know how much
  evidence is behind the encoding.

The `cross join` on the global rate above is itself computed over all outcomes;
for strictness compute the global rate as-of too. The difference is usually small
and the simplification is fine for a first build — say that you made it.

---

## 5. The replay harness (train/serve parity)

```python
# ponytail: 200-record spot check, not a framework
import random, json

def replay_check(records, snapshot_store, pipeline, n=200, tol=1e-9):
    """records: [(entity_id, as_of_ts)] with a stored snapshot from that date."""
    sample = random.sample(records, min(n, len(records)))
    mismatches = {}
    for entity_id, as_of in sample:
        stored = snapshot_store.get(entity_id, as_of)     # written on the day
        rebuilt = pipeline.features(entity_id, as_of)     # computed today
        for k, v_stored in stored.items():
            v_new = rebuilt.get(k)
            differs = (v_stored is None) != (v_new is None) or (
                v_stored is not None and v_new is not None
                and (abs(v_new - v_stored) > tol
                     if isinstance(v_stored, (int, float)) else v_new != v_stored))
            if differs:
                m = mismatches.setdefault(k, {"n": 0, "filled_after": 0})
                m["n"] += 1
                if v_stored is None and v_new is not None:
                    m["filled_after"] += 1
    return {k: {**v, "rate": v["n"] / len(sample)} for k, v in mismatches.items()}


if __name__ == "__main__":  # self-check with a deliberately leaky feature
    class Store:
        def get(self, e, d): return {"clean": 5, "leaky": None}
    class Pipe:
        def features(self, e, d): return {"clean": 5, "leaky": 42}
    out = replay_check([("a", "2026-01-01")] * 10, Store(), Pipe(), n=10)
    assert "clean" not in out, out
    assert out["leaky"]["rate"] == 1.0 and out["leaky"]["filled_after"] == 10, out
    print("replay_check ok:", json.dumps(out))
```

`filled_after` is the backfill signature specifically: the value was absent on
the day and is present now.

**With no stored snapshots the harness cannot run.** That is an honest
`unverified`, not a pass.

---

## 6. Window-parity assertion between training and serving

```sql
-- run against the two pipelines' own metadata, not their outputs
select feature_name,
       train_window_days,
       serve_window_days,
       train_timezone,
       serve_timezone
from   feature_contract
where  train_window_days <> serve_window_days
   or  train_timezone   <> serve_timezone;
-- any row is a silent distribution shift
```

The timezone half of this catches the case where the training extract bucketed
days in the source's timezone and the serving path bucketed in UTC. Every window
feature is then shifted by up to a day, and nothing errors.
