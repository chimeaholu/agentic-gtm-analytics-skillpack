# Connecting Meta Ads — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Read this out before anything else:**

> **Connecting Meta Ads takes days, not minutes, because part of it is a human at Meta
> reviewing an application. The waiting is unavoidable. What you can do today is everything
> up to the review, and then submit — so start it early and do other work while it is in
> the queue. There is a trap in the middle of this process worth knowing now: everything
> will appear to work on your own advertising account before the review is finished, and
> then return nothing on your client's or your company's account. That is not a bug. It is
> the access level, and the review is what changes it.**

**Time: two to ten days.** Your own hands-on work is an hour or two. The rest is Meta's
review.

**Permission levels:**

1. **Admin on a Meta Business Manager**, the account that owns your company's advertising
   assets. Business Manager is Meta's administrative layer — separate from Facebook,
   separate from the ad account itself.
2. **The advertising account must be owned by, or shared into, that Business Manager.** An
   ad account someone runs from a personal profile is not reachable this way and has to be
   brought into Business Manager first.
3. **A Meta developer account**, which is free and takes a minute to create at
   `developers.facebook.com`.

**If you do not have Business Manager admin,** send whoever does this:

> "We need API access to read our Meta Ads performance data. That needs: a Business-type
> app in Meta for Developers; the ad account linked to our Business Manager; the `ads_read`
> permission approved through App Review for Advanced Access; and a **System User** token
> issued from Business Settings, rather than a personal user token. Could you set this up,
> or make me a Business Manager admin so I can? Please send the token through our password
> manager, not over email or chat."

**Plan or tier:** none. Meta does not gate API access behind a spend level. The gate is the
review.

**Two warnings before starting:**

1. **Meta's developer interfaces change often and the wording moves.** Where this
   walkthrough names a screen, treat the destination as reliable and the exact label as
   approximate. **If a label does not match, use the search box in Business Settings
   rather than hunting.** Tell the agent what you are actually seeing.
2. **This walkthrough grants read access only.** The write permission, `ads_management`,
   can create campaigns, change budgets and set them live. **Mistakes there spend real
   money immediately and there is no undo for money already spent.** Do not request it for
   a reporting connection.

---

## 2. The steps

### Step 1 — Confirm the ad account is in Business Manager

Go to `business.facebook.com` and open **Business settings**.

Under **Accounts → Ad accounts**, confirm the advertising account you want to read is
listed.

**If it is not there, stop.** It has to be added or claimed first, which is a separate task
and often needs the current owner's cooperation. Nothing later in this walkthrough works
without it.

*Confirm the ad account is listed, and note its ID.*

### Step 2 — Create the app

Go to `developers.facebook.com`, sign in, and open **My Apps → Create App**.

When asked for a type or use case, choose the **Business** option. This is what makes the
Marketing API available to the app.

Name it something explanatory, such as `GTM Analytics Agent`.

**What you should be seeing afterwards:** the app's dashboard, with a left-hand menu
containing Settings, App Review, and a list of products.

*Confirm the app is created.*

### Step 3 — Attach the app to your Business Manager

In the app's **Settings → Basic**, there is a field for the business that owns the app.
Set it to your Business Manager.

**Do not skip this.** An app not attached to a business cannot use a System User token,
which is the whole point of step 6.

*Confirm the business is set.*

### Step 4 — Add the Marketing API

From the app dashboard, add the **Marketing API** product to the app.

*Confirm it appears in the app's product list.*

### Step 5 — Request Advanced Access through App Review

Open **App Review → Permissions and Features** in the app's menu.

Find **`ads_read`** and request **Advanced Access**.

Meta asks how your app uses the permission, and usually asks for a screen recording showing
the data being used. **Answer specifically:** an internal reporting tool that reads
performance data from advertising accounts your own organisation manages, for internal
analysis, with no resale and no external users.

Submit it.

**Now read out what the two access levels mean, because this is the part that confuses
everyone:**

- **Standard Access**, which you have automatically, reaches **only advertising accounts
  owned by people who are administrators of this app**. Your own test account works
  perfectly. Your client's account returns nothing, with no clear error.
- **Advanced Access**, which the review grants, reaches accounts your business manages.

**That gap is why a developer's test passes and the real account comes back empty.** If you
see empty results before approval, this is almost certainly why.

*Confirm the review is submitted, and note the date.*

### Step 6 — While you wait: create a System User

Go back to `business.facebook.com` → **Business settings** → **Users** → **System users**.

Click **Add**, name it `gtm-analytics-agent`, and give it the **Employee** role rather than
Admin. A System User is a robot identity belonging to the business rather than to a person.

**This is the step everyone misses, and it is what silently kills scheduled work months
later.** A token generated from your own personal login **expires — sixty days for a
long-lived one** — and dies entirely if you leave the company or change your password. A
System User token does neither. The failure does not happen at setup, which is exactly why
people skip this step and pay for it in week nine.

*Confirm the System User exists.*

### Step 7 — Give the System User access to the ad account

Still on the System users page, with your new System User selected, use **Add assets** (or
the equivalent assign control) to grant it access to the specific ad account from step 1.

Choose **View performance** — read-only — not full control. Section 3 explains why.

*Confirm the ad account is assigned with view-only access.*

### Step 8 — Generate the token

With the System User still selected, click **Generate new token**.

Choose the app you created in step 2, then tick the permissions. Section 3 lists which.
**Read section 3 aloud now**, then come back.

The token appears on screen: a long string, usually starting `EAA`, often several hundred
characters.

**Meta shows it exactly once.** Copy it now. If you lose it, you generate another — nothing
breaks, but this one is gone.

**Do not paste it into this chat, an email or a ticket.** Section 6 says where it goes.

*Confirm the token is copied.*

### Step 9 — Store the token and the account ID

| Name | Value | Shape |
|---|---|---|
| `META_TOKEN` | the token from step 8 | long string, usually starting `EAA` |
| `META_AD_ACCOUNT_ID` | the ad account ID | digits only, no `act_` prefix |
| `META_API_VERSION` | the version you pin | for example `v25.0` |

**A note on the ID that costs people twenty minutes:** the API addresses ad accounts as
`act_123456789`, **with the prefix**. Store the digits and add `act_` in the call, or store
it with the prefix and be consistent — but pick one and be deliberate, because
`123456789` without the prefix returns a confusing not-found error.

*Confirm all three are stored. Then go to section 4.*

### Step 10 — Wait for the review result

Meta notifies the app's contact when the review concludes. **Until Advanced Access is
granted, test against an ad account whose owner is an admin of the app** — that is the only
thing Standard Access can see.

*Confirm the person knows to expect this.*

---

## 3. What to choose, with reasons

### Permissions on the token

| Permission | Take it | Why |
|---|---|---|
| **`ads_read`** | **Yes** | Reads campaign, ad set, ad and insights data. This is the permission the reporting work runs on. |
| **`business_management`** | Usually yes | Lets the token see which ad accounts and assets the business owns. Without it, listing accounts fails even though reading a known account works. |
| `read_insights` | Sometimes | Covers Page and post-level insights. Only needed if organic social performance is in scope as well as paid. |
| **`ads_management`** | **No, for reporting** | **This is the write permission: create campaigns, change budgets, set them live. It spends real money and there is no undo.** Do not request it for a reporting connection. If writes are genuinely wanted later, that is a separate decision with a separate approval. |

### Asset permission on the ad account

| Level | What it allows | Use it? |
|---|---|---|
| **View performance** | Read campaigns, ad sets, ads and their results | **Yes. This is the right choice.** |
| Manage campaigns | Create and edit campaigns, change budgets | **No.** Combined with `ads_management`, this is a robot identity that can spend your advertising budget. |

**These two controls stack, and that is useful.** Even if a permission was requested too
broadly, view-only asset access stops a write from succeeding. Set both narrowly and you
have two independent brakes.

### The token type

| Type | Lifetime | Use it? |
|---|---|---|
| Short-lived user token | about an hour | No |
| Long-lived user token | **about sixty days, then it stops** | **No.** This is the trap. It works at setup, passes every test, and breaks a scheduled report two months later at an unpredictable moment, with an authentication error that looks like something is broken. |
| **System User token** | **does not expire on a timer** | **Yes.** It belongs to the business, not a person, and survives staff changes. |

### The API version

Meta ships roughly three API versions a year, with a support window of about two years.
**Pin the version in configuration and record which version produced each number.** At the
time this was written the documentation referenced v25.0 while community tooling had moved
to v26.0 — **check what is current rather than copying a version out of any document,
including this one.**

---

## 4. How to verify it worked

Run this. It asks for last week's spend and impressions, and prints Meta's throttle header
at the same time:

```bash
curl -sD - "https://graph.facebook.com/$META_API_VERSION/act_$META_AD_ACCOUNT_ID/insights?fields=spend,impressions&date_preset=last_7d&access_token=$META_TOKEN"
```

**Success looks like** HTTP headers followed by a JSON block with a `data` list containing
one row:

```json
{"data":[{"spend":"4821.33","impressions":"1204882","date_start":"...","date_stop":"..."}],"paging":{...}}
```

**Among the headers, find `x-fb-ads-insights-throttle`.** It reports how much of your
capacity you are using. **Read it on every insights call from now on** — Meta throttles
based on account activity and this header is the only warning you get before requests start
being rejected.

**An empty `data` list with a successful response is ambiguous here, unlike most
platforms.** It means either the account genuinely had no spend in that period, **or** you
are on Standard Access looking at an account you cannot reach. Check the access level
before concluding the account was quiet.

**Failure looks like** a JSON block with an `error` object containing `message`, `type` and
`code`. Section 5 translates them.

---

## 5. If it does not work

**"Unsupported get request. Object with ID 'act_…' does not exist, cannot be loaded due to
missing permissions, or does not support this operation." — error code 100**

The most common Meta error and the least informative. It means one of four things:

1. The System User was never assigned to that ad account — step 7.
2. You are on Standard Access and this account is not owned by an app admin — step 5.
3. The `act_` prefix is missing from the account ID.
4. The account ID is wrong.

Check them in that order.

**"(#200) Requires ads_management permission to manage the object" or a permissions error
on a read**

The token does not carry `ads_read`, or the review has not granted Advanced Access yet.
Check the app's App Review page for the current status.

**"Error validating access token: Session has expired"**

You are using a user token rather than a System User token. Sixty days have passed. This is
exactly the failure step 6 exists to prevent — go back and issue a System User token
instead of renewing the user one, otherwise you are booking the same outage for two months
from now.

**"(#17) User request limit reached" or "(#80004) There have been too many calls"**

Rate limiting. Meta's limits depend on account activity, not a fixed number. Read the
`x-fb-ads-insights-throttle` header, slow down, and for large pulls use the asynchronous
insights job rather than many synchronous requests. Retrying hard makes the throttle worse.

**Your test account works and the client's account returns nothing**

Standard Access, every time. This is the defining Meta confusion. The review in step 5 is
what fixes it, and nothing else does.

**An error about an unsupported or deprecated API version**

Meta retires versions on about a two-year clock. Move to a current version and treat it as
configuration, not a constant.

---

## 6. Security notes

**Where the token goes.** Into your organisation's secrets manager, or an environment
variable on the machine that needs it. Not a spreadsheet, not a shared document, not a chat
message.

**Never paste it into a chat window, including this one.** Meta tokens are recognisable by
their `EAA` prefix and are actively hunted for.

**Never put it in a web address that gets logged.** The verification call in section 4
passes the token as a query parameter because that is Meta's documented form — **and query
parameters end up in server logs, proxy logs and browser history.** For anything beyond a
one-off test, send it as an `Authorization: Bearer` header instead. This is a genuine
difference from most platforms in this pack and worth changing in production code.

**Never commit it to a repository.**

**What this token can reach.** The advertising accounts assigned to the System User, at the
permission level you granted. If you followed section 3 — `ads_read` and view-only asset
access — a leak exposes performance data. If someone took `ads_management` with manage
access, a leak means someone can spend your advertising budget. That difference is worth
confirming before you finish.

**Rotating it:**

1. Business settings → Users → System users → select the System User → **Generate new
   token**, with the same app and permissions.
2. Update the stored value and re-run the section 4 test.
3. Meta System Users also offer a control to revoke previously issued tokens — use it once
   the new token is confirmed working.

Every six to twelve months is reasonable, and immediately whenever someone with access
leaves.

**If it leaks:**

1. Go to the System User and **revoke its tokens**. This takes effect immediately.
2. **Check the ad account's activity history** — in Ads Manager, the account activity or
   change history — for changes you did not make. Do this even if the token was read-only,
   so you know for certain.
3. Generate a replacement token and update the stored value.
4. If the leaked token had `ads_management`, also review recent spend for anything
   unexpected and contact Meta support.

**Ownership.** A System User token has no person attached, which is the point — it survives
staff changes. Record who is responsible for it anyway. An unowned token that works forever
is how a credential outlives everyone who remembers what it was for.
