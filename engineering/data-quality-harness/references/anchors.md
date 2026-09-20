# Anchors — selection, the stable/drift-prone split, re-baselining, CI wiring

A test suite proves the shape of the data. An anchor proves the **arithmetic**.
It is the only artefact that catches a change in a calculation that leaves
every structural test green.

---

## 1. Choosing anchors

A good anchor is:

- **Materially important.** Pipeline created, revenue, customer count,
  conversion rate. Nobody re-derives a wrong anchor on a metric nobody uses.
- **Computable in one query** against the baked artefact.
- **Over a bounded, named period**, so the query text never changes.
- **Reconcilable by hand** if challenged. An anchor you cannot explain is an
  anchor that gets re-baselined the first time it fails.

Five to fifteen anchors is the useful range. Fifty anchors is a second test
suite that nobody maintains.

**Cover both sides of every contested definition.** Where a metric has two
defensible readings (see `gtm-metric-dictionary`), anchor both. Then a
definition change fails exactly one anchor, which tells you what changed rather
than that something did.

---

## 2. The split, and why it is load-bearing

| | `STABLE` | `DRIFT_PRONE` |
|---|---|---|
| Computed over | frozen historical records | mutable current-state records |
| Example | opportunities created in a closed quarter | open pipeline today |
| Legitimate movement | **none** — the source cannot change | **expected** — records change daily |
| Tolerance | 0, or a rounding epsilon | a stated percentage band |
| On mismatch | **the calculation changed. Fail the build.** | **verify the data**, do not touch the calc |
| Gates CI | yes | no — informational smoke test |

The rule that follows, and it is the one people get wrong: **for a drift-prone
anchor, drift means "go and verify the data", never "fix the calculation".**
Editing the calculation to match a moved drift-prone anchor is how a correct
calculation gets broken by a test.

Without this split, the harness gets switched off the first time real data
legitimately moves — and a harness that is off protects nothing, which is worse
than never having built it because everyone believes it is running.

### Classifying an anchor

Ask one question: **can the underlying records legitimately change after the
fact?**

- Closed quarter, closed month, a snapshot date in the past → `STABLE`.
- Anything containing "current", "open", "active", "today" → `DRIFT_PRONE`.
- A historical window inside a **source's settlement horizon** → `DRIFT_PRONE`
  until the horizon passes, then `STABLE`. Google Ads back-fills conversions to
  the click date for up to 90 days, so a paid-conversion anchor is not stable
  until roughly a quarter after its period ends. Promote it deliberately, with
  a commit, on the date it becomes frozen.

---

## 3. The anchor query

Stored as a file, referenced by id, never inlined in the config:

```sql
-- anchors/pipeline_created_q2.sql
-- STABLE. Reference point 2026-06-30. Anchor set v7.
SELECT COUNT(*) AS value
FROM marts.fact_opportunity
WHERE created_date BETWEEN DATE '2026-04-01' AND DATE '2026-06-30'
  AND is_test_account = FALSE;
```

The query text is part of the anchor. **Changing the query is changing the
anchor**, and it goes through the same re-baselining procedure as changing the
value — otherwise the easiest way to make an anchor pass is to quietly narrow
its filter.

---

## 4. The runner

```python
def run_anchors(conn, anchor_set, build_id) -> int:
    exit_code, report = 0, []
    for a in anchor_set["anchors"]:
        observed = conn.query(read(a["query"])).one().value
        expected, tol = a["expected"], a["tolerance"]
        delta = observed - expected
        within = abs(delta) <= (tol if tol >= 1 else abs(expected) * tol)

        if within:
            status = "PASS"
        elif a["kind"] == "STABLE":
            status, exit_code = "FAIL", 1        # gates the build
        else:
            status = "DRIFT"                      # informational, does not gate

        report.append({"id": a["id"], "kind": a["kind"], "expected": expected,
                       "observed": observed, "delta": delta, "status": status,
                       "build": build_id,
                       "action": {"FAIL":  "the calculation changed — investigate the code",
                                  "DRIFT": "verify the data — do not edit the calculation",
                                  "PASS":  ""}[status]})
    write_anchor_results(conn, report)
    print_table(report)
    return exit_code
```

Three properties:

- **Run against the baked artefact** — the built mart, the deployed view, the
  production credential. An anchor run against a fixture proves the fixture.
- **The remediation text is emitted with the result.** "DRIFT: verify the data,
  do not edit the calculation" printed at the moment of failure is worth more
  than the same sentence in a document nobody opens at 6pm.
- **Results are persisted before the exit**, so a failing build is diagnosable.

---

## 5. Re-baselining: the four-part commit

An anchor edited to make the build green has been deleted. The legitimate
procedure:

```yaml
anchor: pipeline_created_q2
anchor_set_version: 7 → 8
date: 2026-09-20
old_value: 1843
new_value: 1867
delta: +24
cause: >
  CRM data-cleanup on 2026-09-14 backdated 24 opportunities into Q2 by
  correcting their created_date from the import date to the true origination
  date.
reconciliation_query: |
  SELECT COUNT(*) FROM staging.stg_crm__opportunity
  WHERE created_date BETWEEN '2026-04-01' AND '2026-06-30'
    AND _loaded_at >= TIMESTAMP '2026-09-14';
reconciliation_result: 24
approved_by: <role, in the commit>
```

**The delta must reconcile exactly.** +24 explained by a query returning 24 is
a re-baseline. +24 explained by "data cleanup" is an unexplained edit and the
review rejects it.

Where the delta reconciles to *almost* the difference — 24 expected, 21 found —
the anchor has caught a second, unrelated defect. That is the anchor doing its
job, and it is the most valuable thing it ever does.

---

## 6. CI wiring

```yaml
# any CI system; nothing here is tool-specific
steps:
  - run: python runner/migrate.py --dry-run          # exits non-zero on drift
  - run: python runner/build_marts.py
  - run: python runner/run_tests.py  --build "$BUILD_ID"    # exit 1 = gating test failed
  - run: python runner/run_anchors.py --build "$BUILD_ID"   # exit 1 = STABLE anchor failed
  - run: python runner/check_imports.py                     # declared vs imported
```

- The anchor step runs **after** the marts are built, against the built
  artefact.
- `exit 3` from the test runner (a `BLOCKED` test) should fail the build too.
  A suite that goes green because tests stopped running is the most common
  false pass there is.
- `check_imports.py` is the F33 guard: every module imported by the harness is
  declared, and every declared dependency imports in the runner's environment.
  An undeclared dependency works on the author's machine and fails on the
  schedule, at night, silently.

---

## 7. What anchors do not prove

State this in the verification inventory, because an anchor suite creates
confidence out of proportion to its coverage:

- Anchors prove **these values**, at **this reference point**, under **this
  build**. They say nothing about periods, segments or metrics they do not
  cover.
- A passing anchor set is `PARTIAL` coverage by definition: *the checks that
  were run passed; it does not mean every conditional state was exercised.*
- Anchors cannot detect a defect that was present when they were baselined. An
  anchor baselined against a wrong number locks the wrong number in. Anchor
  values should be independently derived at least once — by hand, or from the
  source platform's own UI — and that derivation recorded with the anchor.
