# Organic measurement limits, per source

Each limit below changes a number. None of them errors.

---

## 1. Search Console

### The API

`POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`

| Element | Values |
|---|---|
| `dimensions` | `query`, `page`, `country`, `device`, `searchAppearance`, `date` |
| metrics returned | `clicks`, `impressions`, `ctr`, `position` |
| `rowLimit` | 25,000 maximum per request |
| `startRow` | offset pagination |
| `dataState` | `final` (default) or `all` (includes fresh, incomplete data) |
| `type` | `web`, `image`, `video`, `news`, `discover`, `googleNews` |

### Query anonymisation — the one that breaks reconciliation

**Queries issued by very few users are omitted for privacy.** They are not
grouped into an "other" bucket; they are absent.

Consequence:

```
Σ clicks over the query dimension  <  Σ clicks over the page dimension
                                   <  site total clicks
```

**All three are correct. They are not reconcilable.** The gap is largest on
long-tail content — which is most of a content programme — so the query-level
view systematically under-represents exactly the content whose value you are
trying to establish.

What to do:

- **Report the gap as a number**, not a caveat: "query-level rows account for
  61% of page-level clicks; the remaining 39% are anonymised queries."
- **Use the page dimension for contribution work** and the query dimension for
  intent and branded/non-branded analysis, accepting that the branded split is
  computed on the non-anonymised subset.
- **Never present a query-level click total as site traffic.**

### Other behaviours

| Behaviour | Consequence |
|---|---|
| **16-month retention** | longer trends are impossible from the API; archive monthly if you need them |
| **~2–3 day processing delay** | the most recent days are incomplete. `dataState: "all"` returns them; **anything using it is provisional and must be labelled** |
| **Average position is an average of averages** | weighted by impressions across queries and pages. It moves when the impression mix moves, with no ranking change. **Do not report it as "our rank"** |
| **Property type matters** | a domain property and a URL-prefix property cover different URL sets. Two properties on the same site legitimately return different totals |
| **Filters are applied before row limits** | a filtered query returns up to 25,000 rows of the filtered set, which is usually the route around the limit |

### MCP

**No official Google server exists**, which is notable given Google ships GA4 and
Google Ads servers. The one community option worth considering is
`ahonn/mcp-server-gsc`, judged in the research as the single community server in
the survey worth adopting. **Adopting it is an explicit decision to record**, and
the direct-API path must exist regardless — see `mcp-detect-fallback`.

---

## 2. GA4

### Cardinality rollup

`pagePath` and `pageTitle` are the classic victims. When a report exceeds the
cardinality limit, low-volume values are rolled into `(other)` and the response
sets `dataLossFromOtherRow`.

**For a content site over any meaningful window, this is the default outcome, not
an edge case.**

| Symptom | Reading |
|---|---|
| `dataLossFromOtherRow: true` | individual rows are valid; **the set is incomplete** |
| page figures do not sum to the site total | expected under rollup; **not reconcilable** |
| a page "disappeared" between two reports | it fell below the rollup boundary as the window widened |

Routes around it, in order of preference:

1. **BigQuery export** — event-level, no cardinality rollup, no sampling. The
   correct answer for any serious content analysis.
2. **Narrow the window.** Fewer distinct values, fewer rolled rows.
3. **Filter to a path prefix** (`/blog/`), which reduces cardinality before the
   limit applies.
4. **Query fewer dimensions at once.** Cardinality is a property of the
   combination.

### Other flags to read on every response

| Field | Meaning |
|---|---|
| `samplingMetadatas` | the figure is estimated. Report the rate |
| `subjectToThresholding` | rows suppressed for privacy; **totals will not add up** |
| `dataLossFromOtherRow` | the rollup above |
| `ResponseMetaData.timeZone` | the property's day-bucketing timezone |
| `ResponseMetaData.currencyCode` | the property's currency, which may not be your reporting currency |

See `warning-field-reader` for the full register.

### Dimensions that matter for content work

| Dimension | Use |
|---|---|
| `landingPagePlusQueryString` | entry-point analysis; **the right dimension for content attribution**, not `pagePath` |
| `sessionDefaultChannelGroup` | the channel classification GA4 applied |
| `sessionSource` / `sessionMedium` | the raw values behind the classification, needed when the grouping is disputed |
| `pagePath` | in-session consumption, not entry |

**Using `pagePath` where `landingPagePlusQueryString` was meant** credits every
page a visitor happened to pass through, which inflates navigational and
high-traffic pages against the content that actually brought people in.

---

## 3. GSC and GA4 are not the same object

A recurring request is to reconcile them. They are not reconcilable, for at least
five reasons:

| | Search Console | GA4 |
|---|---|---|
| Unit | a **click** on a search result | a **session** initiated on the site |
| Counting | one click per search result click | sessions with timeouts and re-attribution rules |
| Consent | independent of site consent state | **subject to consent; blocked tracking means no session** |
| Day boundary | Pacific Time, historically | the property's configured timezone |
| Scope | Google Search only | all traffic |

**GSC clicks will exceed GA4 organic sessions**, usually substantially, and the
gap is mostly consent and tracking loss rather than error. Report both, labelled,
and **never sum or chart them as one series.** See `comparability-rules`.

---

## 4. Content consumed without a click

Invisible to both sources above:

- **SERP features** — featured snippets and answer boxes that satisfy the query
  on the results page. GSC records an impression, no click.
- **AI overviews and AI answers.** Consumption without a visit, and attribution
  back to the source page is limited or absent.
- **Syndication and republication.** Read elsewhere entirely.
- **Dark social.** Shared in messaging apps and private communities; any
  resulting visit arrives as Direct.
- **Scraped copies.** No signal at all.

**None of this is measurable with the tools in this stack.** The honest statement
is that content consumption exceeds measured content consumption by an unknown
margin, and that the margin has been growing.

The practical consequence worth naming: **a rising impressions-to-clicks gap is
not automatically a ranking or title problem.** It is consistent with answer
surfaces satisfying more queries, and distinguishing the two requires looking at
`searchAppearance` and at position stability, not at CTR alone.
