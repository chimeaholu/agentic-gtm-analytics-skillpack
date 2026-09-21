# Connecting Iterable — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Iterable's settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need an Iterable account with permission to manage API keys —
normally an **Organisation Admin** or a user whose role grants access to the project's
settings. Ordinary marketing users do not see the API keys page.

**If you need to ask, ask for exactly this:**

> "Please create a **server-side** Iterable API key for an automated reporting integration on
> the [name] project, with read permissions only — no write, no user-data or PII access unless
> I come back and ask — and send it to me through our password manager. Also confirm whether
> the account is on the United States or European data centre."

**Plan and tier.** API access is part of Iterable. What differs by account is which channels
exist and therefore which statistics there are to read.

**How long it takes.** **Ten to fifteen minutes.** This is the easiest of the messaging
platforms to connect.

**Two things that make it less easy than it appears.**

1. **Permissions here are opt-in, individually, and the sensitive ones are separate.** Access
   to personal information about your users, and the ability to write, are not bundled into a
   general key — they are specific things somebody must deliberately switch on. **That is good
   design, and it means a key created carelessly will fail later on exactly the call you
   needed.**
2. **A key from the wrong data centre authenticates against nothing.** United States and
   European accounts are separate systems and keys do not cross between them.

---

## 2. The steps

**Step 1 — Establish which data centre the account is on.**

| Region | Address for requests |
|---|---|
| United States (default) | `https://api.iterable.com` |
| European Union | `https://api.eu.iterable.com` |

**Keys are not portable between them.** A United States key sent to the European address is
nothing more than an unknown key. Ask which region before creating anything; the address people sign in
at is the clue if nobody is sure.

```
ITERABLE_API_BASE=https://api.iterable.com
```

**Step 2 — Sign in and open the API keys page.**

Sign in to Iterable. Open the settings area and find **API Keys**.

**UI wording check:** Iterable's navigation places this under the project or organisation
settings, and the exact path has changed between releases. If it is not obvious, search the
interface for **"API Keys"**. The destination is a page listing existing keys with their
names, types and creation dates.

**Step 3 — Create a key, and choose the right type.**

You are asked what kind of key to create. **The distinction matters and getting it wrong
wastes an afternoon:**

| Key type | What it is for | Right for reporting? |
|---|---|---|
| **Server-side** | Back-end systems calling Iterable's full API | **Yes. This is the one.** |
| **Mobile** | Embedded in a phone application, deliberately very limited | **No.** It cannot do this work at all. |
| **JWT-enabled** | Keys used with signed tokens for end-user-scoped access | No, not for a reporting automation. |
| **Web / client-side** | Browser use, deliberately limited | No. |

Choose **server-side**. Name it after the integration so it is identifiable later.

**Step 4 — Set the permissions. Read section 3 before ticking anything.**

Iterable lets you grant specific capabilities to the key. This is where you decide whether the
automation can read personal data and whether it can change anything.

**Step 5 — Copy the key.**

The key is a long string of letters and digits. Copy it into your password manager, then into
your automation's settings:

```
ITERABLE_API_KEY=<the key>
```

**Step 6 — Send it in the header, not the web address.**

The key goes in an HTTP header named `Api-Key`:

```
Api-Key: <the key>
```

**This is not merely a style preference.** Iterable also accepts the key in the web address or
the request body, and **since 10 November 2025 requests that do so are subject to stricter
rate limiting.** They do not fail — **they get slower and less predictable**, which is
considerably harder to diagnose than an outright refusal.

**If you are inheriting existing code, search it for `?api_key=` now.** Anything doing that is
quietly degraded and should be moved to the header.

**Step 7 — Keys are per project.**

An organisation with several Iterable projects needs **one key per project**. A key from
another project authenticates and returns that other project's campaigns, with nothing in the
response identifying the mix-up.

---

## 3. What to choose, and why

**The permission model is opt-in, which means the default is safe and the default may be
insufficient.** Work through the list deliberately.

| Capability | Set it to | Why |
|---|---|---|
| Campaign and template **read** | On | Resolving campaign names and identifiers, and reading configuration. |
| Metrics and analytics **read** | On | The actual reporting figures — sends, opens, clicks, conversions. |
| Export (data export jobs) | On | Bulk extraction of event data, which is how larger analyses are done. |
| List and segment **read** | On | Understanding who a message went to. |
| **User data / PII access** | **Off unless genuinely required** | This is access to **personal information about identified people** — email addresses, profile fields. If counting is enough, do not enable it. |
| **Any write capability** | **Off** | See below. |

**Why write must stay off.** A key with write access to Iterable can **change user records,
trigger campaigns and send messages to real people**. Those actions reach the outside world
and cannot be undone. A reporting automation never needs them, and the cost of a mistake is
messages in your customers' inboxes.

**Why the personal-data permission deserves a separate decision.** Turning it on is not a
technical convenience — it changes what category of data the credential can reach, which
changes who must approve holding it and where it may be stored. **Decide it explicitly, and
record the decision.** If you later find you need it, coming back for it is a five-minute
conversation; having it by default and being asked why is a longer one.

**The failure mode you are designing against:** a missing permission produces a refusal on one
specific call while the rest of the integration works. That looks like a broken feature rather
than a scoping problem.

---

## 4. How to check it worked

```bash
curl -s -H "Api-Key: $ITERABLE_API_KEY" \
  "$ITERABLE_API_BASE/api/campaigns" | head -c 300
```

**Success looks like** JSON containing a `campaigns` list, each entry with an `id`, a `name`
and a `campaignState`. You should recognise the campaign names.

**An empty list on a project the customer describes as busy is almost always the region**,
from step 1, or a key from a different project, from step 7. Check both before concluding the
project is empty.

---

## 5. If it does not work

**A 401, or a message about an invalid API key.** Three likely causes, in order: the **region**
is wrong (step 1); the key is a **mobile or client-side** key rather than server-side (step 3);
the key was mistyped. Check the region first — it costs nothing and is the most common.

**A 401 specifically saying the key is disabled.** Keys can be disabled rather than deleted in
Iterable. Check the API keys page — a disabled key fails identically to a wrong one.

**A refusal on one particular call while others succeed.** A missing permission from section 3.
Open the key's settings and enable that specific capability. **Do not create a new key.**

**Everything works but is unpredictably slow, or intermittently rate-limited.** The key is
being sent in the web address rather than the header, from step 6. Search the code for
`api_key=`.

**An empty campaign list.** Region, or wrong project. Both return a well-formed empty answer
rather than an error.

---

## 6. Keeping the credential safe

**An Iterable key reaches customer messaging data, and — if the personal-data permission is
enabled — personal information about identified people.**

- **Store it in a password manager or secrets store**, read from an environment variable at run
  time.
- **Never put it in a web address.** Beyond the rate-limiting penalty in step 6, anything in a
  URL ends up in server logs, proxy logs and browser history, none of which are treated as
  secret.
- **Never paste it into a chat window, a ticket or a shared document.**
- **Never commit it to a repository.**
- **Rotating it:** create a second server-side key with the same permissions, move the
  automation onto it, confirm the check in section 4 passes, then **disable and then delete**
  the old one. Iterable's ability to disable a key without deleting it is useful here — disable
  first, watch for anything breaking, then delete once you are sure nothing else was using it.
- **If it leaks:** **disable the key immediately** on the API keys page, which takes effect at
  once, then delete it. If the key had personal-data access, treat the leak as a potential data
  incident and tell whoever owns that process at your company. If it had any write capability,
  also review recent campaign and user activity for changes nobody recognises.
