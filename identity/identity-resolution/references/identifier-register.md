# The identifier register — field names, lifetimes, normalisation

Per-platform field names for every identifier the spine can consume. Where a
field is absent from a platform, that absence is stated rather than filled with
a plausible-looking name.

---

## 1. Web and product

| Platform | Anonymous ID field | Known ID field | Session field | Notes |
|---|---|---|---|---|
| **GA4 (BigQuery export)** | `user_pseudo_id` | `user_id` (only if set by the implementation) | **none** — build it as `user_pseudo_id \|\| '.' \|\| (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')` | there is no session table; a session is a construction |
| **GA4 (Data API)** | not exposed at row level | not exposed at row level | `sessions` is a metric | the Data API is aggregate-only — **person-level identity work requires the BigQuery export** |
| **PostHog** | `distinct_id` (anonymous) | `distinct_id` after `identify` | `$session_id` | `person_id` resolution can change retroactively after a merge |
| **Amplitude** | `device_id` | `user_id` | `session_id` | **user merging rewrites history; re-exports are not idempotent across a merge** |
| **Mixpanel** | `$device_id` | `distinct_id` / `$user_id` | derived | **the raw-export `distinct_id` is not necessarily the UI's canonical ID** on ID-Merge projects — check the project's merge version first |
| **Segment** | `anonymousId` | `userId` | — | Profiles API is a **per-profile lookup**, not an aggregate query API |
| **RudderStack** | `anonymous_id` | `user_id` | — | stitching happens **in your warehouse** (Profiles); the edge cases are yours |

**The bridge edge** is the same everywhere: the event where an anonymous ID and
a known ID appear together — `identify`, a login, a form submission with a
cookie present. Capture it with its timestamp. Without the timestamp there is
no backfill (see `backfill-procedure.md`).

---

## 2. CRM and marketing automation

| Platform | Person ID | Account ID | The trap |
|---|---|---|---|
| **Salesforce** | `Contact.Id`, `Lead.Id` | `Account.Id` | **`Lead.ConvertedContactId` / `ConvertedAccountId` / `ConvertedOpportunityId`.** Conversion retires the Lead ID; activity logged against the Lead does not follow a naive join and must be routed through the converted IDs. This is the most common broken B2B join there is. |
| **HubSpot** | contact `hs_object_id` | company `hs_object_id` | **associations are many-to-many.** A deal with four contacts fans out to four rows with the full amount on each. Also: `hs_lifecyclestage_*_date` properties are **overwritten on re-entry**, so a contact that cycles through a stage twice loses its first journey |
| **Marketo** | lead `id`, and `cookie` (Munchkin) | `Company` / named account | **dedupes on email and emits merge events that rewrite IDs.** Consume the merge events or your joins rot silently. Activity retention is roughly 25 months, contract-dependent |
| **Pardot / MCAE** | prospect `id`, `crm_lead_fid`, `crm_contact_fid` | `crm_account_fid` | the `crm_*_fid` fields are the **rung-2 mapping keys** — when populated, they are the best cross-system key available |

The `crm_*_fid`-style field — a CRM ID written onto the marketing-automation
record — is rung 2 in the precedence table and is worth more than any matching
logic you can write. **Measure its population rate before relying on it**, and
report it: a mapping field populated on a third of records covers a third of
the join.

---

## 3. Commerce and messaging

| Platform | Person ID | Anchor | Note |
|---|---|---|---|
| **Klaviyo** | profile `id`, `email`, `phone_number`, `external_id` | `external_id` is the intended bridge to your store's customer ID | set it at integration time or lose the link |
| **Braze** | `external_id`, `braze_id`, `email` | `external_id` | anonymous users get a `braze_id` only |
| **Iterable** | `email` or `userId` (project-configured) | whichever the project uses | **the project is configured for one or the other**; check which before writing joins |
| Store / checkout | `customer_id`, `order_id` | `order_id` is the B2C anchor | **guest checkout breaks the person link entirely** — the order exists, the person does not. Report guest-checkout share, because it is the ceiling on B2C person-level analysis |

---

## 4. Advertising

Ad platforms return **aggregate reporting only**. There is no person-level
identifier in ad reporting, by design and by policy.

The joinable keys are campaign-level: `campaign_id`, `adgroup_id`/`adset_id`,
`ad_id`, and the UTM parameters that land in your own analytics. This is why
**campaign-key normalisation is mandatory** (`journey-assembler` §3) — the
campaign name is the de-facto join key between ad spend and web touches, and it
is almost always inconsistent.

Where a click identifier is passed through and captured (`gclid`, `fbclid`,
`li_fat_id`, `msclkid`) it is a **deterministic touch-to-click key** worth
capturing at landing and storing on the touchpoint. It identifies the *click*,
not the person — it becomes person-level only through the same cookie bridge as
everything else.

---

## 5. Normalisation, per type

| Type | Rule | Failure if skipped |
|---|---|---|
| email | lowercase, trim, decide plus-addressing and dots **as policy**, exclude role addresses from person identity | the same person appears two to five times; or an `info@` inbox merges an organisation into one "person" |
| phone | E.164, with a default country code declared | `+1 555 0100`, `(555) 0100` and `5550100` are three people |
| domain | lowercase, strip `www.`, strip protocol, **keep the public suffix intact** | `Acme.com` and `acme.com` split an account |
| cookie / device | none — opaque, use exactly as received | "normalising" an opaque ID corrupts it |
| CRM ID | preserve case; **Salesforce 15-character IDs are case-sensitive and the 18-character form is not** — pick one form and convert consistently | a 15-vs-18 mismatch silently fails every join |
| order ID | preserve exactly, including leading zeros — **store as STRING** | numeric casting drops leading zeros and creates collisions |

The Salesforce 15/18 case deserves emphasis: both forms refer to the same
record, the 18-character form is the 15 plus a case-insensitive checksum
suffix, and a join between a table holding one form and a table holding the
other returns **zero rows with no error**. Normalise to 18 everywhere at the
staging boundary.

---

## 6. Lifetimes, and what they bound

| Identifier | Practical lifetime | What it bounds |
|---|---|---|
| First-party cookie under ITP/ETP | **days to weeks** on Safari, longer elsewhere | the **backfill horizon**. A 90-day consideration cycle is partially unrecoverable by construction |
| Third-party cookie | effectively gone | cross-site journeys are not reconstructable from cookies |
| Device ID | stable **if consented** — **ATT opt-in stabilised at roughly 15–25% globally** | for most iOS users this key does not exist; a spine that needs it does not work |
| `user_id` set at login | as long as the account exists | the only durable anonymous→known bridge |
| CRM Contact ID | permanent, unless merged | merges rewrite it — consume merge events |
| Email | years, but people change jobs | in B2B, an email is a person **at a company**; a job change is a new relationship, not a continuation |

**Report the backfill horizon as a number** — the observed median and p90 days
between a touch and the identification that claimed it. It is computable from
your own data, it bounds every first-touch statement you make, and it is one
line in a coverage report.
