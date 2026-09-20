# Authoring insights and dashboards in PostHog

This is the one platform in v1 where "the agent built you a dashboard" is a true sentence.
That makes it the demo path, and it makes an unverified artefact the worst possible
deliverable: a dashboard that exists but renders an error is worse than an answer in chat.

Everything here is a **write**. Route it through `write-gate` first, name the project and
the object being created, and get explicit approval. Creating a new insight on a new
dashboard is additive and low blast radius. **Editing or deleting an existing insight or
dashboard is not** — other people's saved views and subscriptions point at those objects.
Default to creating new objects rather than mutating existing ones.

Required scopes: `insight:write`, `dashboard:write`. Read-only scopes will 403 here, which
is the correct behaviour, not a bug to route around.

## Order of operations

1. Run the query first over `POST /api/projects/{project_id}/query/` and confirm the
   numbers with the user. Never save an insight whose output you have not seen.
2. Create the dashboard.
3. Create each insight with the dashboard id attached.
4. Round-trip every insight.
5. Hand back the dashboard URL plus the numbers in chat. The chat answer is the
   deliverable; the dashboard is the durable copy.

## Create a dashboard

```bash
curl -s -X POST "$POSTHOG_HOST/api/projects/$PROJECT_ID/dashboards/" \
  -H "Authorization: Bearer $POSTHOG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
        "name": "Acquisition overview",
        "description": "Built by agent on request. Definitions in the insight descriptions."
      }'
```

The response carries the numeric `id`. Keep it.

## Create an insight backed by HogQL

```bash
curl -s -X POST "$POSTHOG_HOST/api/projects/$PROJECT_ID/insights/" \
  -H "Authorization: Bearer $POSTHOG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
        "name": "Daily active users, last 30 days",
        "description": "uniqExact(person_id) per day, project timezone. Person merges can change history.",
        "dashboards": [123],
        "query": {
          "kind": "DataVisualizationNode",
          "source": {
            "kind": "HogQLQuery",
            "query": "SELECT toStartOfDay(timestamp) AS day, uniqExact(person_id) AS dau FROM events WHERE timestamp >= now() - INTERVAL 30 DAY GROUP BY day ORDER BY day"
          }
        }
      }'
```

For a native trends insight rather than a SQL table, the source is a `TrendsQuery` inside
an `InsightVizNode`:

```json
{
  "name": "Pageviews, DAU basis",
  "dashboards": [123],
  "query": {
    "kind": "InsightVizNode",
    "source": {
      "kind": "TrendsQuery",
      "series": [{"kind": "EventsNode", "event": "$pageview", "math": "dau"}],
      "dateRange": {"date_from": "-30d"}
    }
  }
}
```

**Two version notes.** Insights historically stored a `filters` blob and now store a
`query` blob; older instances may only accept `filters`. And the exact node kinds evolve.
Neither is a reason to guess: `GET /api/projects/{project_id}/insights/{existing_id}/` on
an insight a human built in the UI returns the exact schema that instance accepts. **Copy
the shape from a working object rather than from memory or from this file.**

## The round-trip test, which is not optional

The API accepts a `query` blob **without the validation the UI applies**, so it is
possible to create an insight that returns rows over the API and cannot be rendered in the
product. The research names this explicitly and it is the most likely way an authoring
path ships broken.

For every insight created:

1. `GET /api/projects/{project_id}/insights/{id}/` and confirm the object exists with the
   query you sent.
2. `GET /api/projects/{project_id}/insights/{id}/?refresh=true` (or the instance's
   equivalent refresh parameter) and confirm it returns a result rather than an error
   payload.
3. Confirm the insight appears on the dashboard: `GET
   /api/projects/{project_id}/dashboards/{dashboard_id}/` and look for the insight in the
   returned tiles.
4. If any step fails, delete the half-built object rather than leaving it. A broken
   insight on a shared dashboard is a support ticket for someone else.

## Layout

Tiles get default positions. Repositioning is done through the dashboard's tile layout
structure, whose shape is version-dependent. Accept the defaults unless the user asks for
a specific arrangement, and if they do, read the layout of an existing hand-built
dashboard before writing one.

## What to write in the description field

Every authored insight carries its own caveats, because the dashboard will outlive this
conversation and the next reader will not have the chat. Put in `description`:

- the metric definition in one line, including the distinct-count function used
- the timezone basis (project timezone, or the `toTimeZone` override used)
- the known instability, named plainly: identity merges can change historical person
  counts, person properties are current-state, deleted persons persist in `events`
- that an agent created it, and when

This is `provenance-block` applied to a durable artefact rather than to a chat message.
