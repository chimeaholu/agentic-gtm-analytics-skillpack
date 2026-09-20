# Alert design and the alert estate

An alert estate is a product with users. It degrades the same way products do:
features added, none removed, until nobody uses it.

---

## 1. The registry schema

Every alert is a record. No alert exists only in a dashboard's UI configuration,
because an alert you cannot diff is an alert nobody can review.

```yaml
- id: pipeline_created_weekly_drop
  class: metric                     # metric | pipeline
  enabled: true
  created_at: 2026-03-02
  last_reviewed: 2026-09-01

  metric: pipeline_created
  definition_id: pipeline_created@v3     # a definition change invalidates the baseline
  source: warehouse.fct_opportunity
  grain: day
  segment: null                          # null = whole business; else the segment key

  method: seasonal_baseline
  baseline: same_weekday_trailing_4w
  fallback_method: absolute_change       # used when the primary is undefined (MAD=0, thin history)
  threshold: { direction: down, pct: 30 }
  min_volume: 30
  evaluate_on: D-2                       # inside the source's settlement window

  owner: "demand generation lead"        # a ROLE, never a person
  action: |
    1. Check the pipeline-health channel. If it is red, stop — this is not a business signal.
    2. Read the auto-attached segment decomposition.
    3. Single segment → route to that owner with the decomposition.
       Broad-based → escalate with the week-over-week and the prior-year comparison.
  runbook: docs/runbooks/pipeline-drop.md

  escalation_after: 2                    # consecutive fires before paging
  channel: "#gtm-metrics"
  page: false

  suppression:
    - { reason: "quarter end", cron: "last 3 business days of quarter" }
    - { reason: "company holidays", calendar: gtm_holidays }
    - { reason: "CRM migration", window: ["2026-11-02", "2026-11-09"], approved_by: "revops lead" }

  auto_retire_if: "fires > 4 times in 8 weeks with no action recorded"
```

**`owner` is a role, not a person.** People change teams; the alert outlives them,
and an alert routed to someone who left is an alert nobody receives.

**`definition_id` is load-bearing.** When the metric definition changes, the
stored baseline describes a metric that no longer exists. The evaluator must
compare the definition id on the alert against the current one and refuse to
evaluate on a mismatch:

```python
if alert.definition_id != current_definition_id(alert.metric):
    return Alert(class_='config', severity='medium',
        detail=f"{alert.metric} definition changed from {alert.definition_id} "
               f"to {current_definition_id(alert.metric)}; the baseline is not comparable",
        action="rebuild the baseline under the new definition, then re-enable")
```

That is a third alert class — **config** — and it is worth having. A detector
running happily against a stale definition is worse than one that is switched
off, because it looks like coverage.

---

## 2. Suppression calendars

Declared in advance. An event explained after the alert fires is indistinguishable
from an excuse, and it teaches the reader that alerts come with explanations
attached rather than actions.

```yaml
gtm_holidays:
  - { date: 2026-12-25, scope: global }
  - { date: 2026-11-26, scope: us }          # regional: suppress only US-segment alerts
campaigns:
  - { window: ["2026-11-27", "2026-12-01"], reason: "seasonal promotion",
      expect: { direction: up, metrics: [sessions, orders, spend] } }
migrations:
  - { window: ["2026-11-02", "2026-11-09"], reason: "CRM migration",
      expect: { direction: unknown, metrics: [pipeline_created, meetings_booked] },
      approved_by: "revops lead" }
```

Two properties that make suppression safe rather than a hiding place:

1. **`expect` records the anticipated direction.** A promotion window suppresses
   the *upside* alert on orders. It does **not** suppress a downside alert — a
   crash during a promotion is the most important alert of the quarter, and blanket
   suppression is how it gets missed.
2. **Suppression windows expire.** No open-ended entries. A migration window with
   no end date becomes a permanently disabled alert that everyone believes is
   running.

```python
def suppressed(alert, day, direction):
    for w in windows_covering(day, alert.metric):
        if w.expect.direction in (direction, 'unknown'):
            return w
    return None          # opposite-direction movements still alert
```

---

## 3. The pipeline-health suite

These run on every load, before any metric evaluation, and they are the alerts
that page.

| Check | Assertion | Fires when |
|---|---|---|
| **Rows landed** | `count(*) > 0` in the staging table | the job ran and loaded nothing |
| **Row-count ratio** | `0.5 ≤ current/prior ≤ 2.0` | an order-of-magnitude change — a data-quality event, not a trend |
| **Business freshness** | `max(event_date) ≥ current_date - N` | the source stopped delivering while the job kept succeeding |
| **Schema stability** | column set and types match the contract | a source added, removed or retyped a column |
| **Null rate on keys** | `count(*) where key is null` within tolerance | a join key degraded, which silently drops rows downstream |
| **Duplicate keys** | `count(*) = count(distinct key)` | a re-run double-loaded; totals are now inflated |
| **Extraction cap** | `rows_returned < row_cap` | the extract truncated; every figure from it is a lower bound |
| **Source warnings** | the source's own warning fields are empty | sampling, thresholding or partial data — per `warning-field-reader` |

**The duplicate-key check catches the failure that looks most like good news.** A
double-loaded day shows revenue up 100%, and without this check someone will
congratulate the team before anyone checks the pipeline.

**The row-count ratio check catches the reverse**, and it is why "order-of-magnitude
changes in row counts between loads are a data-quality event, not a trend" is a
rule rather than a heuristic.

Freshness thresholds are per source. An hourly CRM sync and a daily ad-platform
extract have different `N`, and one global value means either the first is
unmonitored or the second pages every morning.

---

## 4. Alert-estate review

Quarterly. Twenty minutes. The questions:

| Question | Action if the answer is bad |
|---|---|
| How many times did each alert fire? | more than ~6 a quarter with no action → retune or retire |
| How many fires led to a recorded action? | zero → **delete it** |
| How many incidents happened that no alert caught? | add one alert per missed incident, not five |
| Which alerts have an owner who has left the role? | reassign or retire |
| Which thresholds were set more than a year ago? | re-derive from current volume |
| Which suppression windows have no end date? | close them |

**Deleting an alert nobody acts on is an improvement, and it should be recorded as
one.** The instinct to keep it "just in case" is how an estate reaches the size
where nobody reads any of it, and at that point the alerts that matter are lost
in the noise they created.

Track the two numbers that describe the estate's health:

```
precision = fires that led to an action / total fires
recall    = incidents caught by an alert / incidents that occurred
```

Recall requires an incident log, which is the part teams skip. Without it you can
only measure how noisy the estate is, never whether it works — and an estate with
perfect precision and unknown recall is one that fires rarely and might be
covering nothing at all.

---

## 5. The alert message

Same discipline as any other answer: **the finding first, the caveats after, the
action attached.**

```
[GTM] Pipeline created down 34% vs baseline — demand generation lead

88 opportunities on Thu 18 Sep, against a same-weekday 4-week baseline of 133.
Pipeline health: GREEN (CRM extract on time, row counts normal, no schema change).

Top contributors to the change:
  segment A    -29 opportunities  (64% of the drop)
  segment B     -9 opportunities  (20%)
  everything else within normal range

Evaluated on D-2, so CRM close-date edits are mostly settled; the figure may rise
by a small amount and the direction will not change.

Action: runbook docs/runbooks/pipeline-drop.md
Definition: pipeline_created@v3 · created date · UTC
Fires: 1 (escalates to a page at 2 consecutive)
```

Four things that message does deliberately:

1. **States the pipeline is healthy before reporting a business movement.** The
   reader's first question is answered before they ask it.
2. **Attaches the decomposition**, so the first investigative step is already done
   at 3am.
3. **Names the direction of the remaining error** rather than claiming precision
   it does not have.
4. **Carries the definition and the window**, so the recipient can check it against
   their own dashboard without a round trip.
