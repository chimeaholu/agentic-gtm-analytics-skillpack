---
name: sales-activity-analytics
description: Use for sales activity analysis — calls, emails, meetings, sequence performance, activity-to-outcome relationships, or rep activity benchmarking. Relates activity volume and mix to pipeline and revenue outcomes while refusing to present the relationship as causal, and handles the data-quality reality that CRM activity capture is systematically incomplete and unevenly so across reps. Prevents an activity quota being set from a correlation that reflects deal quality rather than rep effort.
---

# Sales activity analytics

Two things make this analysis go wrong, and both are structural rather than
arithmetic. **Activity capture is incomplete and unevenly incomplete across
reps**, so any rep comparison is partly a comparison of integration settings.
And **the activity–outcome correlation runs partly backwards**, because reps
invest more in deals that are already going well. A quota set from that
correlation optimises the proxy and not the outcome.

This skill computes the relationships anyway, because they are useful, and
attaches both caveats to every one of them.

## Step one, always: the capture rate

Never compare reps before reporting how completely each rep's activity is
captured. A rep whose email sync was never enabled looks lazy in every chart
you will ever build.

```
Capture rate proxy (per rep, per week) =
    auto-logged activities ÷ (auto-logged + manually-logged) activities

Coverage proxy (per rep) =
    opportunities with ≥1 logged activity in the last 30 days
    ÷ open opportunities owned
```

- **Grain:** rep × week.
- **Neither is a true capture rate.** There is no denominator for "activities
  that happened", because the unlogged ones are unobservable by construction.
  These are *indicators of integration health*, and they are labelled as such.
- **What to look for:** a rep with near-zero auto-logged email, a rep whose
  activity drops to zero on a specific date (sync broke), a rep whose activity
  is entirely `Task` records created in bulk at quarter end.

Sources of unevenness worth naming explicitly: email and calendar sync enabled
for some users and not others, a mail client the integration does not cover,
BCC-to-CRM used by some reps only, calls placed on a mobile outside the dialler,
meetings booked by an SDR and held by an AE, and sync that silently stopped
after a token expiry.

**If capture rates differ materially across the reps being compared, the
comparison is `unavailable` as a performance statement.** Report the capture
rates as the finding, give the volumes as observed-only, and say which direction
each rep's number is likely wrong in.

## The correlation trap, stated every time

High-activity deals win more often. Part of that is effort causing progress.
Part of it — often most of it — is that **reps invest more in deals that are
already going well**, and that engaged buyers generate activity by replying,
attending and asking for things. The arrow points both ways.

Consequences to state in the answer, not in a footnote:

- **An activity quota derived from the correlation optimises the proxy.** Reps
  hit the call count; the calls get shorter and worse. The correlation between
  activity and outcomes then weakens, which is usually blamed on the reps.
- **Buyer-generated activity must be separated from seller-generated activity**
  where the data allows (inbound reply, meeting accepted, content viewed versus
  outbound call, email sent). Buyer activity is a much better signal and a much
  worse quota.
- **The honest framing is "deals that won had more activity", not "more
  activity causes wins".** Where the difference matters commercially — before
  setting a quota, before a headcount case — the only thing that settles it is
  an experiment, and this skill says so rather than implying causality.

## Activity mix carries more signal than volume

| Metric | Formula | Grain | Denominator | Common miscomputation |
|---|---|---|---|---|
| **Multithreading** | distinct contacts with ≥1 *activity* on the opportunity | opportunity | none (a count) | counting *associated* contacts instead of active ones; association is free |
| **Meetings held** | activities of type meeting with a past date and a held/completed status | rep × period | none | counting meetings *booked*; no-shows and cancellations inflate it |
| **Meeting-held rate** | meetings held ÷ meetings booked | rep × period | meetings booked in the period | booking and holding counted in different periods, so the rate drifts |
| **Response rate** | distinct contacts who replied ÷ distinct contacts emailed | rep × period × sequence | contacts emailed, not emails sent | dividing replies by emails sent, which falls mechanically as you add steps |
| **Activities per opportunity** | logged activities ÷ open opportunities | rep | open opportunities owned | comparing across reps with different capture rates |
| **Days since last activity** | today − max(activity date) | opportunity | — | treating null (never) as a large number rather than a separate state |

**Multithreading is the strongest activity-side B2B signal** and it maps
directly onto the buying-group grain (`account-based-analytics`). It is also the
one activity metric that is hard to game by doing more of something cheap.

Report it as a distribution, not a mean: "62% of open enterprise deals have one
engaged contact" is actionable in a way that "2.4 contacts per deal" is not.

## Sequences and cadences

Step-level analysis needs step-level data and a declared attribution rule.

```
Step reply rate       = distinct contacts replying attributed to step N
                        ÷ distinct contacts who received step N
Sequence reply rate   = distinct contacts replying at any point
                        ÷ distinct contacts entering the sequence
Meeting rate          = distinct contacts booking a meeting attributed to the
                        sequence ÷ distinct contacts entering
```

Four rules:

1. **Denominators are contacts, not sends.** A five-step sequence to 100
   contacts sends up to 500 emails; dividing replies by sends makes every long
   sequence look worse than every short one, mechanically.
2. **Declare the post-sequence attribution rule.** Replies arriving after the
   sequence ends are common. "Credit the last step delivered within N days" is
   defensible; so is "credit the sequence within N days of exit". They give
   different step-level answers. State which, and keep N constant across
   comparisons.
3. **Exits are not completions.** A contact who replied and exited early is a
   success; a contact who completed all steps in silence is not. Do not sum the
   two, and do not read "exited" as failure.
4. **Per-step drop-off is confounded by exit.** Step 4's reply rate is computed
   over the people who did not respond to steps 1–3, who are by selection the
   harder audience. A declining per-step rate is expected, not a finding.

## Platform shapes differ, and so does completeness

| Source | Object | Fields that matter | Trap |
|---|---|---|---|
| Salesforce | `Task` | `WhoId`, `WhatId`, `Subject`, `Status`, `ActivityDate`, `TaskSubtype` (Call/Email/Task), `CallDurationInSeconds`, `IsClosed` | `ActivityDate` is a **date**, not a timestamp, so intra-day ordering is lost; `WhatId` is often null, leaving the activity unlinked to an opportunity |
| Salesforce | `Event` | `WhoId`, `WhatId`, `StartDateTime`, `EndDateTime`, `IsAllDayEvent`, `EventSubtype` | calendar sync writes and deletes these; a cancelled meeting may simply vanish rather than being marked cancelled |
| Salesforce | `EmailMessage` / `ActivityHistory` | `MessageDate`, `Incoming`, `RelatedToId` | `ActivityHistory` is a read-only related list, not a queryable base object in the ordinary sense — query the underlying objects |
| HubSpot | engagements: `calls`, `emails`, `meetings`, `notes`, `tasks` | `hs_timestamp`, `hs_activity_type`, `hs_call_duration`, `hs_meeting_outcome`, associations to contact/deal/company | engagement→deal association is what links activity to an outcome; unassociated engagements are invisible to deal-level analysis |
| HubSpot | rollups | `num_associated_contacts`, engagement-count properties | **computed asynchronously; can be stale or null on read**, and cannot be filtered reliably in search — recompute from the engagement records rather than trusting the rollup |
| Marketo | Bulk Activity Extract | activity type IDs from `GET /rest/v1/activities/types.json` | type IDs are instance-specific; resolve at runtime, never hard-code. Activity retention is finite (commonly ~25 months, contract-dependent) |

**The two CRMs have different permission asymmetries**, which changes activity
counts before any analysis: Salesforce results are scoped to the running user's
sharing rules and can show fewer rows than an admin sees, while a HubSpot
private-app token is portal-scoped and ignores user-level permissions, showing
more. Record which credential produced the numbers (`permission-effect-audit`).

## Answering

> **Reps in the top activity quartile closed 1.7× the pipeline of the bottom
> quartile last quarter.**
>
> That is logged activities per open opportunity against closed-won amount, both
> over the same quarter and the same segment. Two things make it weaker than it
> looks. Capture rates differ: three of the twelve reps have no auto-logged
> email, and their activity is understated by an unknown amount, so part of the
> quartile split is integration settings rather than behaviour. And the
> relationship runs partly backwards — reps work the deals that are already
> going well, and engaged buyers generate activity by replying.
>
> The mix signal is cleaner than the volume signal: deals with three or more
> engaged contacts won at roughly twice the rate of single-threaded deals, and
> multithreading is harder to inflate than call count. 62% of open enterprise
> deals are still single-threaded, which is the specific, actionable finding.
>
> For coaching conversations this is fine. **For setting an activity quota it is
> not** — a quota set from this correlation raises the metric and not the
> outcome. If the quota decision is real, the only thing that settles it is a
> holdout on a subset of the team.

## Honest limits

- **There is no true capture rate.** Unlogged activity is unobservable; the
  indicators above are integration-health proxies and are labelled as such.
- **Rep comparisons across uneven capture are `unavailable` as performance
  statements.** The capture rates are the finding.
- **No activity–outcome relationship here is causal**, in either direction, and
  the reverse-causal path is the plausible one.
- **Sequence step rates are confounded by selection**; per-step decline is
  expected.
- **Meeting "held" depends on a status someone maintained.** Where the status is
  unused, held and booked are indistinguishable — say so rather than counting
  bookings as meetings.
- **`ActivityDate` is a date in Salesforce.** Any analysis that needs intra-day
  ordering, such as first-touch-of-the-day or response latency in hours, is
  unavailable from `Task` alone.

## Core contracts this skill calls

- `answer-contract` — the non-causality statement on every activity–outcome
  relationship, and `unavailable` for rep comparisons across uneven capture
- `provenance-block` — credential identity (which user's sharing scope produced
  these counts), timezone on activity timestamps, freshness on async rollups
- `comparability-rules` — before comparing activity across reps, teams, tools or
  a sync-configuration change
- `warning-field-reader` — HubSpot rollup properties stale or null on read,
  Salesforce report scoping, archived records absent from HubSpot search
- `pagination-patterns` — activity tables are the largest objects in most CRMs;
  this is a bulk-path job, not a report-API one
- `rate-limit-governor` — per-rep per-week grids over activity multiply fast;
  Marketo's shared 100-calls-per-20-seconds instance limit makes activity
  extraction a Bulk Extract job, not a REST loop

## References

- `references/capture-quality.md` — the integration-health checks, what breaks
  capture, and how to report unevenness
- `references/activity-metrics.md` — every metric with formula, grain,
  denominator and miscomputation, plus the sequence attribution rules

## Related skills

- `account-based-analytics` for multithreading at the buying-group grain
- `win-loss-analysis` for stage-at-loss, which corroborates activity patterns
- `gtm-metric-dictionary` for the pipeline and win-rate definitions this joins to
- `permission-effect-audit` when two people see different activity counts
- `incrementality-testing` when the activity question is genuinely causal
