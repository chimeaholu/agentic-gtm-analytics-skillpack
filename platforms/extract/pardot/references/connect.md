# Connecting Pardot (Marketing Cloud Account Engagement) — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Salesforce's setup area. Do not skip ahead and do not batch the steps.

**A note on the name.** Salesforce renamed Pardot to **Marketing Cloud Account Engagement**.
Both names are still in use — in menus, in documentation and in conversation. **They are the
same product**, and this walkthrough uses whichever name the screen you are on is likely to
show.

---

## 1. What you will need before starting

**This setup has two halves in two different systems, and the second half is the one that
catches people.** You create an application in **Salesforce**, and you also need a properly
linked user in **Pardot**. Having one without the other produces a working credential that is
refused, which sends people off to debug the wrong thing entirely.

**Who has to do this.**

- A **Salesforce System Administrator** creates the connected app. This is not something a
  marketing user can do.
- A **Pardot Administrator** makes sure the Salesforce user is linked to a Pardot user with a
  suitable role.
- These are frequently **two different people**, and getting both in the same conversation is
  most of the elapsed time.

**If you need to ask, ask for exactly this — it covers both halves:**

> "For an automated reporting integration against Account Engagement, I need two things.
> First, from a Salesforce admin: a connected app in the associated Salesforce org with the
> `pardot_api`, `refresh_token` and `offline_access` scopes, and the consumer key and consumer
> secret sent to me through our password manager. Second, from a Pardot admin: confirmation
> that the Salesforce user the integration will run as is **linked to a Pardot user** with a
> read-appropriate role, and the 18-character Business Unit ID. The second part is separate
> from the first and the integration will not work without it."

**Plan and tier.** Account Engagement editions differ in which API features they include, and
the older versus newer API versions differ in what they expose. Confirm the edition before
promising a capability.

**How long it takes.** **An hour of actual work**, but realistically **several days to a week
or more** in a company where Salesforce changes go through a change process. Connected apps
are a controlled item in most Salesforce organisations.

**Before you create anything, note the one decision that is permanent.** **The timezone of
whichever user creates a bulk export is frozen into that export's timestamps, for ever, and
nothing in the exported file records which timezone it was.** Step 7 covers this. It cannot be
corrected afterwards and it silently corrupts any analysis that mixes exports from different
people.

---

## 2. The steps

**Step 1 — Note that the old way is gone.**

**Pardot's own API keys were disabled in February 2021.** Authentication is through Salesforce
only. **Any tutorial, script or inherited integration using a Pardot-native API key or
`api_key`/`user_key` login is dead code**, not merely outdated. If you have inherited such a
thing, it is not going to be revived; it needs replacing.

**Step 2 — Open Salesforce Setup.**

Sign in to the Salesforce org that the Account Engagement account is associated with — **the
associated org specifically**, which on some accounts is not the org people use daily.

Click the **gear icon** in the top right and choose **Setup**.

**Step 3 — Create the connected app.**

In the Setup **Quick Find** box on the left, type **App Manager** and open it. Click **New
Connected App** at the top right.

**UI wording check, and it is version-dependent:** newer Salesforce releases push you towards
**External Client Apps** instead, and the New Connected App button may sit behind a choice
between the two. Both routes produce a credential that works. If your org shows the newer
path, follow it — the values you need at the end are the same.

Fill in the name, a contact email, and then tick **Enable OAuth Settings**.

**Step 4 — Set the OAuth details.**

- **Callback URL:** required even for a back-end integration. If the automation has no web
  address, a placeholder such as `https://login.salesforce.com/services/oauth2/success` is the
  conventional choice.
- **Selected OAuth Scopes:** move the scopes listed in section 3 into the selected list.

Save the app. **Salesforce warns that changes can take up to ten minutes to take effect. That
warning is accurate — wait before testing**, or you will debug a delay as though it were a
failure.

**Step 5 — Copy the consumer key and secret.**

Back in **App Manager**, find your app, open its dropdown and choose **View**. There is a
**Manage Consumer Details** button, which will ask you to verify your identity before
revealing the values.

- **Consumer Key** — a long string.
- **Consumer Secret** — a long string, and the sensitive half.

```
SALESFORCE_CONSUMER_KEY=<consumer key>
SALESFORCE_CONSUMER_SECRET=<consumer secret>
```

**Step 6 — Link the Salesforce user to a Pardot user. This is the step that everyone misses.**

A valid Salesforce token is **not** sufficient. The Salesforce user the integration acts as
must also **exist as a Pardot user**, with a Pardot role.

**The failure is confusing because it happens in the wrong place:** the Salesforce sign-in
succeeds, the token is genuine, and the refusal comes from the Pardot layer. So people go and
debug their OAuth setup, which is fine, while the actual problem is user provisioning in a
different administration screen.

Have the Pardot administrator confirm the link exists. They do this in the Account Engagement
settings under user management.

**Step 7 — Choose the export identity deliberately, and write it down.**

**Read this before creating any bulk export.**

Account Engagement's export feature stamps its timestamps in **the timezone of whichever user
created the export, at the moment they created it.** Salesforce documents this directly, and
adds that **if that user's timezone later changes, previously created exports keep the old
timezone.**

Three consequences, all of which produce wrong analysis rather than an error:

1. Two people exporting the same data get **differently offset timestamps**. Combining their
   files mixes time bases silently.
2. A person who relocates changes the meaning of **all their future exports**, while their old
   ones keep the old offset — so one person's export history is not internally consistent.
3. **Nothing in the exported file says which timezone it is in.** You cannot recover it from
   the data.

**What to do about it, and it is not optional:**

- **Pin one dedicated export identity** — a service user whose timezone is set deliberately.
  **UTC is the sane choice.**
- **Record that identity and its timezone alongside every export.**
- **Never mix exports created by two identities in one analysis.**
- **Tell the customer**, because a well-meaning administrator changing that user's timezone
  breaks every future export in a way no monitoring will detect.

**Step 8 — Get the Business Unit ID.**

Every request must carry a header named **`Pardot-Business-Unit-Id`**, holding the
**18-character** Business Unit ID.

A Salesforce administrator finds it in Setup, via **Quick Find → Business Unit Setup** (in
some orgs it is reached through the Account Engagement setup area). It is 18 characters of
mixed letters and digits, commonly beginning with `0Uv`.

```
PARDOT_BUSINESS_UNIT_ID=<18 characters>
```

**Step 9 — Use the right host, which is not your Salesforce address.**

**Requests go to `https://pi.pardot.com`** (or `https://pi.demo.pardot.com` for a sandbox),
**not to your Salesforce instance address.** This catches anybody reusing an existing
Salesforce client, and the resulting failure is confusing precisely because the token is
genuinely valid.

```
PARDOT_API_BASE=https://pi.pardot.com
```

---

## 3. What to choose, and why

**OAuth scopes on the connected app:**

| Scope | Why |
|---|---|
| **`pardot_api`** | The scope that grants Account Engagement API access at all. Without it, a perfectly valid Salesforce token is refused by Pardot. |
| **`refresh_token`** and **`offline_access`** | Allow the integration to obtain a fresh access token without a person signing in each time. **A scheduled automation is impossible without these** — access tokens are short-lived. |

**Add nothing else unless you know why you need it.** Broad Salesforce scopes such as full
access reach the whole CRM, which is a much larger surface than the reporting job requires and
a much harder conversation with a security reviewer.

**The Pardot role on the linked user is the real permission boundary.** Scopes decide which
API may be called; **the Pardot role decides what data comes back.** Give the integration user
a role suited to reading. Do not use an administrator account for convenience — an automation
acting as a Pardot admin can change the things it is supposed to be reporting on.

**The Business Unit ID is a correctness control, not only a routing one.** If it is wrong, you
do not get an error — **you get data from a different business unit.** On a company with
several business units, that is a well-formed, confident, wrong answer. **Record which
business unit produced every number you publish.**

---

## 4. How to check it worked

First, obtain a token from Salesforce. The exact grant depends on how the connected app was
configured; this is the common refresh-token form:

```bash
TOKEN=$(curl -s -X POST "https://login.salesforce.com/services/oauth2/token" \
  -d "grant_type=refresh_token" \
  -d "client_id=$SALESFORCE_CONSUMER_KEY" \
  -d "client_secret=$SALESFORCE_CONSUMER_SECRET" \
  -d "refresh_token=$SALESFORCE_REFRESH_TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

Then make one Account Engagement request:

```bash
curl -s "$PARDOT_API_BASE/api/v5/objects/campaigns?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Pardot-Business-Unit-Id: $PARDOT_BUSINESS_UNIT_ID"
```

**Success looks like** JSON containing a `values` list with one campaign, each entry having an
`id` and a `name`.

**Read the campaign name and confirm it belongs to the business unit you expected.** That is
the only check that catches a wrong Business Unit ID, because a wrong one does not produce an
error.

---

## 5. If it does not work

**Sign-in succeeds but every Pardot request is refused.** This is step 6 — the Salesforce user
is not linked to a Pardot user, or the `pardot_api` scope is missing. **Do not debug OAuth.**
The token is fine. Check the user link and the scope, in that order.

**A message about the host, or a connection that goes nowhere.** Step 9 — requests must go to
`pi.pardot.com`, not to your Salesforce instance address. Very common when an existing
Salesforce client is reused.

**Data comes back but describes campaigns nobody recognises.** The Business Unit ID is wrong.
This produces **no error at all**, which is why it is on this list. Confirm the 18-character
value.

**"invalid_grant" from the Salesforce token request.** The refresh token has been revoked, or
the connected app's settings changed, or the user's password was reset. Obtain a new refresh
token through the sign-in flow.

**Everything worked in testing and fails in production ten minutes later — or the reverse.**
Salesforce connected app changes can take **up to ten minutes** to propagate. Wait before
changing anything else; re-editing the app restarts the clock.

**Timestamps that do not line up between two exported files.** Step 7 — different export
identities with different timezones. This is not a connection problem and it will not
announce itself. Establish which identity created each file before trusting either.

---

## 6. Keeping the credential safe

**This credential reaches marketing data about identified people and sits inside your
Salesforce environment.** Treat it as a Salesforce credential, with whatever handling rules
your organisation already applies to those.

- **Store the consumer secret and the refresh token in a secrets manager.** The refresh token
  is as sensitive as the secret — **it is the thing that allows sign-in without a person.**
- **Never paste either into a chat window, a ticket or a shared document.**
- **Never commit either to a repository.**
- **Rotating the secret:** in App Manager, open the connected app and rotate the consumer
  secret. **This invalidates the old one, so anything else using the same connected app stops
  working** — establish what else uses it before you do this, and plan a window.
- **If it leaks:** a Salesforce administrator should, at minimum, **revoke the connected app's
  existing authorisations** (Setup → **Connected Apps OAuth Usage**, where sessions can be
  revoked) and rotate the consumer secret. **Revoking the authorisation kills the refresh
  token immediately**, which is the fastest way to stop access. If the exposure is serious, the
  administrator can block or uninstall the connected app entirely. Then ask them to review the
  app's usage history, and tell whoever owns security at your company — this credential reaches
  personal data.
