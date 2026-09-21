---
name: powerbi
description: Use for any Power BI or Microsoft Fabric request — running DAX queries, reading measures and relationships from a semantic model, authoring measures or relationships, creating dashboards or cloning reports, or explaining why a Power BI number differs between Desktop and the service. Ask about capacity licensing in the first five minutes: XMLA and the high-volume Arrow DAX endpoint require Fabric, Premium, Embedded or PPU, and a Pro licence in a shared workspace cannot use them at all. Prevents promising a capability that dies on procurement rather than on code.
---

# Power BI

**Capability class: authoring-capable, with the licence tier deciding how much of that is
true for a given customer.** Classic pin-board dashboards genuinely are composable over the
API (`Add Dashboard` plus `Add Dashboard Tile`), and **`Clone Report` plus `Rebind Report`
is the cheapest reliable way for an agent to produce a report**: clone a template, rebind
it to the target semantic model, rename it. Model authoring — measures, relationships,
hierarchies, security roles — is real via XMLA and the Authoring MCP.

**Ask about capacity licensing in the first five minutes.** This module's defining failure
is not a bug, it is procurement: **XMLA and the Arrow DAX endpoint require Fabric,
Premium, Embedded or PPU. A Pro licence in a shared workspace cannot use them at all.** An
agent that plans model authoring for a Pro-only tenant has wasted the engagement. Establish
the tier, then promise.

**Core contracts this module must call, every time:** `provenance-block` (tenant,
workspace, semantic model, licence tier, identity, UTC-versus-local evaluation basis),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor` before the first call,
`pagination-patterns`, `mcp-detect-fallback`, `write-gate` before any model edit, report
clone, dashboard creation or refresh trigger, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** `executeQueries` answers almost any
question on any licence tier. Run it, give the number, then name the one structural reason
it may differ from what the user sees on their screen: **report-layer logic is not in the
model**, so visual-level filters, report-level measures, slicer state and implicit measures
change the displayed number and are invisible to a model query. Say that in one sentence
rather than hedging. Withhold only where the identity genuinely cannot see the object —
OLS makes hidden objects invisible rather than error-producing, and reporting an
OLS-hidden measure as absent is the failure this module exists to prevent.

---

## (a) Auth setup — the hardest in the pack

> **Setting this up for the first time, or walking a non-technical user through it?** Read `references/connect.md` — the same steps written out screen by screen, with what to choose and why, how to verify it, and what the failures actually mean.

Time to first query: hours to days, because a **tenant admin** must act and an agent-builder
cannot self-serve the critical step. Budget a tenant-admin conversation before you promise
a date.

1. **Register an app in Microsoft Entra ID.** You get `client_id` and `tenant_id`; create a
   client secret or upload a certificate.
2. **Grant Power BI Service delegated scopes and obtain admin consent.** Typical set:
   `Dataset.Read.All`, `Report.ReadWrite.All`, `Workspace.Read.All`. **The scopes are
   coarse and `.All` is common, which security teams reasonably dislike** — expect to
   justify it.
3. **Enable service principals at the tenant level. This is the step everyone misses.** A
   Fabric or Power BI **tenant admin must explicitly turn on "Allow service principals to
   use Power BI APIs" and add the service principal's security group to the allowlist.**
   This is an org-level switch. Until it is flipped, a correctly-registered app with
   correct scopes and correct consent fails, and the error does not say "a tenant setting
   is off".
4. **Add the service principal as a member or contributor of *each* workspace.** Tenant
   enablement grants nothing by itself; workspace membership is a separate system, exactly
   as GA4 property ACLs are separate from Cloud project API enablement.
5. **For XMLA write, confirm a qualifying capacity** and, for some operations,
   semantic-model admin.

Token: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, resource
`https://analysis.windows.net/powerbi/api/.default`, lifetime about one hour.

Verify before planning work:

```bash
curl -s -X POST \
  "https://api.powerbi.com/v1.0/myorg/groups/$WORKSPACE_ID/datasets/$DATASET_ID/executeQueries" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"queries":[{"query":"EVALUATE ROW(\"ok\", 1)"}],"serializerSettings":{"includeNulls":true}}'
```

**Use a real workspace, never `myorg`/"My Workspace".** Those endpoints largely do not work
for service principals. A 401 is the token. A 403 is usually step 3 or step 4. And note the
next line before you trust a 200.

---

## (b) Correct query construction

**`POST /datasets/{datasetId}/executeQueries` with a DAX `EVALUATE` statement is the
lowest-common-denominator path, and it works on Pro, PPU and Premium/Fabric.** Build
against it by default and treat everything else as an optimisation that may not be
licensed.

**Prefer `EVALUATE SUMMARIZECOLUMNS(...)` referencing an existing measure by name** over
re-implementing its logic:

```dax
EVALUATE
SUMMARIZECOLUMNS(
    'Date'[Month],
    'Channel'[Channel Name],
    "Net Revenue", [Net Revenue],
    "Opportunities", [Open Opportunity Count]
)
ORDER BY 'Date'[Month]
```

Calling `[Net Revenue]` adopts the customer's definition, including whatever filter
context, calculation groups and time intelligence it carries. Rebuilding it as
`SUM(Sales[Amount])` forks the definition and will disagree the first time anyone touches
the model.

**Introspection is DAX too.** `INFO.MEASURES()`, `INFO.TABLES()`,
`INFO.RELATIONSHIPS()`, `INFO.CALCULATIONITEMS()` run through the same endpoint. They are
the catalogue. See the permission gotcha in (e) — they usually need semantic-model admin.

**High volume:** the **Arrow DAX endpoint** has no fixed row limit and accepts multiple
`EVALUATE` statements per request, but it is **Premium/Fabric only and the caller must
handle binary Apache Arrow streams**, which a naive HTTP agent cannot. Do not plan around
it without confirming both the capacity and the client capability.

**Content creation, in order of how reliably an agent can do it:**

| Path | What it does | Notes |
|---|---|---|
| **`Clone Report` + `Rebind Report`** | clone a template report, point it at a model, rename | **the cheapest reliable agent path to "a report"** |
| `Add Dashboard` + `Add Dashboard Tile` / `Clone Tile` | compose a classic pin-board dashboard | genuinely composable via API |
| `Imports - Post Import` | upload a .pbix, .rdl or .xlsx | you must already have the file |
| Fabric `POST /v1/workspaces/{id}/reports` | create from a **PBIR** definition | schema unpublished; see (e) |
| `Items - Create Semantic Model` | TMDL or TMSL model | Fabric |
| **XMLA** via TOM/TMSL, Tabular Editor, `semantic-link`/`sempy` | model authoring | **capacity-gated** |

All of these are writes. Report clones and dashboards are Tier D under `write-gate`; model
edits via XMLA or the Authoring MCP are Tier C.

---

## (c) Pagination, bulk and cost

**`executeQueries` caps at 100,000 rows and 1,000,000 values per query, and neither is
tunable.**

**Values, not rows, is usually what kills you.** A 20-column result caps at **50,000 rows**,
not 100,000. Compute `columns × rows` before issuing a wide query and reduce columns first.

| Bucket | Limit |
|---|---|
| `executeQueries` | 40/min per user on Pro and PPU; **120/min on Premium/Fabric** |
| General REST (many admin endpoints) | roughly 200 requests/hour |
| Some endpoints | 1/second |
| Workspace scanner requests | historically about 16/hour |

**Limits vary per endpoint family and are not fully documented. Build exponential backoff
and assume no headroom.** A 429 carries `Retry-After`; honour it rather than guessing.

**Pagination is inconsistent by design.** Most list endpoints return everything unpaged.
Admin scanner APIs use `continuationToken`. Fabric REST uses `continuationToken`
consistently. Do not write one pagination handler and assume it fits all three.

**Async patterns:** `Export Report To File` returns a job to poll; `Refresh Dataset` is
fire-and-poll via `Get Refresh History`; Fabric long-running operations return `Location`
plus `Retry-After`.

**For genuine bulk, the answer is usually not Power BI.** In order of preference: Arrow DAX
on capacity; XMLA plus ADOMD; or — best for real volume — **skip Power BI entirely and read
the Lakehouse or OneLake Delta tables with SQL.** Paging a large fact table through
`executeQueries` is the wrong tool and will hit the values ceiling before it finishes.

**Cost is capacity, not per-query billing.** A heavy agent consumes capacity units shared
with human users, so a wide sweep degrades their reports. Say so before starting one.

---

## (d) Preferred MCP server and fallback

**The landscape changed in 2026 and the Microsoft docs were updated 2026-09-17. Treat every
name here as version-dependent and verify before depending on it.**

**Preferred for writes: the Power BI Authoring MCP** (`microsoft/powerbi-modeling-mcp`,
formerly the Modeling MCP). Hosted at
`api.fabric.microsoft.com/v1/mcp/powerbi/authoring`, plus a local stdio mode which is what
you need for Desktop, for PBIP files on disk, for service-principal auth, and for
transactions and traces.

It is **write-first**: create, update and delete tables, columns, measures, relationships,
hierarchies, calculation groups, perspectives and security roles; bulk rename and
refactor; best-practice evaluation; run and validate DAX. It works in **TMDL and PBIP, so
changes flow through git review** — which is the right shape for a Tier C write and worth
using deliberately.

Two warnings to quote before you wire it in. **Microsoft labels it Public Preview and warns
the implementation "may significantly change prior to GA".** And **Microsoft explicitly says
do not use it for consumption scenarios** — it is an authoring tool, not a query tool.

**Preferred for reads: Fabric IQ MCP** (`fabriciq.svc.cloud.microsoft/v1/mcp/FabricIQ`),
the supported consumption path. **It respects existing permissions, RLS and OLS**, which
makes it the right default for an agent reading a customer's model.

**Do not use:** the old **Power BI Consumption MCP is legacy**, documented for existing
integrations only. The `microsoft/fabric-toolbox` Semantic Model MCP Server is a toolbox
repo, not a supported product. `microsoft/skills-for-fabric` is worth reading as prior art
for skill packaging but is not a server.

**Fallback: `executeQueries` plus the `INFO.*` functions covers read on every licence tier,
and XMLA covers write wherever capacity exists.** That fallback is complete enough that no
MCP is load-bearing here, which is the right posture given the preview labels.

---

## (e) Gotchas, and the specific field that reveals each one

- **The licence cliff is the real blocker.** On a Pro-only tenant: no XMLA, no Arrow DAX,
  a hard 100,000-row ceiling. **Ask about capacity first**, because the failure is
  procurement, not code, and no amount of retrying fixes it.
- **`executeQueries` returns errors as HTTP 200 in some client libraries.** **Check the
  `error` object in the response body, not the status code.** An agent that branches on
  status alone reports a failed query as an empty result.
- **Service principals cannot use `executeQueries` against some dataset types**, and
  historically could not call several admin and "MyWorkspace" endpoints. Datasets with
  personal cloud connections or certain gateway credential types fail for a service
  principal with an unhelpful error. **`myorg`/"My Workspace" endpoints largely do not work
  for SPs — always use a real workspace.**
- **`INFO.*` functions generally require semantic-model admin, and some require workspace
  admin.** A read-only viewer identity gets nothing back and the response looks like an
  empty model. Plan for a contributor-or-above service principal.
- **Power BI has no timezone conversion.** `NOW()` and `TODAY()` evaluate in **UTC in the
  service** and in **local time in Desktop**. This is the classic "worked on my machine"
  bug and an agent will reproduce it faithfully. **Prefer an explicit date table and
  explicit date filters over `TODAY()`.**
- **Currency is a data type with four decimal places, not a unit.** Format strings carry
  the symbol. There is no conversion, and **metadata cannot tell you a measure's currency.**
- **Format strings are metadata and are not applied to `executeQueries` output.** The API
  returns raw values; the UI shows `$1.2M`. Expect "the API disagrees with the dashboard"
  complaints that are purely formatting, and check this before investigating anything else.
- **Report-layer logic is not in the model. This is the number-one API-versus-UI
  discrepancy in Power BI.** Visual-level filters, report-level measures in thin/PBIR
  reports, slicer state and Q&A synonyms all live in the report artifact. **An agent
  reading only the model computes a different number than the dashboard shows, and both are
  correct for what they measure.**
- **Implicit measures exist in the report, not the model.** A column dragged onto a visual
  producing an implicit `SUM` will **not** appear in `INFO.MEASURES()`, so a metric
  inventory misses everything authors did ad hoc.
- **OLS makes hidden objects invisible rather than error-producing** — the same silent
  truncation as everywhere else in the pack. A missing table is a permission until proven
  otherwise.
- **Calculation groups and field parameters change what a measure *means* at query time.**
  `INFO.CALCULATIONITEMS()` gives you the expressions; reasoning about the composed result
  is genuinely hard. If a model has calculation groups, say that your number depends on
  which calculation item is applied.
- **Direct Lake and DirectQuery pushdown are invisible in the DAX.** The model does not
  tell you what SQL is generated, nor whether a measure will **fall back from Direct Lake
  to DirectQuery** with a large performance cliff. A query that was fast yesterday can be
  slow today for reasons nothing in the response explains.
- **TMDL does not deploy directly to XMLA; TMSL is what deploys.** And only `Read`
  permission can be set for a semantic-model role via XMLA.
- **PBIR generation fights validation.** The schema is not published as a downloadable
  document and the API rejects any key outside it. **Template-and-modify, never
  generate-from-scratch.**
- **Incremental refresh partitions mean `Refresh Dataset` without a body refreshes per
  policy**, and **`Get Refresh History` shows success even when only recent partitions
  moved.** A green refresh is not evidence that historical data was reprocessed.
- **Deleted content goes to a workspace Recycle Bin**, deleted workspaces are retained
  roughly 7 to 90 days, and **Admin scanner APIs can return items users can no longer
  see**. Scanner APIs require Fabric Administrator, are async, and have their own throttles
  — **do not inventory a tenant with per-item calls.**

---

## Files

- `references/licence-tiers.md` — what each licence tier actually permits, the questions to
  ask in the first five minutes, and how to degrade a plan rather than fail it.
- `references/api-vs-ui-discrepancies.md` — the report-layer problem, implicit measures,
  format strings and timezone, with the diagnostic order to check them in.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
