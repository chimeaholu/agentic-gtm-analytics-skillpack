# Pipeline diagnosis — why the downstream number is wrong

Segment's second genuine value: **diagnosing why a number is wrong downstream.** A
destination failing for three days explains a discrepancy that would otherwise be blamed on
the analytics tool, the tracking code, or the analyst.

## First: Segment's own counts are not comparable to anything

**"Events volume" counts messages ingested — before destination filters, before
transformations, before deduplication. It will not match any downstream tool's event count
and is not supposed to.**

**MTU is a billing construct** computed on Segment's own rules. **It does not equal GA4
users, Mixpanel users or your CRM's contact count.** It is routinely mistaken for a product
metric, including by people who should know better.

So a diagnosis never concludes "Segment says 1.2M and GA4 says 980K, therefore GA4 is
losing events". That gap is expected. The diagnosis is about **where a specific, unexpected
drop came from.**

## The discrepancy playbook, in order

**1. Check Delivery Overview.** Ingress and egress success and failure rates per
destination. A destination failing or partially failing is the single most common cause and
the quickest to confirm.

**Retention is short** — materially shorter than event data in a warehouse — so **check it
promptly. Historical pipeline forensics beyond that window are not possible via API.** If
the discrepancy is two months old and the retention window is shorter, say plainly that the
evidence no longer exists.

**2. Check destination filters and transformations.** **Destination filters,
transformations and Replay change what actually arrives downstream.** A discrepancy between
Segment's egress count and a destination's own count **is usually a filter someone added.**

**The Public API can list filters and transformations — check them before escalating.**
Pair it with the **Audit Trail**: who changed what, and when. A filter added on the 3rd
explains a drop starting on the 3rd, and that is a complete answer.

**3. Check cloud mode versus device mode.** **Cloud-mode and device-mode destinations
receive different data.** An event present in Segment **may never have reached a
device-mode destination** because the user had an ad blocker — **and this is invisible in
Segment's egress metrics**, because Segment never handled that delivery.

So a device-mode destination showing systematically fewer events than Segment's volume is
expected behaviour, and the gap is roughly the blocked population.

**4. Check the timestamps.** See below.

**5. Only then look at the destination tool itself.**

## The four timestamps

**`timestamp`, `originalTimestamp`, `sentAt`, `receivedAt` — and downstream tools pick
different ones.**

| Field | Means |
|---|---|
| `originalTimestamp` | when the client says the event happened |
| `sentAt` | when the client sent it |
| `receivedAt` | when Segment received it |
| `timestamp` | Segment's computed best estimate of event time |

**Late-arriving mobile events from offline queues can be days old at `receivedAt`.**

**This is a top cause of "the warehouse and the product tool disagree on yesterday":** the
warehouse partitions on one field, the product tool buckets on another, and an offline
queue flushing on Thursday puts Monday's events into Thursday for one of them.

**The diagnostic question:** which timestamp does each side use? If they differ, the
disagreement is structural and both are correct.

## Deletion is asynchronous and partial — never overclaim

**A deletion request removes data from Segment and *requests* deletion from supporting
destinations. Destinations that do not support it keep the data.**

**A skill must never claim "the user's data has been deleted" on the basis of a regulation
being created.** The honest statement names what happened and what did not:

> "The deletion request was created and Segment has removed the data it holds. Segment has
> also requested deletion from supporting destinations. Destinations that do not support
> deletion retain the data, and Segment cannot remove it for you — those need handling
> directly."

## The warehouse schema, which is where the analytics happens

Since **there is no bulk export of events via the Public API** — the bulk path is the
Warehouse connector (Redshift, BigQuery, Snowflake, Postgres) or Data Lakes (S3 or GCS plus
Glue) — the model that matters downstream is the warehouse schema.

**Tables:** `tracks` plus **one table per event name**, `identifies`, `users`, `pages`,
`screens`, `aliases`.

**Four modelling rules that determine whether the downstream numbers are right:**

1. **`users` holds only the *latest* traits — it is a Type-1 dimension.** Trait history
   requires **snapshotting `identifies` yourself**. Any "what plan were they on in March"
   question fails against `users`.
2. **`users` has no `anonymous_id`.** The **anonymous-to-known bridge lives in `identifies`
   and `aliases`.** An attribution model that needs pre-signup behaviour joins through
   those, not through `users`.
3. **Per-event tables mean a new event name creates a new table**, so a **`tracks` union is
   usually the right base model** — otherwise a newly-added event silently never enters the
   analysis.
4. **Events are at-least-once delivered — deduplicate on `message_id`.** Without it,
   retried deliveries inflate counts, and the inflation is uneven across events.

## Saying the honest thing about scope

When the question is "how many users did X last week", the answer is:

> "Segment can't answer that — it routes data rather than analysing it, and its volume
> counts are pre-filter and not comparable to any tool's numbers. The warehouse has the
> event data; I'll query there. What Segment *can* tell us is whether the events reached
> the tools you expected, which is worth checking first if the number looks wrong."

That is an answer, not a deflection, and it usually saves the next hour.
