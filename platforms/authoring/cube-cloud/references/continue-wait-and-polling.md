# `Continue wait`, orphaning, and concurrency that looks like slowness

Cube's async idiom is unusual and it is the single most common way an integration against
this platform fails silently. Read this before writing any client loop.

## The shape of the response

A long-running query returns:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"error": "Continue wait"}
```

**HTTP 200. An `error` key. No `data` key.** Every naive client in existence branches on
the status code, finds 200, looks for `data`, finds nothing, and reports "no results".

## The correct loop

```python
def cube_load(session, url, jwt, query, max_wait_s=300, interval_s=1.0):
    """Re-send the IDENTICAL query until Cube returns data."""
    body = {"query": query}
    deadline = time.monotonic() + max_wait_s
    while True:
        r = session.post(f"{url}/load", json=body,
                         headers={"Authorization": jwt}, timeout=60)
        r.raise_for_status()
        payload = r.json()
        # Check the body BEFORE trusting the status code.
        if payload.get("error") == "Continue wait":
            if time.monotonic() > deadline:
                raise TimeoutError("Cube query still queued after max_wait_s")
            time.sleep(interval_s)
            continue
        if "error" in payload:
            raise RuntimeError(f"Cube query failed: {payload['error']}")
        return payload
```

Three rules encoded above, each of which matters:

1. **Check `payload["error"]` before `payload["data"]`.** Status code is not the signal.
2. **Re-send the identical query body.** Cube keys the in-flight query on its content. A
   changed query is a new query.
3. **Bound the wait.** A query that never completes should surface as a timeout you can
   report, not an infinite loop.

## Orphaning

**Unpolled queries are marked orphaned and dropped.** If an agent fires a query, gets
`Continue wait`, and then moves on to a different question, the first query is discarded —
not queued, not completed in the background, not retrievable later.

The practical consequence for an exploratory agent: **do not fire and forget.** Either
poll a query to completion or accept that it produced nothing.

## Concurrency exhaustion disguised as slowness

Concurrency is bounded by `CUBEJS_CONCURRENCY` and by the underlying warehouse driver
pool. **Exceeding it does not return 429.** It returns **more `Continue wait`**.

So the symptom of "we launched twelve parallel agent queries" is not an error, it is
every query taking much longer. Diagnose it by:

- counting your own in-flight queries first — the simplest explanation is usually you
- checking whether the queries would be served by a pre-aggregation (`/v1/dry-run`);
  pre-aggregated queries do not consume warehouse pool slots
- serialising and re-measuring

**Do not respond to slow `Continue wait` by adding parallelism.** It makes it worse.

## Predicting cost before you spend it

Two free calls exist and an agent should use both before a wide sweep:

- **`POST /v1/sql`** returns the SQL Cube *would* generate, without running it. Read it.
  A query that generates a full table scan is visible here, not after the bill.
- **`/v1/dry-run`** validates the query and tells you **which pre-aggregation would serve
  it**. A query matched to a pre-aggregation is served from Cube Store in milliseconds and
  never touches the warehouse; an unmatched query bills the warehouse.

If the dry run shows no pre-aggregation match on a query you intend to issue repeatedly,
that is the moment to say so — either narrow the query to match an existing rollup, or
tell the user a rollup would make this cheap.
