# Segment as a schema oracle

This is the first of Segment's two genuine values to an analytics agent: **it tells you
what data exists and where it goes.** For a stack where five tools each have partial
visibility, that is the best answer available anywhere in the pack — and it is
configuration data, not metrics, so it is cheap and reliable.

## What to read, and what each answers

| Public API surface | Answers |
|---|---|
| **Tracking Plan** | which events and properties are *supposed* to exist, with types |
| **Sources** | where data comes from — website, mobile, server, cloud sources |
| **Destinations** | which tools receive it |
| **Destination filters** | which events are withheld from a given destination |
| **Transformations** | how events are rewritten in flight |
| **Warehouses / Data Lakes** | where the raw copy lands |
| **Audit Trail** | who changed any of the above, and when |

## The question this actually answers

> "We want to analyse activation. Which events exist, and which tools have them?"

Answering that from the tools themselves means asking five vendors and getting five partial
answers. Answering it from Segment means reading the Tracking Plan for what should exist,
the source list for where it originates, and the destination-plus-filter graph for who
receives it.

**Then go to the warehouse for the numbers**, because Segment cannot count.

## Plans are reported, not enforced

**Tracking Plan violations are reported, not enforced, by default.**

So the plan describes **intent**. It is not evidence about the data:

- **A plan can be pristine while the data is not.**
- Events not in the plan can still flow, and frequently do.
- Property types in the plan may not match what is actually sent.

**Cross-check the plan against the warehouse's actual `tracks` tables** before presenting
the plan as a description of reality. The gap between them is itself a useful finding and
is often the real answer to "why is this metric weird".

## Role narrows the answer silently

**A read-only token silently omits resources rather than erroring.**

So an inventory built with a narrow token **under-reports**, and the response looks
entirely normal — no error, just a shorter list.

**Compare the source and destination counts against what the customer describes.** If the
agent sees four destinations and the team talks about seven, that is a token-role question,
not a workspace question.

## Regions do not join

**US and EU workspace endpoints differ.** Establish the region before the first call. A
multi-region customer has separate workspaces, and their schema is not automatically
consistent between them.

## Configuration CRUD exists, and some of it is Tier A

An agent can build a **pipeline**. It cannot build a **report**.

The configuration surfaces — sources, destinations, tracking plans, functions, audiences,
Reverse ETL connections — are full CRUD, and all of it routes through `write-gate`:

| Change | Tier | Why |
|---|---|---|
| **Tracking-plan change that drops or renames events** | **A** | changes what is recorded everywhere downstream, retroactively invisible |
| Adding or editing a destination filter | **A-adjacent** | silently changes what a downstream tool receives |
| Creating a source or destination | C | changes shared pipeline configuration |
| Creating an audience | C | shared definition |

**The tracking-plan case deserves the Tier A treatment explicitly.** Renaming an event
does not error anywhere; it simply means that every downstream query filtering on the old
name returns nothing from that moment on, and every historical comparison breaks.

## Reading the graph efficiently

**Limits are per-endpoint and not uniform** — observed examples range from **250 requests
per minute** on the Reverse ETL sync-status endpoint to **20 per minute** on other Reverse
ETL endpoints.

**Read `X-RateLimit-Consumed`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` from the
response and back off on those rather than a hard-coded constant.**

Pagination is cursor-based on `pagination.next`, with `pagination.count` capped per
endpoint.

Configuration data changes rarely, so **cache the whole graph for the session**. There is
no reason to re-read the destination list twice in one conversation.

## The Profiles API — a lookup, not a query

**The Profiles API answers per-profile questions**: traits, external IDs, event history,
audience and computed-trait membership.

**It is a lookup API, not an aggregate query API — you ask about one profile at a time.**

| Good use | Bad use |
|---|---|
| "What do we know about this account's champion?" | "How many users have trait X?" |
| "Which audiences is this user in?" | "How big is this audience?" |
| "What did this specific user do?" | "How many users did X last week?" |

**Useful for account research, useless for aggregates.** An agent that loops the Profiles
API to build a count has chosen the wrong tool and will exhaust the rate limit long before
it finishes.
