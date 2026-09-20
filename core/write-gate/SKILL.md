---
name: write-gate
description: Use before any operation that creates, modifies, deletes, deploys, schedules or sends anything in a GTM platform — creating a report or dashboard, editing a semantic model, deploying a transformation, changing a campaign or budget, publishing a dashboard, sending a message. Classifies the write by blast radius, requires explicit human approval at the right level, and refuses whole any request mixing a read with an ungated write. Prevents an analytics agent spending real ad budget or silently corrupting every downstream number in the stack.
---

# Write gate

Reads and writes are different capabilities with different failure modes. A bad
read produces a wrong answer someone can dispute. A bad write produces a wrong
answer **everywhere**, for months, that nobody disputes because it looks
consistent.

Classify by blast radius. Approve at the level the radius demands. Refuse mixed
requests whole.

## The blast-radius ladder

### Tier A — silently corrupts all downstream numbers, retroactively and invisibly

**The highest-risk write capability found anywhere in the research, higher than
ad-spend writes.**

- **RudderStack transformation deployment.** JavaScript that runs on **every
  event** passing through the pipeline. The official MCP server permits exactly
  this and explicitly permits nothing else.
- A deployed transformation changes what is recorded from that moment on, and
  because downstream systems recompute from the stream, it can change what
  historical analyses produce. Nothing errors. Every dashboard stays green.
  Every number is now different and internally consistent.

**Always human-approved, never automatic, never batched with anything else.**
The approval must name the transformation, the sources it attaches to, and the
fields it touches. A diff of the JavaScript is mandatory, not a summary of it.

Adjacent Tier A writes: any transformation, mapping or enrichment step in a
customer data pipeline; any change to event schema enforcement; any tracking-plan
change that drops or renames events.

### Tier B — spends money

- **Meta's official MCP can create and edit campaigns, ad sets and ads.** One
  prompt away from real spend.
- Google Ads mutate operations carry real money. **The official Google server is
  read-only; a community server is not.** Know which one is connected, from
  `mcp-detect-fallback`.
- Budget changes, bid changes, campaign activation, audience expansion.

**Always human-approved, per operation.** Not per session, not per campaign
group. The approval names the object, the change, and the money at stake per
day.

### Tier C — changes shared definitions

Everyone's numbers change, but visibly and recoverably.

- Semantic model edits: Cube data model files, Power BI measures, relationships
  and row-level security via the Authoring MCP or XMLA, Snowflake
  `CREATE OR ALTER SEMANTIC VIEW`, Looker project files and
  `deploy_to_production`.
- dbt `build` and `run`. The official dbt MCP exposes both, and an ungated
  `dbt build` from an agent is a Tier C write that looks like a routine command.

**Approved per change set, on a dev branch, with a diff shown.** Not approved as
"go ahead and update the model".

### Tier D — creates a visible artefact

Someone will find it and wonder who made it. Low harm, real clutter.

- Salesforce `POST /analytics/reports`, Looker `create_look` and
  `create_dashboard`, Power BI `Add Dashboard` and `Clone Report`, PostHog
  insights and dashboards, Mixpanel dashboards via MCP, Cube Cloud reports and
  workbooks.

**Approved once per session, per target folder or workspace.** Name the
destination in the approval; "create dashboards" without a destination is not an
approval.

### Tier E — sends to a human or the public

Irreversible in the way that matters: someone read it.

- Scheduled plans and subscriptions, campaign activation, message sends, email
  sends, push notifications, anything that leaves the platform.

**Always explicit, never inferred, never batched.** An approval to create a
campaign is not an approval to send it.

## Read-only is enforced in code, never in a prompt

**The model cannot be talked out of a regex.** A prompt instruction not to write
is a suggestion; a rejected statement is a guarantee.

Where the pack issues SQL or a query language:

1. **Reject DDL and DML by pattern.** `insert`, `update`, `delete`, `merge`,
   `drop`, `create`, `alter`, `truncate`, `grant`, `revoke`, `copy into`, and
   the platform's own procedural entry points.
2. **Block stacked statements.** One statement per request. A semicolon followed
   by anything is a rejection, not a parse.
3. **Block comment-hidden injections.** Strip and inspect; a `--` or `/* */`
   sequence preceding a keyword is not a comment for this purpose.
4. **Block system schemas** and metadata catalogues not on the allowlist.
5. **Allowlist the readable objects.** A denylist is a list of the attacks you
   thought of.
6. **Impose a hard result cap** at the client, independent of any `LIMIT` in the
   query text.

### Refuse mixed requests whole

**A request containing any write component is refused whole, with zero tool
calls.**

No "let me identify the cohort first". No sample write snippet. No delegating
the write to another agent or to a generated script. The precursor read is part
of the refused request, because a partial execution leaves state and leaves the
user believing the operation began.

The refusal names the actual prohibited action and the affected asset:

> That request includes deploying a transformation to the event pipeline, which
> changes every event from that point on. I have not run any part of it,
> including the cohort query. Here is the transformation I would deploy and the
> sources it would attach to; approve it and I will run the whole thing.

Not: "I am not able to help with that request."

## Default to the narrowest credential

Ship recommended minimal scope sets. The model to copy, per the research:

- **Iterable's opt-in design.** PII access, writes and sends are **three separate
  flags, all off by default**, granted per stored key. Named in the research as
  the model a public pack should recommend. Copy the shape: capability classes,
  off by default, granted individually.
- **Braze's dashboard-user-bound OAuth.** Agent permissions mirror the human's,
  and deactivating the human revokes the agent. There is no separate credential
  to forget about.
- **Amplitude's permission inheritance.** The agent cannot exceed the human who
  authorised it.
- **PostHog**: a personal API key scoped to `query:read` and `insight:read` for
  an analytics agent. Nothing else.

The general rule: **an analytics agent gets read scopes only, and a second
credential exists for writes if writes are wanted at all.** One credential that
can do both is one prompt away from doing both.

## Draft-only is a first-class outcome

Where a platform supports drafting, **produce the draft and build the handoff in,
rather than pretending activation happened.**

- Inflection's MCP drafts journeys and emails; a human activates them in the
  app. That is the correct design.
- Klaviyo's MCP creates campaigns and templates **as drafts**.
- Tableau's official server is read-only with no create or publish tools, so the
  honest output is a Pulse metric definition or a specification, not a
  dashboard.

`draft_only` output shape: the artefact, its location, and the exact step a
human takes to activate it. **A demo claiming "the agent launched the campaign"
when the platform structurally cannot is a lie the pack must be unable to tell.**

## Platform-specific warnings to carry

### Snowflake, in its own words
Enabling `SYSTEM_EXECUTE_SQL` on an agent-focused MCP server "allows the MCP
client to bypass the agent's semantic views". **You lose the governance you built
the semantic view for.** Default to semantic-view tools only.

### BigQuery
Prefer a **parameterised, predefined SQL tool** over an arbitrary-SQL-execution
tool for anything customer-facing. The arbitrary tool is convenient in
development and is an unbounded write surface in production.

### Cube's posture, adopted as the pack's
**Verify before merging, not after.**
- Model writes confined to personal dev branches.
- Destructive tools always prompt.
- Production commits require explicit confirmation.

### Power BI
The Authoring MCP is **write-first and in public preview**, and Microsoft says
do not use it for consumption. A write-first preview surface is the worst
combination in the register for an analytics agent: high blast radius, unstable
contract.

### The data-governance disclosure Microsoft flags
**Metadata, schemas and query results leave the platform** and go to the client
and its model provider. That is a conversation to have with the user, not a
platform security control to configure. Raise it before the first query on a
governed dataset, not after.

## Output

```json
{ "verdict": "approved | blocked | draft_only",
  "tier": "A|B|C|D|E",
  "operation": "…", "target": "…", "platform": "…",
  "blast_radius": "what changes, for whom, and whether it is reversible",
  "approval": {"granted_by": "…", "scope": "this operation | this session, this folder",
               "recorded_at": "…"},
  "block_reason": "the actual prohibited action and the affected asset" }
```

An approval record names **what** was approved and **how far** it extends.
"Approved" with no scope is how a per-operation approval becomes a session-wide
one.

## Calls

- Called by every authoring-capable and query-compose module
- Called by semantic-model, transformation and dashboard builders
- Takes the connected-server facts from `mcp-detect-fallback`, because whether a
  write path exists depends on which server is connected

## References

- `references/blast-radius.md` — the ladder with every operation the research names, per platform
- `references/enforcement.md` — read-only enforcement patterns, scope sets, and approval records
