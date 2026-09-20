# The comparison contract, dimension by dimension

Run this before any reconciliation. A mismatch on any dimension means the two
figures answer different questions, and reconciling them is work that cannot
succeed.

---

## 1. Tenant / account / property

Sounds trivial and is not. Common mismatches:

- two GA4 properties on the same site, one legacy
- an ad account plus a second account for a regional team
- a HubSpot portal that excludes a business unit
- a Salesforce sandbox mistaken for production
- a warehouse schema that filters to one brand

**Check:** the property ID, account ID, portal ID or database.schema on both
sides. Put it in the provenance block; do not rely on the label on the
dashboard.

**Tenant-scoped views produce empty results that look like findings.** Where a
view is hard-filtered to a tenant, an empty result is **not applicable**, never
a measured zero.

---

## 2. Exact date endpoints

Three separate questions, all of which get answered wrong:

- **Inclusive or exclusive end?** `< 2026-10-01` and `<= 2026-09-30` agree;
  `<= 2026-10-01` does not.
- **In which timezone is the boundary?** A day boundary in the property
  timezone and one in UTC differ by up to a full day of data for the edge days.
- **Is the last period complete?** A comparison where one side includes a
  partial day and the other does not is not a comparison.

**Equal window is not equal coverage.** Compute covered-day counts on both
sides, and where they differ use an observed-day rate or suppress the
comparison. See `temporal-integrity-audit`.

---

## 3. Source medium

Three kinds of number, which do not converge:

| Medium | Example | Property |
|---|---|---|
| **platform-reported** | Meta's conversions, Google's conversions | includes vendor modelling |
| **warehouse-extracted** | events landed and aggregated by you | measured only |
| **modelled** | anything derived by applying a share or coefficient | must be labelled modelled at the point of display |

**A platform-reported number and a warehouse-extracted number are two
legitimate series and will not match.** The pack says so rather than picking
one. Where a decision needs one number, say which is the right one for that
decision and why, keeping the other visible.

---

## 4. Event set

Which events count as "the thing".

- GA4 key events versus all conversions versus a specific event name
- a purchase event fired client-side and again server-side
- an ESP's "conversion" being whatever `conversion_metric_id` points at, set
  per flow, so two flows can mean two different events
- Braze's two conversion bases, chosen per campaign
- refunds and cancellations: included, excluded, or netted

**Check both sides' event definition, not the label.** "Conversions" is not an
event set.

---

## 5. Attribution model and window

| Question | Why |
|---|---|
| which model | last-click, data-driven, platform-modelled, first-touch |
| click window | 1, 7, 28 days |
| view window | 0, 1 day, or view-through excluded entirely |
| counting method | once per event, once per session, once per user |
| conversion date basis | attributed to the click date or the conversion date |

That last one is a quiet killer: attributing a conversion back to the **click
date** moves revenue into an earlier period than attributing it to the
**conversion date**, and both conventions exist within a single platform's
reporting options.

---

## 6. Timezone

**None of these platforms defaults to UTC, and six platforms in one stack means
six rules.** Full table in `temporal-integrity-audit`. The short version:

| Platform | Rule |
|---|---|
| Salesforce | the **running user's** timezone |
| HubSpot | UTC-midnight date properties |
| Marketo | instance timezone |
| Pardot | export-creator's timezone |
| Braze | workspace timezone |
| Klaviyo | account timezone; only `metric-aggregates` accepts an explicit `timezone` |
| Amplitude / Mixpanel / PostHog | project timezone |
| GA4 | property timezone |
| Google Ads / Meta | account timezone |
| Snowflake | session `TIMEZONE`, often defaulting to America/Los_Angeles |
| BigQuery | UTC |
| Looker | per-query `query_timezone` |
| Tableau | data source / server timezone, no per-query override |
| Power BI | service UTC versus Desktop local |
| Cube | explicit `timezone` query parameter |

**`timezoneStatus` is carried explicitly: confirmed, assumed or unconfirmed.**
Doing your arithmetic in UTC does not establish that the source reports in UTC.
Where the status is unconfirmed, day-boundary comparison against the source UI
is disabled or caveated, and the exact input that would resolve it is recorded.

---

## 7. The contract check, as output

```
comparison_contract:
  tenant:        match      (property A = property A on both sides)
  date_endpoints: MISMATCH  (source A inclusive end, source B exclusive;
                             source A property timezone, source B UTC)
  source_medium:  MISMATCH  (A is platform-reported incl. modelled;
                             B is warehouse-extracted, measured only)
  event_set:      match     (purchase, deduplicated server-side)
  attribution:    MISMATCH  (A: 7d click 1d view; B: last click same session)
  timezone:       unconfirmed for B

verdict: three_different_questions

These three figures cannot be reconciled to one number. What CAN be done:
  - normalise the date endpoints and re-pull both: closes the edge-day gap
  - request A on a last-click basis if the platform exposes it: closes the
    attribution gap for the measured portion
  - the modelled portion of A is not derivable from B by construction and
    the residual will remain
```

---

## 8. When the contract passes

Then, and only then, reconcile. Work the cause register in order, quantify each
cause, and report the residual as a residual.

A passing contract does not mean the numbers will match. It means a difference
between them is a finding rather than a category error.
