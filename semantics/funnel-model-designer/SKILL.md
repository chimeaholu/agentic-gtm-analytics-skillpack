---
name: funnel-model-designer
description: Use before any funnel, conversion-rate or stage-progression analysis, and when a team's funnel stages are undocumented, inconsistent across systems, or defined differently by marketing and sales. Produces the funnel model: stage definitions with entry and exit criteria, the unit of analysis (person, buying group, account, session or order), stage-history requirements, the lookback window, and whether the funnel is cohorted or snapshot. Prevents a conversion rate computed from a snapshot being read as a cohort rate, and prevents measuring a funnel whose stages were never defined.
---

# Funnel Model Designer

Define the funnel before measuring it. The two decisions that go wrong first
are the unit of analysis and the snapshot-versus-cohort question, and both are
invisible in the output once they are made wrong.

---

## 1. Choose the unit of analysis explicitly, and record it

| Unit | Use when | Typical trap |
|---|---|---|
| **Person** | self-serve, PLG, consumer | used for enterprise B2B, where it is the wrong grain entirely |
| **Buying group / demand unit** | B2B with multi-person committees | requires the group to be identifiable, which most CRMs do not do natively |
| **Account** | ABM, land-and-expand | account-level rates hide which contact actually converted |
| **Opportunity** | pipeline stage analysis | opportunities created at different trigger points across teams |
| **Session** | web conversion | session is a construction, not a fact (see §7) |
| **Order** | ecommerce | guest checkout breaks the person link |

**A B2B buying group of six people means person-level journeys are the wrong
grain entirely, and touches must roll up to the account or the opportunity.**
A person-grain funnel measured on a six-person committee produces conversion
rates roughly a sixth of the real ones, and they are not comparable to any
published benchmark.

**Mixing units within one funnel is the most common structural error.** A
funnel that counts people at the top and opportunities at the bottom has no
consistent denominator and the "conversion rates" between those stages are
ratios of two different things.

Record the unit in the funnel specification. Every downstream rate inherits it.

---

## 2. Snapshot versus cohort, decided before anything is computed

| | Cohorted funnel | Snapshot funnel |
|---|---|---|
| What it does | follows a defined entry cohort forward through stages | counts everyone currently sitting at each stage |
| Is it a conversion rate? | **yes** | **no** |
| Needs | stage history with timestamps | current stage field only |
| Time to be meaningful | a full cycle must elapse | immediate |
| Moves when | conversion behaviour changes | the *mix* of the pipeline changes |

**A snapshot funnel is not a conversion rate at all.** It is a shape of the
current pipeline. It is useful for capacity and coverage questions and it is
wrong for any question of the form "how well are we converting".

**Recent cohorts are truncated. The last few points are incomplete, not a
decline.** A cohort with a 90-day median cycle, measured 30 days in, shows a
terminal conversion rate that is structurally low. Mark those cohorts
incomplete and report their rate as a **lower bound** rather than dropping
them, because dropping them hides the most recent information entirely.

---

## 3. Stage transitions require stage history, not the current stage field

The current stage field tells you where something is. It does not tell you
where it has been, and specifically it cannot tell you:

- that a deal **skipped** a stage (which is a process finding)
- that a deal was **pushed backwards** (which is usually a qualification
  finding)
- that a person **re-entered** a stage (which breaks any naive cohort count)
- how long anything spent anywhere

**HubSpot lifecycle stage is a single field that moves both forward and
backward, and re-entry overwrites the `hs_lifecyclestage_*_date` stamps.** A
contact that cycles through Lead twice has one date, the second one, and the
first journey is gone.

**Salesforce `OpportunityHistory` and `OpportunityFieldHistory` cover tracked
fields only**, and tracking is almost always enabled after someone needed it.

The dependency is therefore hard: a stage-transition funnel needs
`fact_lead_stage` (one row per person-stage entry) and
`fact_opportunity_snapshot` (one row per opportunity per day) from
`data-model-designer`. **Neither can be backfilled.**

---

## 4. Entry and exit criteria are written per stage, testably

For each stage:

```
stage_name
entry_criteria     the testable condition that puts a unit INTO this stage
exit_criteria      the testable condition that takes it OUT, and to where
owner              who is accountable for movement through this stage
source_field       where the transition is observable, and in which system
instrumented       yes | no | partial
version            effective_from date of this definition
```

**"MQL" is a threshold on a business rule, not a fact.** Write the rule down
and version it, so that a trendline crossing a definition change is marked
rather than read as a trend. If the threshold moved from 70 to 85 on a date
inside your window, the volume step at that date is a definition change, not a
demand decline. See the metric contract register in `semantic-layer-builder`.

Worked example of a testable pair:

```
stage: Sales Qualified Opportunity
entry: opportunity record exists AND stage in (Discovery, ...) AND
       qualification_completed_at is not null
exit:  stage moves to Proposal (forward), or to Closed Lost / Closed No
       Decision (terminal), or back to Discovery (backward, counted as a
       regression not an exit)
source_field: Opportunity.StageName, observed in fact_opportunity_snapshot
instrumented: yes
```

"Regression is counted, not ignored" matters: a funnel that silently drops
backward moves reports a higher forward conversion rate than reality.

---

## 5. Missing instrumentation is a first-class finding

**SAL is frequently not instrumented at all.** This is *why* MQL→SQL looks
noisy in most orgs: without a Sales Accepted Lead receipt you cannot
distinguish "sales worked it and rejected it" from "sales never touched it".
Those are opposite findings with opposite fixes, and the blended rate averages
them into noise.

**Name the missing stage rather than quietly computing around it.** The output
includes a list of stages that cannot currently be measured and why:

```
cannot_measure:
  - stage: SAL
    reason: no acceptance event exists in the CRM; no task, no status value,
            no timestamp
    consequence: MQL-to-SQL conflates rejected leads with untouched leads
    resolves_with: a lead status value or a task type logged on acceptance
```

This is more useful than the rate you would have computed, and it is the thing
an org can actually act on.

---

## 6. Small-n refusal

A stage-to-stage rate on a cohort too small to support it is refused, with the
minimum cohort size stated.

Default floor: **30 units in the denominator**. Below it, report the raw counts
(`4 of 11`), never a percentage. A 2-of-3 conversion is not 67%, and the
confidence interval on it spans most of the possible range.

Segmented funnels hit this constantly: the overall funnel has 900 units and the
enterprise-EMEA slice has 7. Report the overall rate and the segment counts,
and say plainly that the segment cannot support a rate yet.

---

## 7. Product funnels need sessionization decisions

**GA4 has no session table in BigQuery.** A session is something you construct
from events, and the standard construction is a 30-minute inactivity gap.

**That gap is a convention, not a law.** Changing it changes every
session-denominated metric in the history: sessions, conversion rate,
bounce-like metrics, pages per session, revenue per session.

**Pin it, version it, state it.** Put the gap in the metric contract register
with an `effective_from`, and treat a change to it exactly like a metric
redefinition: mark the boundary, do not describe the crossing as a trend.

Other sessionization decisions that need to be recorded: whether a UTM change
mid-visit starts a new session (GA4 says yes for campaign changes, which
surprises people), whether midnight forces a session break, and which timezone
midnight is in, which is `temporal-integrity-audit`'s problem.

For product funnels generally, also decide:

- **Step ordering**: strict sequence, or any-order completion of a step set?
- **The conversion window**: within one session, within 7 days, within 30 days?
  The window is part of the metric, not a display option.
- **Re-entry**: does a user who completes the funnel twice count twice?
- **First-time-only steps**: activation steps that can only happen once need a
  different denominator from repeatable ones.

---

## 8. Output: the funnel specification

```
unit_of_analysis: person | buying_group | account | opportunity | session | order
basis: cohorted | snapshot          # stated, never implied
stages[]:
  name, order, entry_criteria, exit_criteria, owner,
  source_field, source_system, instrumented, definition_version
lookback_window: the conversion window, with its unit
cohort_definition: what puts a unit in the cohort, and on which date
incomplete_cohorts[]: cohorts younger than the median cycle, marked
cannot_measure[]: stage, reason, consequence, resolves_with
required_sources[]: the tables and fields the funnel needs to exist
min_cohort_size: 30 by default
sessionization (if applicable): gap, version, effective_from
```

---

## 9. Answering

**Answer first.** When asked for a funnel and the stage history does not exist,
give the snapshot shape, label it a snapshot, state plainly that it is not a
conversion rate, and say what it is good for (capacity, coverage, where volume
is sitting). Then name what a cohort funnel would need.

When cohorts are incomplete, **give the rate and call it a lower bound**, with
the expected direction and rough magnitude of the remaining movement if the
prior cohorts support an estimate. Do not drop recent cohorts silently; that
hides the freshest signal.

Withhold only: a stage rate below the small-n floor (report counts instead),
and a transition rate for a stage that is not instrumented at all (report the
missing instrumentation as the finding).

## References

- `references/stage-definitions.md` — worked stage definitions for the
  lead-centric and buying-group models, with entry and exit criteria
- `references/cohort-vs-snapshot.md` — the two computations side by side, the
  truncation correction, and what each is good for

## Related skills

- `gtm-metric-dictionary` for the stage definitions and the two funnel models.
- `data-model-designer` for `fact_lead_stage` and
  `fact_opportunity_snapshot`, both of which are prerequisites.
- `funnel-conversion-analysis` consumes this specification.
- `product-led-growth-analytics` and `ecommerce-analytics` for the
  session-grain and order-grain variants.
