# Connecting Google Ads — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Read this paragraph out before anything else, because it changes whether the person
should start today at all:**

> **Google Ads takes three days to three weeks to connect, and most of that is a human at
> Google reading an application and deciding whether to approve it. You cannot pay to speed
> it up, you cannot escalate it, and the application can be rejected and need resubmitting.
> This is the slowest connection in the pack by a wide margin. If you need Google Ads data
> for something, start the application today and do the rest of your analytics work while
> it is in the queue.**

Nobody should discover this on day four of a two-week project. Say it first.

**Time: three days to three weeks.** Your own hands-on work is about an hour. Everything
else is waiting.

**Permission levels — two of them:**

1. **Administrative access to a Google Ads manager account.** A manager account, still
   widely called an **MCC** (My Client Center), is a Google Ads account that sits above
   other Google Ads accounts and manages them. **The developer token — the credential this
   whole process is about — can only be requested from a manager account, not from an
   ordinary advertising account.** If your company has no manager account, one has to be
   created first, and the accounts you want to read must be linked underneath it.
2. **Permission to create a project in Google Cloud** and create OAuth credentials there.

**If you have neither,** send whoever runs your paid search this:

> "We need API access to Google Ads. That requires a developer token, which is applied for
> from our manager (MCC) account under Admin → API Center, and which Google reviews by hand
> over several days. Could you either start that application or give me administrative
> access to the manager account so I can? We also need the accounts we are reporting on to
> be linked under that manager account."

**Plan or tier:** no Google Ads spend minimum applies to getting a token, but see the
access levels in section 3 — **the level you are granted decides whether you can reach
production accounts at all**, and the starting level cannot.

**Cost warning:** this walkthrough grants **read** access only. That is deliberate and it
matters. The Google Ads API can change budgets, pause campaigns and create ads. **A mistake
made with write access spends real money, immediately, and there is no undo for money
already spent.** If someone offers you a configuration with write scopes for a reporting
task, decline it.

---

## 2. The steps

### Step 1 — Confirm you have a manager account and the right accounts are under it

Sign in to Google Ads. A manager account shows a list of accounts it manages rather than a
single account's campaigns.

Confirm the advertising accounts you want to read are linked beneath it. If they are not,
link them first — the API will not reach an account the manager account does not manage.

*Confirm you are in a manager account and can see the accounts you need.*

### Step 2 — Open the API Center

In the Google Ads interface, open the administrative settings for the manager account and
find **API Center**.

**The navigation here has changed between Google Ads interface versions.** On current
versions it is under **Admin**; on earlier versions it lived under the **Tools and
Settings** wrench icon, in the Setup column. **If you cannot find it, use the search box at
the top of Google Ads and type `API Center`.** Do not hunt through menus.

**If API Center is not offered at all, you are not in a manager account.** Go back to
step 1.

**What you should be seeing:** a page about API access, either offering an application
form or showing an existing developer token and its access level.

*Confirm you can see API Center.*

### Step 3 — Apply for the developer token

Complete the application form.

Google asks what your tool does, who uses it, and how it will use the API. **Answer this
carefully and specifically.** A vague answer is the main reason applications get rejected
or sent back, and each round trip costs days.

Describe it plainly: an internal reporting tool that reads campaign performance data from
accounts your organisation manages, for internal analysis, with no data resold and no
external users. If the tool is internal-only, say so explicitly — internal tools have a
simpler path than tools offered to third parties.

Submit it.

*Confirm it is submitted, and note the date.*

### Step 4 — Copy the developer token and note its access level

API Center now shows a **developer token** — a string of letters, numbers, dashes and
underscores, roughly twenty-two characters.

**It also shows an access level, and the level is more important than the token.** Read it
out. Section 3 explains what each level can and cannot do. **At the starting level the
token cannot reach any production advertising account**, which means a test that fails at
this point may be working exactly as designed.

Store the token:

| Name | Value |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | the token from API Center |

*Confirm you have the token and know the access level.*

### Step 5 — While you wait: set up Google Cloud

The remaining steps do not depend on the approval, so do them now.

Go to `console.cloud.google.com`, sign in with your work account, and select or create a
project using the project selector in the top bar. Name a new one something like
`gtm-analytics`.

*Confirm the right project name is shown in the top bar.*

### Step 6 — Turn on the Google Ads API

In the Cloud console search box, type `Google Ads API`, open the API's page in the library,
and click **Enable**.

*Confirm it says enabled.*

### Step 7 — Configure the consent screen

In the search box type `OAuth consent screen` and open it.

Choose **Internal** if your organisation uses Google Workspace and only your own staff will
sign in — this avoids a separate Google verification process. Choose **External** only if
that is genuinely not possible; **External adds its own review step and more waiting.**

Fill in the application name and a support email address, and save.

*Confirm the consent screen is configured.*

### Step 8 — Create the OAuth client

In the search box type `Credentials`, open it, then choose **Create credentials → OAuth
client ID**.

For application type, choose **Desktop app**. This is the workable choice for a
server-to-server reporting tool, because it allows the one-time browser sign-in that
produces a long-lived refresh token.

Name it `gtm-analytics-agent` and create it.

A dialog shows a **Client ID** (ending `.apps.googleusercontent.com`) and a **Client
secret**. Copy both.

**Do not paste them into this chat.** Section 6 says where they go.

*Confirm you have both.*

### Step 9 — Produce a refresh token

A refresh token is a long-lived credential that lets the tool obtain fresh short-lived
access tokens without anyone signing in again.

Getting one requires signing in once, in a browser, as a Google user who can see the ads
accounts. Google's own `google-ads-python` library ships a helper script for exactly this,
and using the official helper is more reliable than assembling the sign-in by hand.

**Sign in as the right account.** The refresh token inherits that person's access. If they
lose access to the ads accounts, every scheduled report stops.

Copy the refresh token from the script's output.

*Confirm you have a refresh token.*

### Step 10 — Find the customer IDs

In Google Ads, each account's ID appears as ten digits with dashes, like `123-456-7890`.

**The API wants them with the dashes removed:** `1234567890`. Strip them.

You need two IDs, and confusing them causes hours of wasted debugging:

- **the customer ID** — the advertising account holding the data you want
- **the login customer ID** — your **manager** account's ID

*Confirm you have both, dash-free.*

### Step 11 — Assemble the configuration

Five values, all together:

| Name | Value | Shape |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | from API Center | 22-ish characters |
| `GOOGLE_ADS_CLIENT_ID` | from step 8 | ends `.apps.googleusercontent.com` |
| `GOOGLE_ADS_CLIENT_SECRET` | from step 8 | random string |
| `GOOGLE_ADS_REFRESH_TOKEN` | from step 9 | long string, often starting `1//` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | manager account ID | `1234567890`, no dashes |

**The last one is the step everyone misses.** If you operate under a manager account and
omit the login customer ID, Google returns `USER_PERMISSION_DENIED` — which points you at
permissions, when the actual problem is a missing configuration line. People lose hours to
this, checking and re-checking access that was fine all along.

*Confirm all five are stored. Then go to section 4.*

### Step 12 — Wait for the approval email

Google emails the contact on the application when the token's access level changes. Until
then, your token is at the starting level and cannot reach production accounts.

*Confirm the person knows to expect this, and roughly when.*

---

## 3. What to choose, with reasons

### The access levels — the thing that actually gates you

| Level | What it can do | What to expect |
|---|---|---|
| **Test** | **Cannot reach production advertising accounts at all.** Test accounts only. | Where every token starts. A test failing at this level is the system working correctly, not a setup mistake. |
| **Explorer** *(availability varies)* | Limited production access with a low operation cap. | An intermediate step Google has introduced to shorten the gap between Test and Basic. **Whether it is offered varies — read what API Center actually shows rather than assuming.** |
| **Basic** | Production access, capped at **15,000 operations per day**. | What most internal reporting tools need and get. Each step up is a separate application. |
| **Standard** | Production access with a much higher cap. | Apply only if Basic's cap is genuinely reached, and expect to justify why. |

**Each level is a separate, human-reviewed, rejectable application.** Ask for Basic when
Basic is what you need; do not ask for Standard on the theory that more is better, because
a weaker justification is likelier to be rejected and rejection costs days.

### The OAuth scope

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/adwords` | The only scope the Google Ads API uses. There is no separate read-only variant, so this scope technically permits writes. |

**Because the scope does not distinguish reading from writing, the safety boundary has to
be enforced somewhere else.** Two places to enforce it:

- **Grant the signing-in Google user read-only access in Google Ads.** Google Ads has a
  **Read only** account access level. A refresh token minted by a read-only user cannot
  change anything, no matter what the code asks for. **This is the strongest control
  available and it is worth doing.**
- **Route any write through a deliberate approval step**, never through automated code.

**Say this out loud: a mistake with write access to Google Ads spends real money
immediately.** A wrongly set budget, a paused campaign, an enabled experiment — all of it
is live, and money spent cannot be recovered. Read-only is not caution for its own sake.

### Service account or OAuth?

**Use OAuth with a refresh token.** Service accounts are technically possible here but
require domain-wide delegation, which is an awkward Workspace-wide configuration most
administrators decline. The refresh token path is the mainstream one and the one Google's
own tooling assumes.

Its cost is that the credential is bound to a person. Record who, so that when they change
role somebody knows why the reports stopped.

---

## 4. How to verify it worked

**Only meaningful once the token has reached Basic or above.** At Test level this fails by
design.

The Google Ads API uses gRPC and is awkward to call with a plain command line, so the
honest verification is a few lines of Python using Google's own client library:

```python
from google.ads.googleads.client import GoogleAdsClient

client = GoogleAdsClient.load_from_env()          # reads the five values from step 11
service = client.get_service("GoogleAdsService")

rows = service.search(
    customer_id="1234567890",                      # the advertising account, no dashes
    query="SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
)
for row in rows:
    print(row.customer.id, row.customer.descriptive_name)
```

**Success looks like** one line printing the account's ID and its name:

```
1234567890 Example Advertising Account
```

That confirms all five configuration values, the token's access level, and the account
link, in one call.

**Failure looks like** a `GoogleAdsException` naming an error code. Section 5 translates
the common ones.

---

## 5. If it does not work

**`DEVELOPER_TOKEN_NOT_APPROVED`**

Your token is still at Test level and cannot reach production accounts. This is not a
misconfiguration. Wait for Google's email, or check API Center for the current level.

**`USER_PERMISSION_DENIED`**

**Check the login customer ID before you check any permissions.** Under a manager account,
a missing `login_customer_id` produces exactly this error, and the message points at
permissions rather than at the configuration line that is actually missing. Set it to the
manager account's ID, dash-free, and try again.

If it is already set: the Google user behind the refresh token genuinely cannot see that
advertising account, or the account is not linked under the manager account.

**`CUSTOMER_NOT_FOUND`, or an error about the customer ID format**

Almost always the dashes. `123-456-7890` is the interface format; the API wants
`1234567890`. It can also mean the account is not linked under your manager account.

**`DEVELOPER_TOKEN_PROHIBITED`**

The token is being used in a way its terms do not allow — most often a token issued to one
organisation being used against another organisation's accounts. Tokens are not portable
between companies. Apply for one from the manager account that actually manages these
accounts.

**An error naming an unsupported or sunset API version**

**Google Ads API versions sunset on roughly a twelve-month clock, with about three releases
a year.** A hard-coded version has an expiry date. Upgrade the client library and treat the
version as configuration, recording which version produced each number.

**`RESOURCE_EXHAUSTED` or a quota error**

You have hit the daily operation cap — 15,000 at Basic level. Reduce the number of
requests, or apply for Standard with a justification. Retrying does not help; the cap is
daily.

---

## 6. Security notes

**Where the credentials go.** All five values belong in your organisation's secrets
manager, or in environment variables on the machine that needs them. Google's client
library reads them from environment variables or from a configuration file — **if you use a
file, make sure it is not inside a code repository.**

**Never paste them into a chat window, including this one.** The refresh token is the
sensitive one: it is long-lived and it stands in for a person's sign-in.

**Never commit them to a repository.** A developer token in a public repository can be used
by others against your organisation's accounts and can get your token revoked by Google,
which puts you back at the start of a multi-week application.

**What these credentials can reach.** Every advertising account under your manager account
that the signing-in user can see. If the refresh token was minted by a full-access user,
that includes the ability to change campaigns and budgets — which is why section 3 pushes
you toward minting it as a read-only user.

**Rotating them:**

- **Client secret:** Cloud console → Credentials → your OAuth client → rotate or recreate
  the secret. The existing refresh token stops working, so you must mint a new one and
  update both values together.
- **Refresh token:** re-run step 9 to mint a fresh one, update the stored value, then
  revoke the old one at `myaccount.google.com/permissions`.
- **Developer token:** **do not rotate casually.** Getting a replacement means going
  through the approval process again, with the same multi-day wait. Rotate only after an
  actual leak.

**If it leaks:**

1. **Revoke the refresh token immediately** at `myaccount.google.com/permissions` under the
   signing-in account, removing access for the OAuth client. This is the fastest
   containment and it does not cost you the developer token.
2. Rotate the client secret in the Cloud console.
3. **Check the Google Ads change history for every affected account** — Tools → Change
   history — for changes you did not make. This matters more here than on any other
   platform in this pack, because unauthorised changes here spend money.
4. Contact Google Ads support if the developer token itself was exposed.

**Ownership.** The refresh token is bound to a person. Write down who, note it somewhere
your team will look when reports break, and plan to re-mint it before that person changes
role rather than after.
