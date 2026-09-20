---
name: provenance-block
description: Use every time a number is retrieved from any GTM platform, warehouse or BI tool, before it reaches an answer, a chart or a report. Assembles the mandatory provenance block: platform, exact query issued, attribution window, attribution basis, date basis, currency, timezone, freshness status, credential identity, and sampled/thresholded/truncated flags. Emit it automatically — never make it optional. Prevents numbers travelling without the caveats that make them mean anything, and prevents two numbers with different bases being placed in one table.
---

# Provenance block

Every result set carries one. Assembly is automatic and unconditional. **Display
is conditional and rare.** Those two sentences are the whole design, and getting
them the wrong way round is how provenance discipline dies: a block on every
number is compliance theatre, users turn it off, and then it is not there on the
number that needed it.

## Assemble always, show on trigger

```
provenance {
  platform,
  query_text_or_spec,
  api_version_or_revision,
  attribution_window,
  attribution_basis,
  date_basis,
  currency, currency_source,
  timezone, timezone_source, timezone_status,
  freshness: { data_as_of, settles_after, provisional: bool },
  credential_identity, permission_scope_note,
  integrity_flags: [sampled | thresholded | other_row | truncated | cached | modelled | approximate],
  row_coverage: { returned, total_if_known, capped: bool }
}
```

The object attaches to the result set and travels with it into every downstream
skill. It is always populated. Nothing here is optional.

## The seven triggers, and silence otherwise

Render the human-readable block **only** when one of these is true. Otherwise
give the number and say nothing about provenance.

| # | Trigger | Detected from |
|---|---|---|
| 1 | **Sampled data** | `integrity_flags` contains `sampled`. Any sampling rate below 1 on any leg. |
| 2 | **Thresholded or withheld rows** | `integrity_flags` contains `thresholded`. Privacy suppression, minimum-audience floors, masked columns. |
| 3 | **Truncated results** | `row_coverage.capped` is true, or `integrity_flags` contains `truncated` or `other_row`. Any cap hit, any rollup into an `(other)` bucket. |
| 4 | **Cross-platform aggregation** | More than one distinct `platform` in the result sets feeding this number. |
| 5 | **Definition mismatch between systems** | Two sources contributing to one answer disagree on metric definition, attribution model, date basis or event set. Verdict comes from `comparability-rules`. |
| 6 | **Data inside its settling window** | `freshness.provisional` is true, or `data_as_of` is inside `settles_after`. |
| 7 | **Currency or timezone conversion applied** | An FX rate was applied, or days were re-bucketed into a timezone other than the source's, or `timezone_status` is unconfirmed on a day-level answer. |

If none fire: **say nothing.** A single-platform, unsampled, uncapped,
settled, same-currency number needs a number, not a paragraph.

A worked contrast:

> **Silent.** "Sessions last week: 41,208."
>
> **Fires (trigger 1 and 6).** "Sessions last week: 41,208. That report came
> back sampled at 43%, so the real figure is near it but not exact, and the last
> two days are still processing and will move up. For an exact figure the
> event-level warehouse export has no sampling."

## Rendering discipline

The block goes **behind** the answer, as prose, not as a fixed eight-item
header. One to three sentences. Each caveat is one plain sentence a
non-specialist can act on.

- Bad: a table of ten provenance fields above a number.
- Bad: "Note: this data may be subject to various limitations."
- Good: "Revenue is in the property's currency, EUR, not your reporting USD; I
  have not converted it."

The full structured block is available on request, and in the machine-readable
object always. The prose rendering is what a human sees.

## Per-platform field sources

Where each field actually comes from. Guessing any of these is how two numbers
with different bases end up in one table.

### Currency and timezone

| Platform | Currency | Timezone |
|---|---|---|
| GA4 | `ResponseMetaData.currencyCode` — the **property's** currency | `ResponseMetaData.timeZone` — the property's IANA timezone |
| Google Ads | `customer.currency_code` | `customer.time_zone`, per customer account |
| Meta | `account_currency` on the ad account | the ad account's timezone setting |
| LinkedIn | ad account currency | account-level; note the 6-month daily-granularity boundary |
| Salesforce | org currency, or multi-currency `CurrencyIsoCode` per record | **the running user's** timezone, not the org's |
| HubSpot | portal currency; deal amounts may carry a property currency | portal timezone |
| Marketo | instance currency | instance timezone |
| Pardot / MCAE | account currency | account timezone |
| Klaviyo | account currency | **the account's** timezone. Only `metric-aggregates` accepts an explicit `timezone` parameter |
| Braze | **revenue is already converted to USD** | the **workspace's** timezone |
| Iterable | project currency | project timezone |
| Amplitude | as sent in the event properties | project timezone |
| Mixpanel | as sent | project timezone, and see the warning below |
| PostHog | as sent | project timezone |
| Looker | as modelled in LookML | the per-query `query_timezone` |
| Tableau | as modelled in the data source | data source and extract dependent |
| Power BI | as modelled in the semantic model | model dependent; check the date table |
| Snowflake | as stored | the session `TIMEZONE` parameter |
| BigQuery | as stored | **UTC by default** |
| Cube | as modelled | the `timezone` query parameter |
| Segment / RudderStack | not applicable | event `timestamp`, UTC in the payload |

Three that bite hardest:

- **Salesforce reports run in the running user's timezone.** The same report run
  by two people can land a record on two different days.
- **Braze has already converted revenue to USD.** Converting again is a real
  error that looks like a rounding difference.
- **Mixpanel's project timezone setting retroactively re-buckets historical
  reports.** A number quoted last month may not reproduce this month, with no
  data change and no query change.

### Attribution window, attribution basis, date basis

| Platform | Window source | Basis source | Date basis |
|---|---|---|---|
| Google Ads | per conversion action, 1 to 90 days, default 30 | data-driven by default, set per conversion action | **click date**, back-fills up to 90 days |
| Meta | API default `7d_click`; ad-set setting mirrors Ads Manager | ad-set level attribution setting | impression or click date; settles over 28 days |
| LinkedIn | `postClickAttributionWindowSize` (1/7/30), `viewThroughAttributionWindowSize` (1/7/30) | `LAST_TOUCH_BY_CAMPAIGN` by default | conversion event date |
| GA4 | 30-day acquisition lookback, 30 or 90 for paid and organic | data-driven by default | session or event date |
| CRM | not applicable | the campaign-influence model configured in the org | close date, created date, or stage-change date. **Say which.** |

The full cross-platform table with its consequences lives in
`comparability-rules`. Carry the three fields; do not compare on them here.

### Freshness and settling windows

`freshness.provisional` is true whenever `data_as_of` falls inside
`settles_after`.

| Platform | Settles after |
|---|---|
| GA4 | 24 to 48 hours for full processing on standard properties |
| Google Ads | conversions back-fill for up to **90 days** |
| Meta | restates for **28 days** |
| LinkedIn | conversion-date reporting, comparatively stable, but the 6-month daily window matters |
| Warehouse or BI extract | the extract refresh time, not the query time |
| dbt-modelled table | the model's last successful run, not `manifest.json`'s generation time |

> There is no date on which the four major ad and analytics platforms are
> simultaneously final except roughly 90 days back.

### Three clocks, shown separately

Deployment time, bake or extract time, and source data freshness are three
independent facts. Conflating them produces the most confident stale numbers in
the stack.

| Clock | What it is | What it is not |
|---|---|---|
| **Deployment time** | when the dashboard, model or report definition last changed | any statement about the data |
| **Bake / extract time** | when the extract, materialisation or pre-aggregation last ran | source freshness |
| **Source data freshness** | the latest event timestamp the source itself holds | either of the above |

A freshly deployed dashboard can serve an eight-hour-old extract of data that
was itself 36 hours behind. Report the clock the user's question depends on, and
where the gap is material, report all three.

Platform handles: Tableau `hasExtracts` and `extractLastRefreshTime`. dbt
`metadata.generated_at` on `manifest.json`, which describes when the **artefact**
was generated, not when the model last ran and not whether the model still
exists. Cube pre-aggregation refresh keys. BI caches that serve pre-change rows
after the change shipped.

## `timezone_status` is a first-class disclosure

Three values:

- `confirmed` — read from a response field or an account setting you queried.
- `assumed` — inferred from a documented default, not observed.
- `unconfirmed` — not established.

**Doing arithmetic in UTC does not establish that the source reports in UTC.**
Where status is not `confirmed`, day-boundary comparison against the source UI
is disabled or explicitly caveated, and the exact input that would resolve it is
named: "the property timezone from the admin screen", "the ad account timezone
setting", "the report's running user".

Day-level answers are where this bites. A month total is robust to an eight-hour
offset. A "Tuesday versus Wednesday" answer is not.

## Credential identity is part of provenance

**Always log which credential produced a number.** The same query, run by two
identities, legitimately returns different numbers on several platforms, without
an error on either side.

| Platform | How the credential changes the number |
|---|---|
| GA4 | `schemaRestrictionResponse` — field-level permissions restrict cost and revenue metrics; two service accounts return different revenue |
| Salesforce | field-level security omits fields rather than erroring; a report run by the integration user returns fewer rows than the admin sees |
| HubSpot | a private-app token **ignores user permissions and returns more** than a human sees; no access to Sensitive Data Properties |
| Looker | a field absent from an explore is permission-shaped blindness, with no error |
| Snowflake | masking policies mean masked reads **succeed**; check `POLICY_REFERENCES` |
| BigQuery | row-level security silently filters; a dry run returns 0 bytes on RLS tables deliberately |
| Braze | dashboard-user-bound OAuth means agent permissions mirror the human's |
| Amplitude | permissions are inherited from the connecting user |

`permission_scope_note` records what the credential could not see, when that is
knowable. "Ran as the integration user, which cannot read the Opportunity
Product object" is provenance, not an aside.

## Measured versus modelled, labelled at the point of display

Where a series is derived by applying a share, coefficient or vendor model
rather than measured, it is marked **modelled on the chart**, not in a footnote,
with the formula published and the limitation named.

Modelled by definition, per the platforms' own documentation:

- **Google Ads data-driven attribution** — a vendor model, not an observation.
- **Meta post-ATT modelled conversions** — statistically estimated, included in
  reported conversions.
- **GA4 behavioural modelling and thresholded demographics** — modelled to fill
  consent gaps.
- Anything the agent itself derives by applying a ratio, a split, or a
  coefficient to a measured series.

These numbers are not derivable from raw extracts. A warehouse cannot reproduce
them, which is a reason to report both series rather than to pick one.

## Integrity flags

| Flag | Set when |
|---|---|
| `sampled` | the platform sampled. GA4 `samplingMetadatas[]` with ratio below 1 |
| `thresholded` | rows suppressed for privacy or minimum-audience rules. GA4 `subjectToThresholding` |
| `other_row` | high-cardinality rollup. GA4 `dataLossFromOtherRow` |
| `truncated` | a cap was hit. Row caps, element caps, partial-result warnings |
| `cached` | served from a cache that may predate a change |
| `modelled` | contains a vendor-modelled or agent-derived component |
| `approximate` | an approximation algorithm was used. Cube `countDistinctApprox`, HLL distinct counts |

Population is `warning-field-reader`'s job. This skill records them, decides
whether they trigger display, and renders them as sentences.

## Calls

- `warning-field-reader` populates `integrity_flags` before this block is sealed
- `pagination-patterns` populates `row_coverage`
- `mcp-detect-fallback` records which path produced the number
- Feeds `answer-contract`, `comparability-rules`, and every reconciliation skill

## References

- `references/field-sources.md` — the full per-platform source table, all fields
- `references/freshness-and-clocks.md` — settling windows, the three clocks, and the staleness traps
