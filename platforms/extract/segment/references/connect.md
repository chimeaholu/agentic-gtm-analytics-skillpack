# Connecting Segment — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Segment's settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need to be a **Workspace Owner** in Segment, or hold a role that
includes access to the workspace's access-management settings. Users with narrower roles
cannot see the tokens page.

**If you need to ask, ask for exactly this:**

> "Please create a Segment workspace access token for an automated reporting integration, with
> a read-only role scoped to the sources and destinations it needs rather than the whole
> workspace, and send it to me through our password manager. Also tell me whether the
> workspace is on the United States or European region."

**Plan and tier.** The Public API is available on Segment's paid plans. Team and Business
plans differ in some features and in how finely roles can be scoped, so confirm the plan
before promising fine-grained access control.

**How long it takes.** **Ten minutes.** There is no application review and nothing to wait
for.

**The one thing that makes this setup deceptive.** **A token whose role is too narrow does not
produce an error — it produces a shorter list.** Ask Segment for the sources in a workspace
with a restricted token and you get a valid, well-formed answer containing some of them.
Nothing says anything is missing. **An incomplete inventory therefore looks exactly like a
small workspace**, and an automation will happily report on it as though it were complete.
Section 3 is about avoiding that.

---

## 2. The steps

**Step 1 — Establish the region.**

Segment operates United States and European workspaces on separate addresses. Confirm which
one this workspace is in before creating anything; a token from one region does not
authenticate against the other.

If nobody is sure, the address people use to sign in tells you.

**Step 2 — Sign in and open access management.**

Sign in to Segment and open the workspace. Go to **Settings**, then **Access Management**,
then the **Tokens** tab.

**UI wording check:** Segment has reorganised this area between releases, and the tokens
section is sometimes reached through the workspace settings rather than a top-level Settings
entry. If the path does not match, search the interface for **"Tokens"** or **"Access
Management"**. The destination is a page listing existing tokens with names, roles and
creation dates.

**Step 3 — Create the token.**

Click to create a new token. Name it after the integration — "reporting automation" — so that
whoever reviews tokens later can tell what it belongs to.

**Step 4 — Assign the role. Read section 3 before choosing.**

You will be asked to assign one or more roles, and optionally to limit the token to particular
resources.

**Step 5 — Copy the token.**

Segment shows the token **once**. It is a long string of letters, digits and punctuation. Once
you leave the page it cannot be retrieved — the only remedy is to delete it and make another.

Copy it into your password manager, then into your automation's settings:

```
SEGMENT_TOKEN=<the token>
```

It is sent as `Authorization: Bearer <token>`.

**Step 6 — One token per workspace.**

**The token is scoped to a single workspace.** An organisation with several workspaces —
commonly one per product or one per environment — needs **one token for each**. A token from
another workspace returns that workspace's sources, with nothing in the response to flag the
mix-up.

---

## 3. What to choose, and why

**Roles, from most to least appropriate for a reporting automation:**

| Role | What it can do | Choose it when |
|---|---|---|
| **Read-only**, scoped to specific resources | See configuration for named sources, destinations and spaces | The automation only needs to inspect part of the workspace. The safest option **if you are certain of the scope**. |
| **Read-only**, workspace-wide | See all configuration in the workspace | **The right default for an inventory or diagnosis job**, where "what exists" is the question being asked. |
| **Workspace Owner** | Everything, including changing and deleting pipeline configuration | **Do not choose this for an automation.** It can alter or remove live data pipelines. |

**The choice between the first two is not about safety alone — it is about whether the answer
will be correct.**

**If the automation's job is to inventory or diagnose the workspace, a resource-scoped
read-only token will give a wrong answer with no warning.** It will report the sources it can
see and say nothing about those it cannot, and there is no field in the response that
distinguishes "these are all of them" from "these are the ones you may see".

**So decide which situation you are in, and record it:**

- **Answering "what is in this workspace?"** → the token needs **workspace-wide read**.
  Anything less is silently incomplete.
- **Monitoring or reading a specific named pipeline** → a **scoped** token is correct, and
  better.

**Write down which one was used** alongside any inventory the automation produces. "17
sources" from a scoped token and "34 sources" from a workspace-wide one are both accurate
answers to different questions, and neither response says which question it answered.

**Grant no write role.** Segment configuration changes affect live data collection — a
destination disabled by mistake stops data reaching a downstream system, and nothing about the
resulting gap is easy to notice or to backfill.

---

## 4. How to check it worked

```bash
curl -s -H "Authorization: Bearer $SEGMENT_TOKEN" \
  "https://api.segmentapis.com/sources" | head -c 400
```

Use the European address if the workspace is in that region.

**Success looks like** JSON containing a `data` block with a `sources` list, each entry having
an `id`, a `name` and a `slug`.

**Now do the check that actually matters: compare the number of sources to what the customer
says exists.** If the list looks smaller than they describe, **check the token's role before
concluding anything about the workspace.** This is the characteristic Segment failure and it
does not raise an error.

---

## 5. If it does not work

**A 401, or a message about an invalid token.** The token is wrong, was deleted, or belongs to
the other region. Check the region first.

**A 403 on a specific request while others succeed.** The role does not cover that resource
type. Note which call was refused and widen the role, rather than creating a new token.

**A shorter list than expected, with a 200 success.** The role, from section 3. **This is not
an error and it will never present as one.** It is the most important failure on this platform
because an automation reports it as fact.

**A token that worked and suddenly does not.** Tokens can be revoked by a workspace owner
during an access review. Check the tokens page — a revoked token fails identically to a
mistyped one.

**Results describing a workspace you do not recognise.** Wrong workspace token, from step 6.

---

## 6. Keeping the credential safe

**A Segment workspace token exposes your data pipeline's configuration** — which systems send
data, where it goes, and how it is transformed. That is a useful map for anybody planning an
attack on your data estate, even though it is not customer data itself.

- **Store it in a password manager or secrets store**, read from an environment variable at
  run time.
- **Never paste it into a chat window, a ticket or a shared document.** It is shown once by
  design, which is exactly when people paste it somewhere convenient.
- **Never commit it to a repository.**
- **Rotating it:** create a second token with the same role, move the automation onto it,
  confirm the check in section 4 passes, then revoke the old one from the tokens page.
- **If it leaks:** revoke the token from **Settings → Access Management → Tokens**
  immediately. Revocation takes effect at once. Then create a replacement, and have a
  workspace owner review the workspace's audit trail for configuration changes nobody
  recognises — **particularly if the leaked token held anything beyond read-only**, since a
  write-capable token could have altered or disabled live data collection.
