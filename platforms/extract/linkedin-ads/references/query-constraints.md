# `adAnalytics` constraints — the four that change the architecture

One endpoint, and four constraints that decide how any integration against it must be
built. None of them are negotiable and all four fail silently or confusingly.

## 1. No pagination, 15,000 elements

**`adAnalytics` does not support pagination.** LinkedIn states this explicitly. A `paging`
object appears in responses, but the analytics finders cannot be paged — **do not write a
paging loop against it.**

**The response is limited to 15,000 elements.** Over that, you re-slice.

```python
def sliced_analytics(client, base_params, start, end, max_elements=15000):
    """No pagination exists. Slice the date range until each response fits."""
    out, stack = [], [(start, end)]
    while stack:
        s, e = stack.pop()
        resp = client.get_ad_analytics({**base_params, **date_range(s, e)})
        els = resp.get("elements", [])
        if len(els) >= max_elements and s != e:
            mid = s + (e - s) / 2
            stack.extend([(s, mid), (mid + one_day, e)])
            continue
        out.extend(els)
    return out
```

Slice by date range first; slice by facet (campaign group, campaign) second.

## 2. Omitting `fields` gives you almost nothing

**Omit `fields` and you get only `impressions` and `clicks`** — a plausible-looking,
near-empty response rather than an error.

**Maximum 20 metrics per request.**

So the correct pattern is: name exactly the metrics the question needs, enforce the cap
client-side, and split into two requests if the question needs more than 20. Never rely on
a default.

This is also the lever for the rate limit — see below.

## 3. Throttling is data-volume-based

**45 million metric values per 5-minute interval**, where a metric value is one metric
multiplied by one returned record. Breaching returns **429 TOO_MANY_REQUESTS**.

The mitigation is **fewer `fields`**, not fewer requests. An agent that responds to a 429
by adding sleep between identical wide requests has misread the limit.

Rough arithmetic before a sweep:

```
metric_values ≈ (#metrics) × (#records returned)
```

A 20-metric query across 3,000 campaign-days is 60,000 values. Comfortable. A 20-metric
query with a demographic pivot across a large account can be orders of magnitude more.

## 4. URI length — 414 is a real operational error

Everything is a GET query string, and URN lists get long. **414 REQUEST_URI_TOO_LONG is a
real operational error, not an edge case.**

**Use LinkedIn's query-tunnelling workaround: POST with `X-HTTP-Method-Override`** when the
URL exceeds a safe threshold.

```python
def get_or_tunnel(session, url, params, headers, threshold=1800):
    encoded = urlencode(params, safe="():,")
    if len(url) + len(encoded) < threshold:
        return session.get(f"{url}?{encoded}", headers=headers)
    return session.post(url, data=encoded,
                        headers={**headers,
                                 "X-HTTP-Method-Override": "GET",
                                 "Content-Type": "application/x-www-form-urlencoded"})
```

## The demographic restrictions, which change the query shape

Professional demographic pivots are **heavily restricted and approximate**:

- only the **top 100 demographic values per creative per day**
- **values with fewer than 3 events are dropped**
- values for low-engagement ads are **withheld entirely**
- **carousel metrics unsupported**

**LinkedIn's own docs warn that daily sums will not equal the period total, and campaign
sums will not equal account totals.**

**Their explicit guidance is the module's default query shape: query at the highest level
and over the full period, rather than querying finely and summing.** A demographic
breakdown assembled from daily campaign-level queries is wrong in a way that no amount of
care in the summation fixes.

**Metrics that return nothing rather than erroring under a `MEMBER_*` pivot:**
`conversionValueInLocalCurrency`, `cardImpressions`, `cardClicks`,
`viralCardImpressions`, `viralCardClicks`, `approximateMemberReach`.

## `timeGranularity=ALL` outside the daily window

**Daily-granularity data is retained only 6 months.** Outside that window,
**`timeGranularity=ALL` silently rounds dates to month boundaries and includes the whole
month.**

A query for 15 January to 15 July returns 1 January to 31 July, **without telling you**.
This produces wrong numbers that look right — the worst available failure shape.

**Check the date range against the 6-month daily window before trusting any date-bounded
aggregate**, and when the range crosses it, say that the boundaries were rounded.

## Retention summary

| Data | Retention |
|---|---|
| Performance data | 10 years |
| **Professional demographics** | **2 years** |
| **Daily granularity** | **6 months** |

A year-over-year daily comparison is impossible. Say so at planning time.

## URN resolution

**Everything is a URN and URNs are not human-readable** — `urn:li:organization:1111`,
`urn:li:geo:1`. Labelling a report needs a second round of calls against the Geo API and
the Organization API.

**Budget the extra calls and the extra rate limit, and cache resolutions** for the session
at minimum. A 200-row report with unresolved URNs is unreadable; a 200-row report that
costs 200 extra API calls to label is a rate-limit problem you created.

## Empty is ambiguous

**An empty `elements` array means either genuinely no activity or no read access, and these
are indistinguishable in the response.**

**Verify account access separately** — fetch the ad account entity itself — **before
reporting "no spend".** Reporting a client's campaigns as having spent nothing, when the
real cause was a scope or a Business Manager role, is the worst outcome available on this
platform.
