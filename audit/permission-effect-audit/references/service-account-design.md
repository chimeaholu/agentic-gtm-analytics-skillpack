# Service account design

---

## 1. The decision nobody makes deliberately

**Should the service account see everything, or see what the audience sees?**

| | Admin-scoped | Audience-scoped |
|---|---|---|
| Numbers are | complete | consistent with what users see |
| "The dashboard disagrees with the report" is | expected | a bug |
| Good for | audits, reconciliation, lineage, estate inventory | automated reporting delivered to a defined audience |
| Risk | reports figures no user can verify, and reaches data the use case does not need | silently incomplete, and the incompleteness is invisible |

**Pick deliberately and write it down.** Most stacks end up with one of each by
accident: an admin-scoped warehouse role and an audience-scoped BI credential,
which is why the warehouse number and the dashboard number differ and nobody
can say why.

The strong default: **audience-scoped for delivery, admin-scoped for audit,**
with both documented and both recorded in the provenance of the numbers they
produce.

---

## 2. Introspection depth is a function of the role, not the API

This is the trap in naive least privilege. A read-only role can query data and
be unable to read the metric definitions that explain what the data means. The
agent then produces numbers it cannot audit, and reports "no semantic layer
found" when there is one.

Grant the introspection permission explicitly, and separately from data access.

---

## 3. Per-platform configuration

### Looker
- Role with **`see_lookml`** plus explore access on the models in scope.
- Without `see_lookml`: the agent can query but cannot audit, and will report
  metric expressions as unavailable.
- Note `access_filters`: if the model uses them, the account's user attributes
  determine which rows it sees, so the account's attribute values are part of
  the configuration.
- Auth: `client_id` / `client_secret` → `/login`. Watch port 19999 on legacy
  instances.

### Power BI
- **Semantic-model contributor or above** on the models in scope. Viewer gets
  nothing from `INFO.*`.
- **The tenant setting allowing service principals to use the Power BI APIs
  must be enabled.** It is off by default and only a Fabric administrator can
  change it. This blocks more first-time integrations than any other single
  setting.
- XMLA (and therefore model authoring) requires **Fabric / Premium / PPU
  capacity**. A Pro licence in a shared workspace cannot use it at all.
- Admin scanner APIs need **Fabric Administrator**, are asynchronous, and are
  historically limited to roughly 16 workspace-scan requests per hour.
- Auth cost overall: **high**. Entra app registration, admin consent, tenant
  setting, per-workspace membership, capacity gate.

### Tableau
- A **dedicated service user**, not an admin, whose RLS context matches the
  intended audience, if the goal is delivery.
- **Connected App JWT rather than a PAT for anything scheduled.** PATs expire
  after 15 days idle, and the failure looks like a permission change rather
  than an expiry.
- Metadata API must be **explicitly enabled on Tableau Server**, separately
  from any user permission.
- `PulseMetricDefine` capability on the data source if the account will author
  Pulse metric definitions.

### Snowflake
- A dedicated role with `USAGE` on the databases and schemas in scope and
  `SELECT` on the objects.
- **Document exposure to masking and row access policies explicitly.** The role
  determines whether values are masked, and masked values look like data.
- Set the session timezone in the connection rather than relying on the
  default, which is frequently America/Los_Angeles.
- Auth: key-pair JWT or PAT. One user, one role, one warehouse. **Low cost**
  compared to the rest of the stack.

### Salesforce
- An integration user whose **sharing and role position match the intended
  reporting scope**, documented.
- Report output follows that user's sharing, role hierarchy and field-level
  security, so the integration user's position in the role hierarchy is a
  reporting decision, not just a security one.
- Field-level security **omits fields rather than nulling them**, so grant FLS
  on every field the reporting needs, explicitly.
- Note the API limits that look like permissions: `GET /analytics/reports`
  returns only up to 200 recently-viewed reports for the running user, and
  report execution has a **2,000-row cap with no pagination**.

### HubSpot
- A private app with the minimum scopes.
- **Document that it will see more than a UI user**, because it is
  portal-scoped and ignores user roles and field permissions. This is expected
  and should be stated in the reporting, not treated as a defect.

### GA4
- A service account with property-level read access.
- **Record which service account produced each number**: two accounts can
  legitimately return different revenue from the same property via
  `schemaRestrictionResponse`.
- Set `returnPropertyQuota: true` on every request and self-throttle from it.

### Cube
- A JWT whose security context matches the intended audience.
- **Document whether `query_rewrite` applies**, because if it does, every
  number is conditionally scoped by filters that are invisible in the response.

### Marketo
- Note that an API-only role's restricted fields **do not appear in
  `describe2`**, so the schema itself looks smaller. Grant field access for the
  fields the reporting needs, or expect a silently narrower schema.

---

## 4. Privacy posture

Per credential, record: what person-level data it can reach, and whether the
use case requires it.

| Finding | Action |
|---|---|
| credential reads emails for an aggregate-only job | over-scoped; reduce. Cheap and uncontroversial. |
| credential reads masked person data | it is storing masked values that look real. Either grant unmasked access deliberately or stop reading the column. |
| person-level question routed to Braze MCP | **structurally unanswerable: no PII tools by construction.** Route elsewhere or decline. |
| credential can write | writes are a separate capability and are gated separately. See `write-gate`. |

---

## 5. Rotation and expiry

| Platform | Expiry behaviour that causes a mystery outage |
|---|---|
| **Tableau PAT** | **expires after 15 days idle**; a fortnightly job dies on its third run |
| OAuth refresh tokens | revoked on password change, MFA re-enrolment, or admin action |
| Snowflake key-pair | the key rotates; the public key on the user does not |
| Entra app secrets | expire on a schedule set at creation, often two years, so the failure arrives long after anyone remembers |

**Record the expiry behaviour alongside the credential**, because "it worked
last month" is the most common misleading data point in a permission
investigation.

---

## 6. The capability matrix

The audit's central artefact. Rows are credentials, columns are capabilities,
cells carry the probe that established them.

```
                     list  read metric  read row  read  read     write
                     objs  definitions  data      PII   lineage
looker-svc            yes   NO (P1)      yes      n/a   partial  no
powerbi-sp            yes   NO (P5)      yes      n/a   no       no
snowflake-analytics   yes   yes          yes*     no**  yes      no
salesforce-integ      yes   yes          yes***   yes   n/a      no
hubspot-app           yes   partial      yes      yes   n/a      no

*   row access policies may filter; not probed on all tables (P15)
**  masking detected on no tested columns; untested columns unknown (P14)
*** filtered by the integration user's sharing and role hierarchy (P21)
```

The footnotes are the point. **A `yes` with no probe behind it is a guess**,
and a `yes` scoped to what was tested says so.
