# Connecting GA4 — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Time: about thirty minutes.** Nothing is reviewed by a human and there is no waiting
queue. The time goes on the fact that **this setup spans two entirely separate Google
systems that do not know about each other**, and most failed attempts are people who
finished one and assumed they had finished both.

Say that plainly at the start, because it is the whole shape of this task:

> **Google Analytics 4 access is two jobs. In Google Cloud you create an identity and turn
> the API on. In Google Analytics you grant that identity permission to read one specific
> property. Doing the Cloud half alone grants access to nothing at all — and the error you
> get looks like a billing or setup problem, which sends people back to fix the half that
> was already correct.**

**Permission levels — you need two, and they are often two different people:**

1. **In Google Cloud:** permission to create a project, enable an API, and create a service
   account. A service account is a robot identity — a login that belongs to a program
   rather than a person. If your company manages Google Cloud centrally you may need to ask
   someone.
2. **In Google Analytics:** **Administrator on the GA4 property** you want to read, or
   someone who is. This is the permission people usually lack, and it is the one nobody
   thinks to check first.

**If you are not a GA4 Administrator,** you will have an email address for the robot
identity after step 6. Send your GA4 administrator this:

> "Please add `<the service account email, which ends @…iam.gserviceaccount.com>` as a user
> on the `<property name>` GA4 property with the **Viewer** role, at the property level.
> It needs read-only access for automated reporting. Adding it at the account level, or in
> Google Cloud, will not work — it has to be on the property itself."

**Plan or tier:** the standard, free GA4 works. Nothing here needs Analytics 360. Note
separately that free GA4 applies data sampling and cardinality limits to some queries;
that affects the *numbers*, not the connection, and the module covers it.

**Cost warning, worth saying out loud:** creating a Google Cloud project and enabling the
Google Analytics Data API costs nothing, and this API has no per-call charge. **If somebody
tells you to enable billing or link BigQuery in order to do this, that is a different task
with real costs attached.** BigQuery export of GA4 data is genuinely useful and genuinely
billable. Do not turn it on as part of "connecting GA4" without a deliberate decision.

**One value to have ready:** which GA4 property you mean. A Google Analytics account can
contain many properties, and connecting the wrong one produces numbers that are correct and
about the wrong website.

---

## 2. The steps

### Step 1 — Open the Google Cloud console

Go to `console.cloud.google.com` and sign in with your work Google account.

**What you should be seeing:** a dashboard with a project selector in the top bar, next to
the Google Cloud logo.

*Confirm you can see it.*

### Step 2 — Choose or create a project

Click the project selector in the top bar.

- If your company already has a Cloud project for this kind of work, select it.
- Otherwise click **New project**, give it a name such as `gtm-analytics`, and create it.

Wait for the console to switch to the new project — the name in the top bar should change.
**Everything after this happens inside that project**, and doing step 3 in the wrong
project is a common quiet mistake.

*Confirm the project name in the top bar is the one you want.*

### Step 3 — Turn on the Google Analytics Data API

In the console's search box at the top, type `Google Analytics Data API` and open the
result that is the API itself, in the API library.

**What you should be seeing:** a page for the Google Analytics Data API with an **Enable**
button, or, if it is already on, a **Manage** button.

Click **Enable**. It takes a few seconds.

*Confirm it now says the API is enabled.*

### Step 4 — Turn on the Admin API, only if you need it

If the work involves reading GA4 *configuration* — the list of properties, custom
dimensions, data streams — also enable the **Google Analytics Admin API** the same way. For
reading report numbers alone, skip this.

*Confirm, or say it was skipped.*

### Step 5 — Create the robot identity

In the console search box type `Service accounts` and open that page. It lives under **IAM
and Admin**.

Click **Create service account**.

- Name it something explanatory, such as `gtm-analytics-reader`.
- The description field is worth filling in: `Read-only GA4 reporting for the analytics
  agent. Owner: <team>.`
- When it offers to grant this service account a role on the *project*, **skip that step**.
  Project roles do not control GA4 access. Granting one here is the single most common
  wasted effort in this whole process.

Finish creating it.

*Confirm the service account appears in the list.*

### Step 6 — Copy the service account's email address

In the service accounts list, the new entry has an email address in a column, shaped like:

```
gtm-analytics-reader@your-project-id.iam.gserviceaccount.com
```

**Copy it.** This is the identity you will grant access to in step 9, and it is what you
send your GA4 administrator if you are not one.

This address is not a secret. It identifies the robot; it does not authenticate it. You can
safely put it in a ticket or an email.

*Confirm you have the address, and that it ends `.iam.gserviceaccount.com`.*

### Step 7 — Create a key for the robot

Click the service account to open it, then open its **Keys** tab. Choose **Add key → Create
new key**, select **JSON**, and confirm.

**A file downloads to your computer immediately.** It is a small text file containing a
private key. **This file is the password.** Anyone holding it can act as this identity.

**Google shows you this file exactly once. There is no way to download it again** — if you
lose it you delete the key and create another.

*Confirm the file downloaded.*

### Step 8 — Put that file somewhere safe and get it off your downloads folder

Move it out of `Downloads` into wherever your organisation keeps credentials, and record
its location as an environment variable:

| Name | Value |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | the full path to the JSON file |

**Never open this file and paste its contents into a chat, a ticket or a document.** It is
the one artefact in this walkthrough that is genuinely dangerous to leak.

If your organisation uses a secrets manager, store the file's contents there and have the
runtime write it out, rather than leaving a key file on a laptop.

*Confirm it is moved and the path is recorded.*

### Step 9 — Grant the robot access to the GA4 property. This is the step everyone forgets

Now leave Google Cloud entirely and go to Google Analytics at `analytics.google.com`.

Click **Admin**, the gear icon in the lower-left of the navigation.

Make sure the **property** shown in the property column is the one you want — not merely
the account. Then, in the property column, open **Property Access Management**.

**What you should be seeing:** a list of people who can see this property, with a blue plus
button in the top right.

Click the plus button, choose **Add users**, paste the service account email from step 6,
and give it the **Viewer** role.

Untick the option to email a notification — there is no inbox behind a robot address.

Click **Add**.

**Read this out:** doing this at the *account* level instead of the *property* level, or
granting a role back in Google Cloud, does not work. It has to be on this property, in this
screen.

*Confirm the service account email now appears in the property's access list.*

### Step 10 — Get the numeric Property ID

Still in **Admin**, in the property column, open **Property details** (some versions label
it *Property settings*). The **Property ID** is shown there as a plain number, for example
`123456789`.

**It is not the Measurement ID.** The Measurement ID looks like `G-XXXXXXX` and appears in
your website tracking code. It is a different thing and will not work here. It is also not
a Universal Analytics view ID from the previous generation of Google Analytics.

Store it:

| Name | Value | Shape |
|---|---|---|
| `PROPERTY_ID` | the number from Property details | `123456789` |

*Confirm you have a plain number with no letters or dashes. Then go to section 4.*

---

## 3. What to choose, with reasons

**The GA4 role — choose Viewer.**

| Role | What it allows | Use it? |
|---|---|---|
| **Viewer** | Read reports and configuration. Change nothing. | **Yes. This is the right choice for reporting.** |
| Analyst | Viewer, plus create and share Explorations and other assets inside GA4. | Only if you have asked the agent to build things inside GA4, which GA4's API largely cannot do anyway. |
| Editor | Change the property's configuration — data streams, events, conversions. | **No. An accidental configuration change in GA4 can break data collection for the entire website, and GA4 does not backfill.** Data lost while a setting was wrong is lost permanently. |
| Administrator | Everything, including managing who else has access. | **No.** |

**Do not grant Editor or Administrator to a reporting identity.** This is the one place in
GA4 where a wrong click causes real, unrecoverable damage: GA4 does not reprocess history,
so a misconfigured data stream loses data for the period it was wrong, and no amount of
fixing afterwards brings it back.

**The data restrictions.** The access screen also offers restrictions such as *No cost
metrics* and *No revenue metrics*. Leave both unticked if the analysis involves spend or
revenue — which it usually does. Ticking them does not produce an error when a restricted
metric is requested; **it produces a response with that metric silently missing**, which is
exactly the failure this pack exists to prevent.

**The Cloud project role — grant none.** The project-level roles offered during step 5 have
no bearing on GA4 data access. Granting `Viewer` or `Editor` on the Cloud project gives the
robot rights over your Cloud resources and still zero rights over your analytics.

---

## 4. How to verify it worked

Run this. It uses the service account key file you stored in step 8.

```bash
curl -s -X POST \
  "https://analyticsdata.googleapis.com/v1beta/properties/$PROPERTY_ID:runReport" \
  -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  -H 'Content-Type: application/json' \
  -d '{"dateRanges":[{"startDate":"7daysAgo","endDate":"yesterday"}],
       "metrics":[{"name":"sessions"}],
       "returnPropertyQuota":true}'
```

**Success looks like** a JSON block containing a `rows` list with one row holding one
number — sessions in the last seven days — plus a `propertyQuota` section:

```json
{"dimensionHeaders":[],"metricHeaders":[{"name":"sessions","type":"TYPE_INTEGER"}],
 "rows":[{"metricValues":[{"value":"18422"}]}],
 "propertyQuota":{"tokensPerDay":{"consumed":1,"remaining":199999}, ...}}
```

**Always ask for `returnPropertyQuota`.** GA4 charges queries against a daily token budget
and without this field you have no view of how much is left. A skill that omits it is
flying blind and will one day stop returning data mid-report.

**Failure looks like** a JSON block with an `error` object containing a `code` and a
`message`. Section 5 translates them.

---

## 5. If it does not work

**"User does not have sufficient permissions for this property" — a 403**

This is step 9, ninety percent of the time. The robot identity was created and the API was
enabled, but it was never added to the property itself. Go back to Admin → Property Access
Management and check the service account email is actually listed **there**, on the
property, not on the account and not in Google Cloud.

The remaining ten percent: it was added to the wrong property. Confirm the property ID in
your test call matches the property you granted access to.

**"Google Analytics Data API has not been used in project … or it is disabled" — also a 403**

This one means what it says: step 3 was skipped, or it was done in a different Cloud project
than the credentials belong to. The message contains an activation link; follow it and check
the project name matches.

**"Requested entity was not found" — a 404**

The property ID is wrong. Most often somebody used the Measurement ID (`G-XXXXXXX`) or an
old Universal Analytics view ID. The Property ID is a plain number with no letters, from
Admin → Property details.

**"Exhausted property tokens" or a 429**

You have spent the property's daily or hourly query budget. GA4 charges more expensive
queries more heavily, particularly those with many dimensions. Read the `propertyQuota`
block in the last successful response to see what remains, and reduce the number of
dimensions rather than retrying. Retrying spends tokens you do not have.

**Numbers come back but they look too round, or a category called "(other)" appears**

Not a connection problem. Free GA4 applies sampling and cardinality limits, and buckets
overflow values into `(other)`. The response carries metadata fields that say when this
happened — the module covers reading them. Report the caveat rather than the bare number.

---

## 6. Security notes

**The JSON key file is the credential, and it is the most sensitive artefact in this
walkthrough.** It is a private key in a plain text file. Anyone holding a copy can read
your analytics as this identity, from anywhere, with no further check.

**Where it goes.** Into your organisation's secrets manager, or a file on the machine that
needs it with permissions restricted to that machine's service user. Not a shared drive,
not an email attachment, not a chat message, not a laptop's downloads folder.

**Never paste its contents anywhere, including this chat.** The service account *email
address* is safe to share. The key file is not. Those two get confused constantly — the
address ends `.iam.gserviceaccount.com` and is fine in a ticket; the file contains a line
beginning `-----BEGIN PRIVATE KEY-----` and is never fine anywhere.

**Never commit it to a code repository.** Google's own scanners find service account keys
in public repositories and will often disable the key automatically — which is helpful and
also means your reporting stops without warning. Add `*.json` key paths to your ignore file
before you move the file anywhere near a repository.

**Rotating it:**

1. In Google Cloud, open the service account → **Keys** → **Add key** → create a second
   JSON key.
2. Update the stored file or secret, and re-run the section 4 test.
3. Delete the old key from the same Keys tab.

In that order, there is no outage. Every six to twelve months is reasonable, and
immediately if the file has been anywhere it should not have been. Consider whether your
organisation can avoid key files entirely by using workload identity federation, which is
the more modern approach and removes the file from the picture.

**If it leaks,** delete the key from the service account's **Keys** tab. That takes effect
immediately. If you cannot tell which key leaked, delete the service account entirely — it
revokes everything at once — then create a new one and repeat steps 5 to 9. Deleting the
service account removes access only; it does not touch any analytics data.

**Reducing what a leak is worth.** Because you granted **Viewer** on **one property** in
step 9, a leaked key reads one property's analytics and nothing else. It cannot change your
GA4 configuration, cannot reach other properties, and cannot touch your Cloud project. That
containment is the reason sections 3 and 9 are strict.
