<div align="center">

# Agentic GTM Analytics Skillpack

### Give your agent a senior analytics team.

**70 skills. 23 platforms. Attribution, forecasting, machine learning, warehouse
modelling, and deployed dashboards — installed in five minutes.**

*B2B and B2C. Free and open source.*

</div>

---

## What your agent can do an hour from now

Ask it any of these in plain language and it knows how:

> *"Build me a live dashboard of pipeline by source and deploy it."*
> *"Which channels actually drove revenue last quarter — run every attribution model and show me the spread."*
> *"Forecast Q4 bookings and tell me how accurate this method has been on our own history."*
> *"Score our open leads for conversion likelihood and tell me where the cutoff should be."*
> *"Design the warehouse tables for our GTM data in BigQuery."*
> *"Which of our customers are actually persuadable, rather than just likely to buy?"*
> *"Two dashboards disagree on MQL count. Find out why."*

No prompt engineering. No pasting documentation. The skills carry the method.

---

## The capability map

**Attribution — the complete family**
First touch, last touch, last non-direct, linear, time-decay, U-shaped, W-shaped,
full path. **Markov chain removal-effect** and **Shapley value** allocation for when
rules aren't enough. **Media mix modelling** and **incrementality testing** for the
causal question underneath. Run them together and see where they disagree — that
spread is usually the insight.

**Machine learning built for marketing**
Propensity and conversion models. **Uplift and causal modelling** to find who
converted *because of you*. Churn prediction with survival analysis. Customer
clustering and persona discovery. Recommendation systems. Time-series forecasting.
LTV and value regression. Feature engineering from raw GTM event data — with the
discipline that makes models trustworthy: temporal splits, leakage detection,
probability calibration, stability testing.

**Lead scoring, three ways**
Demographic and firmographic fit. Behavioural and engagement scoring with recency
decay. Full ML scoring from logistic baseline through gradient boosting — calibrated,
so a 0.8 actually means 80%. Plus the evaluation layer: lift charts, decile analysis,
drift monitoring, and threshold selection tied to real sales capacity.

**Warehouse and data engineering**
GTM star schemas for BigQuery and Snowflake. Source-by-source field mapping across
every major platform. Idempotent SQL transformation layers. Identity resolution and
journey assembly — anonymous to known, deterministic key precedence. Data quality
tests that catch missing rows instead of reporting a comfortable zero.

**Reporting and deployed dashboards**
**Interactive dashboards deployed to Vercel** — Next.js, bake-at-build with parquet,
keyless workload identity to your warehouse, so no credentials ever touch the
frontend. Recurring cadence reports with real narrative. Anomaly detection and
alerting. Executive summaries that make an argument instead of listing numbers.

**B2B revenue analytics**
Pipeline forecasting, backtested against your own history. Account-based analytics
and buying-group engagement. Funnel conversion and velocity. Win-loss driver
analysis. Sales activity and productivity. Territory, quota and capacity planning.
KPI driver trees that trace any number back to its cause.

**B2C and consumer analytics**
Ecommerce and basket analysis. Subscription analytics with the full MRR movement
waterfall. Cohort LTV and retention curves. Paid media, ROAS and MER. Email
lifecycle and list health. RFM and value segmentation.

**Semantic layer and metric definitions**
Reads your existing dbt models, LookML, Power BI measures or Snowflake semantic
views and uses **your** definitions. Builds portable metric layers. Discovers table
relationships and join paths from the data itself. Canonical B2B and B2C metric
dictionary with formulas, denominators and grain.

**Stack audit**
Point it at your existing reporting and it reverse-engineers what's actually
implemented, reconciles the same metric across systems, traces lineage to source,
and finds the double-counting. Usually the fastest way to get value on day one.

---

## 23 platforms, connected

| | |
|---|---|
| **CRM & marketing automation** | Salesforce · HubSpot · Marketo · Pardot |
| **Lifecycle & messaging** | Braze · Iterable · Klaviyo |
| **BI & semantic layers** | Looker · Tableau · Power BI · Cube |
| **Warehouses** | BigQuery · Snowflake |
| **Product analytics** | PostHog · Amplitude · Mixpanel |
| **Advertising & web** | Google Ads · Meta · LinkedIn · GA4 |
| **Pipelines** | Segment · RudderStack |

Each platform module carries its auth setup, correct query construction, pagination
and cost control, the right MCP server to use, and the practitioner knowledge that
usually takes a year to acquire. Uses official MCP servers where they exist and
falls back to the API where they don't.

---

## Ships with a Salesforce reporting MCP server

Salesforce's own MCP server has no reporting tools. Nobody else's does either.

So this pack includes one: **a working MCP server for the Salesforce Reports and
Dashboards API**. Run saved reports, filter them on the fly, run async for large
result sets, read report metadata, bulk query, and **create real Salesforce report
objects** your team can then open in the UI.

TypeScript, tested, documented, MIT. `mcp-servers/salesforce-reports/`

---

## Install

```bash
git clone https://github.com/chimeaholu/agentic-gtm-analytics-skillpack
```

Point your agent's skills directory at the repo. That's the install.

**Fastest path to a real answer: PostHog.** SQL-based query language, auth is a
scoped API key, and you can go from clone to a deployed dashboard in one sitting.

---

## What access costs, honestly

Start where it's cheap. Every platform is useful on its own.

| Platform | Time to working access |
|---|---|
| PostHog · Mixpanel · Amplitude · Klaviyo · Segment | **Minutes** — API key |
| GA4 · BigQuery · Snowflake | **~30 minutes** — service account + property grant |
| Salesforce · HubSpot | **About an hour** — connected app |
| LinkedIn · Meta | **Days** — developer platform review |
| Google Ads | **Days to weeks** — developer token approval |

---

## Built to be trusted with real numbers

Every skill knows the traps in its own territory. Reports flag when data was
sampled, thresholded or truncated. Metrics carry their denominator and grain.
Cross-platform roll-ups tell you which way they're biased and how to get the
deduplicated figure.

It answers the question you asked, then makes sure you can defend the answer.

---

## Architecture

```
core/          contracts every skill calls
semantics/     metric definitions, semantic-layer introspection, modelling
platforms/     thin router + 22 platform modules
engineering/   warehouse schema, transformations, quality
identity/      resolution and journey assembly
attribution/   rule-based, algorithmic, incrementality, budget allocation
b2b/  b2c/     revenue and consumer analytics
ml/  scoring/  models, propensity, lead scoring
audit/         find where your stack disagrees with itself
delivery/      dashboards, reports, alerts, narrative
```

A warehouse makes it better. It's never required.

---

<div align="center">

Built by **[Brainiac Consulting](https://brainiacconsulting.io)** from production
go-to-market analytics work.

**MIT licensed. Take it, use it, ship it.**

</div>
