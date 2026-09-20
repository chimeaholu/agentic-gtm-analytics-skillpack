# Tripwire catalogue and the quarantine-to-promotion procedure

---

## 1. Why tripwires exist

Schema validation asks *is this file well formed*. Tripwires ask *is this file
what I think it is*. The second question is the one that costs money, because a
wrong-but-well-formed export loads cleanly and reads as a business event.

Every tripwire has: a threshold constant, an observation, a plain-language
meaning, and an uploader action. A tripwire without an uploader action is an
alert nobody can act on, and it will be muted.

---

## 2. The catalogue

### 2.1 Distinct-value floor

```python
distinct_events = df["event_name"].nunique()
if distinct_events < MIN_DISTINCT_EVENT_NAMES:
    fail("MIN_DISTINCT_EVENT_NAMES", distinct_events, MIN_DISTINCT_EVENT_NAMES,
         meaning=f"the export carries {distinct_events} distinct event names; "
                 f"a full feed for this source carries at least {MIN_DISTINCT_EVENT_NAMES}",
         likely_cause="a segment or filter was left applied in the export UI",
         uploader_action="clear all segments and filters, re-export, increment to the next version")
```

Tune the floor **per source and per tenant** from the trailing median of
successful loads, held in `config`. A hardcoded global floor either fires
constantly on small accounts or never fires on large ones.

### 2.2 Row floor and row ceiling

The floor catches broken filters. The ceiling catches caps, and the ceiling
check is the one people skip.

```python
CAP_SENTINELS = {2000, 5000, 10000, 25000, 50000, 100000, 1000000}
if len(df) in CAP_SENTINELS:
    warn("ROW_CAP_SUSPECTED", len(df),
         meaning="the row count is exactly a common platform export cap, "
                 "so this is probably a truncated result rather than the full set",
         uploader_action="narrow the period or use the bulk/async export path, then re-export")
```

Known real caps to keep in the sentinel set: **Salesforce report exports cap at
2,000 rows with no pagination**; LinkedIn `adAnalytics` has **no pagination at
all and a 15,000-element ceiling**; GA4 Data API report rows are bounded per
request. When the sentinel fires, the loaded figure is a **`lower_bound`**
under `answer-contract`, not a total, and it must be labelled as one for as
long as it is in the warehouse — not just in the alert.

### 2.3 Scale sentinel

Fires when a bounded quantity exceeds its plausible ceiling: an average
position above 100, a score above its documented maximum, a rate above 1.5 in a
column declared as a fraction, a percentage above 100.

Usually means the source changed scale (0–1 to 0–100), or the column is not the
metric you think it is.

### 2.4 Percent versus fraction

```python
rates = df["conversion_rate"].dropna()
if (rates <= 1).any() and (rates > PERCENT_UPPER_SENTINEL).any():
    warn("MIXED_RATE_UNITS", {"min": rates.min(), "max": rates.max()},
         meaning="this rate column contains values both below 1 and above 1.5, "
                 "so it mixes fractions and percentages",
         uploader_action="confirm the unit with the source owner; do not assume")
```

**Warn, never normalise.** An automatic ×100 that guesses wrong moves the
number by two orders of magnitude and leaves no trace. This is failure mode F7,
and the reason it recurs is that auto-normalising feels helpful.

### 2.5 Grain shift

```python
rows_per_key = len(df) / df[natural_key].nunique()
prev = config_lookup(source, tenant, "rows_per_key_trailing_median")
if prev and abs(rows_per_key - prev) / prev > 0.25:
    fail("GRAIN_SHIFT", rows_per_key, prev,
         meaning="rows per key changed materially against recent loads, "
                 "so this export is probably at a different grain",
         likely_cause="a new breakdown dimension, or planning rows mixed into a fact export",
         uploader_action="confirm the export's breakdown settings match the previous version")
```

The classic GTM instance is **planning rows and fact rows in one file** (F3):
budget or forecast rows carrying the same columns as actuals. They sum together
perfectly and the total is meaningless.

### 2.6 Column drift

Compare the header against the previous accepted version. Report **added,
removed and reordered** separately. Position-based parsing breaks silently on
reorder; name-based parsing breaks loudly on rename, which is why name-based
parsing plus an exact map is the rule.

### 2.7 Currency absence

A money column with no currency column and no account-currency metadata fails.
**No warehouse and no BI platform has a currency type**, and no platform in the
research performs conversion for you — GA4 returns revenue in the property's
currency, ad platforms report in the account currency, and product analytics
tools do no currency handling whatsoever. The unit is unrecoverable once
landed, so it is captured at extract time or not at all.

### 2.8 Period mismatch

The min and max of the data's own date column must fall inside the period in
the filename. Outside it means the export ignored the requested range — common
when a UI date picker resets to a default.

---

## 3. Tuning without disabling

Thresholds live in `config.ingestion_thresholds`, one row per
`(source, tenant, check)`, with `effective_from` and a reason:

```
source, tenant, check, threshold, effective_from, changed_by, reason
```

Two rules, borrowed from the same logic as anchor re-baselining in
`data-quality-harness`:

1. **A threshold change is a committed, reasoned change**, not an edit made to
   get a red pipeline green.
2. **A tripwire that fires repeatedly and is always a false positive is a
   mis-tuned threshold, not a reason to delete the check.** Retune it, in
   config, with the reason recorded.

---

## 4. Quarantine to promotion

### What goes to quarantine

Rows that are structurally loadable but whose **meaning cannot be established**:

- no tenant resolvable from the object or its manifest
- no observation date, and none derivable from an authoritative source
- an entity alias that resolves to nothing in the approved mapping
- a currency-less money value

Not: rows that fail schema validation. Those reject.

### The promotion procedure

1. A human produces the missing mapping as an artefact in `config` — an
   authoritative manifest, an approved alias map, a tenant assignment — with an
   owner and a date.
2. A promotion job reads quarantine rows matching the mapping, applies it,
   loads them through the **normal** normalize-and-load path so they get the
   same provenance and idempotency treatment, and stamps `promoted_at` /
   `promoted_by`.
3. The promotion is itself a write through `write-gate`, with the blast radius
   stated: *"promotes N rows into `raw.x`, which changes marts A, B and C for
   period P."*
4. **Never promote by inference**, including "these rows are from the only
   tenant we have" and "the filename says EU". Those are exactly the guesses
   quarantine exists to prevent.

### Publishing the quarantine count

```sql
SELECT source, COUNT(*) AS rows_quarantined,
       MIN(quarantined_at) AS oldest,
       ARRAY_AGG(DISTINCT missing_fields_flat IGNORE NULLS) AS blocked_on
FROM raw.quarantine
WHERE promoted_at IS NULL
GROUP BY source;
```

This count is part of every affected number's coverage statement. "Revenue was
X, excluding 812 quarantined rows blocked on a missing tenant assignment" is an
answer. Dropping the rows and reporting X is not.
