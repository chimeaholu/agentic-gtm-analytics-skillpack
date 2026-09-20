# The anchor harness

A known-answer test suite that runs against the **baked artefact** and exits
non-zero. It is the gate between an automatic ingest and a human-visible number.

Mocks prove the code compiles. The artefact is what ships, so the artefact is
what gets tested.

## 1. Choosing anchors

Pick four to eight. More than that and nobody maintains them; fewer and the gate
does not cover the ways the pipeline actually breaks.

| Class | What it is | Tolerance | Failure means |
|---|---|---|---|
| **STABLE** | a fully-settled historical aggregate — a closed prior quarter, a fixed prior-year month | **0%** | a definition changed, a source restated, or the join broke. A human looks. |
| **DRIFT_PRONE** | a current or growing figure — row counts, active accounts | a declared band, typically 5–20% | the order of magnitude moved. Usually real, occasionally a pipeline duplication. |
| **INVARIANT** | a structural property — no null keys, stage values inside the enum, no duplicate primary keys | 0 violations | the model is broken regardless of the numbers |

**A STABLE anchor must sit outside every restatement window.** Ad platforms
settle over weeks (Meta roughly 28 days, Google Ads back-fills conversions up to
90), analytics reprocesses over a day or two, and CRM close dates get edited after
close. An anchor on last month's ad spend is not stable; it is a daily false
alarm that trains people to re-baseline without reading. Anchor at least one full
quarter back for anything touching paid media.

**One anchor per failure mode, not one per tile.** The point is to catch the join
that silently went from inner to left, the currency column that changed basis,
the partition filter someone removed. Twelve anchors on twelve variants of the
same sum catch one thing twelve times.

## 2. The anchor file

```json
{
  "generated_at": "2026-09-20T06:20:00Z",
  "anchors": [
    {
      "id": "closed_won_2026q1",
      "class": "STABLE",
      "dataset": "pipeline_by_stage",
      "assert": { "sum": "amount_usd", "where": { "stage": "Closed Won", "close_quarter": "2026-Q1" } },
      "expected": 0,
      "tolerance_pct": 0,
      "note": "settled quarter; any movement is a definition change or a restatement, both of which a human must see",
      "baselined_at": "2026-09-20",
      "baselined_reason": "initial"
    },
    {
      "id": "opportunity_row_count",
      "class": "DRIFT_PRONE",
      "dataset": "opportunity_rows",
      "assert": { "count": "*" },
      "expected": 0,
      "tolerance_pct": 10,
      "note": "grows with the business; this checks order of magnitude, not exactness"
    },
    {
      "id": "no_orphan_opportunities",
      "class": "INVARIANT",
      "dataset": "opportunity_rows",
      "assert": { "count": "*", "where": { "account_name": null } },
      "expected": 0,
      "tolerance_pct": 0,
      "note": "a non-zero here means the account join dropped to a left join or the key changed type"
    }
  ]
}
```

`expected: 0` in a freshly generated file is a placeholder, and the harness
**refuses to pass a never-baselined anchor** rather than treating zero as a real
expectation. Baselining is an explicit, recorded act (§4).

## 3. The harness

```ts
// scripts/anchors.ts
import { readFileSync } from 'node:fs'
import { readSnapshot } from '../lib/snapshots'

type Anchor = {
  id: string; class: 'STABLE' | 'DRIFT_PRONE' | 'INVARIANT'
  dataset: string; assert: { sum?: string; count?: string; where?: Record<string, unknown> }
  expected: number; tolerance_pct: number; note: string
  baselined_at?: string; baselined_reason?: string
}

const { anchors } = JSON.parse(readFileSync('anchors.json', 'utf8')) as { anchors: Anchor[] }
const failures: string[] = []

for (const a of anchors) {
  if (!a.baselined_at) {
    failures.push(`${a.id}: never baselined. Run 'npm run anchors:baseline' and record the reason.`)
    continue
  }

  const rows = (await readSnapshot(a.dataset)) as Record<string, unknown>[]
  const matched = rows.filter(r =>
    Object.entries(a.assert.where ?? {}).every(([k, v]) => (r[k] ?? null) === v))

  const actual = a.assert.sum
    ? matched.reduce((t, r) => t + Number(r[a.assert.sum!] ?? 0), 0)
    : matched.length

  // absolute tolerance where expected is 0, otherwise percentage
  const allowed = a.expected === 0 ? 0 : Math.abs(a.expected) * (a.tolerance_pct / 100)
  const delta = Math.abs(actual - a.expected)

  if (delta > allowed) {
    const pct = a.expected === 0 ? 'n/a' : `${((delta / Math.abs(a.expected)) * 100).toFixed(1)}%`
    failures.push(
      `${a.class} ${a.id}: expected ${a.expected} ±${a.tolerance_pct}%, got ${actual} (off by ${delta}, ${pct}). ${a.note}`)
  }
}

if (failures.length) {
  console.error(`\nANCHOR HARNESS FAILED — deploy blocked\n\n${failures.join('\n\n')}\n`)
  process.exit(1)
}
console.log(`anchor harness passed: ${anchors.length} anchors`)
```

**`tolerance_pct` against an expected value of zero is meaningless**, which is
why the code branches: zero-expected anchors (the INVARIANT class) demand exact
zero. A percentage of nothing is nothing, and a harness that computes
`0 * 0.1 = 0` and then reports "within tolerance" on a value of 4,000 is the kind
of bug that makes a gate worse than no gate.

Wire it in so it cannot be skipped:

```json
{
  "scripts": {
    "bake": "tsx scripts/bake.ts",
    "anchors": "tsx scripts/anchors.ts",
    "anchors:baseline": "tsx scripts/anchors.ts --baseline",
    "build": "npm run bake && npm run anchors && next build"
  }
}
```

The ordering matters: `bake` writes the artefact, `anchors` tests the artefact,
`next build` bundles it. A harness that runs after the build tests something that
has already been declared shippable.

## 4. Re-baselining discipline

A STABLE anchor that fails once is a finding. The correct sequence:

1. **Read the delta.** A 0.3% move on a settled quarter is usually a currency or
   rounding basis change. A 40% move is usually a join.
2. **Find the cause.** `data-lineage-tracer` for what changed upstream;
   `calculation-integrity-audit` for whether the definition moved.
3. **Only then re-baseline**, and record why in the file:

```json
{
  "id": "closed_won_2026q1",
  "expected": 1284000,
  "baselined_at": "2026-09-20",
  "baselined_reason": "FX basis moved from transaction-date to quarter-end rate per the finance reconciliation; +0.4% on settled history is expected and one-off"
}
```

**An anchor silently re-baselined to whatever the pipeline now produces is not a
test.** It is a record that the pipeline produces what the pipeline produces. If
the reason field would read "updated to match", the investigation has not
happened yet.

A useful habit: keep `baselined_reason` history in the commit, and grep it when
someone asks why a historical number on the dashboard does not match a deck from
six months ago. That question gets asked, and this file answers it in seconds.

## 5. What the harness deliberately does not do

- **It does not check freshness.** That is the bake's assertion (SKILL.md §6),
  which must fail earlier, because a stale artefact should never reach the
  anchors.
- **It does not check the rendering.** An anchor passing means the numbers in the
  artefact are right, not that the page shows them. Tile-level correctness is a
  separate, cheaper check and usually a snapshot test.
- **It does not prove the metric definition is the one the business wants.** It
  proves the definition has not silently changed. `metric-definition-audit` owns
  the first question.

Say that in the README. A gate whose coverage is overstated is worse than a gate
whose coverage is known, because people stop looking at the things it never
covered.
