# GA4 `ResponseMetaData` — the warning-field register

Every `runReport` response carries a `metadata` object. These fields are the difference
between a number and a defensible number. Read them before using any figure, and carry them
into `provenance-block`.

| Field | Type | What it means | Direction of error | What to do |
|---|---|---|---|---|
| `samplingMetadatas[]` | list of `{samplesReadCount, samplingSpaceSize}` | the report was computed on a sample of sessions | noisy both ways; worst on small segments and rare events | report the rate, shorten the range, drop dimensions, or go to BigQuery |
| `subjectToThresholding` | boolean | rows suppressed for privacy | segment totals come in **under** the unsegmented total | say rows are missing, give the unsegmented total as the anchor, widen the window, or drop the demographic dimension |
| `dataLossFromOtherRow` | boolean | tail rows rolled into `(other)` | the tail is **understated**; visible rows are accurate | name the affected dimension, reduce cardinality, or use BigQuery |
| `currencyCode` | string | the property's reporting currency | none, until you add two properties together | label it; normalise explicitly for cross-property work |
| `timeZone` | IANA string | the property's date-bucketing timezone | day-boundary misalignment against other platforms | label it; align windows before comparing |
| `schemaRestrictionResponse` | object | the credential's role restricts some fields | metrics come back restricted or absent, not zero | log the credential, request the role change, do not report absent as zero |
| `emptyReason` | string | why an empty result is empty | reporting "no data" when the cause was something else | read it and report the actual reason |
| `propertyQuota` | object | remaining tokens in each bucket | none | self-throttle; only present when `returnPropertyQuota` was set |

## Sampling, concretely

```
samplingMetadatas: [{ "samplesReadCount": "1240000", "samplingSpaceSize": "9800000" }]
```

Sampling rate = 1,240,000 / 9,800,000 = **12.7 percent of sessions read**.

How to say it: "Organic sessions last month were 412,000. That report was sampled at about
13 percent of sessions, so the figure is approximate and the error grows for small slices;
the total is reliable enough for a trend read, and if you need it exact the BigQuery export
has no sampling." Give the number first. Do not lead with the caveat, and do not withhold.

Sampling is more likely when the query is wide (many dimensions), the range is long, or a
non-standard segment or filter forces GA4 off its pre-aggregated tables. The fix order is:
shorten the range, then drop dimensions, then BigQuery.

## Thresholding, concretely

`subjectToThresholding: true` appears when demographics or interests (`userAgeBracket`,
`userGender`, `userInterest`) or Google-signals data are in the query and the buckets are
too small to be safe. The suppressed rows are **not in the response at all** — there is no
"suppressed" row to sum.

Consequences to state in the answer:

1. The segment rows will not add up to the unsegmented total. The gap is the suppression.
2. Small segments are the ones removed, so any "which age group is smallest" question is
   unanswerable in the suppressed direction.
3. Aggregating across days does not recover the rows; each day is thresholded separately.

Also remember the **separate quota bucket: 120 potentially-thresholded requests per hour**.
A loop over demographic dimensions exhausts it quickly and the resulting error does not
mention thresholding.

## The `(other)` row, concretely

`dataLossFromOtherRow: true` means dimension value combinations beyond the cardinality
ceiling were bucketed together. A dimension with **more than 500 unique values in one day**
is high-cardinality. The usual suspects are `pagePath` on a content site, `pageTitle`, and
custom dimensions carrying ids, session tokens or query strings.

What survives and what does not: the rows you can see are accurate, the total is accurate,
and **the tail is not enumerable**. So "top 10 pages" is a fine answer and "how many
distinct pages got traffic" is not. Say which of those you are giving.

Reducing cardinality usually means stripping query strings from `pagePath`, grouping by
page path prefix or content group rather than full path, or moving to the BigQuery export
where no `(other)` row exists.

## Currency and timezone, concretely

Revenue is in `currencyCode` and dates bucket in `timeZone`. Two consequences worth stating
whenever more than one system is involved:

- **Cross-property roll-ups need explicit FX**, with a stated rate and rate date. GA4 does
  not convert, and summing two currencies without conversion produces a meaningless number
  that looks plausible.
- **Cross-platform day alignment.** GA4 buckets in the property's timezone; Google Ads
  buckets in the ad account's timezone; a warehouse is usually UTC. A one-day shift between
  two series is a timezone artefact until proven otherwise. `comparability-rules` owns the
  decision of whether two series may be compared at all.

## Permission-dependent numbers

`schemaRestrictionResponse` is the field that makes "which credential ran this" part of the
provenance rather than an implementation detail. Two service accounts on the same property
can legitimately return different revenue because one has a cost-data or revenue-data
restriction on its role. **Always log the credential identity with the number.** If an
agent cannot name which credential produced a figure, it cannot defend the figure.

## The check to run before using any GA4 number

1. Is `propertyQuota` present? If not, `returnPropertyQuota` was not set. Fix and re-run.
2. Is `samplingMetadatas` present with a ratio below 1? Compute and report the rate.
3. Is `subjectToThresholding` true? Say rows are missing and stop treating the segment sum
   as a total.
4. Is `dataLossFromOtherRow` true? Name the dimension and answer only the enumerable part
   of the question.
5. Read `currencyCode` and `timeZone` into the provenance block.
6. Is `schemaRestrictionResponse` present? Log the credential and name the restriction.
7. Empty result? Read `emptyReason` before saying "no data".
