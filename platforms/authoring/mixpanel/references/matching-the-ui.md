# When the API and the Mixpanel board disagree

Four causes, in the order worth checking. All four are legitimate — neither surface is
wrong — and the resolution is usually to stop rebuilding and start calling the saved
report.

## 1. Counting method

Mixpanel boards carry a counting method that a rebuilt query does not inherit:

- **Total** — every event
- **Unique** — one per user
- **DAU / average** — a per-day derivation

A `segmentation` call defaults differently from whatever the board author chose. This is
the most common single cause, and the difference is often large enough that nobody
suspects a setting.

## 2. Project session definition

Session-based metrics depend on the project's configured session timeout. It is a project
setting, not a query parameter, and two projects in one company can differ.

## 3. A board-level filter you did not replicate

Boards carry filters at the board level as well as on each card. Rebuilding "the same
query" from the card's visible configuration silently drops the board filter above it.
There is no field in a `segmentation` response that tells you a filter was missing — you
simply get a larger number.

## 4. Sampling on very large projects

Very large projects may be sampled. The rebuilt query and the board can sample
differently.

## The rule: use `bookmark_id`

**When you must match a Mixpanel board, run the saved report through `insights` by
`bookmark_id`.** That call executes the report as saved — counting method, session
definition, board filters and all — and returns the number the human sees.

Rebuilding a query reproduces *the question*. It does not reproduce *the report*.

```
GET /api/query/insights?project_id={id}&bookmark_id={bookmark_id}
```

Getting the `bookmark_id` means asking the user for the board URL, or discovering it
through the MCP's content-discovery tools. Budget one call for it; it is cheaper than
three rounds of "still doesn't match".

## Timezone, which is not a disagreement but looks like one

**The project timezone governs all bucketing, there is no per-query override, and changing
it retroactively re-buckets historical reports.** So:

- a number quoted last month may not reproduce today, with nothing in the response
  explaining the change
- day-boundary comparisons against another platform will differ unless that platform is
  set to the same zone

Record the project timezone in the provenance block on every answer. It is the cheapest
piece of reproducibility available here.

## Identity, which is the one that produces plausible wrong answers

**Identity Management v2/v3 merge semantics changed how `distinct_id` resolves, and on
ID-Merge projects the raw-export `distinct_id` is not necessarily the canonical ID used in
the UI.**

Check the project's ID-merge version **before** writing any join between exported Mixpanel
data and another system. The failure mode is not an error; it is a user count that looks
reasonable and is wrong.

## Lexicon computed properties

**Lexicon computed and custom properties are evaluated at query time and do not exist in
the raw export.** If a board uses one and you are trying to reproduce that board from
exported data in a warehouse, the property is simply absent and you must recreate the
formula. Say that rather than reporting the warehouse number as equivalent.
