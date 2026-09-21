# Connecting Tableau — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Tableau's account or site settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Decide first which of the two credentials you are building, because they suit different
jobs and the second needs an administrator.**

| Credential | Good for | Who can create it |
|---|---|---|
| **Personal Access Token** (a named token tied to your own user account) | Trying things out, one-off analysis, a person running something by hand | Any user **if the site administrator has allowed it** |
| **Connected App with JWT** (an application identity that mints its own short-lived tokens) | **Anything running on a schedule.** This is the real answer for automation. | **Site administrator only** |

**The reason the choice matters, stated plainly: a Personal Access Token dies if it is not
used for 15 consecutive days.** Not a warning, not a grace period — it stops working. **A
report that runs monthly will find its token dead every single time.** Tokens also have a
hard expiry regardless of use, commonly one year on Tableau Cloud.

**So: if a human will run it, a Personal Access Token is fine. If a schedule will run it,
build the Connected App.** Choosing the token because it is quicker, for work that is
scheduled, means building something that fails in a month in a way that looks random.

**Who has to do what.**

- **Personal Access Tokens** must be enabled for the site by an administrator before anybody
  can create one. If the section described in step 2 is missing from your account settings,
  that is why.
- **Connected Apps** are created only by a **site administrator**.

**If you need to ask an administrator, ask for exactly this:**

> "I need to connect a scheduled reporting integration to Tableau. Please create a Connected
> App using Direct Trust on the [name] site, with the scopes `tableau:content:read`,
> `tableau:viz_data_service:read` and `tableau:insight_definitions_metrics:read`, and send me
> the client ID, the secret ID and the secret value through our password manager. Also tell
> me the site's content URL and which user account the integration should act as."

**Plan and tier.** The Tableau REST API is part of Tableau Server and Tableau Cloud. Some
newer query surfaces are version-dependent — confirm the version before assuming an endpoint
exists.

**How long it takes.** **Ten minutes** for a Personal Access Token. **An hour or so** for a
Connected App, plus however long it takes to get an administrator's attention.

---

## 2. The steps

### Path A — Personal Access Token

**Step A1 — Open your own account settings.**

Sign in to Tableau. Click your **profile picture or initials in the top right**, and choose
**My Account Settings**.

**Step A2 — Find the token section.**

Scroll down the settings page to a section headed **Personal Access Tokens**.

**If that section is not there, the site administrator has not enabled tokens for the site.**
You cannot enable it yourself. Ask them to turn on Personal Access Tokens in the site
settings.

**Step A3 — Create the token.**

Type a name for the token — this name is part of the credential, so write it down exactly as
typed, including capitals. Click **Create Token**.

**Step A4 — Copy the secret now.**

Tableau shows the token secret **once**. It is a long random string. Once the dialogue is
closed it cannot be retrieved.

You need three values:

```
TABLEAU_PAT_NAME=<the name exactly as you typed it>
TABLEAU_PAT_SECRET=<the long secret, shown once>
TABLEAU_SITE_CONTENT_URL=<the site's content URL - see step A5>
```

**Step A5 — Find the site content URL.**

Look at the web address while you are signed in. It contains a segment after `/site/` — that
segment is the content URL. On a single-site Tableau Server there may be none, in which case
an empty value is correct.

**Everything in Tableau is per-site.** A company with several sites needs **one credential
per site**. A token created on one site will not work on another, and the failure looks like
a bad credential.

**Step A6 — Understand how the token is used, because it is a two-stage process.**

The name and secret are not sent on every request. They are exchanged for a session token —
returned in a header called `X-Tableau-Auth` — which is then sent on subsequent calls. That
session lasts roughly **240 minutes** of idle time.

**Step A7 — One token per worker, and this one bites.**

**Signing in again with the same Personal Access Token invalidates the previous session.** If
two processes share one token, each sign-in knocks the other out, and the symptom is
intermittent authentication failures that no amount of log-reading explains. **Give every
concurrent process its own token.**

### Path B — Connected App with JWT

**Step B1 — Open the site settings as an administrator.**

Sign in as a site administrator. In the left navigation choose **Settings**, then the
**Connected Apps** tab.

**UI wording check:** on some versions Connected Apps sits under a separate left-navigation
entry rather than inside Settings, and the wording differs between Tableau Cloud and Tableau
Server. If the tab is not where described, search the administrative interface for
**"Connected Apps"**.

**Step B2 — Create a Direct Trust connected app.**

Create a new connected app and choose the **Direct Trust** style — the one where Tableau
gives you a secret and your code signs its own tokens. Name it after the integration.

**Step B3 — Copy the three values.**

Tableau gives you a **client ID**, a **secret ID**, and a **secret value**. All three are
needed. **The secret value is shown once.** People copy the secret ID and miss the secret
value; they are different fields and both are required.

```
TABLEAU_CONNECTED_APP_CLIENT_ID=<client ID>
TABLEAU_CONNECTED_APP_SECRET_ID=<secret ID>
TABLEAU_CONNECTED_APP_SECRET_VALUE=<secret value, shown once>
```

**Step B4 — Enable the connected app.**

A newly created connected app may be disabled. Confirm its status shows as enabled before
testing anything.

**Step B5 — Decide which user the automation acts as.**

A Connected App token names a Tableau user, and **the automation sees exactly what that user
sees.** Row-level security, permissions and data-source access all follow that identity.
Choose a dedicated, deliberately-permissioned account rather than a real person's, so the
integration does not break when that person changes role or leaves.

**Step B6 — Sign a token.**

The automation builds a short-lived signed token naming the user and the scopes, and exchanges
it for a Tableau session. The signing details are in Tableau's Connected Apps documentation
and are version-specific; follow it rather than any example found elsewhere, because a token
that is subtly malformed produces a generic refusal with no explanation of which claim was
wrong.

---

## 3. What to choose, and why

**Scopes, for the Connected App path.** A scope is a named permission carried inside the
token.

| Scope | Why it is needed |
|---|---|
| `tableau:content:read` | Find and read workbooks, views and data sources. Without it the automation cannot see what exists. |
| `tableau:viz_data_service:read` | Query the data behind a published data source directly, rather than only reading a rendered view. This is what makes analysis possible rather than screenshot-reading. |
| `tableau:insight_definitions_metrics:read` | Read metric definitions, so the automation can say what a number means and not only what it is. Include it if the site uses Tableau's metrics features. |

**Grant read scopes only unless a write is genuinely required.** A write scope allows changing
published content that other people depend on.

**The identity choice is the real permission decision.** Scopes say which kinds of action are
allowed; the **user** the token names decides which data comes back. Row-level security is
applied to that user. **Two automations with identical scopes, acting as two different users,
return different numbers and neither reports anything unusual.** Record the identity alongside
every figure you publish.

**Site choice.** Every credential is bound to one site. Write down which site produced a
number; "the Tableau number" is not a reproducible statement on a multi-site deployment.

---

## 4. How to check it worked

For a Personal Access Token:

```bash
curl -s -X POST "$TABLEAU_SERVER_URL/api/3.19/auth/signin" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"credentials\":{\"personalAccessTokenName\":\"$TABLEAU_PAT_NAME\",
       \"personalAccessTokenSecret\":\"$TABLEAU_PAT_SECRET\",
       \"site\":{\"contentUrl\":\"$TABLEAU_SITE_CONTENT_URL\"}}}"
```

Replace `3.19` with an API version your deployment supports — this is version-dependent, and
an unsupported version number is itself a cause of failure.

**Success looks like** JSON containing a `credentials` block holding a `token` value, a
`site` with an `id`, and a `user` with an `id`. **Read the user id and confirm it is the
identity you intended.**

**Failure looks like** an `error` block with a `code` and a `summary` — Tableau's error
summaries are unusually readable, so read the summary before theorising.

---

## 5. If it does not work

**"Signin Error" or "Invalid credentials", on a token that worked before.** The 15-day idle
expiry. The token is gone and cannot be revived. Create a new one — and if the thing that
uses it runs less often than every two weeks, move to a Connected App instead of repeating
this every month.

**Intermittent authentication failures with no pattern.** Two processes sharing one Personal
Access Token, from step A7. Each sign-in kills the other's session. Give each its own token.

**"Invalid site" or a refusal that names the site.** The content URL is wrong, or the
credential belongs to a different site. Check the `/site/` segment in the browser address
while signed in to the site you actually want.

**The Personal Access Tokens section is missing from account settings.** The site
administrator has not enabled Personal Access Tokens for the site. No amount of retrying
helps; this is an administrator action.

**A Connected App token is refused with an unhelpful message.** Check, in order: the connected
app is **enabled**; the **secret value** was used rather than the secret ID; the token names a
**real, active user** on that site; the scopes in the token match those configured on the app.
Tableau deliberately does not say which claim was wrong, so work through the list rather than
guessing.

---

## 6. Keeping the credential safe

**Both credentials act as a Tableau user and can read whatever that user can read.**

- **Store secrets in a password manager or secrets store.** The Personal Access Token name is
  not secret; the secret value is. Both halves are needed, so keep them together.
- **Never paste a token secret or a connected-app secret value into a chat window, a ticket or
  a shared document.**
- **Never commit either to a repository.**
- **Rotating a Personal Access Token:** create a new one, move the automation onto it, confirm
  sign-in works, then revoke the old one from **My Account Settings**. Diary the hard expiry
  date when you create it — commonly a year on Tableau Cloud — because that expiry arrives
  with no warning.
- **Rotating a Connected App secret:** a connected app can hold more than one secret, so add a
  new secret, switch over, then delete the old. No outage is needed.
- **If a Personal Access Token leaks:** revoke it in **My Account Settings → Personal Access
  Tokens** immediately. Revocation is instant.
- **If a Connected App secret leaks:** this is more serious, because the secret can mint tokens
  **naming any user on the site**, including an administrator. **Delete the secret at once**,
  and if there is any doubt, have the administrator disable the whole connected app while it is
  investigated. Then ask them to review site sign-in activity.
