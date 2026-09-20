# Bulk Extract — not an optimisation, the only viable path

## The call-budget arithmetic that decides this

| Limit | Value |
|---|---|
| Daily REST calls per subscription | **50,000** (minimum allocation 10,000) |
| Daily reset | **12:00 AM CST** |
| Burst | **100 per 20 seconds, shared across all integrations on the instance** |
| Concurrency | **10 in-flight maximum** |

At 100 calls per 20 seconds — and Adobe advises staying under about **50** so you do not
starve the Salesforce sync and the webinar connector — the sustainable rate is roughly
**150 calls per minute**. The 50,000 daily budget is therefore about **five and a half
hours** of continuous calling, and that assumes nothing else is running.

A `/rest/v1/activities.json` page returns a bounded number of activities. **Streaming a
large subscription's activity history through it exhausts the daily quota long before it
finishes**, and the quota resets at midnight CST, not when you would like it to.

**So: above a few tens of thousands of rows, Bulk Extract is the only viable path. Decide
this before the first call, not after error 607.**

## The Bulk Extract lifecycle

```
POST /bulk/v1/{leads|activities|program/members}/export/create.json   → exportId
POST /bulk/v1/{...}/export/{exportId}/enqueue.json
GET  /bulk/v1/{...}/export/{exportId}/status.json                     → poll
GET  /bulk/v1/{...}/export/{exportId}/file.json                       → CSV
```

**Capacity:** 500 MB or more of extract capacity per day, with **2 executing plus 10 queued
jobs, inclusive**. Firing more does not make them run faster.

**The activity extract is capped to a 31-day date range per job.** A year of activity is
twelve or thirteen jobs, chained. Build the chunking into the plan and respect the queue
depth.

```python
def activity_windows(start, end, days=31):
    """Activity extracts are capped to a 31-day range per job."""
    cur = start
    while cur < end:
        nxt = min(cur + timedelta(days=days), end)
        yield (cur, nxt)
        cur = nxt
```

## Error 606 versus error 607 — different responses

| Error | Meaning | Response |
|---|---|---|
| **606** | burst limit — 100 per 20 seconds, **instance-wide** | back off, retry; **it may not be your fault** |
| **607** | daily quota exhausted | **stop and report**; it does not clear until midnight CST |

An agent that retries a 607 with exponential backoff will retry uselessly for hours. Read
the code.

And note the instance-wide dimension of 606: **your integration competes with the
Salesforce sync, the webinar connector and every consultant's ad-hoc script.** A 606 you
did not cause still requires you to back off, and a 606 *you* caused breaks their tools
too.

## The activity stream, and the token that expires

For incremental work where Bulk Extract is too heavy:

```
GET /rest/v1/activities/pagingtoken.json?sinceDatetime=2026-09-01T00:00:00-05:00
    → nextPageToken

GET /rest/v1/activities.json?nextPageToken=...&activityTypeIds=1,2,6,7
    → activities, nextPageToken, moreResult
```

Follow `nextPageToken` until **`moreResult`** is false.

**Tokens expire.** A long-running extraction must handle re-minting from the last processed
activity's timestamp rather than failing at hour six with what looks like an auth error.

**Get `activityTypeIds` from `GET /rest/v1/activities/types.json` at runtime.** Custom
activity types are instance-specific and the numeric IDs are not portable between
subscriptions. A hard-coded ID list from a previous engagement extracts the wrong
activities — silently, because the IDs are valid, just different.

## Drive the schema from `describe2`

**`/rest/v1/leads/describe2.json` at runtime, never a hard-coded field list.**

Two reasons, and the second is the dangerous one:

1. Custom fields vary per subscription.
2. **Fields the API user's role cannot see simply do not appear in `describe2` output.** So
   a field list that works under an admin's credentials returns partial data under the
   API-only user's, with no error. Diff `describe2` against what the marketer says exists
   when something is missing.

## Poll `deletedleads.json` at least as often as you extract

**Deleting removes a person from `/rest/v1/leads.json` entirely.**
**`GET /rest/v1/activities/deletedleads.json` is the only way to learn that a record was
removed.**

Without polling it on the same cadence as your extraction, **period-over-period counts
drift downward with no visible cause** — last month's cohort shrinks and nothing in any
response explains why.

## Incremental extraction on `updatedAt` pulls too much

**`updatedAt` churns for reasons unrelated to the marketer**: system processes, list
membership changes, score recalculations.

So incremental extraction keyed on it:

- **pulls far more than actually changed**, burning budget
- **cannot distinguish a meaningful edit from housekeeping**

There is no better key exposed. Plan for the over-pull, and do not present "records changed
since X" as a count of meaningful changes.

## Watch the quota with the telemetry endpoints

**`GET /rest/v1/stats/usage.json` and `/stats/errors.json` are API-quota telemetry, not
marketing metrics.** The naming misleads agents and humans alike.

Use them to track consumption against the 50,000 budget, and check `stats/errors.json`
before assuming a 606 was yours.
