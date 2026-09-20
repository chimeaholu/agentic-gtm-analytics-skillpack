---
name: permission-effect-audit
description: Use when a number differs between two users or between an integration and the UI, when setting up an analytics service account, or before trusting any automated report. Probes what each credential can actually see across the stack, identifies where permissions change the numbers rather than producing an error, and documents the identity under which each reported number was produced. Prevents an agent concluding that a metric does not exist when it simply cannot see it, and prevents two credentials producing two defensible but different answers to the same question.
---

# Permission Effect Audit

Permissions in analytics stacks do not usually produce errors. They produce
**different numbers**, silently, and both numbers are defensible.

---

## 1. The universal pattern

**Missing objects are silently absent rather than access-denied.**

A metric the credential cannot see looks exactly like a metric that does not
exist. An agent that cannot tell those apart will confidently reinvent a metric
the customer already owns, or report that a dataset has no revenue field when
it has one it cannot read.

**Run an explicit capability probe and report the blind spots as a finding**,
not as a footnote.

---

## 2. Permissions change numbers in opposite directions on different platforms

This is why the effect is missed: there is no single direction to look for.

### Shows LESS than a human sees

| Platform | Mechanism |
|---|---|
| **Salesforce** | **report output honours the running user's sharing, role hierarchy and field-level security.** The API commonly shows less than an admin sees, and **fields are omitted rather than nulled**, so a missing column looks like a schema difference. |
| **Looker** | without `see_lookml`, `sql` is omitted from every field; fields the user cannot access are absent entirely; `access_filters` inject per-user row filters |
| **Power BI** | `INFO.*` needs semantic-model admin, sometimes workspace admin; a viewer gets nothing. **OLS makes objects invisible rather than error-producing.** RLS filters rows. |
| **Tableau** | RLS **silently changes every number** depending on the PAT or JWT identity; the Metadata API is permission-filtered with no error |
| **Cube** | `/v1/meta` returns only what the JWT's security context allows, and **`query_rewrite` can inject mandatory filters the agent never sees** |
| **Marketo** | fields an API-only role cannot see **do not appear in `describe2` at all** |
| **Segment** | read-only tokens silently omit resources |
| **Snowflake** | row access policies silently filter rows |

### Shows MORE than a human sees

| Platform | Mechanism |
|---|---|
| **HubSpot** | **private-app tokens are portal-scoped and ignore user roles and field permissions.** The API commonly shows more than a UI user sees. **This is usually why a manager says the agent's number is too high.** |
| **Google Ads** | `status = 'REMOVED'` entities persist and are returned; the UI hides them |
| **Looker** | `search_looks` / `search_dashboards` return soft-deleted content unless filtered |
| **Power BI** | Admin scanner APIs can return items users can no longer see |

### Shows the same shape, different values

| Platform | Mechanism |
|---|---|
| **GA4** | **`schemaRestrictionResponse`: two service accounts can legitimately return different revenue** from the same property, with no error |
| **Snowflake** | **masking policies return masked values that look like data.** Not null, not an error: a plausible-looking wrong value. |
| **Braze** | the MCP server has **no PII tools by construction**, so person-level questions are structurally unanswerable through it |

---

## 3. Always log which credential produced a number

The credential identity goes in the **provenance block**, on every number, next
to the query and the timezone.

```
credential_identity: "analytics service account, <role name>"
permission_scope_note: "Salesforce: runs as the integration user; report rows
                        are filtered by that user's sharing and role hierarchy"
```

Without it, a discrepancy between two numbers cannot be diagnosed, because the
most likely cause is not recorded anywhere.

---

## 4. The capability probe

For each platform, one probe that distinguishes "absent" from "invisible".
Record every result, including the passes, because a probe that was never run
is not evidence.

| Platform | Probe | Blindness signature |
|---|---|---|
| **Looker** | request `sql` on a field you know exists | field returns, `sql` absent → no `see_lookml` |
| **Looker** | list explores, compare to the known model list | explore absent → model-level access missing |
| **Power BI** | `EVALUATE INFO.TABLES()` | empty or 401 → not semantic-model admin |
| **Power BI** | compare a measure's value with and without an RLS role | different → RLS active |
| **Tableau** | Metadata API query for a workbook you know exists | absent from results → permission-filtered |
| **Tableau** | run the same VDS query under two identities | different totals → RLS |
| **Snowflake** | `SHOW SEMANTIC VIEWS` then `DESCRIBE` one | `SHOW` lists it, `DESCRIBE` fails → role lacks usage |
| **Snowflake** | **compare a column's values against a known control value** | values differ from the control but look plausible → **masking policy** |
| **Snowflake** | count rows against a known control count | fewer → row access policy |
| **Cube** | `/v1/meta` under two JWTs | different models → security context filtering |
| **Cube** | check whether `query_rewrite` is configured | if yes, every number is conditionally scoped |
| **GA4** | read `schemaRestrictionResponse` on a report request | present → field-level restriction changed the numbers |
| **Salesforce** | run a report as the integration user and as an admin | row or column difference → sharing / FLS |
| **HubSpot** | compare an API object count to a UI list count for the same filter | API higher → portal-scoped token ignoring roles |
| **Marketo** | `describe2` field list versus the documented field set | fields absent → API-only role restriction |
| **BigQuery** | `INFORMATION_SCHEMA.TABLES` count versus a known inventory | fewer → dataset ACL |

**The Snowflake masking probe deserves emphasis.** A masked value is not null
and does not error. It is a plausible-looking wrong value, and the only way to
detect it is to compare against a value you already know.

---

## 5. Recommended service-account configuration

**Introspection depth is a function of the role, not the API.** A read-only
role may be unable to read metric definitions at all, which means "least
privilege" applied naively produces an agent that cannot do the job and cannot
explain why.

| Platform | Least privilege that still permits introspection |
|---|---|
| **Looker** | a role with `see_lookml` plus explore access on the models in scope. Without `see_lookml` the agent can query but cannot audit. |
| **Power BI** | semantic-model **contributor or above** on the models in scope, plus the **tenant setting allowing service principals to use the APIs**, which is off by default and only a Fabric admin can change |
| **Tableau** | a dedicated service user with the same RLS context as the intended audience, **not** an admin, so numbers match what the audience sees. Connected App JWT rather than a PAT, because **PATs expire after 15 days idle.** |
| **Snowflake** | a dedicated role with `USAGE` on databases and schemas, `SELECT` on the objects in scope, and explicitly documented exposure to masking and row access policies |
| **Salesforce** | an integration user whose sharing and role position **match the intended reporting scope**, documented, because report output follows it |
| **HubSpot** | a private app with the minimum scopes; **note explicitly that it will see more than a UI user** and that this is expected |
| **GA4** | a service account with property-level read; record it, because two accounts can return different revenue |
| **Cube** | a JWT whose security context matches the intended audience, and document whether `query_rewrite` applies |

**The Tableau and Salesforce rows carry a design decision worth stating: should
the service account see everything, or see what the audience sees?** Both are
defensible. An admin-scoped account produces complete numbers that do not match
any user's view; an audience-scoped account produces numbers that match and are
incomplete. **Pick deliberately and write it down**, because the choice
determines whether "the dashboard disagrees with the report" is a bug.

---

## 6. Build the diagnostic rather than guessing the cause

Where a capability appears missing, build a narrow diagnostic that isolates it:

1. **Probe the object catalogue.** Does the object appear at all?
2. **Try multiple API versions and path forms.** A 404 on one path shape is not
   proof of absence.
3. **Run a known-good control query.** If the control works and the target does
   not, the credential is reaching the service and being filtered.
4. **Run the same call under a second identity** where one is available. The
   delta is the permission effect, measured rather than inferred.

The finding is then **"the connected identity cannot see this object"** rather
than **"the integration is broken"**. Those route to different people and
different fixes.

---

## 7. Tenant-scoped views produce empty results that look like findings

Where a view is hard-filtered to a tenant, an empty result is **not
applicable**, never a measured zero.

```sql
-- returns zero rows because the view is scoped to a different tenant
select count(*) from tenant_scoped_view where ...;
-- correct interpretation: not_applicable
-- wrong interpretation:   "this tenant has no activity"
```

**Reporting a hard-filtered empty result as a business finding is cross-tenant
contamination in reverse**, and it is the kind of error that reaches a customer
before anyone notices.

---

## 8. Privacy posture is part of the audit

Record, per credential: what person-level data it can reach, and whether that
matches what the use case requires.

- A credential that can read email addresses for a job that only needs
  aggregate counts is over-scoped, and the fix is cheap.
- **Braze's MCP has no PII tools by construction**, so a person-level question
  routed there is structurally unanswerable and should be routed elsewhere or
  declined, not worked around.
- Where masking is active, person-level values are **masked, not absent**, so a
  process that reads them and stores them is storing masked values that look
  real.

---

## 9. Output

```
credentials[]:
  identity, platform, role, scopes[], auth_method, expiry_behaviour
capability_matrix:
  rows = credentials, columns = capabilities
  (list objects, read metric definitions, read row data, read PII,
   read lineage, write)
  cells = yes | no | partial, with the probe that established it
identity_dependent_numbers[]:
  metric, platform, mechanism, direction (more | less | different_values),
  measured_delta (where a second identity was available)
blind_spots[]:
  credential, platform, probe, result, conclusion, resolves_with
recommended_service_accounts[]:
  platform, role, rationale, scope_decision (admin-scoped | audience-scoped)
privacy_posture[]:
  credential, person_level_reach, required_by_use_case, over_scoped: bool
```

---

## 10. Answering

**Answer first.** When two numbers differ between an integration and the UI,
lead with the likely mechanism and its direction: "The integration is reading
through a portal-scoped HubSpot token, which ignores user roles, so it sees
more than you do in the UI. That is expected, not a bug. The difference is
[n] records."

**Give the number the credential produced**, with the identity attached, rather
than withholding it because the scope is imperfect. A scoped number with its
scope stated is useful; a withheld number is not.

Withhold only: a claim that an object does not exist, when the probe shows the
credential could not see it. That is `unavailable`, not `no_data`, and it names
the permission that would resolve it.

## References

- `references/probe-catalogue.md` — the probes, by platform, with the exact
  calls and signatures
- `references/service-account-design.md` — least privilege that still permits
  introspection, and the admin-scoped versus audience-scoped decision

## Related skills

- `provenance-block` carries `credential_identity` and
  `permission_scope_note` on every number.
- `semantic-layer-introspector` shares the blindness probes.
- `cross-system-reconciliation` when permission scope is the cause of a gap.
- `metric-definition-audit` and `report-estate-audit` both declare their
  coverage using this skill's blind-spot output.
