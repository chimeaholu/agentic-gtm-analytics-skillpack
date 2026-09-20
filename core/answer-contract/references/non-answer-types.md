# The five non-answer types, worked

Each section gives the trigger, the correct output, and the wrong output that an
unconstrained agent produces instead.

---

## `unavailable`

**Trigger.** The source cannot answer. The field is not in the schema, the
object is not exposed, the credential cannot read it, or the platform has no
such API.

**Worked case.** A user asks for marketing-attributed pipeline from a marketing
automation platform that has no reporting API. The platform exposes activity
records and lead records and nothing else.

Correct:

> The platform has no reporting API, so its own attributed-pipeline number
> cannot be retrieved. What is retrievable is the raw activity stream and lead
> records, from which an independently computed version can be built. That
> number will not match the platform's internal report, because the platform
> applies undocumented de-duplication and bot filtering that cannot be
> reproduced.
>
> To get the platform's own number you need a human to export it from the UI, or
> the separate analytics licence that ships the dashboards.

Wrong:

> Marketing-attributed pipeline was 1.2M.

The wrong version was produced by summing a similarly-named field, which is the
specific failure this type exists to prevent. Two substitutions to refuse by
name:

- **A similarly-named field in the same system.** Opportunity `Amount` is not
  weighted pipeline. `sessions` is not `users`. `clicks` is not `link_clicks`.
- **An adjacent system's object.** The CRM's deal count is not the ad platform's
  conversion count, even when they are usually close.

**Always name the administrative change.** "Grant the integration user Read on
the Campaign Member object" is actionable. "Insufficient permissions" is not.

---

## `partial`

**Trigger.** A multi-leg request where some legs succeed.

**Worked case.** Spend across five ad platforms. Four return. The fifth returns
an empty `elements` array, which on that platform is indistinguishable between
"no activity" and "no read access".

Correct:

> Spend across the four platforms that returned was 84,300 USD for the window.
> Breakdown below.
>
> The fifth platform returned an empty result. On that platform an empty result
> means either no activity or no read access for this credential, and the API
> does not distinguish them. Check account access directly before concluding
> spend was zero. If there was spend, the 84,300 is low by that amount.

Wrong, version one:

> I could not complete the request because one platform failed.

Wrong, version two:

> Total spend was 84,300 USD.

The first erases four platforms of successful evidence. The second silently
treats a possible access failure as a zero. **An optional failure must never
erase successful evidence, and a failed leg must never be rendered as zero.**

Always state the direction the missing leg would move the total: up, down, or
unknown.

---

## `lower_bound`

**Trigger.** A cap was hit.

**Worked case.** A CRM report API that caps at 2,000 rows with no pagination,
returning a flag that says whether all data was included.

Correct:

> At least 2,000 opportunities match. The report API caps at 2,000 rows with no
> pagination and the response flag confirms the cap was hit, so this is a lower
> bound, not a count.
>
> The aggregate figures in that same response are computed over the full result
> set and are exact; only the detail rows are truncated. So the *total value* of
> 4.1M is correct even though the row count is not.
>
> For the exact count and the full rows, the report API is the wrong surface:
> query the objects directly through the bulk API, which has no such ceiling.

Wrong:

> There are 2,000 opportunities.

The subtlety worth teaching: on that platform the totals and the rows have
different truthfulness in the same response. Do not downgrade the whole response
when only part of it is capped, and do not trust the rows because the totals
looked right.

---

## `ambiguous`

**Trigger.** Two defensible readings, materially different numbers.

**Worked case.** "What was our conversion rate last month?" with no grain given.

Correct:

> Two readings, both computable:
>
> - **Session conversion rate: 2.4%.** Converting sessions over all sessions.
>   This is what the web analytics platform shows by default.
> - **Visitor conversion rate: 3.9%.** Converting users over all users. Higher
>   because returning visitors convert on a later session than the one that
>   brought them.
>
> Use the session rate for landing-page and campaign work, because the decision
> is about a single visit. Use the visitor rate for funnel and budget work,
> because the decision is about a person. I would report the session rate here,
> since the question followed a campaign question.

Wrong:

> Do you mean session conversion rate or visitor conversion rate?

A clarification question in place of an answer costs a turn and teaches the user
the tool is slow. Answer both, state the choice, move on.

---

## `no_data`

**Trigger.** A valid query against a source that could have held rows returns
none.

**Worked case.** A campaign performance query returns a well-formed response
with an empty data array.

Before concluding `no_data`, run three checks, because on several platforms a
clean empty response has three different causes:

1. **Does the entity exist?** Verify the campaign ID resolves. A wrong ID
   returns empty, not an error, on more than one platform.
2. **Does the window postdate the entity?** A timeframe that predates the
   campaign's creation returns empty legitimately.
3. **Is the metric applicable?** A conversion metric on a campaign with no
   conversion tracking configured returns empty rather than zero.

Correct:

> No events in the window. The campaign ID resolves and the campaign was live
> from the 3rd, so the window is valid and this is a genuine zero for the
> queried event, not a retrieval failure.

Wrong:

> Performance was zero.

Said without the three checks, that sentence is a guess wearing a number.

---

## The disposition table

| Situation | Type | Never |
|---|---|---|
| Field not in schema | `unavailable` | substitute a similar field |
| Credential cannot see the object | `unavailable` | report the visible subset as the total |
| 4 of 5 sources returned | `partial` | fail the whole request |
| Row cap hit | `lower_bound` | report the cap as a count |
| Two readings of the question | `ambiguous` | ask instead of answering |
| Valid query, zero rows, entity verified | `no_data` | report as a performance finding without the checks |
| Overlapping cross-platform sum | **not a non-answer** | withhold it; annotate and ship it |

The last row is the one that matters most. A computable-but-misreadable number
is never a non-answer. It gets the annotated-total treatment in
`comparability-rules`.
