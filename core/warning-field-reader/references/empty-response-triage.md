# Empty response triage

A clean, well-formed response with no rows has at least six distinct causes.
Five of them are not "performance was zero". Reporting zero without triage is
the most common way an analytics agent invents a finding.

## The decision tree

```
Empty result
├─ Is there an explicit reason field?
│    GA4 emptyReason → read it, report it verbatim. Done.
├─ Could this be an access boundary rather than an absence?
│    LinkedIn empty elements  → indistinguishable. Verify account access. → partial
│    Looker field absent      → permission-shaped blindness. Probe. → unavailable
│    Salesforce fields absent → field-level security omission. → unavailable
├─ Could this be an async placeholder rather than a result?
│    Cube {"error":"Continue wait"}     → resend identical query
│    PostHog query_status.id present    → poll GET /query/:id/
│    Meta report_run_id, async_status   → poll to completion
├─ Do the entities in the filter actually exist?
│    Validate IDs resolve. A wrong ID returns empty, not an error, on several platforms.
├─ Does the window postdate the entity's creation?
│    A timeframe before a campaign existed returns empty, legitimately.
├─ Does the metric apply to this object?
│    A conversion metric on an object with no conversion tracking returns empty, not zero.
└─ All checks pass → no_data. A genuine zero, reportable as data.
```

## Per-platform notes

| Platform | Empty means | Distinguishable? |
|---|---|---|
| GA4 | read `emptyReason` | yes, if you read the field |
| LinkedIn | no activity **or** no read access | **no.** Verify access out of band |
| Klaviyo | filter matched nothing, metric inapplicable, or timeframe predates the campaign | not from the response. Validate IDs and dates |
| Google Ads | **rows with zero impressions are omitted entirely** | a missing campaign is usually a campaign with no impressions. Query the resource without metrics to confirm existence |
| HubSpot | archived records are excluded from lists by default and from search always | not from the response. Pass `?archived=true` on lists |
| Salesforce | row-level security, or genuinely no matching records | check the running user before concluding |
| Cube | may be `Continue wait`, which is not empty at all | yes, by checking the error field |
| PostHog | may be an async handle | yes, by checking `query_status` |

## The Google Ads case, spelled out

Google Ads omits zero-impression rows. So:

- A campaign missing from a daily performance query did **not** necessarily stop
  existing, get paused, or lose its budget. It probably had no impressions that
  day.
- A "campaign count" from a metrics query is a count of campaigns **with
  impressions**, not a count of campaigns.
- To distinguish, query the `campaign` resource **without** metrics, which
  returns entities regardless of activity, and join.

And the mirror image: `status = 'REMOVED'` entities persist in the API forever
while the UI hides them. So the same API that under-reports on one query
over-reports on another. Both are the reason a user says "your number doesn't
match the interface".

## What to write when triage ends in `no_data`

> No conversions recorded for that campaign in the window. The campaign ID
> resolves, it was live from the 3rd, and conversion tracking is configured, so
> this is a genuine zero rather than a retrieval gap.

Three checks, one sentence. Without them the same sentence is a guess.
