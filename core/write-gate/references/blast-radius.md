# Blast radius, operation by operation

Classification depends on **what changes and for whom**, not on how the API call
is spelled. A `POST` that creates a private draft is Tier D; a `POST` that
deploys code onto an event stream is Tier A.

---

## Tier A — silently corrupts all downstream numbers, retroactively and invisibly

| Operation | Platform | Why it is Tier A |
|---|---|---|
| **Deploy a transformation** | **RudderStack** | JavaScript runs on **every event**. The official MCP permits exactly this and nothing else. **Named in the research as the highest-risk write capability found anywhere, higher than ad-spend writes** |
| Edit or deploy a tracking plan that drops or renames events | CDP platforms | events stop arriving under the expected name. Historical comparisons break with no error |
| Change event schema enforcement | CDP platforms | previously-valid events are now dropped silently |
| Edit a mapping or enrichment step | CDP platforms | changes what is recorded, everywhere downstream, from that moment |

The defining property: **no error, no visible change, every dashboard still
green, every number now different.** A failed write announces itself. A
successful Tier A write does not.

Approval requirements:

- A **diff of the actual code**, not a description of it.
- The sources or streams it attaches to, named.
- The fields it reads and writes, named.
- An explicit statement of what becomes non-reproducible: analyses run before
  the change may not reproduce after it.
- Never batched with any other operation, never auto-approved, never inferred
  from a prior approval.

---

## Tier B — spends money

| Operation | Platform | Note |
|---|---|---|
| Create or edit campaigns, ad sets, ads | **Meta, via the official MCP** | **write-capable.** One prompt from real spend |
| Mutate operations on campaigns, budgets, bids | Google Ads API | **the official Google MCP is strictly read-only; a community MCP is not.** Check which is connected |
| Change a budget or bid | any ad platform | the daily money at stake must appear in the approval |
| Activate or unpause a campaign | any ad platform | activation is spend, even when the campaign already exists |
| Expand an audience or lift a targeting restriction | any ad platform | changes spend rate without changing the budget field |

Approval requirements:

- **Per operation.** Not per session, not per campaign group, not per plan.
- The object, the field, the before value, the after value.
- The daily spend implication, in currency.
- For activation: the total budget exposed, not just the daily rate.

---

## Tier C — changes shared definitions

Everyone's numbers change. Visibly, and recoverably, which is what separates it
from Tier A.

| Operation | Platform |
|---|---|
| Edit data model files | Cube |
| Create or alter measures, relationships, row-level security | Power BI, via the Authoring MCP or XMLA |
| `CREATE OR ALTER SEMANTIC VIEW` | Snowflake |
| Edit project files, `deploy_to_production` | Looker |
| `dbt build`, `dbt run` | dbt, exposed by the official MCP |
| Create or alter a Tableau Pulse metric definition | Tableau |
| Edit a metric definition in any semantic layer | all |

Approval requirements:

- **Per change set**, with a diff shown.
- **On a dev branch.** Cube's posture, adopted as the pack's: verify before
  merging, not after.
- Production promotion is a **separate** approval from the change itself.
- Name which existing reports depend on the definition being changed, where the
  lineage is available.

`dbt build` deserves a specific mention: it looks like a routine command, the
official MCP exposes it, and it rebuilds shared tables that other people's
dashboards read. Gate it like the definition change it is.

---

## Tier D — creates a visible artefact

| Operation | Platform |
|---|---|
| `POST /analytics/reports` | Salesforce |
| `create_look`, `create_dashboard` | Looker |
| `Add Dashboard`, `Clone Report` | Power BI |
| Create insights and dashboards | PostHog |
| Create dashboards and reports | Mixpanel, via MCP |
| Create reports and workbooks | Cube Cloud |
| Create a campaign or template **as a draft** | Klaviyo, via MCP |

Approval requirements:

- **Once per session, per target folder or workspace.** The destination is part
  of the approval; "create dashboards" with no destination is not an approval.
- Name the artefact so a human can find and delete it later.
- Do not create in a shared or production folder when a personal one exists.

Note what is **not** on this list because the platform cannot do it. See the
capability-limits section below.

---

## Tier E — sends to a human or the public

| Operation | Platform |
|---|---|
| Create or run a scheduled plan | Looker |
| Create a subscription | Power BI, Tableau |
| Activate a campaign or journey | marketing automation, lifecycle platforms |
| Send an email, push or SMS | all messaging platforms |
| Publish a dashboard to a public or external audience | all BI |

Approval requirements:

- **Always explicit, never inferred, never batched.**
- An approval to create is **not** an approval to send. An approval to draft is
  not an approval to activate.
- Name the recipient count and the audience definition.
- For scheduled sends: name the schedule, because approving one send is not
  approving a recurring one.

---

## Capability limits: writes the platform structurally cannot do

Refusing these is not caution, it is accuracy. The pack must be **structurally
unable** to promise them.

| Not possible | Why |
|---|---|
| GA4 dashboard or Exploration authoring | **no public API exists.** Explorations have no API at all; the Admin API creates dimensions, audiences and channel groups, not reports |
| Looker Studio report generation | the API does asset search and permission management. **It cannot read report data, create or modify a report, or read chart configuration.** The Linking API builds a pre-filled URL a human clicks |
| HubSpot report or dashboard creation | does not exist. Neither does reading a custom report's output: there is no endpoint that takes a report ID and returns rows |
| Marketo report creation, execution or retrieval | **no reporting API of any kind.** The vendor's own guidance is to extract activities and compute your own numbers |
| Pardot / MCAE report objects | none. B2B analytics dashboards require a separate licence |
| Amplitude chart or dashboard creation | the vendor's own documentation: the Dashboard REST API "cannot create charts or dashboards" |
| Snowsight dashboard creation | not meaningfully exposed via public API |
| Tableau dashboard composition from a spec | **there is no `POST /worksheets`.** Authoring means generating Tableau XML, which is undocumented-by-contract and version-fragile. Tableau **Pulse** metric definitions are the real CRUD surface |
| Salesforce dashboard authoring over the Reports API | **clone only.** Authoring from nothing requires the Metadata API |

When a user asks for one of these, the answer is not a refusal to help. It is:
the capability does not exist, here is the nearest thing that does, and here is
what a human would do in the product.

---

## Classification when the tier is unclear

Ask three questions in order:

```
1. Does it change what gets recorded, for future or past data?   → Tier A
2. Does it commit money?                                          → Tier B
3. Does it change a definition other people's numbers depend on?  → Tier C
4. Does it create something a human will see in the product?      → Tier D
5. Does it leave the platform and reach a person?                 → Tier E
```

When two apply, **take the higher tier**. A scheduled plan that also creates a
dashboard is Tier E.
