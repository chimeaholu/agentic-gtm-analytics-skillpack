# Connecting Marketo — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Time: about thirty to sixty minutes.** Nothing is reviewed by a human and there is no
waiting queue. The work is four connected pieces of configuration that all have to line up.

**Permission level: you must have access to the Marketo Admin area**, which normally means
a Marketo administrator. **A marketing user cannot do any part of this.** There is no
self-service path and no workaround — the Admin menu is either there or it is not.

**If you are not a Marketo administrator,** send yours this, word for word:

> "Please set up API access for our analytics assistant. That means four things: a new
> **API-Only user role** with read permissions for Lead, Activity, Campaign and Program; an
> **API-Only user** assigned to that role; a **LaunchPoint Custom Service** assigned to
> that user, which produces a Client ID and Client Secret; and our **Munchkin ID** from
> Admin → Munchkin. Please send the Client ID and Secret through our password manager
> rather than over email or chat."

That message is the whole job. An administrator who has done it before will recognise it
immediately.

**Plan or tier:** all Marketo Engage subscriptions include the REST API. **What varies is
the daily API call allowance**, which is set per subscription and is smaller than people
expect — often a few tens of thousands of calls a day shared across *every* integration
your company runs, including ones you do not know about. Find out the number before
planning a large extraction. Section 3 covers what this means in practice.

**One honest expectation to set at the start:** **Marketo has no reporting API.** There is
no endpoint that returns the numbers you see in a Marketo report. Adobe's own guidance is
to extract the underlying activity records and compute your own figures. This connection
gets you the raw material, not the reports — and that is the correct and only path, not a
limitation of this setup.

**A warning about shared budget:** because the daily call allowance is shared across the
whole subscription, **an aggressive extraction can exhaust it and break other integrations
your company depends on** — the CRM sync, the web form handler, the chat tool. That is a
real operational incident, not a slow report. Discuss the budget with the administrator
before running anything large.

---

## 2. The steps

### Step 1 — Open the Admin area

Sign in to Marketo and click **Admin** in the top navigation bar.

**What you should be seeing:** an administration screen with a tree menu down the left-hand
side, containing entries such as Users & Roles, LaunchPoint, Munchkin, and Web Services.

**If there is no Admin option in your navigation bar, you do not have administrator
access.** Stop and go back to section 1.

*Confirm you can see the Admin area.*

### Step 2 — Create the role

In the left-hand tree, open **Users & Roles**, then the **Roles** tab, then click **New
Role**.

Name it `API Analytics Read` and describe it: `Read-only API access for automated
go-to-market reporting. Owner: <team>.`

You are now shown a tree of permissions to tick. **Section 3 lists exactly which ones and
why. Read section 3 aloud now**, then come back and tick them.

**Why a new role rather than an existing one:** the role is the *only* thing controlling
what this integration can see, and reusing a role someone else depends on means a future
change to that role silently changes what your reporting can read.

*Confirm the role is created with the right permissions.*

### Step 3 — Create the API-Only user

Still in **Users & Roles**, go to the **Users** tab and click **Invite New User**.

Fill in:

- **Email:** a real address your team monitors. It must be unique in Marketo and it will
  receive notifications.
- **First and last name:** something recognisable, such as `Analytics Integration`.
- **Role:** the role you created in step 2.
- **Tick the "API Only" option.**

**Ticking API Only is what makes this a robot identity rather than a person.** An API-Only
user cannot sign in to the Marketo interface at all, which means no password to be phished
and no seat to be confused with a colleague's. **It also usually does not consume a regular
user licence — confirm that with your administrator, since licensing terms vary.**

Complete the invitation.

*Confirm the API-Only user exists.*

### Step 4 — Create the LaunchPoint Custom Service

In the left-hand tree, open **LaunchPoint**, then click **New → New Service**.

Fill in:

- **Display Name:** `GTM Analytics Agent`
- **Service:** choose **Custom** from the dropdown
- **Description:** what it reads and who owns it
- **API Only User:** select the user you created in step 3

**LaunchPoint is Marketo's word for its list of connected integrations**, and a Custom
Service is a generic entry for something that is not one of Marketo's prebuilt connectors.
This is the step that actually produces credentials.

Save it.

*Confirm the service appears in the LaunchPoint list.*

### Step 5 — Copy the Client ID and Client Secret

In the LaunchPoint list, find your new service and click **View Details** next to it.

A small panel shows:

- **Client Id** — shaped like a long identifier with dashes, similar to
  `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- **Client Secret** — a long random string

Copy both.

**Marketo lets you come back and view these again**, which is convenient and also a reason
to be careful about who has Admin access.

**Do not paste them into this chat, an email or a ticket.** Section 6 says where they go.

*Confirm you have both.*

### Step 6 — Get the Munchkin ID

In the left-hand tree, open **Munchkin**.

The **Munchkin Account ID** is shown there, shaped like `123-ABC-456`.

**This is the step everyone misses, and the reason is that there is no shared Marketo
address.** Every Marketo subscription has its own web address, built from this ID:

```
https://123-ABC-456.mktorest.com
```

A host copied from another company's documentation, or from a previous engagement, will not
authenticate at all. If a colleague hands you "the Marketo endpoint", check the ID in
it matches yours.

**You can also find the same base address under Admin → Web Services**, which shows the
REST API endpoint directly. Either source is fine; use whichever you can find.

*Confirm you have the Munchkin ID and the resulting host address.*

### Step 7 — Store the three values

| Name | Value | Shape |
|---|---|---|
| `MARKETO_HOST` | from step 6 | `https://123-ABC-456.mktorest.com` |
| `MARKETO_CLIENT_ID` | from step 5 | identifier with dashes |
| `MARKETO_CLIENT_SECRET` | from step 5 | long random string |

*Confirm they are stored.*

### Step 8 — Note the subscription's timezone

Ask the administrator what timezone the Marketo instance is configured in, and **write it
down next to the credentials.**

Here is why it matters, and it is not obvious: **the marketer looking at Marketo sees dates
in the instance timezone, but the REST API does not return data in it.** Every date
boundary — what counts as "yesterday", which month an activity falls in — depends on
knowing this value. An extraction job that does not pin it produces monthly numbers that
disagree with what the marketing team sees, by an amount nobody can explain.

*Confirm the timezone is recorded. Then go to section 4.*

---

## 3. What to choose, with reasons

### Role permissions

**The role's permissions directly determine what the integration can see, and the failure
mode is silent.** A missing permission does not usually produce a clear error saying so —
it produces a response with fewer records, or with fields absent, which looks exactly like
"there is not much data". That is the single most important thing to understand about
Marketo permissions.

**For read-only reporting:**

| Permission area | Take it | Why |
|---|---|---|
| **Read-Only Lead** (under Access API) | **Yes** | Reads lead and person records. The foundation of nearly all Marketo analysis. |
| **Read-Only Activity** | **Yes** | Reads the activity log — email sends, opens, clicks, form fills, web visits. **Since Marketo has no reporting API, this is what every computed metric is built from.** Without it there is essentially nothing to report on. |
| **Read-Only Campaign** | **Yes** | Reads smart campaigns, so activity can be attributed to the campaign that caused it. |
| **Read-Only Program** | **Yes** | Reads programs and their members, which is how campaign performance is grouped. |
| **Read-Only Custom Object** | Only if used | Only if your instance uses custom objects and they are in scope. |
| **Read-Only Named Account** | Only if used | Only for account-based analysis in instances using named accounts. |

**Do not grant write permissions for a reporting connection.** Anything labelled Read-Write
lets the integration change or delete lead records, and **Marketo activity data cannot be
reconstructed once altered.** A reporting integration needs none of it.

**Explicitly avoid `Read-Write Lead` and any permission allowing campaign execution.** A
robot identity that can trigger a smart campaign is a robot identity that can email your
entire database. That is not a hypothetical risk — it is a well-known incident pattern in
marketing automation, and it is unrecoverable, because you cannot unsend an email.

### The access token, and why caching it is not optional

Marketo does not use a permanent key. You exchange the Client ID and Secret for a **bearer
token** that lives for **3600 seconds — one hour** — and then send that token on every
call.

```
GET {MARKETO_HOST}/identity/oauth/token?grant_type=client_credentials&client_id=…&client_secret=…
```

**Cache the token and reuse it for the full hour.** Here is the reason, and it is specific
to Marketo: **minting a token costs one call against your daily allowance**, and the
allowance is per subscription and shared with every other integration your company runs.
Code that mints a fresh token before every request burns the company's shared budget at
double rate and can take down the CRM sync alongside your report.

**Request a fresh token when the current one is within a couple of minutes of expiring**,
rather than waiting for a failure — a token that expires mid-extraction produces a
confusing partial result.

---

## 4. How to verify it worked

Two calls: obtain a token, then use it.

```bash
# 1. Get a token
curl -s "$MARKETO_HOST/identity/oauth/token?grant_type=client_credentials&client_id=$MARKETO_CLIENT_ID&client_secret=$MARKETO_CLIENT_SECRET"
```

**Success looks like:**

```json
{"access_token":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:ab","token_type":"bearer","expires_in":3599,"scope":"analytics@example.com"}
```

The `scope` field shows which API-Only user the token belongs to — **check it matches the
user you created in step 3.** If it names somebody else, the LaunchPoint service is
attached to the wrong user.

```bash
# 2. Use it
curl -s -H "Authorization: Bearer <paste the access_token>" \
  "$MARKETO_HOST/rest/v1/leads/describe.json"
```

**Success looks like** a JSON block with `"success": true` and a `result` list describing
the lead fields available to this role:

```json
{"requestId":"1a2b#3c4d5e6f","success":true,"result":[{"id":2,"displayName":"Company Name","dataType":"string","rest":{"name":"company",...}}]}
```

**Read the field list.** It shows exactly what this role can see. If a field the reporting
needs is absent from it, the role's permissions are the reason — and finding that now is
much better than finding it after the analysis is built on incomplete data.

**A critical thing about Marketo errors:** **Marketo returns HTTP 200 for many failures**,
with `"success": false` and an `errors` list in the body. **Never judge a Marketo call by
its HTTP status code.** Always read the `success` field. Code that checks only the status
code will treat failures as successes and report empty results as real ones.

---

## 5. If it does not work

**Error 601 — "Access token invalid"**

The token is wrong, malformed, or you are sending it to a different host than the one that
issued it. Check the Munchkin ID in the host address matches your subscription.

**Error 602 — "Access token expired"**

The hour has elapsed. Request a new token. If this appears mid-extraction, your code is not
refreshing proactively — refresh when the token is near expiry rather than after it fails.

**Error 603 — "Access denied"**

**The role is missing the permission this call needs.** The token is valid and the identity
is right; the role does not allow this. Go back to Admin → Users & Roles → Roles,
edit the role, and add the permission from section 3. The credentials do not change.

**Error 606 — "Max rate limit exceeded"**

Marketo caps concurrent and per-second requests. Slow down and reduce parallelism. **Do not
retry immediately** — that makes it worse and spends allowance you have already lost.

**Error 607 — "Daily quota reached"**

The subscription's daily call allowance is exhausted, **and this is shared across every
integration your company runs.** Other systems may now be failing too. Stop, tell the
administrator, and plan the extraction around the allowance — using the Bulk Extract
endpoints, which return many records per call, rather than record-by-record requests.

**"Cannot resolve host" or the address does not respond**

The Munchkin ID in the host address is wrong. There is no shared Marketo host; check
Admin → Munchkin again.

**Everything succeeds and returns far less data than expected**

Two likely causes, in order: the role lacks a permission, which fails quietly; or the
timezone from step 8 is making your date filters ask for a different window than you think.
Check the `describe` output from section 4 first — it is the fastest way to see what the
role can actually reach.

---

## 6. Security notes

**Where the credentials go.** The Client ID and Client Secret belong in your organisation's
secrets manager, or environment variables on the machine that needs them. Not a
spreadsheet, not a shared document, not a chat message.

**Never paste them into a chat window, including this one.** Behind them sits your entire
marketing database — every contact, every email address, every behavioural record. Treat
them the way you treat that database.

**Never commit them to a repository.**

**Do not put the Client Secret in a web address that gets logged.** The token request in
section 4 passes it as a query parameter because that is Marketo's documented form — **and
query parameters end up in server logs, proxy logs and browser history.** For production
code, make that request server-side only, never from a browser, and keep the resulting logs
restricted.

**What these credentials can reach.** Everything the API-Only user's role allows, across
the whole subscription. If you followed section 3, that is read access to leads, activities,
campaigns and programs — which is personal data about real people and falls under privacy
law in most jurisdictions. Handle the extracted data accordingly, not only the credential.

**Rotating them:**

1. Admin → LaunchPoint → your service → **View Details**. There is a control to regenerate
   the Client Secret.
2. **Regenerating takes effect immediately and the old secret stops working**, so update
   the stored value straight away and re-run the section 4 test.

Every six to twelve months is reasonable, and immediately whenever an administrator with
access leaves.

**If it leaks:**

1. **Delete the LaunchPoint service.** This revokes access immediately and completely, and
   it is faster than regenerating if you are unsure of the scope of the leak.
2. Deactivate the API-Only user in Admin → Users & Roles.
3. Ask the administrator to check the instance's audit trail for unexpected API activity.
4. Recreate the service and user by repeating steps 3 to 5.

Deleting a LaunchPoint service removes access only. **It does not delete any leads,
activities or campaigns.**

**Ownership.** The API-Only user is a robot, not a person, so this credential survives staff
changes — which is the point. Record who is responsible for it and make sure the
notification email address is one somebody actually reads. An integration nobody owns is an
integration nobody notices has broken.
