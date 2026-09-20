# Three identities, two bridge fields, and email performance within the quota

## Prospect, Visitor, Lead/Contact — count people once

| Identity | Where it lives | Becomes |
|---|---|---|
| **Visitor** | MCAE | a **Prospect** on conversion |
| **Prospect** | MCAE | may or may not sync to Salesforce |
| **Lead / Contact** | Salesforce | the CRM record |

**Counting "people" across these double-counts.** A single human can be a Visitor, then a
Prospect, then a Salesforce Lead, then a Contact — four records, one person.

**Pardot prospect IDs are not Salesforce IDs.** The bridge fields are:

- **`crmLeadFid`**
- **`crmContactFid`**

**Both can be null or stale mid-sync.** A null bridge field means "not synced yet, or not
synced at all" — it does not mean the person is absent from Salesforce, and it does not
mean they are present either.

**The operational rule:** decide which identity the question is about, count that one, and
say which you counted. "4,200 prospects" and "4,200 people" are different claims, and only
the first is defensible.

## Email performance inside the daily quota

**`GET /api/v5/objects/list-emails/{id}/stats` is per-list-email and aggregate only. There
is no "all emails grouped by month" call.**

The KPI family it returns is genuinely good and maps to the UI:

`sent`, `delivered`, `deliveryRate`, `hardBounced`, `softBounced`, `opens`, `uniqueOpens`,
`opensRate`, `totalClicks`, `uniqueClicks`, `clickThroughRate`, `uniqueClickThroughRate`,
`clickOpenRatio`, `optOuts`, `optOutRate`, `spamComplaints`, `spamComplaintRate`.

**The cost shape:** "email performance by month" means enumerating list emails, then **one
`/stats` call per email.** That burns the daily quota **linearly in the number of emails
sent.**

| Edition | Daily requests | Emails/day you can stat while leaving room |
|---|---|---|
| Growth | 25,000 | a heavy sender cannot do this daily without planning |
| Plus | 50,000 | comfortable for most |
| Advanced / Premium | 100,000 | comfortable |

**Planning moves that work:**

1. **Enumerate list emails once** with a bounded date filter, and cache the ID list.
2. **Stat only the emails in the reporting window**, not the whole history.
3. **Cache stats for closed periods indefinitely** — a send from three months ago is not
   going to change materially.
4. **Respect concurrency 5.** Going wider returns error 66, not speed.

## `opens` is not a reliable metric, and the response shows why

**`opens` can legitimately read 0 while `totalClicks` is large.**

Apple Mail Privacy Protection and similar proxies have made open tracking unreliable
industry-wide — in both directions: pre-fetching inflates opens on some populations, and
blocked pixels suppress them on others.

Two rules:

- **Never derive an engagement rate that divides by opens without saying what it
  measures.** `clickOpenRatio` in particular is a ratio of two unreliable numbers on the
  denominator side.
- **Rank by `uniqueClicks` and `clickThroughRate`**, and say why you chose them. A ranking
  by `opensRate` is a ranking by mail-client behaviour.

When a stakeholder asks specifically for open rates, give them — then give the click-based
ordering alongside and say which one to act on.

## Scores and grades have no history

**Scoring and grading are point-in-time with no exposed history. You cannot reconstruct
"what was this prospect's score in March".**

This is an absence of data, not a query problem — there is nothing to retrieve.

**If score trends matter, snapshot on a schedule**, starting now. Every day that passes
without snapshotting is a day of trend data that can never be recovered.

Say this explicitly when someone asks for score progression: the answer is "not available
historically, and here is how we start capturing it today", not "let me look".

## The BU header, which changes which people you counted

**`Pardot-Business-Unit-Id` is required on every call, and the failure mode for a wrong
value is data, not an error. The wrong BU in a multi-BU org returns a valid 200 with a
completely different prospect set.**

On a multi-BU customer, verify the BU by checking a known record before trusting any count.
An entirely plausible prospect total from the wrong business unit is the kind of error that
survives review.
