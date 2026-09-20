# Fitting an analysis inside 60 calls per hour

Mixpanel's Query API allows **5 concurrent requests and 60 queries per hour, and Mixpanel
states these limits cannot be raised.** Treat the hour's budget the way you would treat a
fixed cash allowance: plan the spend, announce it, and do not improvise.

## The consolidation rule

Mixpanel's own guidance is to **consolidate several filtered queries into one segmentation
query** rather than issuing them separately. This is the single highest-leverage habit on
this platform.

**Wrong — 10 calls, one sixth of the hour, gone:**

```
segmentation?event=Signup&where=properties["plan"]=="free"
segmentation?event=Signup&where=properties["plan"]=="pro"
segmentation?event=Signup&where=properties["plan"]=="team"
...
```

**Right — 1 call:**

```
segmentation?event=Signup&on=properties["plan"]
```

The same collapse applies to funnels (one call with a breakdown beats one call per
segment) and to retention.

## A worked budget

A typical "how is activation doing" analysis, planned rather than improvised:

| Call | Purpose | Running total |
|---|---|---|
| 1 | `cohorts/list` — discover what exists | 1 |
| 2 | `segmentation` with `on` breakdown — signups by plan by week | 2 |
| 3 | `funnels` with breakdown — activation funnel by plan | 3 |
| 4 | `retention` — week-1 retention by plan | 4 |
| 5 | `insights` by `bookmark_id` — the board the stakeholder actually looks at | 5 |

**Five calls.** That leaves 55 for iteration and for the inevitable follow-up questions.
The same analysis conducted conversationally — one call per plan per metric — costs 30 to
40 and leaves nothing.

## Announce the spend

Before a multi-query analysis, say what it will cost:

> "This is about five Query API calls. The project's hourly ceiling is 60 and cannot be
> raised, so I'll run one wide breakdown per question rather than iterating."

That sentence prevents the two bad outcomes: a user who does not understand why the agent
suddenly stopped working, and an agent that silently burns the budget on exploration.

## Cache for hours, not minutes

Mixpanel data for a closed day does not change much, but **late-arriving events are
inserted retroactively**, so nothing is truly frozen. The practical policy:

| Window | Cache for |
|---|---|
| Today / intraday | 15–30 minutes, and label the answer provisional |
| Yesterday | 2–4 hours |
| Closed weeks and months | the session, or longer |

Re-running the same segmentation call twice in one conversation is a budget error, not
thoroughness.

## What does not count against the 60

- **Raw Data Export** has its own bucket: 100 concurrent, 60/hour, 3/second, and is a
  long-running streaming GET rather than a job to poll.
- **Lexicon** has its own: 5 requests/minute.

So schema discovery and bulk extraction do not compete with analysis calls — but Raw
Export is a poor substitute for a query, because Lexicon computed properties do not exist
in it.

## When 60/hour is genuinely not enough

Say so, and name the real answer: **Data Pipelines**, Mixpanel's scheduled export to
BigQuery, Snowflake, S3 or GCS. It is a paid add-on. For any workload that wants to ask
many questions repeatedly, exporting once to a warehouse and querying there is the correct
architecture, and the 60/hour ceiling is the reason to say so early rather than after
three rate-limit errors.
