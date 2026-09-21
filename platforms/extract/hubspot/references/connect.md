# Connecting HubSpot — guided walkthrough

**Read this aloud one step at a time. Wait for the person to confirm each step before
reading the next one. Do not read the whole list out at once.**

---

## 1. What you will need before starting

**Time: about thirty minutes if you are a Super Admin and nothing surprises you. Budget an
hour.** Nothing here is reviewed by a human and there is no waiting queue — the time goes
on choosing permissions correctly, which is the part that quietly ruins setups done in a
hurry.

**Permission level: you must be a Super Admin in the HubSpot portal.** A "portal" is
HubSpot's word for your company's whole HubSpot account. Private Apps — the mechanism this
walkthrough uses — are visible only to Super Admins. If you open Settings and cannot find
the Private Apps page at all, that is almost always the reason, not a bug.

**If you are not a Super Admin,** send your HubSpot administrator this, word for word:

> "Please create a Private App in our HubSpot portal called `gtm-analytics-agent`, grant
> it the read scopes listed below, and send me the access token through our password
> manager rather than over email or chat. If you would rather not create it yourself,
> please grant me Super Admin so I can. The scopes are: [paste the list from section 3]."

**Plan or tier: this is where setups fail before they begin.** HubSpot sells Free,
Starter, Professional and Enterprise tiers, and a number of reporting-adjacent APIs are
only callable on Professional or Enterprise. **"The API exists" and "your portal is allowed
to call it" are two different claims.** Find out which tier the portal is on before
promising any analysis. If nobody knows, it is shown in Settings under the account and
billing area.

**One thing that will save you an hour:** decide before you start what the agent actually
needs to read — contacts, companies, deals, tickets, marketing email statistics, traffic
analytics. **Missing permissions in HubSpot do not fail when you create the token. They
fail hours later, on the one call you needed.** Section 3 turns that list into tick boxes.

**A trap to name now, before anyone searches the web for help:** HubSpot used to
authenticate with something called an **API key**, passed in the web address as
`?hapikey=…`. **That was switched off permanently in November 2022.** A great many blog
posts, tutorials and older internal scripts still use it. If you find instructions telling
you to copy an API key from Settings, you are reading a dead page — close it. The same
applies to inherited code: code using `hapikey` is not "deprecated but working", it is
broken.

---

## 2. The steps

### Step 1 — Open HubSpot settings

Sign in to HubSpot and click the **gear icon** in the top navigation bar, on the right.
This opens Settings.

**What you should be seeing:** a settings screen with a long menu down the left-hand side.

*Confirm you can see it.*

### Step 2 — Find Private Apps

In that left-hand menu, open **Integrations**, then **Private Apps**.

If you do not see Integrations, use the search box at the top of the settings menu and type
`private apps`.

**If the page is not there at all, you are not a Super Admin.** Stop and go back to
section 1.

**What you should be seeing:** a page headed *Private apps*, with a short explanation and
a list of existing private apps, which is often empty.

*Confirm you can see that page.*

### Step 3 — Create the app

Click **Create private app**.

A screen opens with tabs across the top. The first tab is for basic information — a name
and description — and the second tab is for **Scopes**, which is HubSpot's word for the
individual permissions the app will hold.

*Confirm the creation screen is open.*

### Step 4 — Name it so a future colleague understands it

On the first tab, fill in the name and the description.

- Name: something like `GTM analytics agent`
- Description: say what it reads and who owns it, for example
  `Read-only CRM and analytics access for automated go-to-market reporting. Owner: <team>.`

**Do not name it "test".** Private apps stay in this list indefinitely and somebody will
eventually have to decide whether deleting it breaks anything. The description is the only
clue they will have.

*Confirm the name and description are filled in.*

### Step 5 — Set the permissions

Click the **Scopes** tab.

You will see a searchable list of permissions grouped by area — CRM, Automation, Analytics,
and others. Each has separate Read and Write tick boxes.

**This is the step that determines whether the setup works or fails silently in three
hours. Go to section 3 now and read the list aloud.** Tick exactly what is listed there and
nothing more.

*Confirm the scopes are ticked, then come back here.*

### Step 6 — Create the app

Click **Create app** in the top right. HubSpot shows a confirmation dialog summarising what
you are about to grant. Read it, then confirm.

*Confirm the app was created.*

### Step 7 — Copy the access token

You are returned to the app's detail page. There is an **Auth** tab showing the **access
token**, hidden behind a **Show token** control, with a copy button beside it.

The token looks like this — a prefix, a region code, then a long random string:

```
pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The middle part reflects where your portal is hosted; `na1` and `eu1` are both common. Copy
the whole thing including the `pat-` prefix.

**Unlike many platforms, HubSpot lets you come back and view this token again later.** That
is convenient and it is also a reason to be careful about who has Super Admin.

**Do not paste it into this chat, an email or a ticket.** Section 6 says where it goes.

*Confirm the token is copied and starts with `pat-`.*

### Step 8 — Store it

Store it as an environment variable or in your organisation's secrets manager:

| Name | Value |
|---|---|
| `HUBSPOT_TOKEN` | the `pat-…` string from step 7 |

It is sent on every request as an `Authorization: Bearer` header. There is no OAuth
sign-in dance, no refresh token, and nothing expires on a timer — which is convenient and
also means a leaked token stays useful until somebody revokes it.

*Confirm it is stored. Then go to section 4 and run the test.*

---

## 3. What to choose, with reasons

**Tick the granular scopes, not the broad ones.** HubSpot offers both older umbrella
permissions and newer fine-grained ones. The granular ones are better: they are narrower,
and they are what current HubSpot documentation assumes.

**Read-only core set — start here:**

| Scope | Why it is needed |
|---|---|
| `crm.objects.contacts.read` | Read contacts. Needed for anything about people, leads or list membership. |
| `crm.objects.companies.read` | Read companies. Needed for anything account-shaped. |
| `crm.objects.deals.read` | Read deals. Needed for pipeline, revenue and forecast work — the most commonly requested analysis. |
| `crm.objects.owners.read` | Read the owner list, so a numeric owner ID on a deal can be turned into a person's name. Without it, reports say `4718392` where a name should be. |
| `crm.schemas.contacts.read`, `crm.schemas.companies.read`, `crm.schemas.deals.read` | Read the property definitions, including what the internal option values of a dropdown actually mean. Without these, a deal stage reads as an opaque code. |

**Add only if the work needs them:**

| Scope | Why, and when |
|---|---|
| `crm.objects.line_items.read` | Only if revenue is analysed at product level rather than deal level. |
| `tickets` (read) | Only if support or service analysis is in scope. |
| `analytics.behavioral_events.read` | Only for custom behavioural event analysis. |
| Marketing email and analytics scopes | Needed for marketing email statistics and web traffic reporting. **The exact names of these differ by tier and have been renamed over time — search the scope list for `analytics` and `marketing` and read what is actually offered in your portal rather than trusting a list from elsewhere.** |

**Do not grant write scopes for a reporting connection.** Anything ending `.write` lets the
agent create, change or delete records in your live CRM. Reporting needs none of it. If you
later want the agent to update records, that is a separate decision, deserves its own
conversation, and is best done with a second private app so the read connection stays
harmless.

**Two things about scopes that catch everybody:**

1. **A missing scope does not stop the token from being created.** The app is made
   successfully, everything looks fine, and then one specific call returns a permission
   error hours into the work. Enumerate what you need up front.
2. **Scopes can be edited afterwards** on the app's detail page, and the token stays the
   same — so a missing scope is a five-minute fix, not a restart. Note that editing scopes
   requires Super Admin again.

---

## 4. How to verify it worked

Run this once:

```bash
curl -s -H "Authorization: Bearer $HUBSPOT_TOKEN" \
  "https://api.hubapi.com/crm/v3/objects/contacts?limit=1"
```

**Success looks like** a JSON block with a `results` list containing one contact record,
each with an `id` and a `properties` object:

```json
{"results":[{"id":"12345","properties":{"createdate":"...","email":"...","lastmodifieddate":"..."}}],"paging":{...}}
```

**An empty `results` list with a successful response is not a failure.** It means the token
works and the portal genuinely has no contacts. That is rare but real, and it is a
different finding from a broken connection — usually it means someone connected a sandbox
or a newly created portal rather than the live one. Confirm which portal the token belongs
to before concluding anything.

**Failure looks like** a JSON block with `"status":"error"` and a `message` field. Section
5 translates the common ones.

---

## 5. If it does not work

**"This oauth token does not have proper permissions" — a 403**

The token is valid; the scope for that specific call was not ticked. The message usually
names the required scope. Go to Settings → Integrations → Private Apps, open the app, edit
the scopes, tick the named one, and save. The token does not change, so nothing else needs
updating.

**"Authentication credentials not found" or a 401**

The token is missing, mistyped, or being sent the wrong way. Check that it is sent as
`Authorization: Bearer pat-…` and not as a query parameter in the web address. If somebody
adapted an older script, this is very often the `hapikey` problem in disguise — a dead
authentication method that returns an authentication failure rather than an explanatory
one.

**Any instruction or error mentioning `hapikey`**

The API key method was switched off permanently in November 2022. Whatever you are
following is out of date. There is no way to make it work and no setting to re-enable. Use
the private app token from step 7.

**A 404 on a documentation web address, or on an endpoint that used to work**

HubSpot reorganised its API documentation and moved to date-based API versions during 2026,
and older `developers.hubspot.com/docs/apis/...` links now return not-found. **This is
version-dependent and changing.** Do not conclude the endpoint was removed — look it up in
the current documentation and pin the version explicitly rather than relying on a
remembered path.

**"You have reached your daily limit" or a 429**

You are being rate limited — sending requests faster than HubSpot allows. Limits depend on
your tier. Note that HubSpot also watches your *error* rate: **error responses should stay
under about five percent of your daily requests, because a high error ratio is treated as
abuse.** An agent that retries hard into a permission error can get the whole portal
flagged, so fix the permission rather than retrying.

**The numbers come back higher than what a colleague sees in HubSpot**

This is not a fault. A private app token is **portal-scoped, not user-scoped**: it ignores
user roles, teams and field-level permissions, and returns everything its scopes allow. So
the API commonly shows *more* than any individual person sees in the interface. It also
means you cannot reproduce one specific person's filtered view. If a manager expects their
own team's number, filter to that team explicitly.

---

## 6. Security notes

**Where the token goes.** Into an environment variable or your organisation's secrets
manager. Not a spreadsheet, not a shared document, not a pinned chat message.

**Never paste it into a chat window, including this one.** If it has already gone somewhere
visible, treat it as leaked and rotate it using the steps below.

**Never commit it to a code repository.** `pat-na1-` is a distinctive prefix and automated
scanners look for exactly this shape. A token that touches a public repository, even for a
minute, is compromised, and deleting the commit does not undo it because it remains in the
repository history.

**What this token can reach.** Everything its scopes allow, across the entire portal,
regardless of who is asking. If you followed section 3, that is read access to your CRM
records — which is still your customer list, and should be treated as seriously as you
treat your customer list.

**Rotating it** — replacing the credential so an old copy stops being useful:

1. Settings → Integrations → Private Apps → open the app → **Auth** tab.
2. There is a control to rotate the access token. **Rotating takes effect immediately and
   the old token stops working**, so anything using it breaks until you update the stored
   value. HubSpot offers the option to keep the old token valid for a short overlap period
   — use it if scheduled jobs depend on this token.
3. Update the stored value, then run the section 4 test again.

Every six to twelve months is reasonable, and immediately whenever someone with access to
it leaves.

**If it leaks,** rotate it straight away as above, or delete the private app entirely,
which revokes the token permanently at once. Deleting the app does not delete any CRM data
— it only removes the access. Then check the portal's login and security history for
anything unexpected.

**Ownership.** Unlike a person-bound credential, a private app token survives the departure
of whoever created it. That is an advantage for scheduled work and a hazard for forgotten
apps. Review the Private Apps list once or twice a year and delete what nothing uses.
