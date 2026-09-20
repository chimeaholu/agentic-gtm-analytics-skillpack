<div align="center">

# Agentic GTM Analytics Skillpack

**Your agent can already pull your numbers. This teaches it when they're wrong.**

Attribution · forecasting · warehouse modelling · reporting — across 22 platforms, B2B and B2C.

</div>

---

## The problem

Marketing teams now have AI agents that will answer any question about their
numbers. The agents are fluent, fast, and wrong in ways nobody catches.

Three real examples, all of which return successfully and none of which warn you:

**Your Salesforce report is missing rows.** The API caps detail rows at 2,000
with no pagination — but computes the aggregates over the *full* result set.
So the grand total is right, the rows behind it are incomplete, and the response
looks identical either way. There is a field that tells you. Almost nothing reads it.

**Your GA4 chart doesn't add up to its own total.** When counts fall below a
threshold, GA4 silently withholds those rows from demographic breakdowns. The
session total stays correct. The split beneath it quietly undercounts. No error,
no flag in the chart.

**Your cross-channel conversion number is inflated.** Add conversions from
Google, Meta and LinkedIn and you get a number that overstates reality — the
same person counted twice, on three different attribution windows, under three
different definitions of the word "conversion." The spreadsheet does not object.

None of these are exotic. They are Tuesday.

---

## What this is

A pack of skills you load into your agent. It arrives already knowing how GTM
analytics works — and, more usefully, where it breaks.

| | |
|---|---|
| **Connect** | Read from 22 platforms. Uses each vendor's official MCP server where one exists, falls back to the API where it doesn't. |
| **Adopt your definitions** | Reads your existing dbt models, LookML, Power BI measures or Snowflake semantic views and uses *your* metric definitions. No parallel universe of numbers contradicting the dashboards your team already trusts. |
| **Model** | GTM star schemas in BigQuery or Snowflake. Source-by-source field mapping. Quality tests that catch missing rows instead of reporting a comfortable zero. |
| **Resolve identity** | Anonymous-to-known stitching with explicit matched / unmatched / ambiguous reporting. The step every attribution library assumes you've already done. |
| **Attribute** | First touch, last touch, linear, time-decay, U and W shaped, full path, Markov removal-effect, Shapley — run together so you see the spread, not one convenient answer. Plus incrementality and media mix modelling. |
| **Predict** | Pipeline forecasting backtested against your own history. Cohort LTV, retention, propensity, churn. Uplift modelling: who converted *because of you*. |
| **Audit** | Point it at a dashboard. It reverse-engineers which definitions are actually implemented, reconciles the same metric across systems, and finds the double-counting. |
| **Ship** | Deployed dashboards, recurring reports with narrative, anomaly alerts, executive summaries that argue rather than list. |

---

## What an answer actually looks like

This is the part that matters, so here it is before anything else.

### Ordinary question, nothing unusual

> **How many SQLs did we create in August?**
>
> **412 SQLs** in August 2026.
> <sub>Salesforce · complete · fiscal calendar · America/Toronto</sub>

One number, one small grey line. That's it. Most questions look like this.

### Something is genuinely wrong

> **Organic sessions by age group, August?**
>
> **38,400 sessions** total.
>
> ⚠️ **The age breakdown below is incomplete.** GA4 withheld rows where counts
> fell under its reporting threshold — roughly 14% of sessions aren't in any
> bucket. The total is accurate; the split undercounts. Drop the demographic
> dimension for complete rows.

One warning, and it changes what you'd do next.

### A question with a trap in it

> **Total conversions across Google, Meta and LinkedIn last month?**
>
> **2,530 conversions** across the three.
>
> | | Conversions | How that platform counts |
> |---|---|---|
> | Google Ads | 1,240 | data-driven attribution, 30-day click |
> | Meta | 980 | 7-day click, 1-day view |
> | LinkedIn | 310 | 30-day click, 7-day view |
>
> That's the figure if you add them up, and it's fine for a trend check or a
> board slide where direction matters more than the decimal. Before you use it
> for budget:
>
> **It overstates, always in that direction.** Someone who saw your LinkedIn ad
> and later clicked a Google ad is counted by both.
>
> **The three aren't counting the same thing.** Google distributes credit
> fractionally; Meta and LinkedIn each claim the whole conversion. Both include
> view-throughs, on different windows.
>
> **Some of it is modelled.** Google's data-driven attribution and Meta's
> modelled conversions both estimate where tracking was lost.
>
> **For a number you can defend:** deduplicate at person level in the warehouse,
> or run a holdout — platform numbers tell you what was *claimed*, incrementality
> tells you what was *caused*.

You get the number you asked for. You also understand it.

**It never withholds a number it can compute.** Guardrails that make you fight
for an answer get switched off, and then they're worse than useless.

---

## What makes it different

Let's be direct about what this isn't competing on.

**Connectors are free elsewhere.** Fivetran and Airbyte ship dbt packages that
are better resourced than anything we'd build.

**Attribution maths is open source.** Meridian, Robyn, PyMC-Marketing,
ChannelAttribution, GeoLift. This pack composes them and tells you which to
reach for. It doesn't reimplement them badly.

What nobody ships free is the judgement:

- **It reads the warning fields** most integrations ignore — sampling flags,
  threshold flags, truncation flags, throttle headers.
- **It names the direction of an error.** "Overstates" is actionable.
  "May be inaccurate" is noise.
- **It knows six platforms have six different timezone rules**, none of them UTC
  by default. This is the most common silent correctness bug in GTM analytics.
- **It won't promise what the platforms can't do.** It will not offer to build
  you a dashboard inside GA4, because that API does not exist.

---

## Platforms

| Tier | Platforms | What the agent can do |
|---|---|---|
| **Authoring** | Salesforce · Looker · Power BI · Cube · PostHog · Mixpanel | Create real report or dashboard objects |
| **Query-compose** | Klaviyo · Tableau · Snowflake | Compose report queries and metric definitions |
| **Extract** | GA4 · Google Ads · Meta · LinkedIn · HubSpot · Marketo · Pardot · Braze · Iterable · Amplitude · BigQuery · Segment · RudderStack | Read, extract, aggregate locally |

That split is researched, not assumed. Most "reporting APIs" cannot author a
report, and the pack is built so it can't accidentally claim otherwise.

---

## Install

```bash
git clone https://github.com/chimeaholu/agentic-gtm-analytics-skillpack
cd agentic-gtm-analytics-skillpack
```

Point your agent's skills directory at the repo, or copy the tiers you want.
Full instructions in [`docs/install.md`](docs/install.md).

**Fastest path to a real answer: PostHog.** Its query language is SQL, auth is a
scoped API key, and it's the only platform where an agent can run an analysis
*and* save the result as a dashboard. Under five minutes from clone to output.

---

## Before you start: what access actually costs

Nobody tells you this up front, so here it is.

| Platform | Time to working access |
|---|---|
| PostHog · Mixpanel · Amplitude · Klaviyo · Segment | **Minutes** — API key |
| GA4 · BigQuery · Snowflake | **~30 minutes** — cloud project, service account, property-level grant |
| Salesforce · HubSpot | **An hour or so** — connected app or private app |
| LinkedIn Ads · Meta | **Days** — developer platform review |
| Google Ads | **Days to weeks** — developer token, tiered approval |

Start where the gradient is cheap. The pack is built so any single platform is
useful on its own.

---

## Architecture

```
core/          guardrails every other skill must call
semantics/     metric definitions, semantic-layer introspection, data modelling
platforms/     one thin router + 22 platform modules
engineering/   warehouse schema, transformations, quality
identity/      resolution and journey assembly
attribution/   rule-based, algorithmic, incrementality, budget allocation
b2b/  b2c/     revenue and consumer analytics
ml/  scoring/  models, propensity, lead scoring
audit/         find where your stack disagrees with itself
delivery/      dashboards, reports, alerts, narrative
```

A **thin router** picks the platform module. Every module calls the shared
`core/` contracts and cannot bypass them — that's what keeps a cross-platform
answer coherent instead of producing four individually-correct, mutually
incomparable numbers.

**A warehouse makes it better. It is never required.**

---

## What it deliberately won't do

Knowing what a tool can't do is the same skill as knowing what it can.

- **Build a GA4 dashboard or Exploration** — no public API exists
- **Create a HubSpot report, or read a custom report's output** — neither endpoint exists
- **Reproduce Marketo's own report numbers** — structurally impossible; Marketo
  de-duplicates and filters in undocumented ways. The pack computes its own and
  explains the difference
- **Compose a Tableau dashboard from a spec** — there is no `POST /worksheets`

---

## Status

Pre-release, building toward v1.

**v1 covers:** the full guardrail layer · metric definitions · semantic-layer
introspection · four platforms end to end (PostHog, GA4, Google Ads, Salesforce)
· a stack audit · rule-based attribution · and a Salesforce Reports & Dashboards
MCP server, a capability no existing server ships.

70 skills across 13 tiers when complete.

---

<div align="center">

Built by **[Brainiac Consulting](https://brainiacconsulting.io)**
from production GTM analytics work.

MIT licensed. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

</div>
