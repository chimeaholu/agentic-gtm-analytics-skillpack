# "The API disagrees with the dashboard" — the diagnostic order

Power BI generates more of these complaints than any other platform in the pack, and the
top cause is structural rather than a defect. Work the list in order; the cheap checks
come first deliberately.

## 1. Formatting (cheapest, and very common)

**Format strings are metadata and are not applied to `executeQueries` output.** The API
returns `1234567.89`; the UI shows `$1.2M`. If the digits match once you strip the
formatting, there is nothing to investigate. Check this before anything else.

## 2. Timezone

Power BI has **no timezone conversion**. `NOW()` and `TODAY()` evaluate in **UTC in the
service** and in **local time in Desktop**. Any measure built on `TODAY()` produces one
answer in Desktop and another in the service, and the gap concentrates at day and month
boundaries.

Fix forward: use an explicit date table and explicit date filters rather than `TODAY()`.
Fix in reporting: state which evaluation basis produced the number.

## 3. Report-layer logic — the number-one cause

**The model is not the report.** These live in the report artifact and are invisible to a
model query:

- **Visual-level filters** — a filter applied to one chart only
- **Report-level and page-level filters**
- **Report-level measures** in thin and PBIR reports
- **Slicer state**, including a default selection the viewer never touched
- **Q&A synonyms**
- **Implicit measures** — a column dragged onto a visual producing an implicit `SUM`

**Implicit measures will not appear in `INFO.MEASURES()`.** A metric inventory built from
the model misses every ad-hoc aggregation an author created by dragging a column. When a
user points at a visual and the model query does not match, ask what is on the visual
before assuming the model is wrong.

Both numbers are usually correct for what they measure. Say that, name the filter you
could not see, and offer to reproduce the visual's filter context explicitly.

## 4. Object-level and row-level security

**OLS makes hidden objects invisible rather than error-producing.** A missing table or
measure is a permission until proven otherwise. RLS silently filters rows depending on the
identity in the token.

The diagnostic: run the same query under a second, more-permissioned identity and compare.
If the numbers differ, security is the explanation, and the right report names which
identity produced which figure.

## 5. Calculation groups and field parameters

These change what a measure *means* at query time. `INFO.CALCULATIONITEMS()` returns the
expressions, but composing them mentally is genuinely hard. If a model has calculation
groups, state that the number depends on which calculation item was applied, and name it.

## 6. Refresh state

**`Get Refresh History` shows success even when only recent partitions moved.** Under an
incremental refresh policy, `Refresh Dataset` with no body refreshes per policy — so a
green refresh is not evidence that historical data was reprocessed. If the disagreement is
in old data, check the partition policy, not the query.

## 7. Direct Lake fallback

**Direct Lake and DirectQuery pushdown are invisible in the DAX.** A model can fall back
from Direct Lake to DirectQuery with a large performance cliff and no signal in the
response. This explains "it was fast yesterday", not "the number is wrong" — but it is
worth naming so nobody investigates a correctness problem that is really a mode switch.

## And one non-discrepancy

**`executeQueries` returns errors as HTTP 200 in some client libraries.** Check the
`error` object in the body. An agent branching on status alone reports a failed query as
an empty result, which is not a disagreement at all — it is a swallowed failure.
