# Enforcement, scopes and approval records

## Why enforcement is not prompting

**The model cannot be talked out of a regex.** It can be talked out of an
instruction, by a sufficiently plausible user message, by text inside a
retrieved record, or by its own reasoning about what the user probably wanted.

So the read-only guarantee lives in the client, between the model and the API.

## Read-only enforcement

### Statement-level rejection

```
DENY = r'\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|
            call|execute|copy\s+into|unload|put|remove|comment\s+on)\b'
```

Plus the platform's procedural entry points, which differ: stored procedure
calls, scripting blocks, `EXECUTE IMMEDIATE`, task and stream DDL.

### Single statement only

```
if count_statements(sql) > 1: reject
```

A semicolon followed by anything is a rejection, not a parse. Stacked statements
are the oldest bypass there is.

### Comment stripping before inspection

```
stripped = strip_comments(sql)     # -- ... and /* ... */
inspect(stripped)                  # a keyword hidden behind a comment marker is still a keyword
```

Inspect the stripped text, execute the original. Never inspect the original and
execute something else.

### Object allowlist, not denylist

```
allowed_objects = {"analytics.fct_orders", "analytics.dim_customer", ...}
referenced = parse_table_references(sql)
if not referenced <= allowed_objects: reject
```

**A denylist is a list of the attacks you thought of.** Block system schemas and
metadata catalogues explicitly as well, since those leak structure even when
they hold no business data.

### Hard result cap at the client

```
rows = execute(sql)[:MAX_ROWS]     # independent of any LIMIT in the query text
```

A `LIMIT` inside the query is the model's promise. The client cap is the
guarantee.

### Where the platform offers a safer tool, use it

- **Snowflake:** semantic-view tools only. Enabling `SYSTEM_EXECUTE_SQL`
  "allows the MCP client to bypass the agent's semantic views", per Snowflake's
  own warning, which means losing exactly the governance the semantic view
  exists to provide.
- **BigQuery:** prefer a parameterised, predefined SQL tool over an
  arbitrary-SQL-execution tool for anything customer-facing.
- **Any platform with a read-only server variant:** connect that one.

---

## Refusing mixed requests whole

```
components = classify_components(request)
if any(c.is_write and not c.approved for c in components):
    refuse(entire_request)          # zero tool calls, including reads
```

Zero tool calls means zero. Not the cohort query "to prepare". Not a dry run.
Not a generated script handed back for the user to execute. Not a sub-agent
asked to do the write part.

The refusal names the actual prohibited action and the affected asset:

> **Blocked.** The request includes deploying a transformation to the event
> pipeline, which changes every event flowing through it from that point on and
> can change what past analyses reproduce. Nothing has run, including the cohort
> query.
>
> Here is what I would deploy: [diff]. It attaches to [sources] and touches
> [fields]. Approve it and I will run the whole request, cohort query included.

Three properties of that refusal: it names the action, it names the asset, it
gives the user a path forward. **Generic compliance language is insufficient**
and trains users to route around the gate.

---

## Recommended minimal scope sets

### The model to copy

**Separate capability classes, off by default, granted individually, per stored
credential.** One vendor in the research ships exactly this: PII access, writes
and sends as three independent flags, all off unless turned on for that key.
That shape is what a public pack should recommend everywhere, whether or not the
platform supports it natively.

### Per platform

| Platform | Analytics-agent scope | Notes |
|---|---|---|
| PostHog | personal API key with `query:read` and `insight:read` | nothing else. Dashboard creation needs a second key |
| Braze | dashboard-user-bound OAuth | **agent permissions mirror the human's; deactivating the user revokes the agent.** The best model in the register |
| Amplitude | OAuth with permission inheritance | the agent cannot exceed the human |
| Iterable | stored key with PII, writes and sends all off | turn on individually, per key, never globally |
| GA4 | `analytics.readonly` | `analytics.edit` only if Admin writes are genuinely wanted |
| Google Ads | read scope, and prefer the **official** read-only MCP | a community server is not read-only |
| Snowflake | a role with `select` on the allowlisted objects, semantic-view tools only | no `SYSTEM_EXECUTE_SQL` |
| BigQuery | a dedicated service account, `bigquery.dataViewer` plus job user | per-user custom quotas then bind the agent |
| Salesforce | an integration user with read on the needed objects | note that the running user determines both rows and timezone |
| HubSpot | scoped private app | **a private-app token ignores user permissions and sees more than a human**, so scope it deliberately |

### Two credentials, not one

An analytics agent gets read scopes. If writes are wanted, a **second
credential** exists for them, with its own approval path. One credential that can
do both is one prompt away from doing both, and no amount of prompt discipline
changes that.

---

## Approval records

```json
{
  "operation": "deploy_transformation",
  "tier": "A",
  "platform": "…",
  "target": "transformation 'normalise_utm' on sources [web, mobile]",
  "diff_shown": true,
  "granted_by": "the human in this conversation",
  "scope": "this operation only",
  "recorded_at": "2026-09-20T14:02:00Z",
  "expires": "immediately after execution"
}
```

Rules:

- **An approval names what was approved and how far it extends.** "Approved"
  with no scope silently becomes session-wide.
- **Scope by tier.** Tier A and B: this operation. Tier C: this change set. Tier
  D: this session, this folder. Tier E: this send.
- **Approval does not survive a change to the operation.** If the diff changes,
  the approval is void.
- **Approval does not transfer across objects.** Approving a budget change on one
  campaign is not approval for the next.
- Record it in provenance, so a number produced after a write can be traced to
  the write that preceded it.

---

## Draft-only handoff

Where the platform supports drafting, this is the output shape:

```json
{ "verdict": "draft_only",
  "artefact": "campaign draft 'Q4 reactivation'",
  "location": "Campaigns → Drafts, in the product",
  "activation_step": "open the draft, review the audience of 14,200, click Schedule",
  "what_the_agent_did_not_do": "did not schedule, did not send, no recipient has received anything" }
```

The last field matters. **A demo claiming "the agent launched the campaign" when
the platform structurally cannot is a lie the pack must be unable to tell**, and
the way to make it impossible is to have the honest sentence built into the
output shape.

---

## The governance disclosure

Before the first query against a governed dataset, tell the user once:

> Metadata, schemas and query results from this platform leave it and go to this
> client and its model provider. Microsoft documents this explicitly for its own
> servers and it is true of every MCP path. That is a policy question for your
> side, not something I can configure away.

It is a conversation to have, not a control to set. Having it before the first
query is materially different from having it after.
