---
name: content-seo-attribution
description: Use for content, SEO and organic-channel analysis — which content contributes to pipeline or revenue, organic performance trends, content-to-conversion paths, or the value of a content programme. Joins content engagement to the assembled journey rather than measuring page views in isolation, handles the branded-versus-non-branded split that determines whether organic is creating or harvesting demand, and states the attribution limits that apply to a channel whose effect is long-lagged and diffuse. Prevents a content programme judged on traffic when the question was pipeline.
---

# Content and SEO Attribution

Content is the channel most often judged on the wrong metric. Someone asks what
the content programme contributed to pipeline, and the answer that comes back is
sessions.

It is also the channel most disadvantaged by the measurement stack. Content works
early, slowly and diffusely — which means **last-touch structurally starves it
and first-touch structurally flatters it**, and much of what it actually drives
lands in Direct, where nothing can see it.

---

## 1. Branded versus non-branded is the first split

**Branded organic largely harvests demand created elsewhere.** Someone searching
your company name already knows you exist. Crediting that traffic to the content
programme credits content with the brand's existing awareness — and with every
other channel that created it.

```
branded     = query matches the brand pattern
non_branded = everything else
```

Build the brand pattern deliberately:

- Company name and its common misspellings and spacings.
- Product names, including ones no longer marketed.
- Founder or executive names where they are searched.
- Branded-plus-modifier queries: "brand pricing", "brand reviews", "brand vs
  competitor", "brand login".

**Then state the rule in the output.** The classification is a judgement, and two
reasonable people will draw the line differently on competitor-comparison and
category-plus-brand queries. A branded/non-branded split with an unstated rule is
not reproducible.

**The consequence to lead with:** if non-branded organic is flat while branded
organic grows, the content programme is not creating demand — something else is,
and organic is collecting it. That is a finding, and it is usually the one
someone actually needed.

---

## 2. Content effects are long-lagged and diffuse

A blog post read in March contributes to a deal closed in September through a
path nobody recorded end to end.

| Model | What it does to content | Why |
|---|---|---|
| **Last touch** | structurally starves it | content is almost never the final touch before a conversion |
| **First touch** | structurally flatters it | content is very often the first tracked touch, including when the real first touch was untracked |
| **Linear** | rewards content volume | a programme publishing more pieces accumulates more touches |
| **Time decay** | starves it further | content touches are the oldest in the journey by construction |

**Run both first-touch and last-touch and report the spread, exactly as in
`attribution-rule-based`.** For content the spread is usually wide, and the width
*is* the finding: content's contribution is genuinely unresolved by allocation
rules, and the honest resolution is a holdout or a geo test on the programme,
not a different rule.

**The lag also breaks the reporting period.** Content published this quarter
cannot have produced this quarter's pipeline. Report content contribution
**by publication cohort at matched age** (§6), not by reporting period.

---

## 3. Direct is a dumping ground, and much of content lands there

Direct absorbs: untagged email links, dark social (messaging apps, private
communities, Slack), app-to-web transitions, stripped referrers under privacy
settings, typed URLs, bookmark returns, and anything where the referrer was lost.

**A large share of what content actually drives arrives as Direct**, because
someone reads an article, remembers the company, and returns later by typing the
URL.

What to do:

1. **Classify Direct explicitly and state the rule.** Under last-non-direct, the
   credit is reassigned to whatever came before — which is an unaudited rule with
   a real effect on content's number.
2. **Report Direct's size and its trend** as a first-class line, not a residual.
   Growing Direct alongside growing content output is consistent with content
   working and invisible; it is also consistent with tagging degrading. Both need
   checking.
3. **Audit tagging before drawing conclusions.** A rise in Direct that coincides
   with a campaign-tagging change is a measurement artefact and will otherwise be
   read as brand strength.
4. **Never silently fold Direct into "organic" or "brand".** It is its own
   bucket with its own uncertainty.

---

## 4. Page engagement is not content value

Sessions, pageviews and time on page measure consumption. The question is
contribution.

**The join chain is: content engagement → person → outcome.** Every link has
coverage, and the coverage is the answer's floor.

```
content_sessions
  → sessions with a resolvable person       (coverage %)
    → persons matched to a CRM record       (coverage %)
      → records with an opportunity          (coverage %)
```

**Report the coverage at each step**, because the uncovered remainder is where
the uncertainty lives — and where the most valuable content may be, since
anonymous readers are exactly the top-of-funnel audience content is meant to
reach.

A worked shape:

> Of 412,000 content sessions last quarter, 11% resolved to a known person and
> 8% to a CRM record with an opportunity. **The pipeline figure below is computed
> on that 8%**, so it is a floor, not an estimate of content's contribution. The
> other 92% is not zero — it is unmeasured, and the ratio between them is exactly
> what a content programme's measurement problem looks like.

---

## 5. Measurement limits, stated plainly

### GA4 cardinality rollup

**`pagePath` and `pageTitle` are classic high-cardinality victims.** When a report
exceeds the cardinality limit, low-volume values roll into `(other)` and the
response sets `dataLossFromOtherRow`. For a content site with thousands of URLs,
this is not an edge case — **it is the default outcome of any page-level report
over a long window.**

- **Check `dataLossFromOtherRow` on every page-level response.** Where true,
  individual page figures are still valid but the **set is incomplete and page
  figures will not sum to the site total.**
- **Route around it**: shorter windows, filtered to a content path prefix, or the
  BigQuery export, which has no cardinality rollup.
- **Never reconcile a page-level sum to a site total across a rollup.** It is not
  reconcilable by construction.

### Search Console

| Property | Consequence |
|---|---|
| **Query anonymisation** — queries below a privacy threshold are omitted | **query-level clicks do not sum to page-level or site-level clicks.** The gap is real and unrecoverable, and it is largest on long-tail content, which is most of a content programme |
| **16-month retention** | longer trends are unavailable from the API; archive if you need them |
| **~2–3 day processing delay**, with a fresh-versus-final data state | a recent-days comparison is comparing provisional data |
| **25,000 rows per request**, paginated by start row | a large site needs paginated extraction; see `pagination-patterns` |
| **Average position is an average of averages** | it is not a rank you held; it is a weighted artefact, and small changes in impression mix move it without any ranking change |

### MCP availability

**There is no official Google Search Console MCP server.** The one community
server worth considering is `ahonn/mcp-server-gsc` — genuinely maintained and the
single community server in the whole research survey judged adoptable. **Adopting
it remains an explicit decision to record**, not an assumption. The fallback is
the Search Console API directly, and per `mcp-detect-fallback` that fallback must
exist regardless.

### Content consumed without a click

SERP snippets, AI overviews and answer boxes, syndication, newsletter
republication, and scraped copies. **This consumption is invisible to every
measurement route you have.** It is not small and it is growing. Say so; do not
let an impressions-to-clicks decline be read purely as a ranking problem when it
is partly a consumption-pattern change.

---

## 6. Content cohorts, not content snapshots

**A piece published last month cannot be compared to one published two years ago
on cumulative contribution.** The older piece has had 24 months to accumulate.

```
contribution(piece, age_months) = outcome attributed within `age_months` of publication
```

Compare at **matched age**: month-3 performance against month-3 performance.

This also gives the programme-level view worth having: plot median contribution
by age across publication cohorts. **If recent cohorts are underperforming older
cohorts at the same age, the programme is declining** — a conclusion that a
snapshot of current traffic, dominated by old winners, will never show.

Two cautions:

- **Mark algorithm updates and site migrations** on the cohort chart. A cohort
  that launched into an update is not comparable to its neighbours.
- **Content is edited.** A piece "published" two years ago and rewritten last
  month is a new piece wearing an old date. Use the substantive-update date where
  it exists, and say which date you used.

---

## 7. Custom visibility metrics are not comparable to vendors'

Share of voice, visibility score, content score and AI-answer presence are each
defined differently by every tool that reports them, and by every in-house
implementation.

- **Name yours distinctly** — `share_of_voice_internal_v2`, not "share of voice".
- **State that it is not comparable to any vendor's same-named number**, and do
  not chart the two together.
- **Two metrics with different denominators never share an axis or a sentence
  without both denominators labelled.** See `comparability-rules` on metric-name
  collision.
- **Version it and date the version.** These definitions change when the tool's
  keyword set changes, which is not a visibility change.

---

## 8. Output

```
split:
  branded, non_branded, rule_stated, ambiguous_queries_share
  direct: { sessions, trend, classification_rule, tagging_audit_date }
attribution:
  by_model[]: model → content contribution (pipeline, revenue)
  spread: { min, max, range_pp, verdict: act | hold | test }
  claim: correlational
join_coverage:
  content_sessions, resolved_person, matched_crm, with_opportunity
  each with count and share; figure_is: floor
cohorts[]:
  publication_cohort, n_pieces, contribution_at_age[], date_basis: published | updated
  annotations: algorithm_updates[], migrations[]
limits:
  ga4_other_row: bool, affected_reports[]
  gsc_anonymisation_gap: { query_clicks, page_clicks, unattributed }
  gsc_data_state: fresh | final
  unmeasurable[]: serp_snippets, ai_overviews, syndication, dark_social
custom_metrics[]: name, definition_version, not_comparable_to[]
```

---

## 9. Answering

**Answer first**, with the floor labelled as a floor.

> **Content-sourced pipeline was at least 1.9M last quarter under first-touch and
> 0.4M under last-touch.** That five-fold spread is not a data problem — it is
> what a long-lagged, top-of-funnel channel looks like under two allocation rules
> that disagree by construction, and no third rule resolves it.
>
> Both figures are computed on the 8% of content sessions that resolve to a CRM
> record with an opportunity, so both are floors rather than estimates. The
> unresolved 92% is not zero; it is unmeasured, and it is disproportionately the
> anonymous top-of-funnel readership content exists to reach.
>
> The split that matters more than either number: **non-branded organic sessions
> are flat year on year while branded organic is up 34%.** The content programme
> is not creating the demand growth — it is collecting demand created elsewhere,
> and being credited for it.
>
> Page-level figures came back with the cardinality rollup active, so individual
> page numbers are valid but will not sum to the site total. The BigQuery export
> would give a complete page set.
>
> For deciding whether content is worth continuing, the direction is clear enough
> and the branded split is the important part. For sizing its contribution to
> justify a budget increase, neither figure will survive scrutiny — a content
> holdout in a set of matched markets would, and it is the only route that
> resolves the spread.

**Withhold only:** a single-model content contribution presented as the figure —
give the spread instead — and a page-level total reconciled across a cardinality
rollup, which is not reconcilable by construction. **Never withhold the content
pipeline number because coverage is low.** Label it a floor, state the coverage,
and name the direction.

---

## References

- `references/organic-measurement-limits.md` — GSC and GA4 field-level behaviour, the anonymisation gap, the cardinality rollup, and the extraction patterns that route around each
- `references/content-cohorts.md` — cohort construction, matched-age comparison, the publish-versus-update date decision, and reading a programme-level decline

## Core contracts called

- **`answer-contract`** — the floor labelling, the spread requirement, and both withholds
- **`provenance-block`** — GSC data state (fresh versus final), GA4 property timezone, and the `dataLossFromOtherRow` flag on every page-level figure
- **`comparability-rules`** — GSC clicks and GA4 sessions are different objects on different clocks and must never be summed or charted as one series; custom visibility metrics against vendor ones
- **`warning-field-reader`** — `dataLossFromOtherRow`, `samplingMetadatas` and `subjectToThresholding` on GA4 responses; the anonymisation gap on GSC
- **`pagination-patterns`** — GSC returns 25,000 rows per request with start-row pagination; a large content site exceeds it routinely
- **`mcp-detect-fallback`** — there is no official GSC MCP server; the direct-API fallback is the primary path, not the backup

## Related skills

- `attribution-rule-based` — the spread across models, which content needs more than any other channel.
- `journey-assembler` and `identity-resolution` — the person join whose coverage is this analysis's floor.
- `funnel-model-designer` — where content sits in the funnel before it is measured.
- `experiment-design-readout` — for the content holdout that resolves the spread.
