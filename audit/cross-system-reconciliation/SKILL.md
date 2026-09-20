---
name: cross-system-reconciliation
description: Use whenever two systems report different numbers for what should be the same thing — CRM versus marketing automation, ad platform versus warehouse, product analytics versus billing, or a dashboard versus its source. Runs a deterministic reconciliation that recomputes every rate, funnel, period comparison and join coverage from the retrieved aggregates, checks the six comparison-contract dimensions first, and reports the disagreement with its cause named. Never averages two sources and never silently prefers one.
---

# Cross-System Reconciliation

Two numbers that disagree are usually two answers to two different questions.
The job is to establish which, name the cause, and say so. **Never average two
sources. Never silently prefer one.**

---

## 1. The comparison contract runs first

Before reconciling anything, check that the two figures are even comparable
along six dimensions:

| # | Dimension | Must match |
|---|---|---|
| 1 | **Tenant / account / property** | same property, same ad account, same portal, same workspace |
| 2 | **Exact date endpoints** | both inclusive? both in the same timezone? |
| 3 | **Source medium** | platform-reported versus warehouse-extracted versus modelled |
| 4 | **Event set** | which events count as the thing being measured |
| 5 | **Attribution model and window** | including view-through and the counting method |
| 6 | **Timezone** | see `temporal-integrity-audit`; no platform defaults to UTC |

**If they do not match, three different totals are three different questions,
not one broken number, and the skill says that rather than reconciling.**

Stopping here is often the whole deliverable. "These cannot be compared, here
is why, here is the comparison that can be made" is a better answer than a
reconciliation table that implies the gap is closable.

---

## 2. Deterministic recomputation is mandatory

**For every numeric cross-system comparison, run a credential-free
recomputation step from the already-retrieved aggregates.** Recompute:

- every rate (numerator and denominator restated explicitly)
- every funnel step count
- every period-over-period comparison
- every deduplicated value
- two-source join coverage: matched, unmatched, ambiguous

This catches the errors that are in your own arithmetic before you attribute
the gap to a platform. It costs nothing, it needs no API calls, and it is
skipped constantly.

---

## 3. The structural causes, as a checklist

Work through these in order. Most gaps are explained by one or two.

### 3.1 Attribution window and basis

The same campaign reports different conversions under a 1-day-click window and
a 7-day-click-plus-1-day-view window. Check the window on **both** sides,
including whether view-through is included and whether the counting method is
once-per-event or once-per-session.

### 3.2 Platform-modelled versus measured

**Meta's post-ATT modelled conversions and Google's data-driven attribution are
computed by the vendor and are not derivable from raw extracts.** A warehouse
number built from raw events will be lower and will never converge. This is not
a bug to fix; it is two legitimate series. Label the platform series modelled
at the point of display.

### 3.3 De-duplication differences

Marketo reports unique versus gross activity counts; per-contact open dedup is
common in ESPs. Two systems counting the same sends can differ by 20% purely on
dedup policy. **Marketo's own de-duplication and bot filtering are
undocumented, so reproducing Marketo's report numbers from the API is
structurally impossible.** Compute independently and explain the difference.

### 3.4 Permission scope, which moves the number in opposite directions

- **Salesforce report output honours the running user's sharing, role hierarchy
  and field-level security, so the API commonly shows LESS than an admin
  sees.** Fields are omitted rather than nulled.
- **HubSpot private-app tokens are portal-scoped and ignore user roles and
  field permissions, so the API commonly shows MORE than a UI user sees.** This
  is usually why a manager says the agent's number is too high.

See `permission-effect-audit`.

### 3.5 Soft-deleted records

**Google Ads keeps `status = 'REMOVED'` entities forever. The UI hides them;
the API does not.** This is the number one cause of "the API says 400
campaigns, the UI says 50". Looker `search_looks` / `search_dashboards` return
soft-deleted content unless filtered. Salesforce has a recycle bin. Filter
deliberately and state the filter.

Also the inverse: **Google Ads does not return zero-impression rows.** A
"missing campaign" usually means no impressions that day, not a data gap. Query
the resource without metrics to get the full entity list.

### 3.6 Timezone and currency

Six platforms in one stack means six timezone rules and none of them is UTC.
Currency has no type anywhere, so a currency mismatch is invisible in metadata.
See `temporal-integrity-audit`.

### 3.7 Extract or cache staleness

Three clocks are independent: deployment time, extract/bake time, and source
data freshness. **An object's last-modified timestamp is metadata about the
object, not about the business dates inside it.**

### 3.8 Sampling, thresholding and cardinality rollup

GA4 specifically: `samplingMetadatas` means the number is estimated;
`subjectToThresholding` means rows are suppressed for privacy and **totals will
not add up**; `dataLossFromOtherRow` means high-cardinality values rolled into
`(other)`. Any of the three makes a segment-sum-versus-total reconciliation
impossible by construction.

### 3.9 Ingestion counts versus destination counts

Segment or RudderStack egress versus the destination's own number. **It is
usually a filter someone added** in the destination's configuration or a
transformation, not a pipeline fault. Check the destination's filters before
escalating a pipeline discrepancy.

### 3.10 Late-arriving data

Meta settles over ~28 days. Google Ads back-fills conversions up to 90 days.
GA4 reprocesses over 24-48 hours. A reconciliation run on day 3 against a
source with a 28-day settlement window is reconciling a provisional number.

---

## 4. Marginal totals instead of a fabricated intersection

When a requested cross-tab is not exposed by a source's aggregate dimensions,
**return the supported marginal totals and explain why the intersection cannot
be computed deterministically.**

The failure this prevents: an agent paginating indefinitely trying to build the
cross-tab, or inventing a join that produces a plausible number nobody can
verify.

```
Requested: revenue by channel by device.
The source exposes channel totals and device totals, not the intersection.

Channel totals:  [given]
Device totals:   [given]

The intersection is not computable from this source's aggregate dimensions.
It is available from the event-level export, if one exists.
```

That is an answer. It contains numbers, it names the limit, and it names the
route to the better number.

---

## 5. No leg-skipping

**For every multi-system question, complete at least one current-turn read per
named system before answering.**

**A leg may not be skipped because of a remembered gap or because another leg's
result made it look unnecessary.** Two specific failures this prevents:

- "I recall this source does not expose that field" from an earlier session.
  Re-check. Capabilities change and memory is not evidence.
- "System A's number already explains the gap, so I will not query System B."
  The explanation is a hypothesis until B is read.

Where a leg genuinely fails, that leg is `unavailable` and the others are still
reported. **An optional failure must not erase successful evidence.**

---

## 6. Join coverage is disclosed

Every join used in the reconciliation reports matched, unmatched and ambiguous
counts, and the measure total carried by the unmatched rows. See
`relationship-discovery`. A reconciliation built on a 62% join and presented as
complete is a new wrong number, produced by the process meant to find them.

---

## 7. Some reconciliations are not achievable, and saying so is the deliverable

| Pair | Why it will not reconcile |
|---|---|
| **GA4 Data API to GA4 UI** | different computation paths, attribution models, session definitions and key-event counting. The canonical example. |
| **Marketo API to Marketo report** | undocumented de-duplication and bot filtering |
| **Meta reported conversions to warehouse events** | modelled conversions are computed by the vendor and are not derivable from raw data |
| **Sum of platform conversions to actual orders** | each platform independently claims overlapping conversions; the sum overstates by construction |
| **Ad platform spend to invoice** | timezone boundaries, currency conversion date, and credits applied after the fact |

**Reconciling forever is worse than naming the limit.** Set the bound before
starting: after the comparison contract and the structural checklist, whatever
remains is reported as a residual with its likely composition named, not chased
indefinitely.

---

## 8. Output

```
comparison_contract:
  tenant, date_endpoints, source_medium, event_set,
  attribution, timezone            # each: match | mismatch | unknown
verdict: reconcilable
       | reconcilable_after_normalisation
       | three_different_questions
figures[]:
  value, source, basis, provenance_ref, integrity_flags[]
causes[]:
  cause, magnitude, direction, evidence, confidence
residual:
  amount, share_of_gap, likely_composition, why_not_pursued_further
join_coverage[]: edge, matched, unmatched, ambiguous, unmatched_measure_total
legs_read[]: system, read_at, status      # every named system, this turn
```

---

## 9. Answering

**Answer first.** Lead with the verdict and the largest named cause: "The gap
is 11% and roughly three-quarters of it is the attribution window: the ad
platform is on 7-day-click-1-day-view and the warehouse is on last-click
same-session."

**Report both figures, always.** Never average. Never quietly pick the one that
supports the narrative. Where one is the right number for the decision at hand,
say which and why, and keep the other visible.

**Report the residual as a residual.** An unexplained 3% is an honest output.
An unexplained 3% silently folded into the largest named cause is not.

Withhold only: a reconciliation that is structurally impossible (§7). That is
`unavailable` for the reconciliation, with both figures still reported and the
independent computation offered instead.

## References

- `references/comparison-contract.md` — the six dimensions, how to check each
  per platform
- `references/cause-register.md` — the structural causes with their typical
  magnitude and direction

## Related skills

- `comparability-rules` is a **hard** dependency.
- `metric-definition-audit` first, if the definitions themselves differ.
- `temporal-integrity-audit` for the timezone and restatement legs.
- `permission-effect-audit` for the credential-scope leg.
- `relationship-discovery` for join coverage.
