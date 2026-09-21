# Connecting LinkedIn Ads — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Read this out before anything else:**

> **Connecting LinkedIn Ads takes days, because LinkedIn reviews the application by hand.
> There is also something specific about LinkedIn worth deciding on before you start: it
> has no robot-identity option. Every credential is bound to a named human being. When that
> person leaves, changes role, or does not re-approve the access within about a year, every
> scheduled report stops. Decide now whose account this will be and who is responsible for
> renewing it, because that decision is much harder to change afterwards.**

**Time: two to ten days.** Your own hands-on work is about an hour. The rest is review.

**Permission levels — three things, and the first one surprises people:**

1. **Administrator of a LinkedIn Page.** LinkedIn requires every developer app to be
   associated with a Company Page that you administer. **No Page admin rights, no app.**
   This blocks people at step 1 more than any other requirement.
2. **Access to the LinkedIn advertising accounts** you want to read, through Campaign
   Manager.
3. **A LinkedIn account in good standing** to create the developer app.

**If you are not a Page administrator,** send whoever is this:

> "To connect our LinkedIn Ads data I need to create a developer app, and LinkedIn requires
> every app to be linked to a Company Page administered by the creator. Could you add me as
> an admin on the `<page name>` Page, or create the app yourself? We also need to apply for
> the Marketing Developer Platform, which LinkedIn reviews over several days."

**Plan or tier:** no advertising spend minimum. The gate is the review.

**Two warnings:**

1. **Before approval, you get Development-tier access to your own advertising accounts
   only.** Your test works. The account you actually care about returns nothing. That is
   the access tier, not a mistake — and it is the single most common source of confusion
   here.
2. **LinkedIn's developer portal and its API version headers change regularly.** Where this
   walkthrough names a screen, the destination is reliable and the exact label may have
   moved. Say what you are actually seeing.

---

## 2. The steps

### Step 1 — Confirm you administer a LinkedIn Page

Open LinkedIn and check that you appear as an admin on your company's Page.

**If you do not, stop here and get that access first.** Nothing else in this walkthrough is
possible without it.

*Confirm you are a Page admin.*

### Step 2 — Create the developer app

Go to `developer.linkedin.com`, sign in with your LinkedIn account, and open **My apps →
Create app**.

Fill in:

- **App name:** something explanatory, such as `GTM Analytics Agent`
- **LinkedIn Page:** the Page from step 1 — this is the required association
- **Privacy policy URL:** LinkedIn asks for one; it must be a real, reachable address
- **App logo:** required, any company logo image

Create the app.

*Confirm the app exists and shows your Page.*

### Step 3 — Verify the app against the Page

On the app's **Settings** tab there is a verification step: LinkedIn generates a link that
a Page admin must open and approve.

If you are the Page admin, open it yourself and approve. If someone else is, send them the
link.

**Until this is verified, the app cannot request products.**

*Confirm the app shows as verified.*

### Step 4 — Request the Marketing Developer Platform

Open the app's **Products** tab.

Find the advertising product — listed as **Advertising API** or **Marketing Developer
Platform** depending on the portal version — and request access.

LinkedIn asks what your application does. **Answer specifically:** an internal reporting
tool that reads advertising performance from accounts your own organisation manages, for
internal analysis, with no resale and no external users.

Submit it.

**Now read the access tiers out, because this is the confusing part:**

- **Development tier**, which you have immediately, reaches **only advertising accounts
  that your own LinkedIn user administers.** Your own test account works.
- **Standard tier**, granted by the review, reaches the accounts your business manages.

*Confirm it is submitted, and note the date.*

### Step 5 — While you wait: collect the app credentials

On the app's **Auth** tab you will find a **Client ID** and a **Client Secret**.

Copy both. **Do not paste them into this chat.** Section 6 says where they go.

*Confirm you have both.*

### Step 6 — Set the redirect address

Still on the **Auth** tab, add an authorised redirect address — where LinkedIn sends the
browser back to after someone signs in.

For local command-line tooling, `http://localhost:8080/callback` is a conventional choice.
If your organisation has a standard, use that. It must match exactly, character for
character, when you sign in.

*Confirm it is saved.*

### Step 7 — Decide whose account this is

**Stop and have this conversation before signing in, not after.**

The person who completes the sign-in in step 8 is the person the credential belongs to.
Everything the integration can read is what they can read, and when their access changes,
the integration's access changes with it.

Pick someone who:

- has stable, long-term access to the advertising accounts
- is not about to change role
- will be reachable in about a year when the refresh token expires and needs re-approving

**Write their name down next to the credentials.** In eleven months, when reports stop and
nobody remembers whose sign-in this was, that note is what saves the afternoon.

*Confirm who it is, and that it is recorded.*

### Step 8 — Complete the sign-in

Run the three-legged OAuth sign-in: the chosen person opens LinkedIn's authorisation page
in a browser, approves the requested permissions, and LinkedIn returns a code that your
tool exchanges for tokens.

The response contains:

- an **access token** — short-lived, commonly about sixty days
- a **refresh token** — longer-lived, commonly about three hundred and sixty-five days,
  which your tool uses to obtain new access tokens without anyone signing in again

Section 3 lists which permissions to request. **Read section 3 aloud before doing this.**

*Confirm you have both tokens.*

### Step 9 — Find the advertising account URNs

In LinkedIn Campaign Manager, each advertising account has a numeric ID.

**The API does not take the bare number. It takes a URN — a structured identifier —
shaped like this:**

```
urn:li:sponsoredAccount:123456789
```

Build it from the numeric ID. Passing the bare number is a routine early mistake and
produces an unhelpful error.

*Confirm you have the URN.*

### Step 10 — Store everything

| Name | Value | Shape |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | from step 5 | random string |
| `LINKEDIN_CLIENT_SECRET` | from step 5 | random string |
| `LINKEDIN_ACCESS_TOKEN` | from step 8 | long string |
| `LINKEDIN_REFRESH_TOKEN` | from step 8 | long string |
| `LINKEDIN_ACCOUNT_URN` | from step 9 | `urn:li:sponsoredAccount:123456789` |
| `LINKEDIN_VERSION` | the API version you pin | `YYYYMM`, for example `202509` |

**About `LINKEDIN_VERSION`:** LinkedIn versions its API by month, as a six-digit string,
and **each version sunsets after roughly a year.** A hard-coded version has an expiry date
built in. Treat it as configuration and record which version produced each number.

*Confirm everything is stored. Then go to section 4.*

### Step 11 — Set a renewal reminder now

**Do this before you close the laptop.** Put a calendar reminder about eleven months out,
assigned to the person from step 7, saying: *re-approve LinkedIn Ads API access or the
reports stop.*

Nothing else in this walkthrough needs a calendar entry. This one does, because the failure
lands a year later on a person who has forgotten the whole process ever happened.

*Confirm the reminder exists.*

---

## 3. What to choose, with reasons

### The permissions to request at sign-in

| Permission | Take it | Why |
|---|---|---|
| **`r_ads_reporting`** | **Yes** | The permission that reads campaign performance numbers. This is what the reporting work runs on. |
| **`r_ads`** | **Yes** | Reads the campaign structure — accounts, campaigns, creatives. Without it you get numbers with no names attached to them. |
| `r_organization_social` | Only if needed | Organic Page posts and their engagement. Only if organic social is in scope alongside paid. |
| **`rw_ads`** | **No, for reporting** | **The write permission: create and modify campaigns, change budgets.** A reporting connection does not need it, and a mistake with it spends real advertising money with no undo. |

**Request the narrowest set that answers the question.** LinkedIn's review asks what you
need each permission for, and a narrow, well-justified request is approved more readily
than a broad one — so restraint here is faster as well as safer.

### The two headers every request needs

LinkedIn rejects requests missing either of these, with errors that do not obviously say
so:

| Header | Value | Why |
|---|---|---|
| `LinkedIn-Version` | a `YYYYMM` string, for example `202509` | Selects the API version. **Sunsets after about a year.** |
| `X-Restli-Protocol-Version` | `2.0.0` | Selects the request encoding. **Omitting it produces parsing errors that look like malformed queries.** |

**These two are the most common cause of "the credentials are right and nothing works".**

### The thing LinkedIn does not offer, and what to do about it

**There is no service account, no system user, and no robot identity of any kind.** Every
credential is bound to a person. Meta has System Users; Salesforce has integration users;
LinkedIn has neither.

What you can do:

- **Use an account that will not churn.** A long-tenured person, ideally one whose role
  includes owning this reporting.
- **Set the renewal reminder** from step 11.
- **Alert on authentication failures.** A scheduled report that stops quietly is worse than
  one that stops loudly. Make the failure visible on the day it happens.
- **Write the owner's name next to the credentials**, where whoever inherits this will
  find it.

This is a real, permanent limitation of the platform, not something you have configured
wrong. Plan around it rather than looking for a setting that removes it.

---

## 4. How to verify it worked

Run this. Note both headers — they are not optional:

```bash
curl -s -H "Authorization: Bearer $LINKEDIN_ACCESS_TOKEN" \
  -H "LinkedIn-Version: $LINKEDIN_VERSION" \
  -H "X-Restli-Protocol-Version: 2.0.0" \
  "https://api.linkedin.com/rest/adAccounts?q=search"
```

**Success looks like** a JSON block with an `elements` list containing advertising accounts,
each with an `id`, a `name` and a `status`:

```json
{"elements":[{"id":123456789,"name":"Example Ads Account","status":"ACTIVE","type":"BUSINESS"}],"paging":{...}}
```

**An empty `elements` list is ambiguous here.** It means either the signing-in person has
no advertising accounts, **or** you are on the Development tier and the accounts you want
are not ones they personally administer. Check the tier before concluding anything.

**Failure looks like** a JSON block with a `status`, a `message` and a `serviceErrorCode`.
Section 5 translates them.

---

## 5. If it does not work

**"Empty oauth2 access token" or a 401**

The token is missing, expired, or sent incorrectly. LinkedIn access tokens are short-lived
— commonly about sixty days — so if this appears on a connection that used to work, the
access token has expired and the refresh token needs to be used to obtain a new one.

If the refresh token has *also* expired, at around a year, **the human from step 7 has to
sign in again.** There is no way around that.

**"Not enough permissions to access: GET /rest/adAccounts" — a 403**

Either the permission was not granted at sign-in, or the Marketing Developer Platform
application has not been approved yet. Check the app's **Products** tab for the current
status before changing anything.

**Requests fail with parsing or field errors, and the query looks correct**

You are missing one of the two required headers. Check both `LinkedIn-Version` and
`X-Restli-Protocol-Version: 2.0.0` are present on every request. This is the most common
cause of confusing failures on LinkedIn.

**An error saying the version is no longer supported**

The `YYYYMM` version string has sunset, which happens after about a year. Move to a current
version and treat it as configuration rather than a constant.

**Your test works and the account you care about returns nothing**

Development tier. Until the Marketing Developer Platform application is approved, you reach
only advertising accounts that the signing-in person administers. The review is the only
fix.

**Reporting returns fewer rows than expected, or truncates**

Not a connection problem. LinkedIn's analytics endpoint has structural limits — a cap on
elements per response and no general pagination on some reporting surfaces. The module
covers the query constraints. Do not read a truncated response as a complete answer.

---

## 6. Security notes

**Where the credentials go.** Client ID, client secret, access token and refresh token all
belong in your organisation's secrets manager, or environment variables on the machine that
needs them. Not a spreadsheet, not a shared document, not a chat message.

**Never paste them into a chat window, including this one.**

**Never commit them to a repository.**

**What these credentials can reach.** Everything the signing-in person can see in LinkedIn
advertising, at the permissions granted. **This is a particular consideration on LinkedIn,
because the credential is a person's access rather than a scoped robot's.** If that person
administers accounts beyond the ones you intended to report on, the token reaches those
too. Worth checking rather than assuming.

**Rotating them:**

- **Access token:** obtained fresh from the refresh token whenever needed. No human
  involvement.
- **Refresh token:** expires after roughly a year and **the human from step 7 must sign in
  again** to produce a new one. This is the renewal the reminder in step 11 protects.
- **Client secret:** the app's **Auth** tab allows regenerating it. The existing tokens
  stop working, so plan the re-sign-in at the same time.

**If it leaks:**

1. **Regenerate the client secret** on the app's Auth tab. This invalidates tokens issued
   under the old secret, which is the fastest containment available.
2. Have the person from step 7 review their LinkedIn account's connected applications and
   remove anything unexpected.
3. Complete a fresh sign-in to produce new tokens, and update the stored values.
4. If `rw_ads` was ever granted, **check Campaign Manager's change history for campaign or
   budget changes you did not make** before doing anything else.

**Ownership, one more time.** LinkedIn is the platform in this pack most likely to break
because of a staffing change rather than a technical fault. The name recorded in step 7 and
the reminder set in step 11 are not paperwork — they are the two things that keep this
connection alive past its first year.
