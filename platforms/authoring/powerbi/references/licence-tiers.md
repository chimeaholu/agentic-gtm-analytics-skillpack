# The licence cliff, and the five-minute conversation

Power BI is the one platform in the pack where the binding constraint is procurement.
A plan that assumes XMLA on a Pro tenant does not fail slowly — it cannot run at all, and
no retry, backoff or alternative endpoint rescues it. Establish the tier before you
promise anything.

## Ask these, in this order

1. **What licence backs the workspace the data lives in?** Pro, PPU, Premium, Embedded,
   or Fabric capacity. "We have Power BI" is not an answer.
2. **Is the workspace on a dedicated capacity, or is it shared?** A Pro licence *in a
   shared workspace* is the constrained case.
3. **Has a tenant admin enabled "Allow service principals to use Power BI APIs", and is
   our SP's security group on the allowlist?** If not, nothing works headlessly.
4. **Is the SP a member or contributor of each workspace we need?** Tenant enablement
   grants nothing on its own.
5. **Do we need model authoring, or only queries?** Authoring raises the capacity bar.

## What each tier permits

| Capability | Pro (shared) | PPU | Premium / Embedded / Fabric |
|---|---|---|---|
| `executeQueries` (DAX) | yes | yes | yes |
| `executeQueries` rate | 40/min per user | 40/min per user | **120/min** |
| Row / value ceiling | 100,000 rows, 1,000,000 values | same | same on this endpoint |
| **Arrow DAX endpoint** | **no** | **no** | **yes** |
| **XMLA endpoint** | **no** | yes | yes |
| Model authoring (TOM/TMSL, Tabular Editor) | no | yes | yes |
| `Clone Report` + `Rebind Report` | yes | yes | yes |
| `Add Dashboard` + tiles | yes | yes | yes |
| Lakehouse / OneLake Delta reads | n/a | n/a | Fabric |

The row is worth stating plainly to a stakeholder: **on Pro, an agent can query and can
clone reports and compose classic dashboards. It cannot edit the semantic model and cannot
exceed 100,000 rows in a single query. That is a licensing decision, not an engineering
gap.**

## Degrade the plan; do not fail it

When the tier will not support the plan, there is almost always a smaller honest version.

| Wanted | Blocked by | Degrade to |
|---|---|---|
| Author a new measure in the model | no XMLA on Pro | compute it in the DAX query, report the number, and hand the human the exact measure definition to paste into Desktop |
| Extract a large fact table | 1,000,000-value ceiling | narrow the columns first (values, not rows, is the binding limit); then chunk by date; then go to the Lakehouse if Fabric exists |
| Build a report from a description | PBIR schema is unpublished and validation rejects unknown keys | clone a template report and rebind it |
| Inventory every artefact in the tenant | scanner APIs need Fabric Administrator, are async, and throttle at roughly 16 workspace scans/hour | scope the inventory to named workspaces |

## The values ceiling, computed

`executeQueries` caps at 100,000 rows **and** 1,000,000 values. Values is
`rows × columns`, and it is usually what binds:

| Columns | Effective row ceiling |
|---|---|
| 5 | 100,000 (row cap binds) |
| 10 | 100,000 (row cap binds) |
| 20 | **50,000** |
| 40 | **25,000** |

Compute this before issuing a wide query. Reducing columns buys more rows than any
retry strategy does.
