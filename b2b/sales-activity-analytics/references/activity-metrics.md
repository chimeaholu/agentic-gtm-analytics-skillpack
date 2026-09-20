# Activity metrics register

Formula, grain, denominator, and the way each one is usually computed wrong.

## Volume and coverage

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Activities per opportunity | logged activities ÷ open opportunities owned | rep | open opportunities | comparing across reps with different capture rates |
| Activity coverage | opportunities with ≥1 activity in N days ÷ open opportunities | rep | open opportunities | N left undeclared, so the metric moves when someone changes it |
| Days since last activity | today − max(activity date) | opportunity | — | nulls (never touched) rendered as a large number instead of a separate state; those are the deals that matter most |
| Touch concentration | share of activities on the top 20% of opportunities | rep | all logged activities | reading a high value as bad; late-stage focus is often correct |

## Meetings

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Meetings booked | meeting records created in the period | rep × period | — | counting reschedules as new bookings |
| Meetings held | meeting records with a past date and a held/completed status | rep × period | — | counting booked meetings as held; no-shows run materially high in outbound motions |
| Meeting-held rate | held ÷ booked | rep × period | meetings booked **in the same period** | booking and holding counted in different periods, so the rate drifts around period boundaries — cohort the bookings |
| Meetings per opportunity created | meetings held ÷ opportunities created | rep × period | opportunities created | mixing SDR-booked and AE-held meetings without deciding whose number it is |

Where the held/completed status is not maintained, held and booked are
indistinguishable. Say that rather than reporting bookings as meetings.

## Email and response

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Contacts emailed | distinct contacts receiving ≥1 email | rep × period | — | counting emails instead of contacts |
| Response rate | distinct contacts who replied ÷ distinct contacts emailed | rep × period | **contacts**, not sends | dividing replies by emails sent, which falls mechanically as sequences lengthen |
| Reply latency | median hours from send to reply | rep | replied threads | the mean, dragged by a tail of replies weeks later; and unavailable from Salesforce `Task` alone, because `ActivityDate` is a date with no time component |
| Positive reply rate | replies classified positive ÷ contacts emailed | rep × period | contacts emailed | an unvalidated classifier over free text; state the rule and its sampled accuracy or do not report the split |

## Multithreading

```
Multithreading(opportunity) = distinct contacts with ≥1 ACTIVITY on the opportunity
Single-threaded share       = opportunities with multithreading = 1
                              ÷ open opportunities
```

- **Grain:** opportunity.
- **Activity, not association.** Associating five contacts to a deal costs
  nothing and means nothing. Distinct contacts with a logged interaction is the
  metric.
- **Report the distribution**, not the mean: "62% of open enterprise deals are
  single-threaded" drives a behaviour; "2.4 contacts per deal" does not.
- Where roles are captured (`OpportunityContactRole.Role`), report multithreading
  by role coverage instead — reaching three people in the same function is not
  multithreading.
- **Strongest activity-side B2B signal**, and the hardest to game, which is why
  it survives as a coaching metric where call counts do not.

## Sequences and cadences

```
Entered(sequence)     = distinct contacts entering
Reply rate            = distinct contacts replying at any point ÷ entered
Step N reply rate     = distinct contacts replying attributed to step N
                        ÷ distinct contacts who RECEIVED step N
Meeting rate          = distinct contacts booking a meeting attributed to the
                        sequence ÷ entered
Completion rate       = contacts completing all steps ÷ entered
Early-exit rate       = contacts exiting before the last step ÷ entered
```

Rules that change the numbers:

1. **Denominators are contacts.** Sends are not people: a five-step sequence to
   100 contacts produces up to 500 sends, and any rate divided by sends
   penalises length mechanically.
2. **Declare the post-sequence attribution rule.** "Credit the last step
   delivered within N days of the reply" and "credit the sequence within N days
   of exit" give different step-level pictures. Keep N constant across any
   comparison.
3. **Exited ≠ completed.** Exiting on a reply is the goal. Completing all steps
   in silence is not. Never sum them, never read exit as failure.
4. **Per-step decline is expected**, because step N's audience is by selection
   the people who ignored steps 1 to N−1. Compare step rates across sequences at
   the same step index, not across steps within one sequence.
5. **A/B comparisons need equal exposure windows.** A variant launched later has
   had less time to accumulate replies; cohort by entry date and compare at a
   common horizon.

## Relating activity to outcomes

Every one of these carries the non-causality statement, and the reverse-causal
direction named.

| Analysis | Shape | What it cannot claim |
|---|---|---|
| Activity quartile vs win rate | quartile reps or deals by activity, compare outcomes | that activity caused the difference; reps invest in deals already going well |
| Multithreading vs win rate | bucket opportunities by distinct engaged contacts | same; engaged buyers produce contacts as well as the reverse |
| Time-to-first-touch vs conversion | median hours from lead create to first activity, by outcome | speed is confounded with lead quality and routing priority |
| Activity mix vs outcome | share of meetings/calls/email by outcome | mix is confounded with deal stage and segment |

**The honest framing in every case:** deals that won had more of X. Where the
commercial decision turns on causality — an activity quota, a headcount case,
a tooling purchase — say plainly that only an experiment settles it, and route
to `incrementality-testing`.
