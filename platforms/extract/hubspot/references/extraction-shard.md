# The 10,000-result cap, and the shard that gets past it

**Search hard-caps at 10,000 total results per query regardless of paging. Paging past
`after=10000` simply stops returning data** — no error, no warning, just an empty page.

**This is the single most common HubSpot extraction bug.** An agent pages naively, receives
exactly 10,000 records, aggregates them, and reports a number that is wrong by however much
the portal exceeds the cap. Nothing in the response says so.

## The keyset shard

Sort ascending on a monotonic property, take the last value from each page, and use it as a
greater-than filter for the next window.

```python
def extract_all(client, object_type, properties, page_size=200,
                sort_prop="hs_lastmodifieddate"):
    """Search caps at 10,000 results per query. Shard with a GT filter on a sorted key."""
    cursor_value, seen = None, 0
    while True:
        filters = []
        if cursor_value is not None:
            filters.append({"propertyName": sort_prop, "operator": "GT",
                            "value": cursor_value})
        body = {
            "filterGroups": [{"filters": filters}] if filters else [],
            "sorts": [{"propertyName": sort_prop, "direction": "ASCENDING"}],
            "properties": properties,
            "limit": page_size,
        }
        page = client.post(f"/crm/v3/objects/{object_type}/search", json=body)
        results = page.get("results", [])
        if not results:
            return
        for r in results:
            yield r
        seen += len(results)
        cursor_value = results[-1]["properties"][sort_prop]
        if len(results) < page_size:
            return
```

**Choice of `sort_prop`:**

| Property | Use when |
|---|---|
| `hs_lastmodifieddate` | incremental extraction; also lets you resume |
| `hs_object_id` | full extraction where modification churn would re-shuffle pages |

**`hs_lastmodifieddate` has a specific hazard** noted in the module gotchas: it churns for
reasons unrelated to a meaningful edit. For a *full* extraction that is fine — you just
need a stable ordering — but for an *incremental* one it pulls far more than actually
changed.

**Ties are the failure case.** If many records share the same `hs_lastmodifieddate` value
at a shard boundary, a strict `GT` skips them. On a portal with bulk-imported records
sharing a timestamp, sort on `hs_object_id` instead, which is unique.

## Throttle Search separately

**CRM Search is rate-limited separately from the general bucket, with a practical ceiling
around 4 to 5 requests per second per account.** Build a dedicated throttle for it.

The general buckets, for context:

| Tier | Burst | Daily |
|---|---|---|
| Free / Starter | 100 per 10s | 250,000 |
| Professional | 190 per 10s | 625,000 |
| Enterprise | 190 per 10s | 1,000,000 |

And one rule that catches aggressive retry logic: **error responses should stay under 5% of
total daily requests — HubSpot treats a high error ratio as abuse.** An agent hammering a
403 can get the portal flagged, which is a much worse outcome than a failed query.

## When to use the Exports API instead

**`POST /crm/v3/exports/export/async` → poll `.../tasks/{taskId}/status` → fetch a
short-lived signed download URL.**

This bypasses the 10,000 cap entirely and is the right tool whenever:

- you need the whole object, not a filtered slice
- the object count is large enough that sharding would take hours
- you need many properties per record (the shard pays for wide properties on every page)

**Export job counts per day are limited, and HubSpot does not publish one stable number
across tiers. Verify against the portal** rather than planning around an assumed figure.

The download URL is short-lived — fetch it promptly, and do not store it as a durable
reference.

## Planning the aggregation before the first call

Because **there are no aggregation primitives — no GROUP BY, no SUM, no COUNT-by-group** —
every HubSpot "report" is extract-then-aggregate-locally. Decide these four before you
start, and tell the user what you decided:

1. **Which objects and how many.** Get a rough count first; it determines shard versus
   export.
2. **Which properties.** Wide property sets cost on every page. Ask for what the
   aggregation needs, not everything.
3. **Which currency field.** `amount` or `amount_in_home_currency` — see
   `currency-and-dates.md`. This changes the answer, not just the formatting.
4. **Archived or not.** **Search never returns archived records at all**, and list
   endpoints exclude them unless you pass `?archived=true`.

A pipeline report over a large portal is a sharded-extraction engineering project. Saying
that at planning time is the job; discovering it after two hours is the failure.

## Read back by ID, not by search

**Search is eventually consistent; list and read-by-ID are not.** A record created or
updated seconds ago may not appear in `/search` yet.

Any write-then-verify pattern must read back by ID. An agent that creates a record and then
searches for it will intermittently conclude the write failed.
