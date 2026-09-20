# "The export doesn't match the chart" — and what to do about it

Three distinct causes, in order of how often they are the answer.

## 1. `server_upload_time`, not event time — the number-one cause

**The export window is keyed on `server_upload_time`, not event time.**

An export for "yesterday" therefore:

- **includes** late-arriving events that were *uploaded* yesterday but *occurred* earlier
- **excludes** events that *occurred* yesterday but arrived today

On a mobile product with offline queuing, that gap is large. On a web product it is small
but non-zero.

**Handling:**

- **Export a wider window than you need and filter on event time locally.** A two-day
  export filtered to one day of `event_time` is closer to the chart than a one-day export.
- **Re-export a settled window** rather than exporting the most recent day, when accuracy
  matters more than freshness.
- **Never present an export-derived daily series as equivalent to a chart's daily series**
  without saying which time basis each uses.

## 2. Charts carry defaults that a rebuilt query does not inherit

A saved chart carries **all** of these, and a `/events/segmentation` call replicates
**none** of them automatically:

| Chart property | Effect if not replicated |
|---|---|
| **Counting method** — uniques vs totals vs DAU percent | often a large difference |
| **Project timezone** | day-boundary shifts |
| **Date range** including relative ranges | different window entirely |
| **Cohort filter** | different population |
| Segment definitions | different slices |

**The rule: if you need the chart's number, use `/api/3/chart/{chart_id}/query` or the
MCP's `query_chart`.** Rebuilding a query reproduces the *question*, not the *chart*.

**Chart IDs are opaque and come from the UI URL.** An agent cannot discover them without
`get_charts` or `search`. **Plan the discovery step** rather than stopping mid-analysis to
ask the user to paste an ID.

## 3. Identity merges rewrite history

**When Amplitude merges an anonymous device with an identified user, previously-exported
rows become inconsistent with new queries.**

Concretely: **re-exports are not idempotent across a merge.** The same window exported
before and after a merge differs, and the difference is not late-arriving data.

And the downstream version: **Amplitude's identity merge logic differs from your
warehouse's**, so exported user IDs may not match your own resolution. Any join on them is
an approximation — say so rather than presenting a merged count as exact.

## Timezone, which is a project setting

**Project timezone is a project setting applied to day bucketing, with no per-query
override on most endpoints.**

Two consequences:

- **Two projects in one company can bucket days differently**, so their series cannot be
  naively combined into a company-wide daily trend.
- A comparison against another platform (GA4, a warehouse) needs the timezone stated on
  both sides.

Record the project timezone in the provenance block. It is not something you can adjust in
the query.

## Revenue, which Amplitude does not understand

**Amplitude does not do currency conversion.** Revenue is whatever was sent in
**`$revenue`**, in whatever currency the SDK sent it, **with no enforced currency field.**

**Multi-currency products therefore produce silently summed nonsense** — EUR and USD added
as bare numbers.

**Check with the implementer before reporting revenue** from a multi-currency product. The
honest answer, when the implementation sent mixed currencies with no discriminator, is that
the figure cannot be interpreted — not a converted estimate.

## Deletions drift a warehouse copy

**GDPR and CCPA deletions remove users from future queries but remain in previously
downloaded exports.**

So a warehouse built from Amplitude exports **drifts out of compliance unless deletions are
replayed.** That is a data-governance obligation attached to the export, not an Amplitude
feature, and it should be stated when setting up any recurring export.

## The one thing that is genuinely absent

**Amplitude cannot create charts or dashboards.** Its own documentation says the Dashboard
REST API "cannot create charts or dashboards—only retrieve data from existing ones."

The Taxonomy API creates **definitions**; the Behavioral Cohorts API manages **cohorts**.
Neither is a reporting object.

So when a stakeholder asks for "an Amplitude dashboard for the team", the honest plan is:
run the analysis, deliver it into whatever surface they already open, and — if they want it
to live in Amplitude — hand a human the query parameters to build the chart themselves.
