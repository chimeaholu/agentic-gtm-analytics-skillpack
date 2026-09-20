# Bulk API 2.0 query jobs — the actual answer for "get me all the rows"

The report API caps at 2,000 rows with no pagination. When the question needs rows rather
than a report's own totals, this is the supported path.

**What you give up by coming here:** the report's definition. Custom summary formulas,
`PARENTGROUPVAL`, `PREVGROUPVAL` and `ROWCOUNT` formulas exist only inside reports and have
no field to extract. Ordinary formula fields and roll-up summaries do export. If you
re-implement a report's logic in SOQL, **you now own that metric definition** and the
answer must say so.

## The four steps

**1. Create the job.**

```bash
curl -s -X POST "$SF_INSTANCE_URL/services/data/v60.0/jobs/query" \
  -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "operation": "query",
    "query": "SELECT Id, Name, Amount, CurrencyIsoCode, CloseDate, StageName, OwnerId FROM Opportunity WHERE CloseDate >= 2026-01-01 AND CloseDate < 2026-04-01"
  }'
```

`operation` is `query` (excludes Recycle Bin and archived records) or **`queryAll`**
(includes soft-deleted and archived; filter `IsDeleted` yourself). Use `queryAll` whenever
you are reconciling counts against a system that never deletes.

**2. Poll the job.**

```bash
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/v60.0/jobs/query/$JOB_ID"
```

`state` moves `UploadComplete` → `InProgress` → `JobComplete`. `Failed` and `Aborted` are
terminal; read `errorMessage`. Back off between polls rather than spinning.

**3. Retrieve results, and loop on the locator.**

```bash
curl -s -D headers.txt -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/v60.0/jobs/query/$JOB_ID/results?maxRecords=50000"
```

Two response headers matter:

- **`Sforce-Locator`** — the cursor for the next page. Pass it back as `?locator=<value>`.
  **Loop until the header is absent or `null`.** This is the pagination pattern for this
  platform; it is not offset-based and it is not a page number.
- `Sforce-NumberOfRecords` — rows in this response. Sum it across pages and reconcile
  against your expected count before using the data.

The body is CSV with a header row. Treat every value as text until you have decided on a
type; ids are case-sensitive 15 or 18 character strings and must never be parsed as
numbers.

**4. Know the limits you are working inside.** Roughly 15 GB per query job, 10,000 query
jobs per rolling 24 hours, 1 GB maximum retrieved file size, and results retrievable for
**7 days**. Query jobs do **not** consume ingest batches, so the 10,000-records-per-batch
ingest limits are irrelevant here. Standard org-wide daily API allocations still apply.

## Field-level traps in extracted data

- **Compound fields are not supported by Bulk API 2.0 query.** `Address` and geolocation
  fields must be requested as components (`BillingStreet`, `BillingCity`, `BillingState`,
  `BillingPostalCode`, `BillingCountry`).
- **Shield-encrypted fields return masked**, not omitted. A masked value that looks like
  data is worse than an absent one; check for it explicitly.
- **FLS still applies.** A field the integration user cannot see is absent from the CSV
  rather than null. Compare the returned header row against the fields you asked for and
  raise the difference rather than treating missing columns as empty.
- **`Amount` comes with `CurrencyIsoCode` in a multi-currency org and is not converted.**
  Report figures are converted to the report's or user's currency at current or dated
  rates. **These are two different numbers for the same opportunity.** Normalise
  explicitly, state the FX basis and date, and never mix the two in one calculation.
- **Date and datetime fields come back in UTC** in Bulk output, while report date groupings
  evaluated in the running user's timezone. A day-level reconciliation between the two
  needs an explicit timezone conversion.
- **Lead conversion retires the Lead id.** Follow `ConvertedContactId`,
  `ConvertedAccountId` and `ConvertedOpportunityId` on the Lead, or campaign-member and
  activity history breaks across the conversion boundary.
- **Formula fields are not replicated by ELT connectors**, because Salesforce does not
  update `SystemModStamp` when a referenced object changes. If the warehouse is the source,
  recompute them there, and note that formula-field history is not recoverable.

## When to use this rather than the report API

| Question | Surface |
|---|---|
| "What does this saved report say?" | Report API, `GET /analytics/reports/{id}` |
| "Same report, different date range" | Report API, `POST` with a `reportMetadata` override |
| "Give me every opportunity row for the quarter" | Bulk API 2.0 |
| "Reconcile our CRM count against the warehouse" | Bulk API 2.0 with `operation: "queryAll"` |
| "What reports exist in this org?" | SOQL on the `Report` object, not `GET /analytics/reports` |
