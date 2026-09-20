# Pulse: the one real authoring surface — and lineage: when to leave Tableau

## What Tableau can and cannot author

| Ask | Available? |
|---|---|
| Compose a worksheet or dashboard from a spec | **No. There is no `POST /worksheets`.** |
| Generate `.twb` XML with an agent and publish it | Technically possible; a high-maintenance technique, not a product capability. Do not sell it. |
| Publish a workbook file the user already has | Yes, via REST `Publish Workbook` |
| **Create a Pulse metric definition** | **Yes — full CRUD** |
| **Create a Pulse metric from a definition** | **Yes** |
| **Subscribe humans to a Pulse digest** | **Yes** |
| Generate an insight bundle for a metric | Yes — `Generate Insight Bundle` |
| Refresh an extract | Yes, via REST extract-refresh tasks plus `Query Job` |
| Manage subscriptions to views | Yes — full CRUD |

**Say the first row plainly whenever someone asks for a Tableau dashboard.** The honest
alternative is: define the metric in Pulse, subscribe the humans, and deliver the numbers
into whatever surface the team already opens.

## A Pulse metric definition, in the shape that matters

A definition names:

- the **data source**
- the **measure** and its aggregation
- the **time dimension** that makes it a trend
- the **filterable dimensions** that let a human slice it

Creating one is a **Tier C write** under `write-gate` — it becomes a shared definition that
changes what an organisation means by a metric. Subscribing humans to a digest is
**Tier E**, because it sends.

Two configuration details that change the numbers and are easy to miss:

- **`custom_calendar`** — Pulse honours a fiscal calendar config, so "this quarter" may not
  be the calendar quarter.
- **the site's start-of-week setting** — `TRUNC_WEEK` and Pulse weekly comparisons both
  depend on it. **Two users can legitimately see a different "this week".**

## Extract freshness — the number-one reconciliation cause

**Extract versus live is invisible to the caller.** Two Metadata API fields are the only
way to know:

- **`hasExtracts`** — is this data source backed by an extract at all
- **`extractLastRefreshTime`** — when it last refreshed

**Report extract freshness alongside every Tableau number.** The typical dispute is: a
human hit Refresh in the UI, saw new numbers, and the agent queried the extract and saw
older ones. Both are correct. Naming the refresh time ends the argument in one line.

```graphql
{
  publishedDatasources(filter: {luid: "<luid>"}) {
    name
    hasExtracts
    extractLastRefreshTime
    upstreamTables { name schema fullName database { name connectionType } }
  }
}
```

## Reading `errors` before `data`

**The Metadata API has a 20,000-node limit. `NODE_LIMIT_EXCEEDED` returns partial results
with a warning in the `errors` block.**

An agent that reads `data` and ignores `errors` builds a lineage graph that is silently
incomplete, then reasons confidently about a model it only partly saw. **Read `errors`
first, every time.** If the node limit was hit, narrow the query — filter by database, by
workbook, or by data source — rather than accepting the truncated graph.

Two related Metadata API traps:

- **Indexing is asynchronous.** Freshly published content is not in the graph yet. An agent
  that publishes then immediately queries lineage gets nothing and wrongly concludes the
  publish failed. Wait and retry.
- **Results are permission-filtered with no error**, and on Tableau Server the Metadata API
  must be explicitly enabled with `tsm maintenance metadata-services enable`. On a Server
  customer it may simply be off.

## When to leave Tableau for the warehouse

The Metadata API's lineage exists to make this decision possible. Leave Tableau when:

- the volume is real — VDS streaming plus `returnFormat: ARRAYS` handles a lot, but a
  multi-million-row extraction belongs in SQL
- you need **row-level detail** — `Query View Data` returns a view's **summary** data, not
  underlying rows, and there is no clean REST equivalent of the full-data download
- you need **join semantics** — the warehouse has declared keys; Tableau's join conditions
  are not reliably exposed

`upstreamTables` gives you database, schema, table and connection type. That is enough to
hand a warehouse module a concrete target.

**State the trade when you do it:** warehouse numbers and Tableau numbers are two
legitimate series. The Tableau number carries the published data source's calculated
fields, its filters and its row-level security. The warehouse number carries none of those
unless you rebuild them — and per the join-opacity gotcha, rebuilding them is exactly what
you should be cautious about.
