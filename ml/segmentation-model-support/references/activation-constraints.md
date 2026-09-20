# Activation constraints by destination

**Sourced from the platform research.** Where the research says a capability does
not exist, this skill cannot promise it. Where a limit is stated by the vendor's
own documentation, that sentence is the most reliable one available — quote it
rather than discovering it in production.

---

## 1. The capability table

| Destination | Segment creation | Person-level activation | The named limit | Fallback |
|---|---|---|---|---|
| **Mixpanel** | Cohort creation **yes**, via its MCP | **No** | Its MCP states: *audience targeting and cohort editing are not supported via MCP — use the UI* | Create the cohort programmatically; targeting and editing are manual |
| **Braze** | Via REST API | **Not through its MCP** | **The MCP has no user-level PII tools at all** | REST API with a properly-permissioned key |
| **Iterable** | Via API | Yes, **flag-gated** | Its MCP requires explicit `ITERABLE_USER_PII` and `ITERABLE_ENABLE_WRITES` | Set the flags, or use the REST API directly |
| **Klaviyo** | **Yes**, segments are API-manageable | Yes | Reporting endpoints are severely rate-limited — **measurement is the constrained side** | Batch measurement; do not poll |
| **Amplitude** | Behavioral Cohorts API | Export only | **Cohorts are query-time constructs** — an export is a snapshot | Own the snapshot downstream |
| **PostHog** | Cohorts via API | Export only | Same query-time recomputation | Own the snapshot downstream |
| **Segment / RudderStack** | Audiences are **configuration objects** | Via the config | A change is a config change with downstream effect | Behind `write-gate`, always |
| **Salesforce / CRM** | Campaign membership, field writes | Yes | Field-level security and validation rules **silently reject** | **Verify the write took effect** — read back |
| **Ad platforms** | Customer-list audiences | Yes, hashed | **Minimum size floors; match rates well below 100%** | Size for the post-match count |

---

## 2. The failure modes, each with its tell

### Query-time cohort treated as a stable list

**Where:** product-analytics platforms whose cohorts are recomputed on
evaluation.

**What happens:** a five-touch sequence re-queries the cohort at each touch.
Members who no longer satisfy the definition silently fall out mid-sequence. The
sequence's measured performance is then computed over a population that changed
under it, and it will look worse than it was.

**Fix:** snapshot the membership at sequence entry and own that snapshot. The
cohort is the *source*; the sequence's audience is a *copy* with its own
lifecycle.

**Tell:** the destination's docs describe the cohort as "recomputed" or
"dynamic", or the count changes between two identical reads.

### PII activation through a channel that structurally cannot carry it

**Where:** MCP servers that expose analytics and campaign tools but deliberately
omit user-level PII tools.

**What happens:** the flow is designed, the tool list is checked at a glance, and
the person-level step fails at the platform boundary. It presents as a
permissions error, so hours go into re-issuing credentials that were never the
problem.

**Fix:** verify the capability **before** designing the flow — `mcp-detect-fallback`
probes the tool list, and the fallback is the REST API with a scoped key.

### Flag-gated writes

**Where:** MCP servers that require explicit opt-in environment flags for PII or
writes.

**What happens:** every write fails until the flags are set. The error does not
say "set the flag".

**Fix:** treat the flags as part of the connection contract; check them at
connect time, not at first write.

### Silent rejection on CRM writes

**Where:** CRM field writes and campaign membership.

**What happens:** field-level security, validation rules or a required-field
trigger rejects the update. The API can return success at the request level while
the field is unchanged.

**Fix:** **read back after writing.** Compare the value you set against the value
stored, for a sample of the batch, and report the applied count rather than the
attempted count.

### Match-rate surprise on ad platforms

**What happens:** a 1,200-record audience is pushed; 600 match; the audience
falls under the platform's minimum size floor and never activates. No error that
resembles the cause.

**Fix:** size for the post-match count. Report both numbers — pushed and matched
— and treat the matched count as the real audience size. Where the floor is
close, push a superset or widen the segment deliberately.

---

## 3. Sync mode and pacing

| Mode | When | Cost |
|---|---|---|
| **Full re-push** | First sync; destinations with no delta support; after a definition change | Expensive; exhausts quota on large audiences |
| **Delta (adds/removes)** | **The default for recurring syncs** | Requires you to hold the previous state |
| **Event-driven** | Where the destination supports membership-on-event | Lowest latency, most moving parts |

```sql
-- compute the delta
select 'add' as op, entity_id from current_members
except select 'add', entity_id from last_synced_members
union all
select 'remove', entity_id from last_synced_members
except select 'remove', entity_id from current_members;
```

**Batch, do not iterate.** Per-record API calls against a rate-limited endpoint
is the single most common way a sync job exhausts a daily quota and takes the
rest of the integration down with it. `rate-limit-governor` owns the pacing; this
skill owns not designing a per-record loop in the first place.

---

## 4. The activation checklist

- [ ] Destination capability **verified**, not assumed — probe the tool list or
      the endpoint
- [ ] Person-level PII path confirmed available, or the REST fallback designed
- [ ] Required flags or scopes set at connect time
- [ ] Segment snapshot owned locally if the destination's cohort is query-time
- [ ] Suppression lists applied **before** the push, not after
- [ ] Sync mode chosen; delta preferred
- [ ] Pacing plan inside the destination's rate limits
- [ ] Minimum size floor checked **against the post-match count**
- [ ] Write verified by read-back; applied count reported, not attempted count
- [ ] Segment version and destination recorded in the sync log
- [ ] **`write-gate` passed**, with the record count declared before the push
