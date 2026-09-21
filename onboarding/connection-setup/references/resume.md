# Resuming a half-finished setup

**Load this whenever someone returns to a setup that is not finished**, or says any of:
"I think I already did some of this", "someone set this up before", "it used to work",
"I got a key but I don't know if it works", "I'm still waiting on approval".

**The rule: never restart from step 1 without checking what already exists.** Redoing
completed work is the fastest way to make a person conclude the tool is not worth the
trouble.

---

## The three questions, in this order

### 1. "Do you have a credential already — a key, token, or file — even if you're not sure it works?"

**If yes, run the verification call from the walkthrough's section 4 immediately.**

This is the most efficient move available. A failing credential names the incomplete step
in seconds, more reliably than any amount of asking what they remember doing. Do not ask
them to paste the credential — ask them to put it in the environment variable the
walkthrough names, and run the call.

### 2. "Did you submit an application?"

Relevant for **Google Ads, Meta Ads and LinkedIn Ads** only.

Check the actual status in the vendor console:

| Platform | Where to look |
|---|---|
| Google Ads | The manager account's **API Center** — it shows the developer token's current access level |
| Meta Ads | The app's **App Review → Permissions and Features** page |
| LinkedIn Ads | The app's **Products** tab |

**If it is still pending, there is nothing to do and saying so is the entire answer.** Do
not invent work to fill the wait. Offer to connect something in the minutes band instead,
so the session produces a real result.

### 3. "Did you get as far as asking an administrator?"

If it is blocked on a person, offer the prepared request wording from **section 1 of the
platform's walkthrough** again — they may never have sent it, or it may have been sent in
a form the administrator could not act on. Then offer a fast platform meanwhile.

---

## Symptom to step

**Use the error to find the step. Resume there, not at the beginning, and say why.**

### PostHog

| Symptom | Resume at | Why |
|---|---|---|
| 401 | Step 1, the region | A US key against the EU host produces exactly this. Check the host before the key. |
| 403 | Step 6, the scopes | The key lacks `query:read`. **Scopes cannot be edited on an existing personal API key — a new key is needed.** Two minutes. |
| 404 | Step 9, the project ID | Wrong ID, or the key was scoped to a different project. List the projects the key can reach. |
| "Invalid token" but they are sure it is right | Step 8, which key | Check the first four characters. `phc_` is the website's ingestion token and can never read anything. |

### HubSpot

| Symptom | Resume at | Why |
|---|---|---|
| 403 naming a scope | Section 3, the scopes | **Editable on the existing app, and the token does not change. Say that — people assume they must start over.** |
| 401 | Step 8, how it is sent | Must be `Authorization: Bearer`, not a query parameter. Often an adapted `hapikey` script. |
| Anything mentioning `hapikey` | Step 1 | That method was switched off permanently in November 2022. Whatever they are following is dead. |
| 404 on a documentation link | Not their error | HubSpot reorganised its docs and moved to date-based API versions during 2026. Look up the current path. |

### Salesforce

| Symptom | Resume at | Why |
|---|---|---|
| 401 INVALID_SESSION_ID | Step 13, the instance address | **Check the host before the token.** Using `login.salesforce.com` instead of the returned `instance_url` produces this. |
| API_DISABLED_FOR_ORG | Step 10, the permission set | Missing **API Enabled** — or the edition lacks API access, which is a purchase, not a setting. |
| A missing column, no error at all | Step 10, field-level security | **Nothing in the response reveals this.** The field is absent. |
| invalid_client_id right after creating the app | Step 7, the wait | New Connected Apps take two to ten minutes to propagate. Wait before changing anything. |

### GA4

| Symptom | Resume at | Why |
|---|---|---|
| **403 "insufficient permissions for this property"** | **Step 9, the property grant** | **Nearly always this.** The Cloud half was done and the Analytics half was not. |
| 403 "API has not been used in project" | Step 3 | The Data API was not enabled, or was enabled in a different Cloud project than the credentials belong to. |
| 404 "Requested entity was not found" | Step 10, the property ID | Usually the Measurement ID (`G-XXXXXXX`) was used instead of the numeric Property ID. |
| 429 exhausted tokens | Not a setup problem | The property's query budget is spent. Reduce dimensions; retrying spends what is left. |

### Google Ads

| Symptom | Resume at | Why |
|---|---|---|
| DEVELOPER_TOKEN_NOT_APPROVED | Step 12, the wait | **Working as designed at Test level.** Nothing to fix. |
| **USER_PERMISSION_DENIED** | **Step 11, the login customer ID** | **Check this before checking any permissions.** The error names permissions; the cause is a missing configuration line. |
| CUSTOMER_NOT_FOUND | Step 10, the ID format | Dashes must be stripped: `1234567890`, not `123-456-7890`. |
| An unsupported version error | Not a setup problem | Versions sunset on a roughly twelve-month clock. Upgrade the client library. |

### Meta Ads

| Symptom | Resume at | Why |
|---|---|---|
| Error 100 "object does not exist or cannot be loaded" | Steps 7, 5, 9, in that order | System User not assigned to the account; or Standard Access; or the missing `act_` prefix; or a wrong ID. |
| **Empty results on the account they care about** | **Step 5, the access tier** | Standard Access reaches only accounts owned by app admins. The review is the only fix. |
| "Session has expired" on something that worked for two months | **Step 6, the System User** | They used a personal user token. Sixty days elapsed. **Issue a System User token rather than renewing — otherwise the same outage is booked for two months from now.** |
| Error 17 or 80004 | Not a setup problem | Rate limited. Read `x-fb-ads-insights-throttle` and slow down. |

### LinkedIn Ads

| Symptom | Resume at | Why |
|---|---|---|
| Parsing or field errors on a correct-looking query | Section 3, the headers | Missing `LinkedIn-Version` or `X-Restli-Protocol-Version: 2.0.0`. **The most common confusing failure on this platform.** |
| 401 on something that used to work | Step 8, the tokens | Access tokens last about sixty days. If the refresh token has also expired, at about a year, **the human from step 7 must sign in again.** |
| 403 | Step 4, the review | Marketing Developer Platform not yet approved, or the permission was not granted at sign-in. |
| **Empty results on the account they care about** | **Step 4, the access tier** | Development tier reaches only accounts the signing-in person administers. |
| "Version no longer supported" | Not a setup problem | The `YYYYMM` version sunsets after about a year. |

### Marketo

| Symptom | Resume at | Why |
|---|---|---|
| Error 603 "Access denied" | Step 2, the role permissions | The credential is fine. **Editable without new credentials — say so.** |
| Error 601 | Step 6, the host | The Munchkin ID in the address is wrong. There is no shared Marketo host. |
| Error 602 | Section 3, token caching | The hour elapsed. Refresh proactively, not on failure. |
| **Error 607 daily quota** | **Stop and escalate** | **The allowance is shared across the whole subscription. Other integrations may be failing right now.** Tell the administrator before doing anything else. |
| **Returns far less data than expected, no errors** | Step 2, the role | **Marketo permission failures are silent by design.** Run `leads/describe.json` to see what the role can actually reach. |

---

## Telling a pending approval from a broken setup

**This distinction is the most valuable judgement in a resume conversation**, because the
two look identical from the chat and need opposite responses.

| It is a **pending approval** when | It is a **broken setup** when |
|---|---|
| The platform is Google Ads, Meta or LinkedIn | Any other platform |
| Their **own** account works and the target account returns nothing | Nothing works anywhere |
| The vendor console shows a review in progress | The vendor console shows the access already granted |
| Errors are about access level or tier | Errors name a specific missing scope, permission or field |

**If it is pending: say so, give the realistic remaining wait, and connect a
minutes-band platform in the same session.** Do not manufacture work to fill the wait, and
do not let the person leave with nothing but a queue position.

**If it is broken: find the step from the table above and resume there.** Say which step
and why, so they understand this is a two-minute fix rather than a restart — because
believing it is a restart is what makes people stop.
