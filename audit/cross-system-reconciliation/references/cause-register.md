# The cause register

Each cause with its typical direction and magnitude, how to evidence it, and
how to quantify it. Direction is stated from the perspective of the
platform-reported number versus the independently computed one.

---

## C1. Attribution window difference

**Direction:** wider window reports more. **Magnitude:** 10-40% between a
1-day-click and a 7-day-click-1-day-view window, larger for considered
purchases.

**Evidence:** the window setting on both sides, read from the API rather than
assumed.

**Quantify:** re-pull the platform figure at the other side's window if the
platform exposes it. Where it does not, the gap attributable to the window is
not separable and should be stated as such rather than estimated.

---

## C2. Modelled versus measured conversions

**Direction:** platform-reported is **higher**. **Magnitude:** varies by
platform, category and consent rates; can be substantial post-ATT.

**Evidence:** the platform documents that the metric includes modelling.
Meta's post-ATT modelled conversions and Google's data-driven attribution are
modelled by definition.

**Quantify:** **you cannot, from raw extracts.** The modelling is the vendor's
and is not derivable. State that the residual includes an unquantifiable
modelled component, and **label the platform series modelled at the point of
display**.

This is a genuine limit, not a gap in the audit.

---

## C3. De-duplication policy

**Direction:** either, depending on which side dedups. **Magnitude:** 5-25% on
email metrics.

**Evidence:** the platform's documented dedup behaviour, and your own
`count(distinct ...)` versus `count(*)`.

**Special case:** **Marketo's de-duplication and bot filtering are
undocumented, so reproducing its report numbers from the API is structurally
impossible.** Adobe's own guidance is to extract activities and compute your
own numbers. Specify the metric as independently computed and explain the
difference rather than chasing parity.

---

## C4. Permission scope

**Direction: opposite on different platforms, which is why it is missed.**

| Platform | Direction | Mechanism |
|---|---|---|
| **Salesforce** | API shows **LESS** | report output honours the running user's sharing, role hierarchy and FLS; fields omitted rather than nulled |
| **HubSpot** | API shows **MORE** | private-app tokens are portal-scoped and ignore user roles and field permissions |
| **GA4** | either | `schemaRestrictionResponse`: two service accounts can legitimately return different revenue |
| **Tableau** | less | RLS silently changes every number by PAT/JWT identity |
| **Snowflake** | looks the same | masking policies return masked values that look like data |
| **Cube** | less | `/v1/meta` and `/v1/load` scoped by the JWT security context |

**Evidence:** run the same query under two identities. The delta is the
permission effect. See `permission-effect-audit`.

**Quantify:** directly, by the two-identity diff, where a second credential is
available.

---

## C5. Soft-deleted and hidden records

**Direction:** API shows **more**. **Magnitude:** can be an order of magnitude.

| Platform | Behaviour |
|---|---|
| **Google Ads** | `status = 'REMOVED'` entities persist forever; the UI hides them, the API does not. **The number one cause of "the API says 400 campaigns, the UI says 50".** |
| **Looker** | `search_looks` / `search_dashboards` return soft-deleted content (`deleted: true`, roughly 90-day trash) unless filtered |
| **Tableau** | 30-day recycle bin; content IDs stay resolvable for a window |
| **Power BI** | deleted Fabric items sit in a recycle bin; Admin scanner APIs can return items users can no longer see |
| **Salesforce** | recycle bin, plus `IsDeleted` on queryable objects |

**Evidence:** filter on the status field and re-count. **Quantify:** exactly,
by the count difference.

**The inverse, which looks identical to a stakeholder:** **Google Ads does not
return zero-impression rows.** A "missing campaign" usually means no
impressions that day. Query the resource without metrics, or join to the full
entity list, to distinguish "absent" from "zero".

---

## C6. Timezone and day boundaries

**Direction:** either; concentrated in the first and last day of a window.
**Magnitude:** up to a full day of data on the edges, so proportionally larger
on short windows.

**Evidence:** the timezone field or setting on both sides, and the
`timezoneStatus` (confirmed / assumed / unconfirmed).

**Quantify:** re-pull with the boundaries shifted, or compute the edge days
separately and compare only the interior days.

---

## C7. Currency

**Direction:** either. **Magnitude:** the FX move over the period, plus the
convention difference.

**Evidence:** **no BI or warehouse platform has a currency type**, so this is
never in metadata. Read the platform account's currency setting (GA4
`ResponseMetaData.currencyCode`, Google Ads `customer.currency_code`, Meta
`account_currency`) and the warehouse's conversion logic.

**Braze converts revenue to USD already.** A second conversion double-converts.

**Quantify:** exactly, if the rate table and conversion date convention are
known. If either is unknown, the currency component is unquantifiable and
should be named rather than estimated.

---

## C8. Extract or cache staleness

**Direction:** the stale side is lower for growing series. **Magnitude:** one
refresh interval's worth.

**Evidence:** three clocks, shown separately: deployment time, extract/bake
time, and source data freshness. **An object's last-modified timestamp is
metadata about the object, not about the business dates inside it.**

**Quantify:** exactly, by re-pulling both at the same moment.

---

## C9. Sampling, thresholding and cardinality rollup

**GA4 specifically, and these make certain reconciliations impossible by
construction:**

| Field | Meaning | Effect on reconciliation |
|---|---|---|
| `samplingMetadatas[]` | estimated from a sample; rate = `samplesReadCount / samplingSpaceSize` | the number has a sampling error; shorten the range, drop dimensions, or use the BigQuery export |
| `subjectToThresholding: true` | rows suppressed for privacy | **segment sums will not equal the total.** Never present a segment sum as the total. |
| `dataLossFromOtherRow: true` | high-cardinality rollup into `(other)` | there is no long tail to reconcile against; name the dimension |
| `emptyReason` | an empty report is not always "no data" | read it and report it |

**Evidence:** these are response fields. Read them; `warning-field-reader`
makes it non-optional.

**Quantify:** sampling rate is computable. Thresholding suppression is not,
because the suppressed rows are not returned.

---

## C10. Ingestion versus destination counts

**Direction:** destination is **lower**, usually. **Magnitude:** whatever the
filter removes.

**Evidence:** Segment or RudderStack egress counts versus the destination's own
number. **Check the destination's own filters and transformations before
escalating a pipeline fault.** It is usually a filter someone added, not a
dropped event.

**Quantify:** by reading the filter and counting what it excludes.

---

## C11. Late-arriving data and restatement

**Direction:** the earlier-read side is **lower**. **Magnitude:** platform
specific.

| Platform | Settlement |
|---|---|
| Meta | ~28 days |
| Google Ads | conversion backfill up to 90 days |
| GA4 | reprocessing over 24-48 hours |
| Klaviyo | an attribution-window change **restates all history retroactively** |
| Bizible-style touchpoint systems | recalculate on their own schedule |

**There is no date on which all sources are simultaneously final except roughly
90 days back.** Any reconciliation inside a settlement window is reconciling a
provisional number, and the answer is labelled provisional.

**Quantify:** re-read the same window later and diff. That diff is the
restatement.

---

## C12. Join coverage

**Direction:** the joined side is **lower**. **Magnitude:** the unmatched
measure total, which is frequently much larger than the unmatched row share.

**Evidence:** matched / unmatched / ambiguous counts plus the measure total
carried by unmatched rows. See `relationship-discovery`.

**Quantify:** exactly, and **report the amount-weighted coverage, not just the
row-weighted coverage.** 94% of rows matching can be 69% of the money.

---

## Residual reporting

After working the register, whatever remains is the residual.

```
gap:      11.4% (platform 1,240 vs computed 1,113)
explained:
  C1 attribution window   ~7.2pp   evidenced, platform on 7d-click-1d-view
  C5 removed entities     ~1.9pp   evidenced, 34 REMOVED campaigns included
  C6 timezone edge days   ~0.8pp   evidenced, account tz vs UTC
residual: ~1.5pp
  likely composition: modelled conversions (C2), which are not derivable
                      from raw extracts by construction
  why not pursued: no further decomposition is possible without vendor
                   modelling detail that is not published
```

**Report the residual as a residual.** Folding it into the largest named cause
to make the table balance is the same failure as averaging two sources.
