---
name: data-quality-harness
description: Use when building or reviewing data-quality tests for GTM marts, and whenever a metric moves sharply and it is unclear whether the business changed or the pipeline broke. Produces freshness, uniqueness, referential-integrity, control-total and fan-out tests, plus known-answer anchors that gate a release, with anchors split into stable and drift-prone. Prevents a broken ingest being read as a business decline, and prevents anchors being quietly edited until they pass.
---

# Data Quality Harness

**"Revenue dropped 90%" and "the ingest job failed" look identical on a chart
and require opposite responses.** Everything in this skill exists to keep those
two apart, and to make the distinction visible before someone presents the
wrong one in a meeting.

Tests here are plain SQL plus a runner that exits non-zero. No framework, no
dbt dependency — the pack has to work for someone with a warehouse and a
credential and nothing else.

---

## 1. Pipeline failure alerts separately, and louder

This is the single most-missed alerting requirement in GTM analytics.

| Event | Where it must surface | Severity |
|---|---|---|
| Ingest job failed or rejected a file | **pipeline alert**, and a visible gap on the chart | high — someone must act today |
| Data landed but failed a quality test | pipeline alert, mart marked not-ready | high |
| Data landed, tests passed, the number moved | **metric alert**, to a different audience | normal — `anomaly-detection` owns this |

Three structural requirements:

1. **`last_successful_load` and `last_attempted_load` are separate published
   columns.** A consumer who sees only "last updated" cannot tell a pipeline
   that ran and rejected everything from one that ran and loaded. This is
   failure mode F1 and it is how a broken ingest becomes a business decline.
2. **A stale mart renders as a gap, not as a flat line.** Left-joining onto
   `dim_date` gives you zeros for genuinely-zero periods; a missing load must
   be distinguishable from those (see `answer-contract` on zero versus missing
   versus unavailable).
3. **The readiness state is a queryable view, not a log line.** The dashboard
   header reads it. So does the agent, before it answers a question.

```sql
CREATE OR REPLACE VIEW quality.mart_readiness AS
SELECT
  m.mart_name,
  m.last_attempted_load,
  m.last_successful_load,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), m.last_successful_load, HOUR) AS hours_stale,
  m.expected_max_staleness_hours,
  t.tests_run, t.tests_failed, t.tests_not_run,
  CASE
    WHEN m.last_successful_load IS NULL                                   THEN 'NEVER_LOADED'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), m.last_successful_load, HOUR)
         > m.expected_max_staleness_hours                                 THEN 'STALE'
    WHEN t.tests_failed > 0                                               THEN 'FAILED'
    WHEN t.tests_not_run > 0                                              THEN 'PARTIAL'
    ELSE 'READY'
  END AS readiness
FROM quality.mart_load_state m
LEFT JOIN quality.test_results_latest t USING (mart_name);
```

**The status badge is asserted here, in the warehouse, not in the renderer.**
Failure mode F17 is a green badge above a stale number, and it happens whenever
the badge is computed by the display layer from data it was handed.

---

## 2. The mandatory test set for every GTM mart

Seven tests. A mart without all seven is not tested; it is spot-checked.

| # | Test | Catches |
|---|---|---|
| 1 | **Freshness** — max timestamp within the declared window | a stopped pipeline |
| 2 | **Uniqueness on the declared grain** | fan-out, double loads, SCD filters missing |
| 3 | **Referential integrity** to each dimension | orphan facts, a dimension load that ran late |
| 4 | **Control totals** — row count **and** sum against a declared control | partial loads and duplication (each test alone misses one) |
| 5 | **Fan-out detection** — rows per source key against the expected ratio | the silent revenue multiplier |
| 6 | **`dim_date` spine completeness** | zero-activity periods vanishing instead of showing zero |
| 7 | **Numerator/denominator coverage matching** for every rate | a rate built from two populations that do not overlap |

Test 4 needs both halves stated together, because a row-count test alone misses
a partial fan-out that also dropped rows, and a sum test alone misses a
duplication that cancels out.

```sql
-- 2. uniqueness on the declared grain
SELECT 'fact_opportunity_snapshot.grain' AS test, COUNT(*) AS failures
FROM (
  SELECT opportunity_id, snapshot_date, COUNT(*) AS n
  FROM marts.fact_opportunity_snapshot
  WHERE snapshot_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  GROUP BY 1, 2
  HAVING n > 1
);

-- 4. control totals, both halves, against the staging control
WITH control AS (
  SELECT COUNT(*) AS rows_ctl, SUM(CAST(amount AS NUMERIC)) AS sum_ctl
  FROM staging.stg_crm__opportunity
),
actual AS (
  SELECT COUNT(*) AS rows_act, SUM(amount_original) AS sum_act
  FROM marts.fact_opportunity
)
SELECT 'fact_opportunity.control_totals' AS test,
       rows_ctl, rows_act, sum_ctl, sum_act,
       (rows_ctl <> rows_act) OR (ABS(sum_ctl - sum_act) > 0.01) AS failed
FROM control, actual;

-- 7. numerator/denominator coverage for a conversion rate
SELECT 'mql_to_sql_rate.coverage' AS test,
       COUNTIF(d.person_id IS NULL) AS numerator_rows_without_denominator
FROM marts.fact_sql n
LEFT JOIN marts.fact_mql d USING (person_id);
```

Test 7 deserves its own sentence: **a numerator row with no denominator row
means the rate's two populations are not nested**, and the rate is a ratio of
two different things. It is the most common cause of a conversion rate above
100% and of a rate that is quietly wrong below it.

---

## 3. Known-answer anchors that gate the deploy

A test suite proves the shape. **Anchors prove the arithmetic.** An anchor is a
value computed at a fixed reference point, checked against a declared tolerance,
with the harness exiting non-zero on failure so CI can gate on it.

```json
{
  "anchor_set_version": "7",
  "reference_point": "2026-06-30",
  "anchors": [
    {
      "id": "pipeline_created_q2",
      "kind": "STABLE",
      "query": "anchors/pipeline_created_q2.sql",
      "expected": 1843,
      "unit": "opportunities",
      "tolerance": 0,
      "rationale": "frozen historical window; the source records for Q2 cannot legitimately change"
    },
    {
      "id": "open_pipeline_today",
      "kind": "DRIFT_PRONE",
      "query": "anchors/open_pipeline_today.sql",
      "expected": 412,
      "unit": "opportunities",
      "tolerance": 0.15,
      "rationale": "mutable current-state records; movement here is business, not a defect"
    }
  ]
}
```

### The split is what keeps the harness alive

| Kind | Over | On mismatch | Gates CI |
|---|---|---|---|
| **STABLE** | frozen historical snapshots | **fail the build** — the calculation changed | yes |
| **DRIFT_PRONE** | mutable current-state records | **report and verify the data** — not "fix the calc" | no, informational |

**Without this split the harness gets disabled the first time real data
legitimately moves**, and then it protects nothing. A drift-prone anchor that
gates CI teaches people to bypass the gate.

**Run anchors against the baked artefact**, not against a mock or a fixture. An
anchor that passes against a fixture proves the fixture.

---

## 4. Re-baselining an anchor requires a reconciled explanation

An anchor whose expected value is edited to make the build pass has been
deleted, not updated. Failure mode F49.

A legitimate re-baseline is a commit containing four things:

1. the **date** of the change,
2. the **data event** that caused it — a backfill, a corrected source export, a
   deliberate definition change, a merge in the identity graph,
3. an **arithmetic reconciliation of the delta**: old value, new value,
   difference, and the rows that account for the difference, summing exactly,
4. the **anchor set version** incremented.

```
anchor: pipeline_created_q2
old: 1843   new: 1867   delta: +24
cause: 24 opportunities backdated into Q2 by the CRM data-cleanup on 2026-09-14
reconciliation: SELECT COUNT(*) FROM staging.stg_crm__opportunity
                WHERE created_date BETWEEN '2026-04-01' AND '2026-06-30'
                  AND _loaded_at >= '2026-09-14'   -- returns exactly 24
```

**If the delta does not reconcile exactly, the anchor has caught a real defect
and the change is rejected.** That is the whole point of the anchor.

---

## 5. Structural gates derive their expectations from the data

A gate that must be edited to pass will eventually be edited to pass for the
wrong reason. Failure mode F48.

```sql
-- WRONG: a hardcoded integer
SELECT COUNT(*) = 47 AS pass FROM marts.dim_campaign;

-- RIGHT: derived from canonical data at the declared grain
SELECT (SELECT COUNT(DISTINCT campaign_id) FROM staging.stg_ads__campaign)
     = (SELECT COUNT(*)                    FROM marts.dim_campaign) AS pass;
```

The difference: the first fails on the day someone launches campaign 48 and
gets "fixed" by changing 47 to 48. The second fails only when the mart and its
source genuinely disagree, which is the only interesting case.

---

## 6. The verification inventory, with a defined `PARTIAL`

Report against a **named build**, with this vocabulary and these definitions
written into the document itself:

| Status | Definition |
|---|---|
| `PASS` | the check ran against the named build and succeeded |
| `PARTIAL` | **the checks that were run passed; it does not mean every conditional state was exercised** |
| `NOT_TESTED` | no check exists for this, and that is a known gap |
| `FAIL` | the check ran and failed — listed **by name, with the reason** |
| `BLOCKED` | the check could not run: missing credential, missing dependency, source unavailable |

`PARTIAL` read as coverage is failure mode F45, and the only defence is
defining it in the artefact where it is reported, every time. A stakeholder who
reads `PARTIAL` as "mostly fine" is reading it reasonably; the document is what
is wrong.

`FAIL` items are always enumerated. A count of failures with no names is a
number designed not to be acted on.

---

## 7. Declared cadence is not a proven schedule

**A cadence recorded in a registry is an intention.** Deployed ingestion code is
not evidence of a recurring sync, and a connector's existence is not evidence
that it ran. Failure mode F44.

| Claim | Evidence that settles it |
|---|---|
| "this syncs hourly" | a scheduler configuration **and a run history** showing the last N executions with their outcomes |
| "the dashboard refreshes nightly" | the refresh job's execution log, not its schedule definition |
| "the connector is live" | rows landed in the last period, from the load ledger |

Until both exist, label the cadence **declared** and name the exact evidence
that would settle it. This is not pedantry: a pipeline whose schedule was
disabled six weeks ago still has a cadence in the registry, still has deployed
code, and still has a green connector icon.

```sql
-- the cheap proof, from the ingestion ledger
SELECT source,
       COUNT(*)                                    AS loads_last_7d,
       MAX(loaded_at)                              AS last_load,
       MIN(TIMESTAMP_DIFF(next_load, loaded_at, MINUTE)) AS min_gap_minutes,
       APPROX_QUANTILES(TIMESTAMP_DIFF(next_load, loaded_at, MINUTE), 2)[OFFSET(1)] AS median_gap_minutes
FROM (
  SELECT source, loaded_at,
         LEAD(loaded_at) OVER (PARTITION BY source ORDER BY loaded_at) AS next_load
  FROM raw.load_ledger
  WHERE load_status = 'loaded'
    AND loaded_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
)
GROUP BY source;
```

A median gap of 1,440 minutes is evidence of a daily cadence. A registry entry
saying "daily" is not.

---

## 8. Dependencies are asserted, not assumed

Failure mode F33. Run an **import-versus-manifest check in CI**: every module
the harness imports must be declared, and every declared dependency must be
importable in the runner's environment. An undeclared dependency works on the
machine it was written on and fails on the schedule, at night, silently, with
the failure surfacing as stale data three days later.

The same check applies to the warehouse side: every object a test references
must exist and be readable by the harness's credential. A `BLOCKED` test is
reported as `BLOCKED`, never quietly skipped.

---

## 9. The runner

```python
def run_suite(conn, suite, build_id) -> int:
    results, exit_code = [], 0
    for test in suite:
        try:
            row = conn.query(test.sql).one()
            status = "FAIL" if row.failed else "PASS"
        except MissingObject as e:
            status, row = "BLOCKED", {"reason": str(e)}
        except Exception as e:
            status, row = "BLOCKED", {"reason": repr(e)}
        results.append({"test": test.id, "status": status, "detail": dict(row),
                        "build": build_id, "kind": test.kind})
        if status == "FAIL" and test.gates:
            exit_code = 1
        if status == "BLOCKED":
            exit_code = max(exit_code, 3)
    write_results(conn, results)          # into quality.test_results
    print_inventory(results)              # PASS / PARTIAL / NOT_TESTED / FAIL / BLOCKED
    return exit_code
```

- `exit 0` all gating tests passed · `exit 1` a gating test failed ·
  `exit 3` a test could not run.
- **`BLOCKED` is not `PASS`.** The most common way a suite goes green is tests
  that stopped running.
- Results are written to `quality.test_results` **before** the exit, so a
  failing build still leaves a diagnosable record.

---

## 10. Answering

**Answer first.** "Is this drop real?" gets a verdict in the first sentence,
because you can compute it: check `quality.mart_readiness`, the load ledger and
the control totals, then say *"the ingest for the 14th to the 16th never
completed, so this is a pipeline gap, not a decline — the three missing days
are why the total is down 38%."*

Where tests pass and the number still moved, say that too, plainly: *"the
pipeline is healthy and the tests pass, so the movement is in the data."* That
is a real answer, and it hands the question to `anomaly-detection` rather than
leaving it open.

**Withhold only** where the tests cannot run — a `BLOCKED` suite means the
readiness state is unknown, and "unknown" is the honest report. Name the
credential or object that would unblock it.

---

## Core contracts called

- `answer-contract` — `PASS` / `PARTIAL` / `NOT_TESTED` / `FAIL` / `BLOCKED` map
  onto the non-answer types; a `BLOCKED` suite makes readiness `unavailable`,
  never `READY`.
- `provenance-block` — freshness, last successful load and test status ride
  with every number derived from a mart.
- `write-gate` — anchor re-baselining, threshold changes and any test-suite
  edit that reduces coverage.
- `rate-limit-governor` — the suite runs on a budget; control totals over large
  facts are the expensive tests and are scheduled, not run per query.

## References

- `references/test-library.md` — the seven mandatory tests as runnable SQL per
  warehouse, plus the fan-out and coverage patterns
- `references/anchors.md` — anchor selection, the stable/drift-prone split, the
  re-baselining procedure and the CI wiring

## Related skills

- `source-ingestion-mapper` supplies the load ledger this reads.
- `warehouse-schema-designer` defines the `quality` layer.
- `anomaly-detection` takes over once the pipeline is proven healthy.
- `cross-system-reconciliation` when the control total disagrees with the source platform.
- `calculation-integrity-audit` for the arithmetic assertions behind the anchors.
