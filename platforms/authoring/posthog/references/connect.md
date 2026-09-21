# Connecting PostHog — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

This is the fastest connection in the pack. Most people finish in two to five minutes.
There is no application to submit, nobody has to approve anything, and there is no waiting.
If the person has been dreading connecting their stack, start here — it is the one that
gives them a working result in the same sitting.

---

## 1. What you will need before starting

**Time: two to five minutes.** Nothing in this process is reviewed by a human, so the
only thing that can slow it down is finding the right page.

**Permission level:** you need to be able to sign in to PostHog as a member of the
organisation, with access to the project you want to read. You do **not** need to be an
organisation owner or an administrator for read-only access. A personal API key — a
password-like string that lets a program sign in as you — can only ever reach data you can
already see in PostHog yourself, so an ordinary member seat is enough.

**If you cannot sign in at all,** ask whoever runs PostHog at your company for:

> "Please add me to the PostHog organisation as a Member, with access to the
> `<name of the project>` project. I need to create a personal API key with read scopes so
> our analytics assistant can query the data."

**Plan or tier:** none. Personal API keys are available on every PostHog plan, including
the free one.

**One thing to have ready:** which PostHog you use. PostHog runs in more than one place
and they do not talk to each other. You will confirm this in step 1 below — do not guess.

**A cost note, so there are no surprises:** reading your own data through the API does not
cost extra on top of your existing PostHog plan. If you later connect PostHog's MCP server
and use its AI features, those can consume PostHog AI credits, which is a separate,
metered thing. This walkthrough does not turn any of that on.

---

## 2. The steps

### Step 1 — Find out which PostHog you are on

Open PostHog the way you normally do and look at the web address in your browser's address
bar, the part before the first single slash.

- If it reads **`us.posthog.com`** or **`app.posthog.com`**, you are on PostHog Cloud US.
- If it reads **`eu.posthog.com`**, you are on PostHog Cloud EU.
- If it reads anything else — a web address at your own company's domain — PostHog is
  self-hosted, meaning your company runs its own copy on its own servers.

**Read that address out and tell it to the agent now.** This matters more than it looks.
US and EU are completely separate systems holding completely separate data. A key made in
one will not work against the other, and it does not forward you to the right place — it
returns an error, or worse, an empty answer that looks like "you have no data".

*Confirm the address before moving on.*

### Step 2 — Open the personal API keys page

In PostHog, click your **account avatar or your name**, usually in the top-right corner,
and open **Settings**. In the settings screen look for the section named **Personal API
keys**.

If you cannot find it by clicking, use the settings page's own search box and type
`personal api`. PostHog moves things between releases and the fastest route is the search
box, not a memorised click path.

**What you should be seeing:** a page headed *Personal API keys* with a list of existing
keys, which is often empty, and a button to create a new one.

*Confirm you can see that page.*

### Step 3 — Start creating the key

Click the button to create a new personal API key. Its label is usually
**"+ Create personal API key"**.

A panel opens asking for a label, an organisation and project scope, and a list of
permissions.

*Confirm the panel is open.*

### Step 4 — Name the key so a future colleague understands it

In the label field, type something that says what it is for and who owns it. For example:

```
gtm-analytics-agent read-only
```

**Do not call it "test" or "temp".** In six months somebody will find this key in the list
and have to decide whether it is safe to delete. The label is the only clue they will get.

*Confirm the label is entered.*

### Step 5 — Restrict the key to one organisation and one project

In the same panel there are controls for which organisation and which project the key may
reach. Set both to the specific organisation and the specific project you want analysed,
rather than leaving it open to everything.

Why this matters: if the key ever leaks, the damage is bounded to one project instead of
your whole PostHog account. This takes ten seconds now and cannot be retrofitted later —
you would have to make a new key.

*Confirm both are set.*

### Step 6 — Choose the permissions

PostHog calls these **scopes**: individual on/off switches saying what the key may do.
Section 3 below lists exactly which ones to switch on and why. **Read section 3 to the
person now, then come back here.**

*Confirm the scopes are ticked.*

### Step 7 — Create the key and copy it immediately

Click the confirm button to create the key.

**PostHog shows you the key exactly once.** The screen will display a long string starting
with `phx_`, something shaped like:

```
phx_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

Copy it now, before you close or navigate away from that panel. If you lose it, nothing is
broken — you delete the key and make another — but you cannot recover this one.

**Do not paste it into this chat, an email, a ticket or a document.** Section 6 says where
it goes instead.

*Confirm the key is copied and starts with `phx_`.*

### Step 8 — Know which key you are holding

PostHog has three different strings that all look like keys, and picking the wrong one is
the most common first failure.

| Starts with | What it is | Works for querying? |
|---|---|---|
| `phx_` | personal API key — the one you created | **Yes. This is the one.** |
| `phs_` | project secret key, for server-to-server use | not the path this pack uses |
| `phc_` | project token, used by your website to *send* events in | **No.** It cannot read anything |

`phc_` is the one that appears in your website's tracking snippet, so it is the one people
have seen before and reach for first. It only sends data in. It will never answer a query.

*Confirm the key begins with `phx_`.*

### Step 9 — Find the numeric project ID

Every PostHog analytics web address contains a project number. Open **Settings → Project**
and look for the project ID, which is a plain number such as `12345`.

If you cannot find it on that page, look at the web address while you are browsing the
project — the number appears in the path. You need this number as well as the key.

*Confirm you have a number.*

### Step 10 — Store the three values

You now have three things. Put them where section 6 says — in environment variables or a
secrets manager, not in a chat window:

| Name | Value | Example shape |
|---|---|---|
| `POSTHOG_HOST` | the address from step 1, with `https://` in front | `https://us.posthog.com` |
| `POSTHOG_API_KEY` | the key from step 7 | `phx_…` |
| `POSTHOG_PROJECT_ID` | the number from step 9 | `12345` |

*Confirm all three are stored. Then go to section 4 and run the test.*

---

## 3. What to choose, with reasons

PostHog asks you to tick individual permissions rather than handing over everything. This
is genuinely useful and worth thirty seconds of attention — an unscoped key that leaks
gives an attacker your whole account, while this one gives them read access to one project.

**For reading and analysis, which covers almost everything people want:**

| Scope | Tick it | Why it is needed |
|---|---|---|
| `query:read` | **Yes** | This is the one that actually runs queries. Without it, every call returns a permission error. |
| `insight:read` | **Yes** | Lets the agent read the charts and saved insights you already built, so it uses your definitions instead of inventing new ones. |
| `dashboard:read` | **Yes** | Lets the agent see how your dashboards are assembled, which is how it avoids contradicting a number your team already looks at. |

**Only if you want the agent to build things in PostHog for you:**

| Scope | Tick it | Why, and the risk |
|---|---|---|
| `insight:write` | only on request | Lets the agent create saved charts in your PostHog. Real objects that your colleagues will see. |
| `dashboard:write` | only on request | Lets the agent create and modify dashboards. **A modification can change a dashboard your team relies on.** |

**Leave the write scopes off unless you have actually asked for an authored dashboard.**
They are easy to add later by creating a second key. A read-only key cannot damage
anything, which makes the first connection a low-stakes one.

**Do not tick "all access" or the equivalent select-all control.** It is faster by about
four seconds and it removes the entire benefit of scoping.

---

## 4. How to verify it worked

Run this once. Replace nothing — it reads the three values you stored in step 10.

```bash
curl -s -H "Authorization: Bearer $POSTHOG_API_KEY" \
  -H 'Content-Type: application/json' \
  "$POSTHOG_HOST/api/projects/$POSTHOG_PROJECT_ID/query/" \
  -d '{"query":{"kind":"HogQLQuery","query":"SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY"}}'
```

**Success looks like** a block of JSON containing a `results` list with a single number in
it — the count of events recorded in the last day:

```json
{"results": [[41273]], "columns": ["count()"], ...}
```

Any number at all, including a small one, means the connection works.

**A zero with a successful response is not a failure.** It means the credentials are
correct and that project genuinely had no events in the last day. That is a real finding
about the project, not a problem with the setup, and it should be reported that way —
usually it means events go to a different project than the person expected.

**Failure looks like** a JSON block containing `"detail"` and a message about
authentication or permission, with no `results` list. Section 5 translates those.

---

## 5. If it does not work

**"Incorrect authentication credentials" or a 401 error**

The key is wrong, or the key is right but you are pointing it at the wrong PostHog. Check
the host first — a US key against `eu.posthog.com` produces exactly this. Then check you
copied the whole key including the `phx_` prefix and no trailing space.

**"You do not have permission" or a 403 error**

The key is valid but you did not tick the scope the call needs. For the test call above,
that is `query:read`. Scopes cannot be edited after creation on a personal API key — delete
the key and create a new one with the right boxes ticked. This takes another two minutes,
which is why section 3 exists.

**"Not found" or a 404 error**

The project ID is wrong, or it belongs to a project this key was not scoped to in step 5.
Run `curl -s -H "Authorization: Bearer $POSTHOG_API_KEY" "$POSTHOG_HOST/api/projects/"`
to list the projects this key can actually reach, and take the ID from there.

**A response about the token being invalid, when you are sure you copied it correctly**

Check the first four characters. If it starts `phc_`, you copied the project token out of
your website's tracking code instead of creating a personal API key. That token sends data
in and cannot read anything back. Go back to step 2.

**Everything returns empty, no errors anywhere**

Almost always the wrong project, or the wrong region holding a different copy of the data.
Confirm in the PostHog web interface that you can see events in the project whose number
you used.

---

## 6. Security notes

**Where the key goes.** Into an environment variable or a secrets manager — the place your
organisation already keeps passwords for software. Not a spreadsheet, not a shared
document, not a pinned chat message.

**Never paste it into a chat window, including this one.** If you have already pasted it
somewhere visible, treat it as leaked and follow the revoke steps below. That is not an
overreaction; chat histories get exported, indexed and shared.

**Never commit it to a code repository.** If it reaches a repository that is public even
briefly, automated scanners find it within minutes. Deleting the commit afterwards does not
help, because the key is already in the repository's history and in whatever copied it.

**Rotating it** — replacing a key on a schedule so an old copy stops being useful:

1. Create a second key with the same label plus a date, and the same scopes.
2. Update the stored value everywhere that uses it.
3. Confirm the test call in section 4 still passes.
4. Delete the old key from the personal API keys page.

Doing it in that order means there is never a gap where things are broken. Every three to
six months is a reasonable cadence for a read-only key.

**If it leaks,** go to **Settings → Personal API keys**, find the key by its label and
delete it. Deletion takes effect immediately and every call using that key starts failing
at once. Then create a replacement. Because the key was scoped to one project with read
permissions in step 5, the blast radius of a leak is one project's analytics data — which
is exactly why that step was worth doing.

**The key is tied to you personally.** If you leave the company or your PostHog account is
deactivated, the key stops working and any scheduled analysis silently breaks. For anything
running on a schedule, note down who owns the key so the next person knows where to look.
