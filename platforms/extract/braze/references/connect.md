# Connecting Braze — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Braze's settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need an account on the Braze workspace with permission to manage
API keys — normally an **Admin**, or a user whose role includes the "Manage API keys"
permission. Marketing users typically cannot see the API keys page at all.

**If you need to ask, ask for exactly this:**

> "Please create a Braze REST API key for an automated reporting integration, with permissions
> ticked only for the endpoints I list below, and send it to me through our password manager.
> Please also tell me which cluster or instance the workspace is on — the `iad-`, `fra-` or
> `au-` prefix — because I cannot work it out from the key."

Then list the endpoints. Section 3 explains how to arrive at that list, and doing it before
the key is created saves a second round trip.

**Plan and tier.** REST API access is part of Braze. What varies is which channels and
features the workspace has, and therefore which statistics exist.

**How long it takes.** **Fifteen minutes**, if you have already worked out which endpoints
you need. If you have not, the key gets created three times.

**The two things that make this setup harder than it looks.**

1. **Braze keys carry per-endpoint permissions**, so a key can work perfectly for nine
   requests and be refused on the tenth. **That refusal looks like a broken endpoint, not a
   scoping problem**, and it is the reason section 3 asks you to enumerate first.
2. **You must know which cluster the workspace is on**, and **you cannot discover it from the
   key**. Getting it wrong produces an authentication error, not a routing error, so it
   presents as a bad credential.

---

## 2. The steps

**Step 1 — Work out the cluster, and therefore the address.**

Braze runs a number of separate instances. Each has its own dashboard address and its own API
address, and **a key only works against its own instance**.

The instance identifiers look like `iad-01` through `iad-10` (United States), `fra-01`
(Europe), `au-01` (Australia), and others. The API address is built from that identifier, in
the pattern `https://rest.<instance>.braze.com` — for example `https://rest.iad-03.braze.com`.

**How to find it, in order of reliability:**

- **Ask whoever administers Braze.** They know.
- **Look at the dashboard web address** while somebody is signed in. The instance appears in
  it.
- **Braze publishes the mapping between dashboard address and REST address** in its
  documentation. Use that table rather than assuming the pattern holds for your instance.

**Do not guess.** A wrong instance gives an authentication failure with no indication that
routing is the problem, and people re-issue keys for an hour trying to fix it.

```
BRAZE_REST_URL=https://rest.<your instance>.braze.com
```

**Step 2 — Sign in and open the API keys page.**

Sign in to the Braze dashboard. Open **Settings**, then **API Keys**.

**UI wording check:** older Braze documentation refers to **Developer Console → API
Settings**. Both lead to the same place, and which you see depends on the version. If neither
matches, search the interface for **"API"**.

**Step 3 — Create the key.**

Click to create a new API key. Name it after the integration — "reporting automation" — so
that the person auditing keys later can tell what it is for.

**Step 4 — Tick the endpoint permissions. Read section 3 first.**

You are shown a long list of individual endpoints, each with a tick box. **This is the part
that decides whether the setup works.** Ticking too few produces a refusal weeks later on one
specific call; ticking everything hands a reporting automation the ability to send messages to
your customers.

**Step 5 — Consider restricting the key by network address.**

Braze allows each key to be limited to specific network addresses. If your automation runs
from a known, fixed address, this is worth doing — a key that only works from your own
infrastructure is far less valuable if it leaks.

**Do note one interaction:** if your organisation uses dashboard-level address restrictions,
Braze's own hosted connector becomes unusable. That is a trade-off to make deliberately rather
than discover.

**Step 6 — Copy the key.**

The key is a long string in the shape of a universally unique identifier — groups of letters
and digits separated by dashes. Copy it into your password manager, then into your
automation's settings:

```
BRAZE_API_KEY=<the key>
BRAZE_REST_URL=https://rest.<your instance>.braze.com
```

It is sent as `Authorization: Bearer <key>`.

**Step 7 — One key per workspace.**

**Braze keys belong to a single workspace** — what Braze also calls an app group. An
organisation running several workspaces needs one key for each.

**And note something that affects your numbers, not only your access:** different workspaces
can have **different timezone settings**. Adding statistics across workspaces without
accounting for that produces a total whose days do not line up. Record each workspace's
timezone alongside its figures.

---

## 3. What to choose, and why

**Work backwards from the questions you need to answer.** Braze's permission list is
per-endpoint, so the correct approach is to write down the endpoints first and tick exactly
those.

A typical read-only reporting key needs the campaign, Canvas, segment and KPI export
endpoints — the ones under `/campaigns/...`, `/canvas/...`, `/segments/...` and `/kpi/...`
that list objects and return their statistics. Look through the list for the read and export
entries in those families and tick them.

| Family | Why you need it |
|---|---|
| Campaign list and details | Resolve a campaign name to its identifier, and read its configuration. |
| Campaign analytics or data series | The actual sends, opens, clicks and conversions over time. |
| Canvas list, details and analytics | The same for multi-step journeys, which are a separate object type with separate endpoints. |
| Segment list and details | Understand who a message went to. |
| KPI endpoints | Account-level daily figures such as active users. |

**Do not tick any messaging, user-track, user-delete or schedule endpoint on a reporting
key.** Those endpoints **send messages to real people** and **change or delete customer
records**. A reporting automation has no reason to hold them, and an automation that holds
them can, through a mistake, message your entire customer base. This is the clearest example
in this pack of a wrong tick causing real-world damage.

**The failure mode you are designing against.** A missing tick produces a permission error on
**one** endpoint while everything else keeps working. Somebody then reports "the Canvas
numbers are broken" and an hour goes into investigating Canvas. **If exactly one endpoint
fails and the rest work, look at the key's permissions first.**

---

## 4. How to check it worked

```bash
curl -s -H "Authorization: Bearer $BRAZE_API_KEY" \
  "$BRAZE_REST_URL/campaigns/list?page=0"
```

**Success looks like** JSON containing a `campaigns` list — each entry with an `id` and a
`name` you recognise — and a `message` field reading `success`.

**Failure looks like** a JSON body with a `message` describing the problem. Braze's messages
are more specific than most, so read the message before theorising.

---

## 5. If it does not work

**"Invalid API key" — and you are confident the key is right.** The cluster, from step 1. A
key from one instance sent to another is rejected as invalid, with nothing to suggest the
address is the issue. Confirm the instance before re-issuing anything.

**One endpoint refuses while the rest work.** A missing permission tick on that specific
endpoint, from section 3. Go back to the API keys page, open the key, and add the endpoint.
**Do not create a new key** — a new one will have the same gaps unless you tick differently.

**"Invalid API key" from a machine that previously worked.** Address restrictions, from step
5. If the automation moved, or runs from a changing address, the restriction now blocks it.

**A campaign or Canvas identifier that returns nothing.** Identifiers are per workspace. An
identifier from one workspace queried with another workspace's key returns an empty or
not-found result rather than an error.

**Numbers that do not add up across workspaces.** Timezone differences between workspaces,
from step 7. This is not a connection problem, but it presents during the first real analysis
and is worth eliminating early.

---

## 6. Keeping the credential safe

**A Braze REST key reaches customer messaging data**, and depending on its permissions may be
able to **send messages to real people**. That second possibility is why permission discipline
in section 3 matters as much as storage discipline here.

- **Store it in a password manager or secrets store**, read from an environment variable at
  run time.
- **Never paste it into a chat window, a ticket or a shared document.**
- **Never commit it to a repository.**
- **Use the address restriction from step 5 where you can.** It is the only mechanism Braze
  offers that limits the damage of a key that has already escaped.
- **Rotating it:** create a second key with the same permissions, move the automation onto it,
  confirm the check in section 4 passes, then delete the old key from the API keys page. Braze
  supports multiple keys at once, so no outage is needed.
- **If it leaks:** delete the key from the API keys page **immediately**. Deletion takes effect
  at once. Then check the workspace's activity — **if the key held any messaging permission,
  treat the leak as urgent and involve whoever owns security at your company**, because the
  worst outcome is not data exposure but unauthorised messages sent to your customers, which
  cannot be recalled.
