# Connecting RudderStack — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
RudderStack's settings. Do not skip ahead and do not batch the steps.

---

## STOP — read this before anything else

**RudderStack carries the highest-risk write capability in this entire pack, higher than
anything that spends advertising money.**

**Transformations are pieces of code that run on every single event passing through your data
pipeline.** Deploying one changes what is recorded from that moment on, and because downstream
systems recompute from the stream, **it can change what your historical reports say too.**

**Nothing errors. Every dashboard stays green. Every number is now different, and internally
consistent, which is exactly why nobody disputes it.** A company can run for months on
silently altered figures.

**Therefore:**

- **No automation deploys a transformation without a named human approving it, every time.**
- **That approval requires the actual code difference, line by line — not a summary of it.**
  "Updates the event enrichment logic" is a description of an approval that did not happen.
- **It is never batched with anything else and never automatic.**
- **This routes through `core/write-gate`, which classifies it at the highest tier.** Read
  that contract and this module's `references/transformation-risk.md` before any write work.

**If the only reason you are connecting RudderStack is to read data, create a token that
cannot deploy transformations.** Section 3 explains how. That single choice removes the entire
risk described above.

---

## 1. What you will need before starting

**Who has to do this.** You need an account on the RudderStack workspace with permission to
create access tokens — typically an **Admin** on the workspace.

**If you need to ask, ask for exactly this:**

> "Please create a RudderStack personal access token for an automated **read-only** reporting
> integration — it must not be able to create or deploy transformations — and send it to me
> through our password manager. Also send me the workspace's data plane URL, confirm whether
> this is RudderStack Cloud or a self-hosted deployment, and tell me which region the
> workspace is in."

**Plan and tier.** RudderStack Cloud and self-hosted open-source deployments differ
substantially in what the API offers. Establish which you are dealing with before planning
anything.

**How long it takes.** **Ten to fifteen minutes**, assuming the person creating the token can
also tell you the addresses.

---

## 2. The steps

**Step 1 — Establish whether this is RudderStack Cloud or a self-hosted deployment.**

**Ask, and do not assume.** A self-hosted or open-source deployment has entirely different
addresses and a reduced set of API features. **A plan built against Cloud endpoints does not
degrade gracefully on self-hosted — the equivalent does not exist at all.**

**Record the answer**, because every subsequent claim about what is available depends on it.

**Step 2 — Get both addresses, and understand that there are two.**

This is the most common RudderStack setup error and it is worth slowing down for.

| Address | What it is for | Where it comes from |
|---|---|---|
| **Control plane** | Configuration — listing sources, destinations, connections. **This is what a reporting or inventory automation talks to.** | RudderStack's API host |
| **Data plane** | Receiving events sent into the pipeline from your applications | **Specific to your workspace.** You cannot guess it. |

**Using one where the other belongs is the usual mistake, and the failure is confusing rather
than explicit** — it does not say "wrong host", it fails in a way that reads like a
credential problem.

The data plane URL is shown in the RudderStack dashboard, in the connection instructions for a
source. Ask for it rather than deriving it.

```
RUDDERSTACK_DATA_PLANE_URL=<the workspace's data plane URL>
```

**Step 3 — Sign in and open the token area.**

Sign in to the RudderStack dashboard. Personal access tokens are created from the account or
settings area.

**UI wording check:** the exact location has moved between releases. Look for **"Personal
access token"**, **"Access tokens"**, or **"Settings"** with a tokens section. If it is not
obvious, use the dashboard's search. The destination is a page where a token can be created
and existing ones listed.

**Step 4 — Create the token with the narrowest role available. Read section 3 first.**

**Step 5 — Copy the token.**

RudderStack shows it once. Copy it into your password manager, then into your automation's
settings:

```
RUDDERSTACK_ACCESS_TOKEN=<the token>
```

Different RudderStack APIs expect it slightly differently — some as a bearer token, some as
the username half of an ordinary username-and-password pair with an empty password. Check the
documentation for the specific API you are calling rather than assuming.

---

## 3. What to choose, and why

**There is one decision here that matters more than everything else in this document:
whether the token can deploy transformations.**

| Capability | For a reporting automation | Why |
|---|---|---|
| **Read** sources, destinations, connections | **Yes** | This is the whole job of an inventory or diagnosis automation. |
| **Read** transformations | Acceptable | Reading the code that runs on your events is useful context and changes nothing. |
| **Create or deploy transformations** | **No. Absolutely not.** | See the warning at the top of this document. |
| **Modify sources, destinations or connections** | **No** | A disabled destination stops data reaching a downstream system, and the resulting gap is very hard to notice and often impossible to backfill. |
| Workspace administration | **No** | An automation has no reason to manage people. |

**If RudderStack's role options do not let you exclude transformation deployment**, then the
token you hold **can** do it, and the safeguard has to be procedural instead: the write gate,
human approval with a full code difference, and an explicit rule that the automation never
issues a deployment call. **Say this out loud to whoever owns the pipeline** rather than
assuming the technical control exists.

**Record which deployment, which region and which hosts produced any answer.** On this
platform more than most, "RudderStack says X" is not reproducible without that context.

---

## 4. How to check it worked

Ask the control plane for the list of sources:

```bash
curl -s -H "Authorization: Bearer $RUDDERSTACK_ACCESS_TOKEN" \
  "https://api.rudderstack.com/v2/sources" | head -c 400
```

**Success looks like** JSON containing a list of sources, each with an `id`, a `name` and a
type.

**Failure to read carefully:** if this returns an authentication error, check **which host you
sent it to** before doubting the token — the control plane and data plane confusion from step
2 is the most likely cause, and it presents as a credential problem.

**Deliberately, this test only reads.** Do not test the connection by deploying anything.

---

## 5. If it does not work

**A 401 or 403 on a token you believe is correct.** Check the host first — control plane
versus data plane, from step 2. Then check the region. Then check the token.

**An endpoint that does not exist at all.** Almost certainly a self-hosted deployment, from
step 1, where the Cloud API surface is not present. This is not something to work around with
a different token; the capability is absent.

**The token works for some calls and not others.** The role is narrower than the calls you are
making. **If the refused call is a write, that is the design working — do not widen the role
to make it pass.** Stop and route the request through the write gate.

**Configuration that looks incomplete.** As with other workspace-scoped tokens, a narrow role
can return a partial list without indicating anything is missing. Compare against what the
customer describes before treating the list as an inventory.

---

## 6. Keeping the credential safe

**A RudderStack token exposes your data pipeline's configuration, and — depending on its role
— may be able to deploy code that runs on every event your company collects.** That second
possibility is what makes this credential unusually dangerous.

- **Store it in a secrets manager**, read from an environment variable at run time.
- **Never paste it into a chat window, a ticket or a shared document.**
- **Never commit it to a repository.**
- **Keep read-only and write-capable tokens separate**, and give the reporting automation only
  the read-only one. If a write is ever authorised, it should be performed with a separate
  credential, by a separate deliberate act, with the approval recorded.
- **Rotating it:** create a second token with the same role, move the automation onto it,
  confirm the check in section 4 passes, then revoke the old one.
- **If it leaks:** revoke it **immediately**, before anything else. Then — and this is the step
  specific to RudderStack — **have somebody review the transformation history and the
  connection configuration for changes nobody recognises.** A leaked token that was used to
  deploy a transformation leaves no error, no alert and no visibly broken dashboard; the only
  way to find it is to look at what changed and when. Treat that review as mandatory, not as a
  precaution.
