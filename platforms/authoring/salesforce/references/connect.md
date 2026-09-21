# Connecting Salesforce — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Time: one to four hours, and a Salesforce administrator must be involved for most of
it.** Nothing is queued for human review by Salesforce, so there is no waiting on an
external approval — the time goes on the number of separate settings that all have to line
up, and on finding an administrator with a free hour.

**Permission level: System Administrator in the Salesforce org**, where "org" is
Salesforce's word for your company's Salesforce instance. Creating the app, creating the
integration user and granting permissions are all administrator-only actions. A marketing
or sales user cannot do any of this, and there is no partial path.

**If you are not an administrator,** send yours this:

> "Please set up API access for our analytics assistant. That means: a Connected App (or
> External Client App on newer orgs) with the `api` and `refresh_token offline_access`
> scopes; an integration user with the **API Enabled** permission; read access to the
> report folders we care about; and field-level read on the fields in those reports. Please
> send the credentials through our password manager, not over email or chat. I have the
> full details if it helps."

**Plan or tier: API access is not included in every Salesforce edition.** Professional
Edition frequently needs an API access add-on purchased separately; Enterprise and above
normally include it. **Check this before starting.** If the org does not have API access,
nothing in this walkthrough will work and no amount of configuration fixes it — it is a
purchase.

**Three warnings to give before anyone clicks anything:**

1. **You are working in a live system that runs a sales team's day.** Permission sets and
   profile changes take effect immediately for real people. Create new objects; do not edit
   existing ones that other people depend on.
2. **Sandboxes are a different world.** If the org is a sandbox — a test copy — it
   authenticates against a different address and returns a different host. Know which one
   you are in before you start. Doing this in production while believing you are in a
   sandbox is the way this goes badly.
3. **After you create the app, Salesforce makes you wait.** Newly created Connected Apps
   commonly take **two to ten minutes** to become usable, and calls during that window fail
   with errors that look like configuration mistakes. Expect it, so nobody starts
   "fixing" something that is merely not ready yet.

---

## 2. The steps

### Step 1 — Open Setup

Sign in to Salesforce and click the **gear icon** in the top-right, then **Setup**. Setup
opens in a new browser tab.

**What you should be seeing:** the Setup home page, with a **Quick Find** search box at the
top of the left-hand menu.

**Use Quick Find for everything that follows.** Salesforce's menu structure differs between
editions and releases and clicking through it is unreliable; typing into Quick Find is not.

*Confirm Setup is open and you can see Quick Find.*

### Step 2 — Open the app manager

In Quick Find, type `App Manager` and open **App Manager**.

**On newer orgs you may instead be steered toward External Client Apps**, which is
Salesforce's newer replacement for Connected Apps. Both work for this. **This part is
version-dependent** — if App Manager is absent or the New Connected App button is disabled,
search Quick Find for `External Client App` and follow the equivalent flow there. Tell the
agent which one you are seeing.

**What you should be seeing:** a list of applications with a **New Connected App** button
in the top right.

*Confirm which screen you have.*

### Step 3 — Create the app

Click **New Connected App**. If a chooser appears offering a Connected App or an External
Client App, take the Connected App unless your administrator has a policy otherwise.

Fill in the basic information:

- **Connected App Name:** `GTM Analytics Agent`
- **API Name:** fills in automatically
- **Contact Email:** a monitored address — Salesforce emails it about this app

*Confirm the basics are filled in.*

### Step 4 — Turn on OAuth

Tick **Enable OAuth Settings**.

The screen expands to show a callback address field and two lists of scopes — the
permissions the app will hold.

**Callback URL:** this is where Salesforce sends a person's browser back to after they
sign in. For a server-to-server setup nobody's browser is involved, but the field is
required. `http://localhost:1717/OauthRedirect` is a conventional value for command-line
tooling. If your administrator has a standard, use theirs.

*Confirm OAuth settings are enabled.*

### Step 5 — Choose the scopes

Move the scopes listed in section 3 from the available list to the selected list.

**Read section 3 aloud now, then come back.**

*Confirm the scopes are selected.*

### Step 6 — Decide how the app will sign in

This is the decision that shapes everything after it, and section 3 explains the trade-off
in full. **Read the "OAuth flow" part of section 3 now** and pick one:

- **Client Credentials** — the simplest. The app is permanently associated with one
  designated user. Best for scheduled, unattended reporting.
- **JWT Bearer** — a certificate-based flow with no stored password. More setup, better
  suited to strict security policies.
- **Web Server / authorization code** — a person signs in through a browser. Use when a
  named human should be behind every call.

*Confirm which flow you chose and tell the agent, because the rest differs.*

### Step 7 — Save, and wait

Click **Save**, then **Continue**.

**Now wait two to ten minutes before testing anything.** Salesforce needs time to propagate
a new app. Calls made during that window fail with misleading errors.

*Confirm it saved, then wait.*

### Step 8 — Collect the app's credentials

Back in App Manager, find your app in the list, open the dropdown at the end of its row and
choose **View**. On that page, in the API section, there is a control revealing the
**Consumer Key** and **Consumer Secret** — Salesforce's names for the client ID and client
secret.

The Consumer Key is a long string of letters, numbers and dots. The Consumer Secret is a
long numeric or alphanumeric string.

Copy both. **Do not paste them into this chat.** Section 6 says where they go.

*Confirm you have both.*

### Step 9 — Create the integration user

Back in Quick Find, type `Users` and open **Users**, then click **New User**.

Create a user that represents the integration rather than a person:

- Name it recognisably, for example `Analytics Integration`.
- Give it an email address that someone actually monitors, because password resets and
  security alerts go there.
- **Salesforce may offer an Integration User licence type, which is designed exactly for
  this and is cheaper than a full licence.** Ask your administrator whether the org has
  them available. **This is edition- and licence-dependent** — if the option is not
  offered, a standard user licence works.

**Use a dedicated user, never a person's account.** A person leaves, their account is
deactivated, and every scheduled report stops with no warning. A person also changes their
own settings, and one of those settings silently changes your numbers — see step 11.

*Confirm the user exists.*

### Step 10 — Permission the user properly. This is the step people miss

The app grants OAuth scopes. **The scopes do not grant any data access at all.** What the
integration can see is entirely determined by this user's profile and permission sets. Miss
this and you get an app that authenticates perfectly and returns nothing.

In Quick Find, type `Permission Sets` and open **Permission Sets**. Create a new one, name
it `Analytics Integration Access`, save it, then configure it as section 3 describes.
Assign it to the user you created in step 9.

**Read the permissions part of section 3 aloud now.**

*Confirm the permission set is created and assigned.*

### Step 11 — Pin the user's timezone and write it down

Open the integration user's record and note its **Time Zone** setting.

**Every relative date filter and every date grouping in a Salesforce report evaluates in
the running user's timezone, at the moment the report runs.** If this user's timezone is
not deliberately chosen and recorded, monthly totals are not reproducible and nobody will
work out why. Set it to whatever your reporting is supposed to be in, and record the value
alongside the credentials.

*Confirm the timezone is set and recorded.*

### Step 12 — Pre-authorise the app for this user

Still in Setup, find the connected app's management page — Quick Find `Connected Apps`, or
`Manage Connected Apps`. Open your app and edit its policies.

Set **Permitted Users** to **Admin approved users are pre-authorized**, then assign your
permission set (or the user's profile) to the app.

**If you skip this, the app is reachable by anyone in the org who can sign in.** Setting it
means only the identity you chose can use it, which is what you want.

*Confirm the setting is saved.*

### Step 13 — Sign in once and capture the instance address

Complete a sign-in with the flow you chose in step 6. The token response that comes back
contains two things you must keep:

- `access_token` — the credential that authorises calls
- **`instance_url`** — the host your org actually lives on, such as
  `https://yourcompany.my.salesforce.com`

**Always use the `instance_url` from the response as your API host. This is the step
everyone misses.** Never hard-code `login.salesforce.com` — that address only issues
tokens; it does not serve data. Sandboxes authenticate against `test.salesforce.com` and
return a different host again. Getting this wrong produces an authentication error that
looks like a bad credential, which sends people off to regenerate a perfectly good token.

Store:

| Name | Value |
|---|---|
| `SF_INSTANCE_URL` | the `instance_url` from the token response |
| `SF_ACCESS_TOKEN` | the `access_token` from the token response |
| `SF_API_VERSION` | the version you pin, for example `v60.0` |

*Confirm all three are stored. Then go to section 4.*

---

## 3. What to choose, with reasons

### OAuth scopes

| Scope | Take it | Why |
|---|---|---|
| `api` | **Yes** | Without it there is no API access at all. This is the one that matters. |
| `refresh_token offline_access` | **Yes for anything scheduled** | Lets the integration renew its own access without a human signing in again. Omit it and your scheduled reports stop working at an unpredictable moment. |
| `web` | only if needed | Only for flows that redirect a person's browser. Unnecessary for server-to-server. |
| `full` | **No** | Grants everything the user can do, including things nobody intended. The `api` scope already covers reporting. |

### Which OAuth flow

| Flow | Choose it when | The cost |
|---|---|---|
| **Client Credentials** | Scheduled, unattended reporting — the common case | You must designate a run-as user on the app, and everything the integration does is attributed to that user |
| **JWT Bearer** | Your security policy dislikes stored secrets | You generate a certificate, upload it to the app, and pre-authorise the user. More moving parts, no password stored anywhere |
| **Web Server** | A named human should be behind each call | Requires a person present at sign-in; unsuitable for anything scheduled |

**For most reporting work, Client Credentials is the right answer** and the extra JWT setup
buys nothing unless a policy demands it.

### What the integration user needs

| Permission | Why |
|---|---|
| **API Enabled** | The switch that allows API calls at all. Without it, a perfectly configured app returns a permission error on every single request. |
| **Read** on the objects in scope — Account, Contact, Lead, Opportunity, and any custom objects | Object permissions gate whole tables. Missing one produces an error naming the object, which is at least a clear failure. |
| **Access to the report folders** | Reports live in folders with their own sharing. A user who cannot see the folder cannot run the report, and the API returns what looks like an empty org. |
| **Field-level read on every field used in the reports** | **This is the dangerous one. Missing field-level security does not produce an error — the field is absent from the response.** A report silently loses a column and totals come out wrong with nothing to indicate why. |
| **View All Data** | **Only if genuinely required.** It bypasses sharing rules entirely and lets the integration see every record in the org, including things a sales team keeps deliberately restricted. Prefer explicit object and field permissions. Discuss it with the administrator rather than taking it for convenience. |

**The rule to say out loud: object permissions fail loudly, field permissions fail
silently.** Check the fields.

**Do not grant Modify All Data, and do not grant write permissions for a reporting
connection.** A reporting integration with write access is one bad loop away from mass-
editing live customer records, and Salesforce has no undo for that.

---

## 4. How to verify it worked

Run this:

```bash
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/$SF_API_VERSION/analytics/reports"
```

**Success looks like** a JSON list of report summaries, each with an `id`, a `name` and a
`url`:

```json
[{"id":"00O...","name":"Pipeline by Stage","url":"/services/data/v60.0/analytics/reports/00O...","describeUrl":"..."}]
```

**An empty list is not necessarily an empty org, and this catches people out.** That
endpoint returns *recently viewed* reports for the running user, and a freshly created
integration user has viewed nothing. An empty list usually means the user is new, not that
there are no reports. To check properly, query the report catalogue directly instead:

```bash
curl -s -H "Authorization: Bearer $SF_ACCESS_TOKEN" \
  "$SF_INSTANCE_URL/services/data/$SF_API_VERSION/query?q=SELECT+Id,Name+FROM+Report+LIMIT+5"
```

**Failure looks like** a JSON array containing an `errorCode` and a `message`. Section 5
translates them.

---

## 5. If it does not work

**"INVALID_SESSION_ID: Session expired or invalid" — a 401**

Most often the host is wrong, not the token. You are calling `login.salesforce.com` or a
remembered address instead of the `instance_url` that came back with the token. Check that
first, before regenerating anything.

Otherwise the token has genuinely expired; mint a new one. If you took
`refresh_token offline_access`, the client can do that itself.

**"API_DISABLED_FOR_ORG" or "API is not enabled for this Organization or Partner"**

Either the org's edition does not include API access — a purchase, not a setting — or the
integration user's profile lacks **API Enabled**. Check the user's permission set first,
since that is free to fix.

**A permission error naming an object, such as INSUFFICIENT_ACCESS or "entity type cannot
be queried"**

Object-level permission is missing on the integration user. Add read on that object to the
permission set. This is the failure mode you want, because it names what is wrong.

**A report runs and a column is missing, with no error at all**

Field-level security. The integration user cannot read that field, and Salesforce omits it
rather than complaining. Check field-level read on every field in the report. **Nothing in
the response tells you this happened** — which is why section 3 flags it.

**"invalid_client_id" or "client identifier invalid", right after creating the app**

Very often you are inside the two-to-ten-minute propagation window from step 7. Wait, then
try again before changing anything. If it persists past fifteen minutes, check the Consumer
Key was copied whole, with no line break in the middle.

**Everything authenticates and the numbers do not match what the sales team sees**

Usually the timezone from step 11, or record sharing. The integration user sees only what
its permissions and the org's sharing rules allow, so its numbers can legitimately be
*lower* than a manager's. Say which user the numbers were produced as, rather than
adjusting until they match.

---

## 6. Security notes

**Where the credentials go.** The Consumer Key, Consumer Secret, refresh token and any
certificate private key belong in your organisation's secrets manager, or in environment
variables on the machine that needs them. Not in a spreadsheet, a shared document, a ticket
or a chat message.

**Never paste them into a chat window, including this one.** If they have already gone
somewhere visible, rotate them using the steps below — Salesforce credentials are among the
most valuable things an attacker can find, because behind them sits your entire customer
and pipeline database.

**Never commit them to a code repository.** Treat a Consumer Secret that has touched a
repository as compromised, even if the commit was removed, because the repository history
and every clone still contain it.

**What these credentials can reach.** Everything the integration user can see. If you
followed section 3 and granted read on specific objects with no View All Data, that is a
defined slice of your CRM. If someone took View All Data for convenience, it is every
record in the company. That difference is worth revisiting before you finish.

**Rotating them:**

- **Consumer Secret:** Setup → App Manager → your app → **View** → there is a control to
  rotate the consumer secret. **Rotation invalidates the old secret**, so update the stored
  value and re-run the section 4 test straight afterwards. Salesforce offers a short
  overlap window on rotation — use it if scheduled jobs depend on this app.
- **Certificate, for JWT:** generate a new one, upload it to the app, confirm the new one
  works, then remove the old.
- **Integration user password:** rotate on your organisation's normal schedule.

Every six to twelve months is reasonable, and immediately whenever an administrator with
access leaves.

**If it leaks,** do these in order:

1. Setup → **Manage Connected Apps** → open the app → **Block** it. This stops every token
   issued to that app at once, which is the fastest containment available.
2. Revoke the integration user's active sessions — Setup → `Session Management`.
3. Rotate the Consumer Secret and any certificate.
4. Unblock the app once the new credentials are in place, and re-run the section 4 test.
5. Check Setup → `Login History` and the org's Event Monitoring, if the org has it, for
   calls from unexpected addresses.

**Ownership.** Because the credential belongs to a dedicated integration user rather than a
person, it survives staff changes — which is the point. Write down who is responsible for
it anyway, because an integration user with nobody watching its inbox is how a security
alert goes unread for a year.
