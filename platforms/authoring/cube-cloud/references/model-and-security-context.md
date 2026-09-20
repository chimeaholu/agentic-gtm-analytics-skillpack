# What `/v1/meta` hides, and why your numbers may already be filtered

Cube's security model is the cleanest in the pack: the JWT payload *is* the security
context, so an agent's identity determines its visibility by construction rather than by
convention. The cost of that design is that an agent cannot see its own constraints.

## Three things the security context does to your results

| Mechanism | Effect | Visible in the response? |
|---|---|---|
| `public: false` on a cube or view | the object is absent from `/v1/meta` | **no** |
| `query_rewrite` | **injects mandatory filters into every query** | **no** |
| `COMPILE_CONTEXT` | compiles a different model per tenant | **no** |

**`query_rewrite` is the one that changes numbers.** It can add a tenant filter, a date
floor, a region restriction — anything — and the response looks exactly like an unfiltered
response. There is no field to read. The only way to know is to read the data-model source
files, or to ask the person who wrote them.

**The operational rule:** state the identity the query ran under in the provenance block,
every time. "Total pipeline is 4.2M, queried as the analytics service account" is a
reproducible claim. "Total pipeline is 4.2M" is not.

## Diagnosing a suspiciously small model

If `/v1/meta` returns far less than the user describes:

1. It is almost certainly the security context, not an empty deployment.
2. Compare the view list against what the human sees in the Cube Cloud UI.
3. Check whether the JWT carries the claims the model's `COMPILE_CONTEXT` expects — a
   missing tenant claim frequently compiles an empty or minimal model rather than erroring.

Do not report "this deployment has no revenue model" on the strength of a narrowed
`/v1/meta`.

## Dynamic models are returned resolved

Cube supports templated and dynamically generated data models. `/v1/meta` returns **the
resolved output for the current context**, not the template that produced it. So:

- an agent reading `/v1/meta` sees today's shape for this identity
- the generating logic — loops, conditionals, tenant branching — lives only in the source
  files
- a model that looks inconsistent between two identities may be entirely correct

## Measure types that are not what they look like

Read `type` from `/v1/meta` before quoting a measure:

- **`countDistinctApprox` is an HLL estimate, not a count.** Reporting "1,247 accounts"
  from one is reporting an estimate as a count. Say "approximately" and say why.
- **`format: currency` is presentation only.** It tells you nothing about the unit and
  performs no conversion.

## Pre-aggregation freshness, which is the other silent number-changer

A query served from a pre-aggregation returns the rollup's data, **with no indication in
the response that it did**. An hour-old rollup returns an hour-old answer that looks live.

Before claiming freshness on any Cube number:

- call `getPreAggregationStatus` (MCP) or read `lastRefreshTime`
- or run `/v1/dry-run` to learn whether a pre-aggregation will serve the query at all

And note the inverse trap: **`ungrouped: true` disables most pre-aggregations.** A query
that was free and instant becomes a warehouse scan, and the only visible symptom is that it
got slow.
