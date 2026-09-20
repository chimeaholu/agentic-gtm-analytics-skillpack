---
name: source-ingestion-mapper
description: Use when ingesting GTM data from platform exports, file drops or connectors into a warehouse, and when diagnosing why an ingested file produced wrong or missing numbers. Defines the object-naming contract, the classify-validate-normalize-load-report stages, semantic tripwires that catch a wrong-but-well-formed export, idempotency by content hash, and lossless quarantine instead of inference. Prevents a file with the right columns and the wrong meaning loading successfully and being read as a business decline.
---

# Source Ingestion Mapper

A file with the right columns can be the wrong report. That is the failure this
skill exists to catch, and schema validation does not catch it: the load
succeeds, the row count looks plausible, and three weeks later someone presents
the dip as a business decline.

Two rules govern everything below.

1. **Rejection must be loud.** A file that fails validation produces a report,
   a non-zero exit, and a visible gap — never a quiet skip.
2. **Never infer semantics.** Not from a filename, not from a response body,
   not from a column that looks like the one you wanted. Where the meaning is
   not established, the rows go to quarantine intact.

---

## 1. The object-naming contract

One pattern, checked on arrival, for every landed object:

```
<tenant>/<source>/<start_date>_<end_date>__<source>__v<version>.<ext>

acme-eu/google-ads/2026-07-01_2026-07-31__google-ads__v1.csv
```

| Token | Rule | Why |
|---|---|---|
| `tenant` | matches the folder **and** the filename; mismatch rejects | a file dropped into the wrong tenant folder is the worst possible silent error |
| `source` | drawn from a **closed enum**, not free text | `googleads`, `google_ads` and `Google Ads` become three sources otherwise |
| dates | inclusive ISO `YYYY-MM-DD`, start ≤ end | ambiguous ranges make overlap-replace impossible |
| `version` | **a corrected re-export increments the version; it never overwrites** | the original stays auditable and the correction is a visible event |
| extension | closed enum, matched against sniffed content | a `.csv` that is actually XLSX fails at parse, not at load |

A file that does not match the pattern is rejected at classify. **There is no
"best effort" parse of a non-conforming name**, because that is exactly where
semantics get inferred.

---

## 2. Five stages, each with a named output

```
classify  → object identity, source, period, version, content hash
validate  → pass or a rejection report (schema + semantic tripwires)
normalize → typed, mapped, canonicalised rows + normalisation log
load      → rows in raw, with per-row provenance + load ledger entry
report    → readiness record, rejection report, exit code
```

**Validation thresholds are named constants at the top of the file**, not
numbers buried in a conditional. They are the part of the pipeline a human must
review, so they must be reviewable:

```python
# --- validation thresholds: review these, they are the contract ---
MIN_ROWS                  = 1         # an empty export is a failure, not a quiet day
MIN_DISTINCT_EVENT_NAMES  = 5         # below this, someone exported a filtered view
MAX_NULL_FRACTION_KEY     = 0.00      # key columns: no nulls, ever
MAX_NULL_FRACTION_MEASURE = 0.20      # measures: tolerate, but log the rate
MAX_PLAUSIBLE_AVG_RANK    = 100.0     # above this, the export is on a different scale
PERCENT_UPPER_SENTINEL    = 1.5       # values >1.5 in a rate column: percent, not fraction
DATE_RANGE_MAX_DAYS       = 400       # wider than expected: probably the wrong export
```

### The rejection report

Written back **next to the uploaded file**, so the person who dropped it finds
it without access to the warehouse:

```json
{
  "object": "acme-eu/google-ads/2026-07-01_2026-07-31__google-ads__v1.csv",
  "content_sha256": "…",
  "decision": "rejected",
  "stage": "validate",
  "rows_seen": 812,
  "rows_rejected": 812,
  "failures": [
    {
      "check": "MIN_DISTINCT_EVENT_NAMES",
      "observed": 2,
      "threshold": 5,
      "meaning": "the export contains 2 distinct event names; a full feed for this account has at least 5",
      "likely_cause": "a segment or filter was applied in the UI before exporting",
      "uploader_action": "re-export with all segments cleared, increment to v2"
    }
  ],
  "exit_code": 2
}
```

**The process exits non-zero when anything was rejected.** A scheduler that
treats exit 0 as success is the only alerting many teams have; silently
returning 0 on a rejected file removes it.

---

## 3. Semantic tripwires — the checks that catch the wrong report

Schema checks catch a malformed file. These catch a well-formed file that means
something other than what you assumed.

| Tripwire | Fires when | What it usually means |
|---|---|---|
| **Distinct-value floor** | fewer distinct event names / campaigns / pages than a full feed carries | a segment or filter was left on in the export UI |
| **Row floor** | row count below the configured floor for this source and period | a broken filter, a wrong date range, or an export that hit a row cap |
| **Row ceiling / round number** | row count is exactly 2,000 / 10,000 / 100,000 | **a platform row cap, not a dataset size.** Salesforce reports cap at 2,000 rows with no pagination; a report export that returns exactly the cap is a lower bound |
| **Scale sentinel** | average rank, score or rate above a plausible ceiling | a different scale (1–100 vs 0–1), or a different metric entirely |
| **Percent-versus-fraction** | rate column contains values both below 1 and above 1.5 | mixed units in one column — **warn, do not normalise** |
| **Date-range width** | period wider or narrower than the filename claims | the export ignored the requested range |
| **Currency absence** | a money column with no currency column or account-currency metadata | no platform has a currency type; the unit is lost the moment it lands |
| **Grain shift** | rows per natural key differs materially from the previous version | the export changed grain — planning rows and fact rows in one file, or a new breakdown dimension |
| **Column drift** | a column appears, disappears or changes position between versions | the source contract changed; position-based parsing is now wrong |

**Percent-versus-fraction warns rather than silently normalising**, and this is
deliberate. An automatic ×100 that guesses wrong moves every downstream number
by two orders of magnitude and leaves no trace. A warning costs someone ten
minutes.

Tripwires are per source and per period, and their thresholds live in `config`,
not in code, so tuning them is a reviewable change.

---

## 4. Idempotency: content hash plus natural key

Two layers, because either alone fails.

### Layer 1 — the file ledger

```sql
CREATE TABLE IF NOT EXISTS raw.load_ledger (
  content_sha256   STRING NOT NULL,
  object_path      STRING NOT NULL,
  object_version   STRING,        -- the storage system's immutable version id
  source           STRING NOT NULL,
  period_start     DATE,
  period_end       DATE,
  rows_loaded      INT64,
  rows_rejected    INT64,
  loaded_at        TIMESTAMP NOT NULL,
  load_status      STRING NOT NULL   -- loaded | rejected | quarantined
);
```

A byte-identical re-upload matches on `content_sha256` and becomes a **no-op**,
logged. This is what makes a retry safe.

**Pin the download to the immutable object version** and record it beside the
hash. "The file at that path" is not an identity — the path can be overwritten
between your list call and your read call, and you would hash a different file
than the one you loaded.

### Layer 2 — per data shape

| Shape | Idempotency rule |
|---|---|
| **Snapshot** (daily state of entities) | skip known `snapshot_id` / `snapshot_date`; a past snapshot is immutable |
| **Fact** (events, spend, activity) | load into a temp table, then **overlap-replace**: delete the target's rows for the loaded period, insert the new ones, in one transaction |
| **Governed log / config** | upsert on the natural key |

**Serialize the loader.** Two concurrent uploads for overlapping periods can
interleave a delete from one with an insert from the other and leave the target
missing rows with no error anywhere. One lock per target table, held across the
delete-and-insert. It costs throughput you do not need on a daily GTM load.

---

## 5. Lossless quarantine instead of inference

When an export lacks something you need — the tenant, the observation date, a
usable key — the wrong moves are: guess it from the filename, guess it from the
API response text, or drop the rows.

The right move is to land them **intact and unpromotable**:

```sql
CREATE TABLE IF NOT EXISTS raw.quarantine (
  quarantine_id    STRING NOT NULL,
  source           STRING NOT NULL,
  object_path      STRING NOT NULL,
  object_version   STRING,
  content_sha256   STRING NOT NULL,
  row_sha256       STRING NOT NULL,     -- per-row identity, survives re-ingestion
  row_number       INT64,
  raw_payload      JSON NOT NULL,       -- the row, unmodified
  missing_fields   ARRAY<STRING>,       -- what blocks promotion
  quarantined_at   TIMESTAMP NOT NULL,
  promoted_at      TIMESTAMP,           -- null until an authoritative mapping exists
  promoted_by      STRING
);
```

Promotion requires **an authoritative manifest and an approved field mapping**
— a human-owned artefact in `config`, not an inference. Until then the rows
exist, are counted, and are excluded from every mart. The count is published,
because "812 rows in quarantine" is information and a silent drop is not.

---

## 6. Exact maps, never fuzzy repair

A source contract mismatch — the platform calls it `campaign_nm`, your model
expects `campaign_name` — is repaired with a **one-entry typed map**:

```yaml
# config/field_maps/google-ads.yaml
version: 3
effective_from: 2026-07-01
map:
  campaign_nm:   campaign_name
  cost_micros:   cost_micros        # kept as-is: divide by 1e6 in staging, not here
  segments.date: event_date
unmapped_policy: reject             # not "pass through", not "best guess"
```

**No prefix matching, no case folding, no similarity scoring, no "did you
mean".** Everything unmapped still rejects. A fuzzy field mapper will one day
map `revenue_gross` onto `revenue` and nothing will ever error.

The same prohibition covers entity aliases. Unresolvable campaign or account
aliases do not go into an "other" bucket that disappears from the count — they
reject or quarantine, and their volume is reported.

---

## 7. Row-level provenance, stamped at ingestion

**Retrofitting provenance is impossible.** Once the rows are in and you do not
know which file they came from, the only fix is to reload everything, and
usually the files are gone.

Every landed row carries, at minimum:

```
_source            STRING     -- closed enum
_object_path       STRING
_object_version    STRING     -- the storage system's immutable version
_content_sha256    STRING     -- the file's hash
_row_sha256        STRING     -- this row's hash
_loaded_at         TIMESTAMP
_row_number        INT64      -- position within the object
```

This is what makes `data-lineage-tracer` able to answer "which file produced
this number", and what makes a targeted re-load possible instead of a full
rebuild.

---

## 8. Preserve source quirks exactly; correct at the boundary

Where a source ships a misspelled field, a malformed identifier, a trailing
space in an enum value or an off-by-one date convention, **preserve it exactly
in the schema mapping and record why**. Then correct in `staging`, once, with
the reason attached.

The failure mode of the alternative: someone "fixes" the source assumption in
the ingestion code, the source later fixes it too, and now the correction is
applied twice with no test covering it.

```yaml
quirks:
  - field: "referer"          # sic — the source spells it with one 'r'
    action: preserve_in_raw
    corrected_in: staging.stg_web__pageviews AS referrer
    reason: "source field name, not a typo in our schema"
  - field: "date"
    note: "source reports in account timezone, not UTC; converted once in staging"
```

---

## 9. What ingestion cannot fix

Say these plainly rather than papering over them:

- **A row cap is not a dataset.** An export that returned exactly the platform's
  cap is a lower bound and must be labelled one — Salesforce report exports cap
  at 2,000 rows with no pagination; re-export via a different path or narrow
  the period.
- **Pre-filtered exports cannot be un-filtered.** The tripwire catches it; only
  a new export fixes it.
- **A missing currency cannot be inferred.** Not from the account name, not
  from the magnitude of the numbers.
- **A missing timezone cannot be inferred** from the data. It comes from
  platform metadata or from a human, and until then day-boundary comparisons
  are `unavailable` (see `temporal-integrity-audit`).
- **Late-arriving revisions are not the loader's problem to detect** — the
  reprocessing window in `warehouse-schema-designer` §3 handles them, and a
  loader that only ever appends will miss every revision.

---

## 10. Answering

**Answer first.** "Why is last month low?" gets the ingestion diagnosis before
the business one, in this order, because this is their real frequency: the
file was rejected and nobody saw it; the export was filtered; the export hit a
row cap; the period in the filename does not match the period in the data; a
column changed name and now loads null. Check the load ledger and the rejection
reports before anyone opens a dashboard.

Give the number you have with the coverage stated: *"Last month loaded 812
rows against a trailing average of 14,000; the export carries 2 distinct event
names against 11 last month, so this is a filtered export rather than a
decline. The figure is a floor, not a total."* That is an answer with a
direction of error, and it takes one sentence.

**Withhold only** where the file's meaning cannot be established at all — an
export with no tenant, no period and an unknown shape. That is quarantine, the
row count is still published, and the resolving input is the authoritative
manifest.

---

## Core contracts called

- `answer-contract` — rejected, quarantined and capped loads surface as
  `partial`, `lower_bound` or `unavailable`, never as zero.
- `provenance-block` — the row-level provenance in §7 is what populates it;
  every number downstream inherits the object identity and hash.
- `write-gate` — the overlap-replace delete, any quarantine promotion, and any
  change to a field map or a threshold constant.
- `warning-field-reader` — connector and API responses carry partial-result and
  truncation flags that must be read before the payload is treated as complete.

## References

- `references/ingestion-contract.md` — the naming contract, the five stages,
  the rejection-report schema and the exit-code convention
- `references/tripwires-and-quarantine.md` — the tripwire catalogue with
  thresholds and tuning, and the quarantine-to-promotion procedure

## Related skills

- `warehouse-schema-designer` owns the `raw` layer this lands into, and the
  late-arriving reprocessing window.
- `data-quality-harness` consumes the load ledger for freshness and for the
  "last successful load" versus "last attempted load" split.
- `data-lineage-tracer` reads the row-level provenance stamped here.
- `cross-system-reconciliation` when a loaded file disagrees with the platform UI.
