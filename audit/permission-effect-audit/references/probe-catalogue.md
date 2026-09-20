# The probe catalogue

Each probe distinguishes "this does not exist" from "I cannot see it". Record
every result, including passes. **A probe that was never run is not evidence.**

---

## Looker

### P1. `see_lookml` probe
```
GET /api/4.0/lookml_models/{model}/explores/{explore}
```
Inspect a field you know exists.

| Result | Conclusion |
|---|---|
| field present with `sql` | `see_lookml` granted |
| field present, **`sql` absent** | **no `see_lookml`**; metric expressions unreadable |
| field absent entirely | field-level access missing, or the model is broken |

**Resolves with:** `see_lookml` permission on the model.

### P2. Model visibility probe
```
GET /api/4.0/lookml_models
```
Compare against the known model list. A model absent from the response is not
necessarily absent from the instance.

### P3. `access_filters` probe
Read `access_filters` from the explore. If present, **every query through this
explore is row-filtered by the calling user's attributes**, and the numbers are
identity-dependent by design.

### P4. `errors` block
A non-empty `errors[]` means the model is broken, which returns fewer fields
and looks identical to a permission restriction. Read it before concluding
anything about permissions.

---

## Power BI

### P5. `INFO.*` access probe
```dax
EVALUATE INFO.TABLES()
```

| Result | Conclusion |
|---|---|
| rows returned | semantic-model admin or above |
| empty result or 401 | **not semantic-model admin**; `INFO.*` unavailable |

**Resolves with:** semantic-model contributor or above, **plus** the tenant
setting that allows service principals to use the Power BI APIs, which is off
by default and only a Fabric administrator can change.

### P6. RLS effect probe
Run the same measure with and without an effective-identity / RLS role. A
difference means RLS is active and the number is identity-dependent.

### P7. OLS probe
**Object-level security makes objects invisible rather than error-producing.**
Compare `INFO.TABLES()` and `INFO.COLUMNS()` output against the TMDL from git,
if available. Objects in the TMDL and absent from `INFO.*` are OLS-hidden.

### P8. Capacity probe
```dax
EVALUATE INFO.MODEL()
```
plus an XMLA connection attempt. `executeQueries` working while XMLA is refused
means shared capacity, so model authoring is unavailable on this tenant
regardless of role.

---

## Tableau

### P9. Metadata API visibility
Query for a workbook you know exists.

| Result | Conclusion |
|---|---|
| returned | visible to this identity |
| **absent, no error** | **permission-filtered**, or not yet indexed |

The Metadata API is **permission-filtered with no error** and
**asynchronously indexed**. Absence has two causes and the probe cannot
distinguish them; re-run after the index interval to separate them.

### P10. RLS probe
Run the same VDS `query-datasource` query under two identities. **Tableau RLS
silently changes every number depending on the PAT or JWT identity.** Different
totals from identical queries is the signature.

### P11. Node limit
Read `NODE_LIMIT_EXCEEDED` on any Metadata API response. A truncated graph
looks like a small estate.

### P12. PAT expiry
**PATs expire after 15 days idle.** A scheduled job that worked for two weeks
and then stopped is usually this, not a permission change. Check the token's
last-used date before investigating permissions.

---

## Snowflake

### P13. Role usage probe
```sql
SHOW SEMANTIC VIEWS IN DATABASE <db>;
DESCRIBE SEMANTIC VIEW <db>.<schema>.<one from the list>;
```
`SHOW` listing it and `DESCRIBE` failing means the role lacks usage on the
schema or ownership-adjacent privileges.

### P14. Masking probe, the important one
**Masking policies return masked values that look like data.** Not null, not an
error: a plausible wrong value.

```sql
-- compare against a value you already know independently
select email, amount from customers where customer_id = :known_id;
-- if email comes back as a plausible but different string, masking is active
```

There is no metadata field that tells you a value was masked in the result set.
**A known control value is the only reliable detection.**

```sql
-- what policies exist, if you have the privilege to see them
show masking policies in account;
select * from snowflake.account_usage.policy_references
where  policy_kind = 'MASKING POLICY';
```

### P15. Row access probe
```sql
select count(*) from t;   -- compare to a known control count
show row access policies in account;
```
Row access policies silently filter. A count lower than the control is the
signature.

### P16. Session timezone
```sql
SHOW PARAMETERS LIKE 'TIMEZONE';
```
Not a permission, but it belongs in the same probe run because it changes
numbers the same way: silently. Frequently defaults to America/Los_Angeles.

---

## Cube

### P17. Security context probe
Request `/v1/meta` with two different JWTs. Different models returned means the
security context is filtering the schema itself.

### P18. `query_rewrite` probe
Check the deployment configuration for `query_rewrite`. **If it is configured,
every number from this Cube deployment is conditionally scoped by filters the
agent never sees, and nothing in the response discloses them.** This must be
stated on every Cube-sourced number.

---

## GA4

### P19. `schemaRestrictionResponse`
Present on a report response means **field-level permissions changed the
numbers, without erroring**. Two service accounts can legitimately return
different revenue from the same property.

```
response.propertyQuota          -> set returnPropertyQuota: true, always
response.schemaRestrictionResponse -> log the credential, flag the metrics
```

### P20. Quota probe
Set `returnPropertyQuota: true` on every request and read `PropertyQuota`. Not
a permission, but the same class of silent truncation: without it, a batch job
discovers its quota by being cut off partway through and returning a partial
dataset that looks complete.

---

## Salesforce

### P21. Running-user probe
Run the same report as the integration user and as an admin.

| Difference | Mechanism |
|---|---|
| fewer rows | sharing rules and role hierarchy |
| **missing columns** | **field-level security: fields are omitted rather than nulled** |

The missing-columns case is the one that fools people, because an absent column
reads as a schema difference rather than a permission effect.

### P22. Recently-viewed trap
`GET /analytics/reports` returns **only up to 200 recently-viewed reports for
the running user**. An agent that "lists the reports" from it reports a
near-empty org. SOQL the `Report` object for the real catalogue. This is a
scope effect, not a permission one, and it presents identically.

---

## HubSpot

### P23. Portal-scope probe
Compare an API object count to a UI list count for the same filter, run by a
non-admin user.

| Result | Conclusion |
|---|---|
| API higher | **portal-scoped token ignoring user roles and field permissions** |

**This is usually why a manager says the agent's number is too high.** It is
expected behaviour, not a bug, and saying so early saves an investigation.

---

## Marketo

### P24. `describe2` probe
Compare the field list from `describe2` against the documented or expected
field set. **Fields an API-only role cannot see do not appear in `describe2` at
all**, so the schema itself looks smaller.

---

## Segment / RudderStack

### P25. Read-only token probe
Read-only tokens **silently omit resources**. Compare the resource list against
a known inventory. Absent resources are a scope effect, not a configuration
gap.

---

## BigQuery

### P26. Dataset ACL probe
```sql
select count(*) from `project.dataset.INFORMATION_SCHEMA.TABLES`;
```
Compare against a known inventory. Dataset-level and column-level ACLs remove
objects from `INFORMATION_SCHEMA` results with no error.

---

## Braze

### P27. PII structural limit
**The Braze MCP server has no PII tools by construction.** This is not a
permission that can be granted. A person-level question routed there is
structurally unanswerable and should be routed elsewhere or declined, not
worked around.

---

## The probe report

```yaml
probes:
  - platform: looker
    probe: P1 see_lookml
    run_at: 2026-09-20
    result: "field returned, sql absent on all 40 measures"
    conclusion: "credential lacks see_lookml; metric expressions unreadable"
    resolves_with: "see_lookml permission on the model"
    effect_on_numbers: "none directly; blocks the definition audit"

  - platform: hubspot
    probe: P23 portal scope
    run_at: 2026-09-20
    result: "API 18,402 contacts vs UI 14,110 for the same filter"
    conclusion: "portal-scoped token ignoring user roles; expected behaviour"
    resolves_with: "n/a, this is by design; state it rather than fixing it"
    effect_on_numbers: "API counts run ~30% higher than a UI user sees"

  - platform: snowflake
    probe: P14 masking control
    run_at: 2026-09-20
    result: "control value matched"
    conclusion: "no masking detected on the columns tested"
    resolves_with: "n/a"
    effect_on_numbers: "none on tested columns; untested columns unknown"
```

That last entry matters: **a pass is scoped to what was tested.** "No masking
detected on the columns tested" is an honest claim; "no masking" is not.
