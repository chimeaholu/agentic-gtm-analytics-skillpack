---
name: amplitude
description: Use for any Amplitude request — event segmentation, funnels, retention, session metrics, revenue LTV, user activity, or raw event export. Amplitude is strong ad-hoc query plus strong raw export and zero authoring: its own docs state the Dashboard REST API cannot create charts or dashboards. Estimate query cost before issuing anything, because a 90-day retention query with three segments costs more than the entire five-minute concurrent budget. And remember the export window is keyed on server upload time, not event time, which is the number-one cause of "the export doesn't match the chart".
---

# Amplitude

**Capability class: extract-only. Amplitude cannot create charts or dashboards.** Its own
documentation states the Dashboard REST API **"cannot create charts or dashboards—only
retrieve data from existing ones."**

So an agent here can do two things well and one thing not at all:

- **run ad-hoc segmentation, funnel and retention queries** — strong
- **fetch the results of a chart a human already built** — strong
- **save any analysis back as a chart, dashboard or notebook** — **not possible**

The Taxonomy API creates **definitions** and the Behavioral Cohorts API manages **cohorts**;
neither is a reporting object. **State this plainly: Amplitude is strong ad-hoc query plus
strong raw export, zero authoring.**

**Core contracts this module must call, every time:** `provenance-block` (project, region,
project timezone, counting method, chart id if used, export window basis),
`warning-field-reader`, `comparability-rules`, **`rate-limit-governor` with a cost estimate
before the first call**, `pagination-patterns`, `mcp-detect-fallback`, `write-gate` before
any Taxonomy or cohort write, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** Amplitude answers behavioural questions
directly and cheaply in tokens — give the number. Then name the one thing that makes it
differ from the chart the user is looking at: the chart carries a timezone, a date range, a
counting method and possibly a cohort filter that a rebuilt query does not inherit.
Withhold only the genuinely gone: a user removed by a GDPR deletion, or a window before the
project started collecting.

---

## (a) Auth setup — by far the lowest friction in the pack

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

Time to first query: about two minutes.

1. **HTTP Basic auth with `{api_key}:{secret_key}` base64-encoded.** Keys are **per-project**,
   from Settings → Projects → General. No OAuth, no app review, no approval queue.
2. **EU data-residency customers must use `analytics.eu.amplitude.com` rather than the US
   host. This is the step everyone misses, and hitting the wrong host returns confusing
   auth errors rather than a redirect** — so it presents as a credential problem when it is
   a routing problem.
3. **Treat the secret key as high-sensitivity.** It is a **project-scoped credential with
   broad read access**, and **unlike PostHog there is no granular scoping to fall back
   on.** You cannot issue a read-only-analytics key; you issue the key.
4. **Verify the plan tier.** Free and Starter plans restrict the Dashboard REST API and
   some endpoints. **"The API exists" and "your account can call it" are different
   claims.**

Verify before planning work:

```bash
curl -s -u "$AMPLITUDE_API_KEY:$AMPLITUDE_SECRET_KEY" \
  "https://amplitude.com/api/2/sessions/average?start=20260901&end=20260907"
```

An auth error on correct credentials is usually the EU host. A 403 on a call that should
work is usually the plan tier.

---

## (b) Correct query construction

**The Dashboard REST API** covers:

| Surface | Use |
|---|---|
| **`/api/3/chart/{chart_id}/query`** | **results of a saved chart by ID — the way to match the UI** |
| `/api/2/events/segmentation` | event segmentation |
| `/api/2/funnels` | funnel analysis |
| `/api/2/retention` | retention |
| `/api/2/sessions/*` | session length, average, per user |
| `/api/2/useractivity`, `/api/2/usersearch` | per-user activity and lookup |
| `/api/2/users` | active and new users |
| `/api/2/realtime` | realtime active users — 5-minute granularity, 2-day window |
| `/api/2/revenue/ltv` | revenue LTV |

**The Export API** (`/api/2/export`) returns raw events. Supporting APIs: **Taxonomy** for
definitions, **Behavioral Cohorts**, **User Privacy**, **Chart Annotations**.

**When you need the chart's number, use `/api/3/chart/{chart_id}/query`, not a rebuilt
segmentation query.** A saved chart carries a project timezone, a date range, a counting
method (uniques versus totals versus DAU percent) and possibly a cohort filter. Rebuilding
"the same" query reproduces the question, not the chart.

**Chart IDs are opaque and come from the UI URL.** An agent cannot discover charts without
`get_charts` or `search` through the MCP. **Plan the discovery step** rather than asking the
user to paste an ID mid-analysis.

**Estimate the cost before issuing.** See (c); on this platform that is a query-construction
step, not an afterthought.

---

## (c) Pagination, bulk and cost

**Amplitude meters a cost model, not a request count:**

```
cost = (#days) × (#conditions) × (query-type cost)
```

where **conditions = segments + filters**.

**Preset query-type costs:** **retention 8**, **funnel 2 × events + 4 per group-by**,
**sessions 4**.

| Limit | Value |
|---|---|
| Concurrent requests | **5** (10 for User Activity / User Search) |
| **Cost per 5-minute window** | **1,000** |
| Cost per hour | **108,000** |
| User Activity / Search | additionally **360 queries/hour**, separate bucket |

**The worked example this module teaches: a 90-day retention query with 3 segments costs
90 × 3 × 8 = 2,160 — over the 1,000-per-5-minutes limit on its own.** It cannot succeed.
**Compute the estimated cost before issuing, and either narrow the range or warn the
user.**

**Bulk:** `GET /api/2/export?start=YYYYMMDDTHH&end=YYYYMMDDTHH` returns a **zipped archive
of JSON files, one event per line.** Constraints: **maximum queryable period 365 days; a
hard 4 GB response limit (over it you get a 400); very large datasets return 504
timeouts.**

**For anything genuinely large, Amplitude's own answer is the Amazon S3 export, not the
API.**

**Latency:** data is available within roughly 2 hours of receipt.

**Throttling is silent until it is not — you get 429s in bursts rather than a gradual
slowdown, so retry with backoff *and* cost estimation, not naive retry.** A retry loop
without a cost model re-issues the same impossible query forever.

---

## (d) Preferred MCP server and fallback

**Preferred: the official, remote-hosted Amplitude MCP.** `https://mcp.amplitude.com/mcp`
(US) and `https://mcp.eu.amplitude.com/mcp` (EU). Nothing to clone or pin.

**OAuth 2.0 that respects the user's existing Amplitude permissions — the best auth story
of any MCP in the research, because the agent cannot see data the human operator cannot.**
That is a meaningful contrast with the REST path, where the secret key is broad and
unscopeable.

Tools: `search`, `query_chart`, `query_experiment`, `query_dataset`, `query_metric`,
`get_charts`, `get_dashboard`, `get_notebook`, `get_experiments`, `get_flags`,
`get_session_replays`, `get_event_properties`, `get_context`.

**Read-only, consistent with the underlying API. Available on all plans including Free.**

**Explicitly labelled beta: "under active development… you may experience bugs or
performance issues", with a note that it may be rate-limited.**

**Coverage is a token subset with good taste rather than full API coverage.** It covers
querying and content discovery — including experiments and feature flags, which the REST
story does not foreground — **but it does not expose the Export API.**

**So the split is: MCP for interactive analysis, direct API for bulk extraction.** Say
which you used.

Community `amplitude-mcp` repos are mostly **ingestion**-focused despite misleadingly
similar descriptions. With a solid official server there is no reason to use them.

**Fallback: the Dashboard REST API and the Export API directly, which cover everything.**

---

## (e) Gotchas, and the specific field that reveals each one

- **The export window is keyed on `server_upload_time`, not event time.** An export for
  "yesterday" **includes late-arriving events uploaded yesterday and excludes yesterday's
  events that arrived today. This is the number-one cause of "the export doesn't match the
  chart".**
- **Charts and API queries diverge on defaults.** A saved chart carries a project timezone,
  a date range, a **counting method (uniques versus totals versus DAU percent)** and
  possibly a cohort filter; querying `/events/segmentation` with "the same" parameters will
  not reproduce it unless you replicate all of them. **If you need the chart's number, use
  `query_chart` or the chart-results endpoint rather than rebuilding the query.**
- **Project timezone is a project setting applied to day bucketing, with no per-query
  override on most endpoints** — so **two projects in one company can bucket days
  differently** and their series cannot be naively combined.
- **Amplitude does not do currency conversion.** Revenue is whatever was sent in
  **`$revenue`**, in whatever currency the SDK sent, **with no enforced currency field.
  Multi-currency products produce silently summed nonsense — check with the implementer
  before reporting revenue.**
- **User merging rewrites history.** When Amplitude merges an anonymous device with an
  identified user, **previously-exported rows become inconsistent with new queries, so
  re-exports are not idempotent across a merge.**
- **GDPR and CCPA deletions remove users from future queries but remain in previously
  downloaded exports** — a warehouse copy drifts out of compliance unless deletions are
  replayed.
- **Free and Starter plans restrict the Dashboard REST API and some endpoints.** **"The API
  exists" and "your account can call it" are different claims — verify the tier** before
  promising.
- **Chart IDs are opaque and come from the UI URL.** An agent cannot discover charts without
  `get_charts` or `search`. **Plan the discovery step.**
- **Amplitude's identity merge logic differs from your warehouse's**, so exported user IDs
  may not match your own resolution. A join built on them is an approximation.

---

## Files

- `references/query-cost-model.md` — the cost formula, the preset costs, the worked example
  that cannot run, and how to narrow a query that is over budget.
- `references/export-vs-chart.md` — `server_upload_time` versus event time, the chart
  defaults that do not transfer, and merge non-idempotency.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
