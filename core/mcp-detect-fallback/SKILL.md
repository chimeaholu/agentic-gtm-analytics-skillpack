---
name: mcp-detect-fallback
description: Use at the start of any platform interaction, before choosing how to call it. Detects whether the platform's official MCP server is connected and whether it actually exposes the needed tool, then routes to MCP or to the direct API fallback. Encodes which vendors have real official servers, which have none, and which community servers are clone farms to avoid. Prevents a skill breaking when a vendor-hosted, unversioned MCP changes or removes a tool between sessions, and prevents adopting an abandoned or lead-generation repo as a dependency.
---

# MCP detect and fallback

**Prefer the MCP. Never depend on it.**

Every top-tier official server is vendor-hosted and versionless. You cannot pin
it, diff it, or subscribe to its changelog. A tool can be renamed or removed
between one session and the next. **An MCP-only skill is a skill whose behaviour
the vendor controls.**

So: probe, route, record, and keep the direct client working.

## The routing decision

```
1. Is a server for this platform connected in this session?
   No  → direct_api
2. List its tools. Does a tool match the required capability?
   No  → direct_api, and note which tool was expected
3. Does the vendor's own documentation limit that tool in a way that matters here?
   Yes → direct_api or a hybrid, and quote the limitation
4. Otherwise → mcp:<tool_name>
5. Record the chosen path in provenance either way.
```

**Probe, do not assume.** List tools at session start and match against the
capability you need. A tool that existed last week is not evidence a tool exists
now, and a server being connected is not evidence it can do the thing.

Output:

```json
{ "route": "mcp:run_report | direct_api | unavailable",
  "server": "…", "tool": "…",
  "reason": "tool absent | vendor limitation | no server | probe failed",
  "vendor_limitation_quote": "…" }
```

## The verified official-server register

Hosting, auth, write capability and the vendor's own stated limitations.

| Platform | Server | Hosting | Auth | Write | The limitation that matters |
|---|---|---|---|---|---|
| **Meta Ads** | Meta Ads MCP, `mcp.facebook.com/ads` | remote | OAuth | **Yes — create/edit campaigns, ad sets, ads** | write-capable with real money attached. Gate through `write-gate` |
| **Google Ads** | `googleads/google-ads-mcp` | self-host | OAuth / service account | **No — strictly read-only, in Google's own words** | 3 tools, but `search` takes arbitrary GAQL and therefore covers the whole read API |
| **GA4** | `googleanalytics/google-analytics-mcp` | self-host (PyPI) | ADC | No | **self-labelled experimental.** 7 tools: no pivots, no batch, no compatibility check, no audience exports, no Admin writes |
| **Mixpanel** | `mcp.mixpanel.com` | remote | OAuth PKCE / service accounts (beta) | **Yes** — dashboards, reports, cohorts, flags | 60+ tools. **No HIPAA support.** Org-admin enablement needed for accounts created before 2026-08-01 |
| **Amplitude** | `mcp.amplitude.com` | remote | OAuth, inherits existing permissions | No | **explicit beta warning from the vendor.** No Export API access |
| **PostHog** | `mcp.posthog.com` | remote | scoped personal API key | **Yes** | ~80 tools. **May incur PostHog AI spend** |
| **HubSpot** | `mcp.hubspot.com` | remote | OAuth 2.0 | **Yes** — CRM objects and engagements | **GA, and zero analytics tools.** No access to Sensitive Data Properties |
| **Klaviyo** | remote + local | remote/local | OAuth | **Yes** — campaigns and templates as drafts | reporting explicitly in scope. Send and schedule reportedly not until later |
| **Braze** | `mcp.braze.com` / `.eu` | remote | dashboard-user-bound OAuth | varies | GA 2026-07-23. **No user-level PII tools at all.** Blocked entirely if dashboard IP allowlisting is on |
| **Iterable** | `@iterable/mcp`, MIT | **local stdio only** | API key | opt-in | read-only by default; PII, writes and sends are separate opt-in flags |
| **RudderStack** | vendor-hosted | remote | OAuth, no stored credentials | **Narrow — transformations only** | cannot create or delete sources or destinations. **The transformation write is the highest-risk write in this register** |
| **Inflection** | `mcp.inflection.io` | remote | OAuth 2.1 + DCR | **Drafts only — cannot activate** | the right design, and the pack copies it |
| **Snowflake** | `CREATE MCP SERVER` | in-warehouse | Snowflake auth, RBAC | query | tools declared in SQL under RBAC. See the `SYSTEM_EXECUTE_SQL` warning in `write-gate` |
| **BigQuery** | `bigquery.googleapis.com/mcp` | remote | Google auth | query | **preview** |
| **Looker** | in `googleapis/genai-toolbox` | self-host | Google auth | query | **shipped as-is, not a supported GCP product.** Looker integration is preview and Google-Cloud-hosted Looker only |
| **Tableau** | `mcp.tableau.com` | remote | OAuth 2.1, per-user permissions | No | "Tableau Supported". **Read-only: no create or publish tools** |
| **Power BI** | Authoring MCP | remote | Entra | **Write-first** | **public preview, and Microsoft says do not use it for consumption.** Fabric IQ is the consumption path |
| **Cube** | `cubecloud.dev/mcp` | remote | Cube auth | yes | **Premium and Enterprise plans only** |
| **dbt** | `dbt-labs/dbt-mcp` | self-host | dbt Cloud token | yes | ~50 tools, and it exposes `build` and `run`. Gate them |
| **Salesforce DX** | `salesforcecli/mcp` | self-host stdio | Salesforce CLI auth | yes | **Developer Preview.** Developer tooling: **no reporting tools at all** |

Two entries in that table are routinely misread, so state them outright:
**Salesforce's official MCP is a developer tool, not an analytics source**, and
**HubSpot's official MCP has zero analytics tools**. Neither can do reporting.
Assuming either can is a common and expensive mistake.

## Where there is genuinely nothing official

| Platform | Reality |
|---|---|
| **LinkedIn Ads** | no official server. The community field is a **clone farm**: two repos under different owners share identical READMEs and the same commit timestamp to the second, and a third runs a "full write access" pitch as a lead magnet. **Do not adopt** |
| **Segment** | no official server. Community `segment-mcp` projects wrap the **ingestion** API, which is a hazard rather than a feature |
| **Google Search Console** | no official Google server, notably. The best community option is genuinely maintained and is the one community server worth considering in this survey |
| **Marketo** | 6 community repos, the best at 4 stars |
| **Pardot / MCAE** | 4 community repos, **all with 0 stars** |
| **Salesforce Reports and Dashboards REST API** | **wrapped by no server, official or community.** The headline gap in the whole ecosystem |

For all of these: **write a thin direct client.** That is not a workaround, it is
the correct answer. Access is cheap once the gotchas are known; each is a page
of query construction plus a page of traps.

## The four quality signals that actually discriminate

Stars and tool counts lie. These do not.

### 1. Duplicate descriptions across owners means clone farm
The strongest single signal. **Search the description string, not just the repo
name.** Identical READMEs under different owners, and identical commit
timestamps to the second under different owners, confirm it. The clone farms
found in the research were for LinkedIn, Meta, and an ingestion-MCP pair
appearing under two different product names.

### 2. The last-commit date on the repo you found can be wrong about the project
One vendor's standalone MCP repo looks eight months dead; the code moved into
the monorepo and ships daily. **Check whether the code relocated before writing a
project off.** Conversely, check whether a "fresh" commit is README or CI churn.

### 3. Tool count is not coverage, and a high count is a negative for agents
A 135-tool wrapper is worse for an LLM than a 3-tool server whose `search` takes
arbitrary GAQL, because the 3-tool server covers the entire read API in one
well-described tool. **Generic query tool plus schema tool beats N hand-wrapped
endpoints.** This is the most transferable design lesson in the research, and it
is also how to judge a server you did not write.

### 4. Hosted plus OAuth plus permission inheritance is the real quality tier
"Respects your existing permissions" and project-level permission enforcement
mean the agent cannot exceed the human who authorised it. That is worth more
than any number of tools.

Stars are inflated by directory sites and deflated by monorepos. Use them only
to separate 0 to 50 (ignore) from 1,000+ (real adoption). The 50 to 500 band is
noise.

## Quote the vendor's own limitation text

These are the most reliable sentences in the ecosystem and they are all in the
official documentation. **Quote them to the user rather than letting them be
discovered in production.**

- "Experimental" — the GA4 server's own README
- "Beta and may be rate-limited" — Amplitude
- "No HIPAA support, no cohort editing" — Mixpanel
- "Developer Preview" — Salesforce
- "May significantly change prior to GA" — Microsoft
- "Shipped as-is, not a supported product" — Google's toolbox
- "AI documentation answers may be inaccurate" — RudderStack
- "Strictly read-only" — Google Ads, which is a limitation worth celebrating

## The structural caveat, always

Every top-tier official server is vendor-hosted and versionless.

- You cannot pin a version.
- You cannot diff two revisions.
- There is no changelog to subscribe to.
- A tool can be renamed, restricted or removed between sessions.

Therefore: **every MCP path needs a direct-API fallback, and the skill detects
tool absence and degrades rather than failing.** A skill that returns "the tool
is gone" has outsourced its reliability to a vendor's deployment schedule.

Also worth stating to users: **metadata, schemas and query results leave the
platform** and travel to the client and its model provider. Microsoft flags this
explicitly. That is a conversation to have, not a platform control to configure.

## Deprecated and avoid

- A widely-recommended community warehouse MCP is **marked DEPRECATED in its own
  README** while still being recommended by blog posts and directory sites.
  Check the README, not the directory listing.
- LinkedIn and Pardot clone-farm repos, per the signals above.
- Anything whose pitch is "25 tools, full write access" with no vendor behind it.

## Calls

- Called **first** by every platform module
- Feeds `provenance-block` with the path that produced the number
- Feeds `write-gate` when the chosen route exposes write tools

## References

- `references/server-register.md` — the full register with endpoints, auth, tool counts and limitations
- `references/probing.md` — the probe procedure, capability matching, and the degradation ladder
