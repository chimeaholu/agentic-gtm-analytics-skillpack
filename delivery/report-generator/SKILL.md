---
name: report-generator
description: Use when producing a recurring or one-off report as a deliverable file — a weekly GTM report, a monthly exec pack, a QBR deck input or a self-contained HTML or PDF artefact that needs no hosting. Applies the cadence discipline — leading indicators weekly, finance-reconciled monthly, forecast-accuracy postmortem quarterly — and attaches the definition, window and caveats to every number. Prevents a chart dump nobody reads, and prevents a report whose numbers quietly contradict the dashboard.
---

# Report Generator

A report is prose with evidence attached. A chart dump is a report that has
offloaded the analysis onto the reader, and the reader does not do it. If the
artefact you are producing could be summarised as "here are the numbers", it will
be skimmed once and never opened again.

**Core contracts this skill must call:** `answer-contract` (every number in the
report is a number reaching a human), `provenance-block` (which populates the
sidecar, §7), `comparability-rules` (before any period comparison or
cross-source total), `warning-field-reader` (source warnings become caveats, not
silence), `pagination-patterns` (a capped extract is reported as a lower bound in
the report too), `rate-limit-governor` (a recurring report is a recurring query
budget).

---

## 1. Report, dashboard and answer are three different things

Choosing wrong is the mistake an agentic pack is most likely to make, because all
three start from the same request.

| Shape | When | Cost of the wrong choice |
|---|---|---|
| **Answer** | asked once, decided once | none — this is the cheap case |
| **Report** | asked on a cadence, read by people who were not in the conversation | a report nobody asked for, produced forever |
| **Dashboard** | a surface people return to and interact with, with filters you cannot enumerate | **a dashboard is the most expensive possible answer to a one-off question, and then has to be maintained forever** |

The routing rule, applied before any artefact is built:

```
Has this exact question been asked before?
  no  → answer it. Log it.
  yes, once or twice → answer it again. Log it.
  yes, three or more times, same shape, same cadence → a report is owed. Build it.
       and if the follow-ups are always "but filtered to X" with X unpredictable
       → a dashboard is owed. Route to dashboard-builder-vercel.
```

**The tenth repeat of the same ad-hoc question is a signal that a report is
owed**, and it is a signal almost nobody acts on, because each individual repeat
is cheap. Say so when you notice it: "this is the fourth time this quarter — want
it weekly instead?"

Run the routing call out loud and record why. A user who asked for a dashboard
and received a weekly report needs to see the reasoning, and roughly half the
time they agree.

---

## 2. Cadence discipline

| Cadence | Contains | Explicitly not |
|---|---|---|
| **Daily** | **exceptions only, and it should be an alert, not a report** | a daily digest of normal numbers |
| **Weekly** | **leading indicators only**, same definitions every week, 2–3 sentences of what changed and why | revenue, which does not move weekly in a way anyone can act on |
| **Monthly** | **reconciled to finance before publication**, the full metric set, month-over-month with the drivers | a second, contradicting set of numbers |
| **Quarterly** | the monthly set plus a **forecast-accuracy postmortem** and the definition-change log | a QBR that only defends the quarter |
| **Ad hoc** | the answer, plus timestamp, definition, window, caveats | an artefact with no window on it |

Three of those rows carry the weight:

**Daily reports are alerts wearing the wrong clothes.** A daily report nobody
reads is worse than none, because its existence is taken as coverage. Route it to
`anomaly-detection` and give it an owner and an action.

**The weekly report carries leading indicators only.** Pipeline created, meetings
booked, qualified volume, activity, engagement — things that move weekly and that
somebody can do something about on Monday. Closed revenue in a weekly report is
noise: it moves on deal-close timing, and the reader learns to discount the whole
artefact.

**The monthly report is reconciled to finance before publication.** If the
marketing number and the finance number differ, **that gets resolved before
publication, not explained afterwards.** An explanation after the fact is a
credibility event; two numbers in circulation is a credibility problem that lasts
quarters. Use `cross-system-reconciliation`, and if the difference is structural
and irreducible, publish **one** number with the other named and the gap
quantified — never both with equal billing.

---

## 3. Same definitions every period, and changes go on the timeline

A definition change is **marked on the timeline**, not silently applied. Both the
old and the new series appear for at least one period, and the marker names the
date, the change and the effect.

```markdown
▲ 2026-08-01 — "Qualified opportunity" now requires a confirmed budget holder.
  Effect: about 12% fewer opportunities from August onward.
  Series before and after this marker are not comparable without restating.
```

Silently restating history is worse than either option: the reader's remembered
numbers stop matching the report and they conclude the report is unreliable,
which is the correct conclusion.

Where a restatement is genuinely required, publish both series for the transition
period and say which is authoritative from when.

---

## 4. The report is narrative, and the charts support it

The structure that survives contact with an executive reader:

```
1. The headline           one number and its direction, in the title
2. What happened          three to five sentences. The story, not the table.
3. Versus expectation     forecast, actual, variance, and the accuracy record
4. Why                    two or three decomposed, quantified drivers
5. What we are doing      actions with owners
6. What we need           specific asks, or "nothing this period" written explicitly
7. The numbers            the tables and charts, supporting the above
8. Definitions appendix   every metric used, as resolved
9. What this does not claim
```

Sections 2 through 6 come from `executive-narrative-builder`. This skill owns the
artefact: the assembly, the provenance, the file. **If sections 2–6 are empty and
section 7 is full, you have built a chart dump.** That is the failure this
ordering exists to prevent — it is not a stylistic preference, it is the
difference between an artefact that changes a decision and one that gets
forwarded unopened.

Every chart earns its place by supporting a sentence in the narrative. A chart
nobody referenced in prose is a chart nobody will read. Follow `dataviz`
conventions for the charts themselves.

---

## 5. Every number carries its window and its basis

In the table, next to the number, not in a footnote at the end:

| Metric | Value | Window | Basis |
|---|---|---|---|
| Pipeline created | 4.2M | 2026-08-01 – 2026-08-31 | created date, USD at month-end rate |
| Win rate | 22% | opportunities **closed** in Aug | closed-won ÷ (closed-won + closed-lost) |
| Qualified meetings | 310 | booked date, account timezone | excludes internal and test accounts |

The three columns answer the three questions a sceptical reader asks first, and
answering them inline removes the round trip that otherwise kills the report's
usefulness for a day.

**Incomplete periods are marked or excluded, and the last bar is never presented
as a trend.** Three acceptable treatments — drop it, render it distinctly and
label it, or prorate it and say it is prorated. Silently including it is not one
of them, and it is the single most common way a report manufactures a decline.

---

## 6. Provenance goes in a collapsed footer, not inline

**This is the design decision that makes the discipline survivable.** The
`answer-contract` requires ten fields to be *statable*, not *stated*. A report
that opens with an eight-item provenance header teaches its reader to scroll past
the caveats, and then the one caveat that mattered is scrolled past too.

So: **one collapsed footer, and a machine-readable sidecar.**

```html
<details class="provenance">
  <summary>Sources, definitions and caveats — 6 sources, 2 partial</summary>
  <!-- the full contract: per-source windows, timezones, currency basis,
       join match rates, exclusions, extraction warnings, coverage -->
</details>
```

What stays **inline**, because it changes how the number is read:

- the window and basis on every number (§5)
- an incomplete-period marker on any period still open
- a lower-bound marker on any figure from a capped extract
- a direction-of-error sentence on any figure known to over- or under-state

What goes in the **collapsed footer**: everything else. Source list, extraction
timestamps, timezone status per source, join match rates, FX rates and dates,
exclusion lists, per-source row counts and coverage windows.

`<details>` is native HTML, works in every browser with no JavaScript, and
survives being saved to disk or emailed. **Do not build a modal for this.**

PDF has no `<details>`. Put the same content in a final appendix page and link to
it from a one-line footer on each page. The PDF's provenance is a page, not a
disclosure widget — the discipline is unchanged, the mechanism differs.

---

## 7. The machine-readable sidecar

Every report emits a companion JSON file with the same basename. This is what
makes a report auditable, diffable and reconcilable six weeks later, and it costs
nothing to produce because you already hold every field.

```json
{
  "report_id": "gtm-monthly-2026-08",
  "generated_at": "2026-09-02T08:14:22Z",
  "period": { "start": "2026-08-01", "end": "2026-08-31", "basis": "close_date", "timezone": "UTC" },
  "cadence": "monthly",
  "metrics": [
    {
      "key": "pipeline_created",
      "label": "Pipeline created",
      "value": 4203118.0,
      "unit": "USD",
      "definition_id": "pipeline_created@v3",
      "definition_source": "semantic_layer",
      "grain": "opportunity",
      "window": { "start": "2026-08-01", "end": "2026-08-31", "basis": "created_date" },
      "timezone": "UTC",
      "timezone_status": "confirmed",
      "currency_basis": { "currency": "USD", "fx_method": "month_end", "fx_date": "2026-08-31" },
      "numerator": null,
      "denominator": null,
      "source": "warehouse.fct_opportunity",
      "extracted_at": "2026-09-02T06:05:11Z",
      "coverage": { "rows": 1840, "capped": false },
      "exclusions": ["test_accounts", "internal_domains"],
      "state": "observed",
      "comparison": { "prior_value": 3980220.0, "prior_period": "2026-07", "equal_coverage": true }
    },
    {
      "key": "paid_attributed_pipeline",
      "label": "Paid-attributed pipeline",
      "value": 1105400.0,
      "unit": "USD",
      "definition_id": "paid_attributed_pipeline@v2",
      "state": "observed",
      "error_direction": "overstates",
      "error_reason": "per-platform attributed conversions overlap by construction; no shared identity key exists to deduplicate",
      "error_magnitude": "unquantified",
      "better_number": "warehouse deduplication on the account key, available once identity resolution covers paid touchpoints"
    },
    {
      "key": "marketing_sourced_arr",
      "value": null,
      "state": "unavailable",
      "reason": "the marketing platform exposes no reporting API; its internal figure cannot be retrieved",
      "resolves_with": "UI export, or the separate analytics licence"
    }
  ],
  "definition_changes": [
    { "date": "2026-08-01", "metric": "qualified_opportunity",
      "change": "now requires a confirmed budget holder", "effect": "approximately 12% fewer opportunities from August" }
  ],
  "reconciliation": { "against": "finance", "status": "reconciled", "residual_pct": 0.0 },
  "does_not_claim": [
    "Causality: measured before and after in uncontrolled windows, with no control group and no seasonality adjustment.",
    "Cross-platform deduplication of paid conversions.",
    "Reconciliation to any ad platform's own UI, which computes on a different path."
  ],
  "sources": [
    { "name": "warehouse", "extracted_at": "2026-09-02T06:05:11Z", "coverage_end": "2026-08-31",
      "timezone": "UTC", "timezone_status": "confirmed", "warnings": [] }
  ]
}
```

Four uses that justify it immediately:

1. **Diff two periods' sidecars** and every definition, window or basis change
   appears as a diff line. This answers "why does this month's number not match
   the deck" in seconds instead of an afternoon.
2. **Reconcile the report against the dashboard mechanically** — same
   `definition_id`, same window, same basis, or a flagged mismatch.
3. **Regenerate the report** from the sidecar without re-querying.
4. **Audit.** `metric-definition-audit` and `calculation-integrity-audit` read it
   directly rather than parsing prose.

The `state` field takes the same values as `answer-contract`: `observed`,
`missing`, `unavailable`, `lower_bound`, `partial`, `ambiguous`. **`null` with a
state of `unavailable` is a valid, complete metric entry.** Zero is not.

---

## 8. Self-contained HTML is the lowest-friction deliverable

Inline data, inline styles, a chart library from a CDN, one file. No hosting, no
auth, no build. It opens from an email attachment on a phone, on a laptop with no
network, and in three years.

```html
<!doctype html>
<meta charset="utf-8">
<title>GTM monthly — August 2026</title>
<style>/* inline; no external stylesheet */</style>
<script id="data" type="application/json">{"pipeline_created":[...]}</script>
<main>
  <h1>Pipeline created was 4.2M in August, up 6% on July</h1>
  <p>...narrative...</p>
  <figure><canvas id="pipeline"></canvas><figcaption>...</figcaption></figure>
  <details class="provenance"><summary>Sources, definitions and caveats</summary>...</details>
</main>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>/* read #data, render */</script>
```

Two properties that matter more than they look:

- **Inline the data, do not fetch it.** A report that fetches is a report that
  breaks the moment the endpoint moves, the token expires or the reader is
  offline. The artefact must be true in three years with no infrastructure.
- **Pin the CDN version** (`chart.js@4`, not `chart.js@latest`). A floating tag
  means the chart renders differently next year, or not at all.

If the CDN is unacceptable — an air-gapped reader, a strict email gateway — inline
the library too and accept the file size, or render static SVG server-side. Say
which you did, because it determines whether the charts are interactive.

**PDF when the reader needs to print, sign or archive it**, or when the recipient's
mail gateway strips HTML attachments. Otherwise HTML: it is smaller, searchable,
and its charts can be interactive.

**Deck input, not a deck.** When the destination is a slide deck, emit structured
content — headline, three bullets, one chart, the source line — and let the deck
tool lay it out. Generating slide geometry from an analytics skill produces
something that is both a bad report and a bad deck.

---

## 9. The negative list closes the report

**Repeated in full at document level**, even though individual caveats appear
inline, because the negative list is the part worth re-reading and scattered
caveats are never read together.

Lead with the causal disclaimer whenever the shape is before-and-after,
correlational, or an observed lift, which is almost always:

> **What this report does not claim.** Measured before and after in uncontrolled
> windows, with no control group and no seasonality adjustment: this shows what
> happened, not what caused it. It does not deduplicate people across platforms,
> because no shared key exists. It does not reconcile to any ad platform's own UI,
> which computes on a different path. It covers only the sources listed above;
> anything absent is out of scope, not zero.

**"Anything absent is out of scope, not zero" belongs in every report.** A reader
who cannot see a channel assumes it did nothing.

---

## 10. Answering

**Answer first, in the title.** "Pipeline created was 4.2M in August, up 6% on
July" is a headline. "August GTM Report" is a filename.

Then the caveats, one plain sentence each, inline where they change the reading
and in the footer where they do not:

> Paid-attributed pipeline of 1.1M sums figures that overlap by construction, so
> it overstates; without a shared identity key the overlap cannot be measured. For
> budget-direction decisions this figure is fine; for a channel reallocation, use
> the deduplicated warehouse figure. Marketing-sourced ARR is unavailable this
> month — the marketing platform has no reporting API, so its own figure cannot be
> retrieved; the independently computed equivalent is in the appendix and will not
> match it.

**Withhold only what cannot honestly be computed.** A metric whose source failed
appears in the report as `unavailable` with the reason and the resolution — never
omitted, because a silently dropped metric reads as a metric that was not
important. A metric that is computable but easy to misread ships with its
direction of error named.

The rule for a recurring report specifically: **a metric that appears one month
and vanishes the next, with no note, is the worst available outcome.** Once a
metric is in the report it stays in the report, showing its state, until it is
deliberately retired with a note.

---

## Files

- `references/html-report-template.md` — the full self-contained HTML skeleton,
  the `<details>` provenance footer, and the sidecar writer
- `references/cadence-playbooks.md` — what goes in the weekly, monthly and
  quarterly reports, with the finance reconciliation procedure and the
  forecast-accuracy postmortem
- `evals/cases.json` — behavioural cases including the honest-limit cases

## Related skills

- `executive-narrative-builder` writes sections 2–6; this skill assembles the artefact
- `dashboard-builder-vercel` when the answer is a surface, not a file
- `anomaly-detection` when the request is really for a daily report
- `revenue-waterfall` for the reconciling decomposition behind the narrative
- `cross-system-reconciliation` for the finance reconciliation the monthly requires
- `gtm-metric-dictionary` for the definitions appendix
