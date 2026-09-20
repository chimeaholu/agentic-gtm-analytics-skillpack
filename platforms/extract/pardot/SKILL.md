---
name: pardot
description: Use for any Pardot / Marketing Cloud Account Engagement request — prospect, visitor and activity extraction, list-email statistics, or campaign data. There is no report object to create, run or read, but MCAE is better than Marketo on two counts: a real aggregate email-stats endpoint whose KPI family matches the UI, and a well-designed async Export API. The worst trap is documented behaviour, not a defect: export timestamps are frozen to the timezone of whoever created the export at the moment they created it. Pin one dedicated export identity and record its timezone with the data.
---

# Pardot / Marketing Cloud Account Engagement

**Capability class: extract-only. Creating, running or reading a Pardot report does not
exist.** There is no report object of any kind.

**But MCAE is meaningfully better than Marketo on two counts, and you should say so:**

1. **A real aggregate email-stats endpoint** whose KPI family matches the UI, so you are
   not rebuilding email performance from raw events.
2. **A well-designed async Export API** with relationship traversal, which cuts call volume
   dramatically.

**The worst trap here is documented behaviour rather than a defect, and it is a genuinely
nasty silent correctness bug: export timestamps are frozen to the timezone of whichever
user created the export, at the moment they created it.** Two users exporting the same data
get differently-offset timestamps. A user who relocates changes the meaning of all their
future exports. **Pin one dedicated export identity, record its timezone alongside the
data, and never mix exports from two identities in one analysis.**

**Core contracts this module must call, every time:** `provenance-block` (business unit ID,
**the export identity and its timezone**, API version, deleted-record filter),
`warning-field-reader`, `comparability-rules`, `rate-limit-governor`,
`pagination-patterns`, `mcp-detect-fallback`, `write-gate` for any prospect or campaign
write, and `answer-contract` on the way out.

**Answer-first discipline for this platform.** The email-stats endpoint returns a real KPI
family — give the numbers. Then name the two things that bound them: `opens` is unreliable
industry-wide, and stats are per-list-email so "by month" costs one call per email.
Withhold only what genuinely is not retrievable — a prospect's historical score, which has
no exposed history, or a collection field, which cannot be exported at all.

---

## (a) Auth setup

Roughly Salesforce-level complexity, plus one header.

1. **Salesforce OAuth only. There is no Pardot-native auth any more** — it was disabled in
   February 2021. Any tutorial using a Pardot API key is dead.
2. **Create a Connected App** (or External Client App) **in the *associated Salesforce
   org*** with the **`pardot_api`** scope plus `refresh_token offline_access`.
3. **Link a Salesforce user to a Pardot user with an appropriate Pardot role. This is the
   step everyone misses, and the failure is confusing: both sides must exist, and a valid
   Salesforce token with no Pardot user mapping fails at the Pardot layer, not at the OAuth
   layer.** So you get a good token and a bad request, which sends people to debug OAuth
   when the problem is user provisioning.
4. **Send `Pardot-Business-Unit-Id` on every request**, carrying the 18-character BU ID.
   **The failure mode for a wrong value is data, not an error** — see (e).
5. **The host is `pi.pardot.com` (or `pi.demo.pardot.com`), not your Salesforce instance
   URL.** This is a frequent misconfiguration for anyone reusing a Salesforce client, and
   it produces confusing failures because the token is genuinely valid.
6. **Choose and document the export identity now, not later.** Its timezone becomes a
   permanent property of every export it creates.

---

## (b) Correct query construction

**Build on Version 5 only.** v3 and v4 are legacy and Salesforce directs all new work to
v5. Exact retirement dates have moved more than once — **check current MCAE release notes
rather than relying on a remembered date.**

**`GET /api/v5/objects/{object}`** covers prospects, visitors, visitor-activities,
campaigns, list-emails, forms, files, lists, list-memberships, opportunities, custom-fields
and users, with `nextPageToken` paging.

**`GET /api/v5/objects/list-emails/{id}/stats` is the closest thing to a real reporting
endpoint outside Salesforce and the B2C platforms.** It returns:

`sent`, `delivered`, `deliveryRate`, `hardBounced`, `softBounced`, `opens`, `uniqueOpens`,
`opensRate`, `totalClicks`, `uniqueClicks`, `clickThroughRate`, `uniqueClickThroughRate`,
`clickOpenRatio`, `optOuts`, `optOutRate`, `spamComplaints`, `spamComplaintRate`.

**It is per-list-email and aggregate-only. There is no "all emails grouped by month"
call** — that shape costs one call per email, which matters on a Growth edition budget.

**Two v5 features cut call volume dramatically, and both are worth using deliberately:**

- **Relationship traversal in `fields`, up to depth 3:**
  `?fields=id,email,campaign.name,campaign.folder.parentFolder.name`. **This also works in
  the Export API**, so a single VisitorActivity export can carry Campaign, Email and
  Prospect attributes inline **with no join pass.**
- **The async Export API itself**, covered in (c).

**B2B Marketing Analytics pushes data into CRM Analytics datasets, where
`POST /wave/dashboards` genuinely applies — but that is CRM Analytics, licensed separately,
on a sync cadence that lags the MCAE API by hours.** Do not present it as a Pardot
capability.

---

## (c) Pagination, bulk and cost

**Daily API requests by edition:**

| Edition | Daily requests |
|---|---|
| Growth | 25,000 |
| Plus | 50,000 |
| Advanced | 100,000 |
| Premium | 100,000 |

**Concurrency is 5. Any connection over five returns error code 66.** **Parallelising an
extraction across more than five workers actively hurts** — it produces errors, not speed.

**Pagination is `nextPageToken` / `nextPageUrl` alongside `values`.**

**The Export API:**

```
POST   /api/v5/exports              → export id
GET    /api/v5/exports/{id}         → poll status
GET    /api/v5/exports/{id}/results → the files
POST   /api/v5/exports/{id}/do/cancel
```

**It is subject to the same daily and concurrent limits as the sync API — it is not a
separate quota pool.** And **exports are queued and executed sequentially per account,
oldest first: firing twenty exports does not make them run twenty ways, it makes the
twentieth wait.**

**Export constraints:**

- **Maximum 150 fields per export.**
- **Collection fields cannot be exported at all** — `senderOptions`, `replyToOptions` and
  similar. Relationship fields are supported to depth 3 but **scalar-only**.
- **Supplying `createdAfter` without `createdBefore` runs "up to the creation date of the
  export" — an unbounded upper edge that makes repeated runs non-deterministic.** Always
  bound both ends.
- **Export data expires after 7 days**, and **an export not finished within 7 days expires
  unprocessed.**
- **Record order across CSV files is not guaranteed and record counts per file vary — never
  assume file 1 has the earliest rows.**

**The cost shape that bites: email stats are per-list-email, so "email performance by
month" means enumerating list emails and issuing one `/stats` call each. That burns the
daily quota linearly in the number of emails sent. On Growth at 25,000 per day, a heavy
sender cannot do this daily without planning.**

---

## (d) Preferred MCP server and fallback

**No official Salesforce MCP server covers Account Engagement.** The Salesforce DX MCP
server is CRM and developer tooling with **no Pardot tools**.

**Community options are all brand-new, unproven, and every one found has zero stars:**
`shelfio/salesforce-pardot-mcp`, `DaniilMai/salesforce-pardot-mcp`, `JustParent/pardot-mcp`,
and `CDataSoftware/salesforce-pardot-mcp-server-by-cdata` (read-only, requires a CData JDBC
licence).

**None is production-grade.**

**Fallback, and it is the plan: call the v5 API directly.** Note the reasoning, because it
generalises — **the auth is the hard part on this platform, and no MCP server removes the
Connected App and BU-header setup anyway.** An MCP here would wrap the easy part and leave
the hard part untouched.

A thin direct client needs: Salesforce OAuth with refresh, the `Pardot-Business-Unit-Id`
header on every call, a concurrency cap of 5, `nextPageToken` paging, and the Export API
lifecycle with bounded `createdAfter`/`createdBefore`.

---

## (e) Gotchas, and the specific field that reveals each one

- **Export timestamps are frozen to the timezone of whichever user created the export, at
  the moment they created it.** The documentation states it directly: dates are returned in
  the user's timezone at the time they created the export, and **if a user's timezone
  changes, previous exports keep the previous timezone. Two users exporting the same data
  get differently-offset timestamps, and a user relocating changes the meaning of all their
  future exports. Pin a single dedicated export identity and record its timezone alongside
  the data. This is documented behaviour, not a defect, and it is a genuinely nasty silent
  correctness bug.**
- **`Pardot-Business-Unit-Id` is required on every call and the failure mode is data, not
  an error.** **The wrong BU in a multi-BU org returns a valid 200 with a completely
  different prospect set.** Verify the BU against a known record before trusting any
  number.
- **Concurrency 5 and error code 66**, combined with sequential export queueing, **rewards
  a single well-behaved serial extractor and punishes naive parallelism.**
- **Prospect, Visitor and Lead/Contact are three identities.** A Visitor becomes a Prospect
  on conversion; a Prospect may or may not sync to a Salesforce Lead or Contact.
  **Counting "people" across these double-counts.** **Pardot prospect IDs are not
  Salesforce IDs — `crmLeadFid` and `crmContactFid` are the bridge fields, and they can be
  null or stale mid-sync.**
- **Soft deletes.** Deleted prospects go to a recycle bin and **v5 object queries exclude
  them by default. Without the deleted/archived filter, an agent reports "we lost 400
  prospects this month" when someone merely ran a cleanup.**
- **Email stats are per-list-email and aggregate only.** Building "email performance by
  month" means enumerating list emails then one `/stats` call each, **which burns the daily
  quota linearly in the number of emails sent. On Growth (25,000/day) a heavy sender cannot
  do this daily without planning.**
- **`opens` can legitimately read 0 while `totalClicks` is large.** Apple Mail Privacy
  Protection and similar proxies have made open tracking unreliable industry-wide. **Never
  derive an engagement rate that divides by opens without saying what it measures**, and
  prefer `uniqueClicks` and `clickThroughRate` for any ranking.
- **Collection fields silently cannot be exported** — you get an error or a missing column,
  **not a partial export with a warning.** **Validate the field list before scheduling** an
  export that runs unattended.
- **Scoring and grading are point-in-time with no exposed history.** You cannot reconstruct
  "what was this prospect's score in March". **Snapshot on a schedule if score trends
  matter** — the data does not exist to be recovered later.

---

## Files

- `references/export-api.md` — the export lifecycle, the frozen-timezone rule and how to
  handle it, bounded date ranges, and the field-list validation step.
- `references/identity-and-email-stats.md` — Prospect versus Visitor versus Lead/Contact,
  the bridge fields, and how to build email performance within the quota.
- `evals/cases.json` — behavioural cases including the honest-limit cases.
