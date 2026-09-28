# Methodology corrections

Verified: 2026-09-28

## 1. PostHog first-page tuple cursor

- **Original:** `core/pagination-patterns/references/per-platform.md`, §PostHog: initialized `last_ts = window_start`, `last_id = null`, then filtered with `(timestamp > last_ts or id > last_id)`.
- **Problem:** On the first request, events exactly at the inclusive start timestamp evaluate `id > NULL` as unknown, while `timestamp > window_start` is false. Those boundary events disappear before the cursor advances.
- **Corrected method:** Leave the cursor unset for page one and use the inclusive time-window predicate only; after a page, seek lexicographically by the non-null `(timestamp, id)` pair.
- **Assumptions:** Event IDs and timestamps are non-null and define a stable total order for the extraction.
- **Primary sources:** [PostgreSQL row comparison and NULL semantics](https://www.postgresql.org/docs/current/functions-comparisons.html).
- **Regression case id:** `pp-08-posthog-first-page-timestamp-boundary`

## 2. Missing required test result cannot be READY

- **Original:** `engineering/data-quality-harness/SKILL.md`, §1: a left join to latest test results followed by `WHEN tests_failed > 0`, `WHEN tests_not_run > 0`, otherwise `READY`.
- **Problem:** When a required test-result row is absent, the joined counts are NULL; both `WHEN` conditions fail and the mart falls through to green READY without evidence that the test ran.
- **Corrected method:** Join each mart to its required-test count; coalesce missing results to zero; return `NOT_READY` when no result aggregate exists, any test is not run, or observed test count is below required count.
- **Assumptions:** `quality.mart_required_test_counts` has one row per governed mart, and `tests_run` counts completed required tests.
- **Primary sources:** This is a fail-closed completeness condition; the CASE branches make the missing-evidence path explicit.
- **Regression case id:** `dqh-06-missing-required-test-not-ready`

## 3. Relationship coverage uses disjoint buckets

- **Original:** `semantics/relationship-discovery/SKILL.md`, §3, and `references/join-scoring.md`: `count(r.key)` was reported as matched while rows with `r.n > 1` were also counted as ambiguous.
- **Problem:** A multi-match row entered both counts, so matched + unmatched + ambiguous exceeded the left-side total and inflated claimed coverage.
- **Corrected method:** Count `r.n = 1` as matched, `r.n IS NULL` as unmatched, and `r.n > 1` as ambiguous; state explicitly that the three buckets are mutually exclusive and sum to all left rows.
- **Assumptions:** The right side is grouped to one row per key before joining, preserving one joined row per left record.
- **Primary sources:** The mutually exclusive partition follows directly from the three disjoint cardinality conditions (0, 1, and >1 matches).
- **Regression case id:** `rd-07-disjoint-coverage-buckets`

## 4. Opportunity snapshots and funnel cohort event order

- **Original:** `b2b/pipeline-forecast/SKILL.md`, historical forecast method, relied on an as-of opportunity state without a reconstruction query; a current-row period filter could omit state existing only at the period-end snapshot. `b2b/funnel-conversion-analysis/references/cohort-construction.md`, §1, described entry and progression windows without constraining event time to cohort entry.
- **Problem:** Mutable current close dates/amounts can erase an opportunity from a historical period, and a stage-B event before stage-A cohort entry can be falsely credited as conversion.
- **Corrected method:** Select each opportunity's latest snapshot at or before the as-of date, then apply period scoring to that reconstructed state. For funnels, require `stage_event_time >= cohort_entry_time` and `< cohort_entry_time + window`.
- **Assumptions:** The snapshot table retains the as-of values and `snapshot_date`; first stage-A entry defines the cohort in the example.
- **Primary sources:** [Kimball Group, fact table types and periodic snapshot tables](https://www.kimballgroup.com/2008/11/fact-tables/); [Microsoft Learn, event time and time-windowed event processing](https://learn.microsoft.com/en-us/stream-analytics-query/time-management-in-azure-stream-analytics).
- **Regression case ids:** `pf-08-reconstruct-asof-snapshot-before-period-filter`; `fca-08-stage-event-after-cohort-entry`

## 5. Journey conversion reporting window

- **Original:** `identity/journey-assembler/SKILL.md`, §5 path-building query filtered touchpoint dates to the report window but did not similarly bound joined conversion events.
- **Problem:** A conversion outside the requested period could be attached to a period touchpoint and counted as an in-window conversion.
- **Corrected method:** Bound `conversion_ts` in the conversion join to `>= window_start` and `< window_end`, using the report's half-open interval convention.
- **Assumptions:** Reporting windows are half-open in the example; conversion time is the event time used for period attribution.
- **Primary sources:** [Google Ads conversion-time reporting](https://support.google.com/google-ads/answer/6270625?hl=en), which distinguishes conversion occurrence time from interaction time.
- **Regression case id:** `ja-07-conversions-bounded-by-report-window`

## 6. Semantic-layer fields and portable registry SQL

- **Original:** `semantics/semantic-layer-builder/SKILL.md`, §1 dbt example referenced `amount`, `is_won`, `is_closed`, and `snapshot_date` without defining their model contract. The registry example and `assets/metric_contract_versions.sql` claimed ANSI portability while using `text[]`, array constructors, and a filtered unique index.
- **Problem:** The dbt semantic model can fail or misrepresent its grain when referenced fields do not exist. PostgreSQL array and partial-index syntax prevents the registry DDL from running as claimed on other SQL engines.
- **Corrected method:** Include the `mart_opportunity` SQL model that selects the source fields and derives `is_won`/`is_closed`. Use `VARCHAR` and a delimited `valid_dimensions` string in the ANSI variant, removing the filtered index and documenting version enforcement in the redefinition transaction.
- **Assumptions:** `stg_opportunity` exposes `opportunity_id`, `account_id`, `close_date`, `snapshot_date`, `stage`, `segment`, and `amount`; the warehouse-neutral example favors portable storage over native array querying.
- **Primary sources:** [dbt semantic models documentation](https://docs.getdbt.com/docs/build/semantic-models); [ISO 9075 SQL standard catalogue](https://www.iso.org/standard/76583.html).
- **Regression case id:** `slb-07-defined-dbt-fields-and-portable-registry`

## 7. Tenant-scoped overlap replacement

- **Original:** `engineering/source-ingestion-mapper/references/ingestion-contract.md`, §4: `DELETE FROM target WHERE source = ? AND event_date BETWEEN ? AND ?`.
- **Problem:** In a shared multi-tenant target, the same source and date range can match another customer's rows, so an overlap replacement for one tenant deletes another tenant's data.
- **Corrected method:** Include `tenant_id = ?` in the delete predicate and load replacement rows under the same tenant, source, and date scope.
- **Assumptions:** The target is shared across tenants and `tenant_id` is the tenant isolation key.
- **Primary sources:** Tenant scoping is a direct predicate requirement of the stated multi-tenant table model.
- **Regression case id:** `sim-06-overlap-replace-scoped-to-tenant`

## 8. Territory first-year ramp capacity

- **Original:** `b2b/territory-quota-capacity/SKILL.md`, ramp arithmetic and worked answer: 36.90 quota-months was reported as approximately `$4.1M`; `references/ramp-and-attrition.md` reported `$3.08M`.
- **Problem:** The two figures disagree, and `$4.1M` does not follow from the stated hire schedule and monthly quota.
- **Corrected method:** `36.90 quota-months × ($1,000,000 annual quota ÷ 12) = $3,075,000`, approximately `$3.08M`; updated both main-skill occurrences to the same value and left the naive `$10M` figure distinct.
- **Assumptions:** The existing worked schedule's 36.90 quota-months and `$1M` annual quota per rep are authoritative inputs; attainment is already reflected in the stated ramp factors.
- **Primary sources:** Arithmetic recomputed directly from the example's stated inputs.
- **Regression case id:** `tqc-08-ramp-capacity-recomputed`

## 9. Formula direction and cohort corrections

### 9a. Cohort CAC

- **Original:** `b2c/cohort-and-ltv/references/cohort-mechanics.md` called CAC “overstated” when duplicate identities inflate the new-customer denominator; the skill also did not state one explicit formula wherever CAC was discussed.
- **Problem:** More apparent customers per dollar lowers spend per apparent customer, so that direction was inverted; mixing periods or denominators also makes CAC incomparable with cohort LTV.
- **Corrected method:** Define `CAC = acquisition spend in the acquisition period ÷ new customers acquired in that same period`, cohort-match with LTV, and call duplicate-inflated denominators CAC understated. Use this same direction in the main skill and references.
- **Assumptions:** Acquisition spend scope is declared by the analyst; the denominator is unique new customers acquired in the matching period.
- **Primary sources:** [Farris et al., *Marketing Metrics*, 4th edition, Pearson](https://www.pearson.com/en-us/subject-catalog/p/marketing-metrics/P200000000122/9780137460267), customer profitability and acquisition-spending treatment.
- **Regression case id:** `clv-08-cac-spend-over-new-customers`

### 9b. Settled paid-media CPA

- **Original:** `b2c/paid-media-analytics/SKILL.md`, settling guidance warned that in-flight and settled pulls differ but did not define the denominator's cohort; a conversion-event-date series could be divided into spend from another period.
- **Problem:** Delayed conversions and interaction-date spend from different cohorts produce a CPA that is neither the settled CPA for the cost cohort nor a like-for-like period comparison.
- **Corrected method:** `CPA = cost for a defined interaction cohort ÷ settled conversions attributed to that same cohort`; keep attribution settings fixed and compare only after the cohort's delay window has matured.
- **Assumptions:** The example uses click-date cohorting; platforms that report on another interaction basis must use that platform's matching cost and conversion basis.
- **Primary sources:** [Google Ads cost-per-conversion definition](https://support.google.com/google-ads/answer/6270625?hl=en); [Google Ads conversion-time reporting and delay guidance](https://support.google.com/google-ads/faq/10286469?hl=en).
- **Regression case id:** `pma-08-settled-cpa-same-interaction-cohort`

### 9c. Propensity prior correction

- **Original:** `ml/supervised-propensity-models/SKILL.md`, §3 used `p_true = p_obs / (p_obs + (1 − p_obs)·r)` while `references/calibration-and-thresholds.md`, §6 used `p_true = p_obs / (p_obs + (1 − p_obs)/r)`.
- **Problem:** The two equations apply opposite prior adjustments; the skill formula pushes the probability in the wrong direction after negative-class undersampling.
- **Corrected method:** Both locations now use `p_pop = p_train / (p_train + (1 − p_train) × ((1 − π_pop)/π_pop) × (π_train/(1 − π_train)))`. With population prior 0.02, training prior 0.17 and training posterior 0.50, the result is about 0.091.
- **Assumptions:** Prior-probability shift holds: class-conditional feature distributions remain stable between training and population. Recalibration on representative data remains preferred where available.
- **Primary sources:** [Elkan, “The Foundations of Cost-Sensitive Learning,” IJCAI 2001 proceedings paper](https://www.ijcai.org/Proceedings/01/IJCAI-2001-k.pdf).
- **Regression case id:** `spm-07-prior-shift-correction-direction`

## 10. Report HTML network disclosure and safe JSON embedding

- **Original:** `delivery/report-generator/SKILL.md`, §8 and `references/html-report-template.md` called the output self-contained/offline while loading Chart.js from jsDelivr, and inserted JSON directly into an `application/json` script element.
- **Problem:** The chart fails without network access, and a value containing `</script>` can terminate the data element; U+2028/U+2029 may also break parsing in JavaScript contexts.
- **Corrected method:** Relabel the output as a single-file report whose interactive chart requires the pinned CDN; explain the fully offline static-SVG option. Add `safeJsonForHtmlScript`, escaping `</script>`, U+2028, and U+2029 before generation-time interpolation.
- **Assumptions:** The report generator renders the template server-side before delivery. The CDN remains the chosen interactive-chart option in this example.
- **Primary sources:** [WHATWG HTML parsing, script data state](https://html.spec.whatwg.org/multipage/parsing.html#script-data-state); [ECMAScript JSON.stringify](https://tc39.es/ecma262/#sec-json.stringify).
- **Regression case id:** `rg-09-html-cdn-disclosure-and-safe-json`
