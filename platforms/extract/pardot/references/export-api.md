# The Export API — lifecycle, the frozen timezone, and the bounded range

The v5 Export API is well designed and is the right path for volume. It also carries the
worst silent correctness trap in this module, so read the timezone section before you
create the first export.

## The frozen timezone — handle this first

**Export timestamps are frozen to the timezone of whichever user created the export, at the
moment they created it.**

Salesforce documents it directly: dates are returned in the user's timezone at the time
they created the export, and **if a user's timezone changes, previous exports keep the
previous timezone.**

Three consequences, all of which produce wrong analysis rather than errors:

1. **Two users exporting the same data get differently-offset timestamps.** Combining their
   outputs in one analysis silently mixes time bases.
2. **A user who relocates changes the meaning of all their future exports** — and the old
   ones keep the old offset, so a single person's export history is not internally
   consistent.
3. **Nothing in the file says which timezone it is in.** You cannot recover it from the
   data.

**The handling, and it is non-negotiable:**

- **Pin one dedicated export identity.** A service user whose timezone is set
  deliberately — UTC is the sane choice — and who nobody edits.
- **Record that identity and its timezone alongside every export**, in the provenance
  block.
- **Never mix exports created by two identities in one analysis.** If you inherit a mixed
  set, treat the timestamps as unreliable until each file's creating identity is
  established.
- **Document the choice to the customer**, because a well-meaning admin changing the
  service user's timezone breaks every future export in a way no monitoring will catch.

## The lifecycle

```
POST   /api/v5/exports                 → { "id": ... }
GET    /api/v5/exports/{id}            → poll: status
GET    /api/v5/exports/{id}/results    → file list
POST   /api/v5/exports/{id}/do/cancel  → cancel
```

**Quota notes that change the plan:**

- **Exports are subject to the same daily and concurrent limits as the sync API. It is not
  a separate quota pool.**
- **Exports are queued and executed sequentially per account, oldest first.** Firing twenty
  exports does not make them run twenty ways — **it makes the twentieth wait.**
- **Concurrency is 5 overall; over five connections returns error code 66.** A single
  well-behaved serial extractor beats naive parallelism here, every time.

## Bound both ends of the date range

**Supplying `createdAfter` without `createdBefore` runs "up to the creation date of the
export".**

That is an **unbounded upper edge**, which makes repeated runs non-deterministic: the same
export definition run twice returns different row counts, and an incremental pipeline built
on it either duplicates or gaps depending on how it stitches.

```python
def export_window(start, end):
    """Always bound both ends. An open upper edge makes reruns non-deterministic."""
    assert end is not None, "createdBefore is required for reproducible exports"
    return {"createdAfter": start.isoformat(), "createdBefore": end.isoformat()}
```

## Validate the field list before scheduling

**Maximum 150 fields per export.**

**Collection fields cannot be exported at all** — `senderOptions`, `replyToOptions` and
similar. **You get an error or a missing column, not a partial export with a warning.**

Relationship fields are supported to depth 3 but are **scalar-only**.

**So validate the field list against a small test export before scheduling anything
unattended.** An overnight export that fails on a collection field, or quietly omits a
column, is discovered the next morning at best.

## Relationship traversal — the feature that saves the quota

**`fields` supports relationship traversal up to depth 3, and it works in the Export API
too:**

```
?fields=id,email,campaign.name,campaign.folder.parentFolder.name
```

**A single VisitorActivity export can therefore carry Campaign, Email and Prospect
attributes inline, with no join pass.** On a platform where the binding constraint is daily
call count, eliminating a join pass is worth more than any batching trick.

Use it deliberately: enumerate what the analysis needs from related objects, and pull it
inline rather than as a second extraction.

## Files expire, and are not ordered

- **Export data expires after 7 days.** Fetch promptly.
- **An export not finished within 7 days expires unprocessed** — a very large export can
  therefore fail by timing out in the queue rather than by erroring.
- **Record order across CSV files is not guaranteed and record counts per file vary. Never
  assume file 1 has the earliest rows.** Sort after loading; do not infer ordering from
  file names.

## Don't forget deleted records

**Deleted prospects go to a recycle bin and v5 object queries exclude them by default.**

**Without the deleted/archived filter, an agent reports "we lost 400 prospects this month"
when someone merely ran a cleanup.** Include the deleted population as an explicit number
in any period-over-period count.
