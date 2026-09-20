# The ingestion contract — naming, stages, reports, exit codes

The runnable procedure. `SKILL.md` holds the rules; this holds the shapes.

---

## 1. Classify

Input: an object in the landing area. Output: an identity record, or a
rejection.

```python
@dataclass(frozen=True)
class ObjectIdentity:
    tenant: str            # from the folder, cross-checked against the filename
    source: str            # from the closed enum SOURCES
    period_start: date
    period_end: date
    version: int
    extension: str
    object_path: str
    object_version: str    # the storage system's immutable generation/version id
    content_sha256: str
    size_bytes: int
```

Checks, in order, each fatal:

1. path matches the naming pattern
2. `tenant` in the path equals `tenant` in the filename
3. `source` is in the closed enum
4. `period_start <= period_end` and both parse as ISO dates
5. `period_end - period_start <= DATE_RANGE_MAX_DAYS`
6. sniffed content type matches the extension (a `.csv` that is really XLSX
   fails here, not three stages later)
7. `content_sha256` is not already in `raw.load_ledger` with
   `load_status = 'loaded'` — if it is, exit 0 as a logged no-op

**Read the object by its version id, not by its path.** Between listing and
reading, a path can be overwritten; you would then hash one file and load
another.

---

## 2. Validate

Two passes, both required.

**Schema pass** — column presence, types, key-column null fraction, duplicate
natural keys within the file.

**Semantic pass** — the tripwires. See `tripwires-and-quarantine.md`.

Every failure produces a structured entry, never a bare exception message. The
entry must be readable by the person who exported the file, who does not know
your column names:

```python
@dataclass
class Failure:
    check: str            # the constant's name, e.g. "MIN_DISTINCT_EVENT_NAMES"
    observed: object
    threshold: object
    meaning: str          # plain language, no internal identifiers
    likely_cause: str
    uploader_action: str  # what they must actually do
```

---

## 3. Normalize

Order matters, because a later step assuming an earlier one ran is a classic
source of double-applied corrections.

1. **Rename** via the exact field map. Unmapped → reject.
2. **Type** — dates to DATE, money to NUMERIC/NUMBER, never FLOAT.
3. **Unit-correct**, once, with the correction logged: `cost_micros / 1e6`,
   basis points to fractions, seconds to milliseconds. **Each unit correction
   is recorded in the normalisation log with the source field name**, so a
   later source-side fix is detectable rather than silently doubling.
4. **Canonicalise enums** through an exact map. No case folding as a fallback —
   if `ACTIVE` and `active` both appear, that is a source change worth a
   rejection, not a silent fold.
5. **Stamp provenance** (`_source`, `_object_path`, `_object_version`,
   `_content_sha256`, `_row_sha256`, `_loaded_at`, `_row_number`).

`_row_sha256` is computed over the **normalised** row with provenance columns
excluded, so the same logical row re-ingested from a re-export hashes the same.

The normalisation log is an artefact, not a debug print:

```json
{"field": "cost_micros", "action": "divide", "factor": 1000000, "rows": 812,
 "target": "cost", "map_version": 3}
```

---

## 4. Load

| Shape | Procedure |
|---|---|
| Snapshot | insert rows whose `(entity_id, snapshot_date)` is not already present |
| Fact | `BEGIN` → `DELETE FROM target WHERE source = ? AND event_date BETWEEN ? AND ?` → `INSERT` from temp → `COMMIT` |
| Governed log / config | upsert on the natural key |

One advisory lock per target table, acquired before the delete and released
after the commit. Concurrent loads for overlapping periods otherwise interleave
and leave the target short with no error raised anywhere.

Write the ledger row in the **same transaction** as the data where the
warehouse allows it. A ledger that can disagree with the table is worse than no
ledger, because it will be trusted.

---

## 5. Report

Three outputs, always, even on success:

1. **The rejection report**, written next to the uploaded object (see
   `SKILL.md` §2). On a clean load it still writes, with
   `"decision": "loaded"` and `rows_rejected: 0`.
2. **The readiness record** in the `quality` layer:

```sql
MERGE INTO quality.source_readiness t
USING (SELECT ? AS source, ? AS last_attempted_at, ? AS last_successful_at,
              ? AS last_status, ? AS rows_loaded, ? AS rows_rejected,
              ? AS rows_quarantined) s
ON t.source = s.source
WHEN MATCHED THEN UPDATE SET …
WHEN NOT MATCHED THEN INSERT …;
```

**`last_attempted_at` and `last_successful_at` are separate columns and both
are published.** A consumer that sees only "last updated" cannot distinguish a
pipeline that ran and rejected everything from one that ran and loaded. This is
failure mode F1 and it is the single most common way a broken ingest is read as
a business decline.

3. **The exit code:**

| Code | Meaning | Scheduler should |
|---|---|---|
| 0 | loaded, nothing rejected | nothing |
| 0 | byte-identical re-upload, no-op | nothing |
| 2 | one or more rows or files rejected | **alert** |
| 3 | quarantined: landed but unpromotable | alert, lower severity |
| 4 | infrastructure failure (auth, network, warehouse) | alert, retry per `rate-limit-governor` |

Exit 2 and exit 4 are different incidents with different owners. Collapsing
them into "the job failed" sends the wrong person to look.

---

## 6. Connector-sourced data follows the same contract

A managed connector (Fivetran, Airbyte, a vendor sync) replaces stages 1–4 but
**not** stage 5, and not the tripwires. What changes:

- The object identity becomes the connector's sync id and its cursor position.
- The content hash is unavailable; use the connector's sync id plus row counts
  per table as the ledger key.
- Idempotency is the connector's problem, but **its re-sync semantics are
  yours to verify**: a connector that upserts on a key the source has since
  merged will silently drop rows.
- The tripwires still apply, and they matter more, because a connector failure
  is invisible by design — it does not put a file anywhere for a human to
  notice.

The pack's position, stated plainly: **for ingest-to-staging, a maintained
connector beats anything hand-written here.** This skill's value is the
validation, tripwire, provenance and readiness layer that connectors do not
provide.
