# The cost model — estimate before you issue

Amplitude does not meter requests. It meters **cost**, and a single well-formed query can
exceed the entire five-minute budget on its own. Estimating first is a query-construction
step here, not an optimisation.

## The formula

```
cost = (#days) × (#conditions) × (query-type cost)
```

where **conditions = segments + filters**.

**Preset query-type costs:**

| Query type | Cost |
|---|---|
| **Retention** | **8** |
| **Funnel** | **2 × events + 4 per group-by** |
| **Sessions** | **4** |

## The budgets

| Bucket | Limit |
|---|---|
| Concurrent requests | **5** (10 for User Activity / User Search) |
| **Cost per 5-minute window** | **1,000** |
| Cost per hour | **108,000** |
| User Activity / User Search | **360 queries/hour**, separate bucket |

## The worked example that cannot run

**A 90-day retention query with 3 segments:**

```
90 days × 3 conditions × 8 (retention) = 2,160
```

**2,160 against a 1,000-per-5-minutes limit. It cannot succeed, and no amount of retrying
changes that.** An agent that issues it, receives a 429, and retries with backoff will
retry forever.

**Compute the estimate before issuing.** Then either narrow or warn.

```python
QUERY_COST = {"retention": 8, "sessions": 4}

def estimate_cost(query_type, days, segments=0, filters=0, events=0, group_bys=0):
    conditions = max(segments + filters, 1)
    if query_type == "funnel":
        base = 2 * events + 4 * group_bys
    else:
        base = QUERY_COST[query_type]
    return days * conditions * base

def check_budget(cost, window_budget=1000):
    if cost > window_budget:
        raise ValueError(
            f"estimated cost {cost} exceeds the {window_budget} per-5-minute budget; "
            f"narrow the date range or reduce segments"
        )
```

## Narrowing a query that is over budget

In order of how much the user loses:

| Lever | Effect on the example | What the user loses |
|---|---|---|
| **Shorten the range** | 30 days × 3 × 8 = **720** ✓ | a shorter window |
| **Drop a segment** | 90 × 2 × 8 = 1,440 ✗ (still over) | one comparison |
| **Both** | 45 × 2 × 8 = **720** ✓ | window and one comparison |
| **Run segments sequentially** | 90 × 1 × 8 = **720** each ✓ | wall-clock time, 3 windows |

**Sequential segments is usually the right answer** — it preserves the full range and the
full comparison, and costs only time. Say that you are doing it and roughly how long it
will take.

## Say what it costs before you spend it

> "A 90-day retention with three segments estimates at 2,160, which is over the
> 1,000-per-five-minutes ceiling. I'll run the three segments as separate queries across
> about fifteen minutes, which preserves the full window."

That sentence prevents the two bad outcomes: an agent silently narrowing the analysis, and
an agent stuck in a retry loop.

## Throttling is bursty, not gradual

**You get 429s in bursts rather than a gradual slowdown**, so the first sign of trouble is
failure rather than latency.

**Retry with backoff *and* cost estimation, not naive retry.** A retry loop with no cost
model re-issues an impossible query indefinitely; a cost model without retry gives up on a
query that was merely unlucky with concurrency.

## The separate User Activity bucket

`/api/2/useractivity` and `/api/2/usersearch` have **their own 360-queries-per-hour bucket
and 10 concurrent**, separate from the cost budget.

So per-user lookups do not compete with analysis queries — useful when an analysis needs to
drill into specific users, and worth knowing before assuming everything shares one ceiling.

## Bulk export constraints

The Export API is a different shape again:

- `GET /api/2/export?start=YYYYMMDDTHH&end=YYYYMMDDTHH`
- returns a **zipped archive of JSON files, one event per line**
- **maximum queryable period 365 days**
- **hard 4 GB response limit** — over it you get a **400**
- **very large datasets return 504 timeouts**

**For anything genuinely large, Amplitude's own answer is the Amazon S3 export, not the
API.** Say so at planning time rather than after a 504.

**Latency:** data is available within roughly 2 hours of receipt, so a query for the last
hour is legitimately incomplete.
