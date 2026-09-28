# The single-file HTML report, end to end

One HTML file with inline data and styles, a pinned chart library loaded from a
CDN, and a `<details>` provenance footer. The report text and data work offline;
the interactive chart requires network access to the CDN.

Before writing the HTML, serialize embedded values with this helper:

```js
function safeJsonForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/<\/script/gi, '<\\u002fscript')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
```

The replacements ensure a literal `</script>` cannot close the data element,
and U+2028/U+2029 do not break JavaScript parsing. Apply this on the generator
side before interpolating the string into HTML.

## 1. The skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GTM monthly — August 2026</title>
<style>
  :root { --ink:#1a1a1a; --muted:#6b6b6b; --rule:#e4e4e4; --warn:#8a5a00; }
  body { font:16px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         color:var(--ink); max-width:46rem; margin:2rem auto; padding:0 1rem; }
  h1 { font-size:1.6rem; line-height:1.25; margin:0 0 .25rem; }
  .period { color:var(--muted); margin:0 0 2rem; }
  table { border-collapse:collapse; width:100%; margin:1.5rem 0; font-size:.94rem; }
  th, td { text-align:left; padding:.45rem .6rem; border-bottom:1px solid var(--rule); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .basis { color:var(--muted); font-size:.85rem; }
  .incomplete, .lower-bound { color:var(--warn); font-weight:600; }
  .unavailable { color:var(--muted); font-style:italic; }
  details.provenance { margin-top:3rem; border-top:1px solid var(--rule); padding-top:1rem;
                       font-size:.88rem; color:var(--muted); }
  details.provenance summary { cursor:pointer; font-weight:600; color:var(--ink); }
  .negative-list { background:#fafafa; border-left:3px solid var(--rule);
                   padding:.9rem 1.1rem; margin:2rem 0; font-size:.92rem; }
  @media print { details.provenance[open] { display:block } details.provenance { open:true } }
</style>
</head>
<body>

<h1>Pipeline created was 4.2M in August, up 6% on July</h1>
<p class="period">1–31 August 2026 · created date · UTC · USD at the 31 Aug rate</p>

<!-- 2. WHAT HAPPENED -->
<p>...three to five sentences of narrative...</p>

<!-- 3. VERSUS EXPECTATION -->
<!-- 4. WHY — two or three quantified drivers -->
<!-- 5. WHAT WE ARE DOING -->
<!-- 6. WHAT WE NEED -->

<!-- 7. THE NUMBERS -->
<table>
  <thead><tr><th>Metric</th><th class="num">Value</th><th>Window</th><th>Basis</th></tr></thead>
  <tbody>
    <tr><td>Pipeline created</td><td class="num">4,203,118</td>
        <td>1–31 Aug</td><td class="basis">created date · USD, month-end FX</td></tr>
    <tr><td>Win rate</td><td class="num">22%</td>
        <td>closed in Aug</td><td class="basis">closed-won ÷ (closed-won + closed-lost)</td></tr>
    <tr><td>Paid-attributed pipeline</td><td class="num">1,105,400</td>
        <td>1–31 Aug</td><td class="basis">sums overlapping platform figures — <strong>overstates</strong></td></tr>
    <tr><td>Marketing-sourced ARR</td><td class="num unavailable">unavailable</td>
        <td>—</td><td class="basis">the platform exposes no reporting API</td></tr>
    <tr><td>September to date</td><td class="num incomplete">1,340,000 *</td>
        <td>1–19 Sep</td><td class="basis">* period incomplete, 19 of 30 days</td></tr>
  </tbody>
</table>

<figure>
  <canvas id="pipeline" height="180"></canvas>
  <figcaption class="basis">Pipeline created by month. The final bar is the current
    month to date and is not a trend point.</figcaption>
</figure>

<!-- 9. NEGATIVE LIST -->
<div class="negative-list">
  <strong>What this report does not claim.</strong>
  Measured before and after in uncontrolled windows, with no control group and no
  seasonality adjustment: this shows what happened, not what caused it.
  It does not deduplicate people across platforms, because no shared key exists.
  It does not reconcile to any ad platform's own UI, which computes on a different path.
  It covers only the sources listed below; anything absent is out of scope, not zero.
</div>

<!-- 6/8. PROVENANCE, COLLAPSED -->
<details class="provenance">
  <summary>Sources, definitions and caveats — 6 sources, 1 unavailable</summary>
  <h3>Sources</h3>
  <table>
    <thead><tr><th>Source</th><th>Extracted</th><th>Covers to</th><th>Timezone</th><th>Rows</th></tr></thead>
    <tbody>
      <tr><td>Warehouse (opportunities)</td><td>2 Sep 06:05 UTC</td><td>31 Aug</td>
          <td>UTC (confirmed)</td><td class="num">1,840</td></tr>
      <tr><td>Ad platform A</td><td>2 Sep 06:07 UTC</td><td>31 Aug</td>
          <td>account tz (confirmed)</td><td class="num">412</td></tr>
    </tbody>
  </table>
  <h3>Definitions</h3>
  <dl>
    <dt>Pipeline created <code>@v3</code></dt>
    <dd>Sum of opportunity amount where created date falls in the window and stage
        is not Closed Lost at creation. Grain: opportunity. Source: semantic layer.</dd>
    <dt>Win rate <code>@v2</code></dt>
    <dd>Closed-won opportunities ÷ (closed-won + closed-lost), both by close date in
        the window. Excludes "no decision" — see the denominator note in win-loss-analysis.</dd>
  </dl>
  <h3>Definition changes</h3>
  <p>▲ 1 Aug 2026 — "Qualified opportunity" now requires a confirmed budget holder.
     About 12% fewer opportunities from August onward. Series either side of this
     marker are not comparable without restating.</p>
  <h3>Exclusions applied</h3>
  <ul><li>Internal email domains</li><li>Accounts flagged as test</li>
      <li>Opportunities with amount null (11 rows, 0.6%)</li></ul>
  <h3>Currency</h3>
  <p>USD. Non-USD amounts converted at the 31 Aug rate, so month splits will not
     sum exactly to the quarter figure.</p>
</details>

<script id="report-data" type="application/json">${safeJsonForHtmlScript(reportData)}</script>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<script>
const d = JSON.parse(document.getElementById('report-data').textContent);
new Chart(document.getElementById('pipeline'), {
  type: 'bar',
  data: { labels: d.months, datasets: [{
    data: d.pipeline,
    // the incomplete period is rendered distinctly — never silently included
    backgroundColor: d.pipeline.map((_, i) =>
      i >= d.incomplete_from_index ? 'rgba(138,90,0,.35)' : 'rgba(26,26,26,.75)'),
  }]},
  options: { plugins: { legend: { display:false } },
             scales: { y: { beginAtZero:true } } }
});
</script>
</body>
</html>
```

## 2. The five things that template does on purpose

1. **The `<h1>` is the finding, not the filename.** A reader who opens it on a
   phone and reads nothing else has the answer.
2. **`unavailable` renders as the word, in the table, with the reason** — never
   as a blank row and never as 0. A dropped row reads as an unimportant metric; a
   zero reads as a business result.
3. **The incomplete period is a different colour and carries an asterisk in the
   table and a sentence in the figcaption.** Three touchpoints for the one thing
   readers systematically misread.
4. **The provenance is `<details>`** — native, no JavaScript, works when saved to
   disk. Present on every report, in front of no reader who did not ask.
5. **The chart library version is pinned to a patch.** `@latest` renders
   differently next year, or 404s.

Note the print rule: `<details>` collapsed content does not print. If the report
will be printed, force it open for print media or move the provenance to a final
section. Test it, because the failure appears only on paper.

## 3. Writing the sidecar alongside

```ts
import { writeFileSync } from 'node:fs'

type MetricState = 'observed' | 'missing' | 'unavailable' | 'lower_bound' | 'partial' | 'ambiguous'

type MetricEntry = {
  key: string
  label: string
  value: number | null
  unit?: string
  state: MetricState
  definition_id: string
  definition_source: 'semantic_layer' | 'platform_report' | 'ad_hoc_sql'
  grain: string
  window: { start: string; end: string; basis: string }
  timezone: string
  timezone_status: 'confirmed' | 'assumed' | 'unconfirmed'
  currency_basis?: { currency: string; fx_method: string; fx_date: string }
  numerator?: string | null
  denominator?: string | null
  source: string
  extracted_at: string
  coverage: { rows: number; capped: boolean }
  exclusions: string[]
  error_direction?: 'overstates' | 'understates' | 'unknown'
  error_reason?: string
  error_magnitude?: string          // a number, or the literal "unquantified"
  better_number?: string
  reason?: string                   // required when state is unavailable
  resolves_with?: string            // required when state is unavailable
}

export function writeReport(basename: string, html: string, sidecar: Sidecar) {
  assertSidecar(sidecar)
  writeFileSync(`${basename}.html`, html)
  writeFileSync(`${basename}.json`, JSON.stringify(sidecar, null, 2))
}

function assertSidecar(s: Sidecar) {
  const problems: string[] = []
  for (const m of s.metrics) {
    if (m.state === 'unavailable') {
      if (m.value !== null) problems.push(`${m.key}: state unavailable but value is not null`)
      if (!m.reason) problems.push(`${m.key}: unavailable with no reason`)
      if (!m.resolves_with) problems.push(`${m.key}: unavailable with no resolution path`)
    }
    if (m.state === 'observed' && m.value === null) {
      problems.push(`${m.key}: state observed but value is null — this is 'missing' or 'unavailable'`)
    }
    if (m.error_direction && !m.error_reason) {
      problems.push(`${m.key}: error direction given with no reason`)
    }
    if (m.denominator && !m.numerator) {
      problems.push(`${m.key}: a rate with a denominator and no stated numerator`)
    }
    if (m.timezone_status === 'unconfirmed' && m.window.basis.includes('date')) {
      problems.push(`${m.key}: date-bucketed metric with an unconfirmed timezone`)
    }
  }
  if (!s.does_not_claim?.length) problems.push('no negative list')
  if (problems.length) throw new Error(`sidecar invalid:\n  ${problems.join('\n  ')}`)
}
```

**The assertion throws rather than warns.** A sidecar that records
`state: "observed", value: null` is the machine-readable form of rendering
missing as zero, and it will be consumed by something that averages it.

## 4. Diffing two periods

The reason the sidecar exists, demonstrated:

```bash
# what changed between July and August, structurally
diff <(jq -S '.metrics[] | {key, definition_id, grain, window:.window.basis, tz:.timezone,
                            fx:.currency_basis.fx_method, excl:.exclusions}' gtm-monthly-2026-07.json) \
     <(jq -S '.metrics[] | {key, definition_id, grain, window:.window.basis, tz:.timezone,
                            fx:.currency_basis.fx_method, excl:.exclusions}' gtm-monthly-2026-08.json)
```

Any line in that diff is a reason two months' numbers are not comparable. This is
the answer to "why doesn't this match the deck from last quarter", and it takes
seconds instead of an afternoon of re-deriving both numbers.

Run it as a pre-publication check on every recurring report: **an undeclared
definition or basis change between periods is a blocker, not a footnote.**

## 5. PDF

Render the same HTML through a headless browser rather than maintaining a second
template:

```bash
npx playwright screenshot --full-page report.html report.png    # quick visual check
# or a real PDF, honouring print CSS:
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();
const p=await b.newPage();await p.goto('file://'+process.cwd()+'/report.html');
await p.pdf({path:'report.pdf',format:'A4',printBackground:true});await b.close()})()"
```

The `${...}` expression is evaluated by the report generator before the file
is written. Two differences to handle deliberately:

- **`<details>` does not print its collapsed content.** Either add
  `details { display:block } details > summary { list-style:none }` plus forced
  expansion under `@media print`, or move provenance to a final appendix page.
- **Charts must render before the PDF is taken.** Wait for the canvas, or
  pre-render static SVG for the PDF path. A PDF with blank chart areas is the
  standard failure here, and it is invisible until someone prints it.
