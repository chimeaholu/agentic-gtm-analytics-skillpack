# Connecting Looker — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Looker's admin area. Do not skip ahead and do not batch the steps. If a screen does not
look like the description here, stop and say so rather than clicking on.

---

## 1. What you will need before starting

**Who has to do this.** Creating an API credential in Looker is an **admin-only** action.
An admin is a Looker user whose role includes the `administer` permission — in most
companies that is one or two people on the data team. **If you are not an admin, you cannot
do any of this yourself and there is no workaround.**

**If you need to ask an admin, ask for exactly this, word for word:**

> "Please create a dedicated Looker service user for an automated reporting integration,
> give it a role that includes `access_data`, `see_looks`, `see_user_dashboards`,
> `explore`, `see_sql` and `see_lookml`, and then create an API key on that user and send
> me the client ID and client secret through our password manager. Also tell me the full
> API base URL including the port number."

That paragraph is the whole request. Sending it once saves a week of back-and-forth.

**What kind of Looker account you need.** There is no special plan or add-on. The API is
part of Looker. What matters is the **role** attached to the user the key belongs to, not
the company's contract.

**How long it takes.** About **30 minutes** if an admin is sitting with you. If you have to
raise a ticket with a data team, assume **a few days**, because the `see_lookml` permission
below often triggers a short internal discussion.

**One thing to decide before you start.** The key will be attached to a specific Looker
user, and **the automation will see exactly what that user can see — no more, no less.**
Create a new, dedicated user for this. Do not attach the key to a real person's account:
when that person leaves the company and their account is deactivated, every automated
report stops working, usually at the worst possible moment.

---

## 2. The steps

**Step 1 — Find out the instance address, including the port number.**

The port number is the part after the colon at the end of a web address. Looker is unusual
here and **this is the step that wastes the most time in practice.**

- Looker instances hosted by Google usually serve the API on the standard secure port,
  which is `443` and is invisible, so the address reads only `https://yourcompany.looker.com`.
- **Older instances, and any instance the company hosts itself, very often serve the API on
  port `19999` instead** — `https://yourcompany.looker.com:19999`.

Ask the admin which one it is. Do not guess. If you guess wrong, every attempt below fails
with a message about the connection being refused or timing out, which reads like a broken
network and sends people looking in entirely the wrong place.

Write the answer down as `LOOKER_BASE_URL`.

**Step 2 — Open the Admin area.**

Sign in to Looker. In the left-hand navigation there is an **Admin** entry (in some versions
it is a gear or cog icon near the bottom of the left sidebar). Click it. You should land on
an admin overview page with a long list of sections down the left: Users, Groups, Roles, and
others.

If you do not see **Admin** at all, your account is not an admin account. Stop here and go
back to section 1.

**Step 3 — Create the dedicated service user.**

In the admin sidebar, click **Users**. You will see a table of every Looker user. Click the
button to add a user — it is at the top of that table and reads **Add Users** or **Add
User** depending on the version.

Give it an email address that belongs to a shared mailbox or a group, not a person. Something
like `looker-automation@yourcompany.com`. Create the user.

**Step 4 — Give that user a role.**

Section 3 below lists exactly which permissions to include and why. Read that section now,
before you create the role, because getting it wrong here is the failure that shows up two
weeks later as "the numbers are missing" rather than as an error.

In the admin sidebar, click **Roles**. A Looker role is built from two pieces: a
**permission set** (what actions are allowed) and a **model set** (which data models are
visible). You create or pick both, combine them into a role, and assign that role to the
new user.

**Step 5 — Create the API key on that user.**

Go back to **Admin → Users**, find your new service user, and open it. On the user's page
there is a section for API credentials.

**UI wording check, and it is version-dependent:** in older Looker versions the button reads
**Edit Keys** and the keys are called **API3 Keys**; in newer versions the section is
labelled **API Keys**. Both do the same thing. If you see neither, use the admin search box
at the top of the admin area and search for the user, then look for anything on their page
containing the word "API".

Click through to the keys page and click **New API Key** (or **New API3 Key**).

**Step 6 — Copy both halves of the credential.**

Looker shows you a **Client ID** and a **Client Secret**. Both are long strings of letters
and numbers with no recognisable prefix — they look like random text, roughly 20 to 30
characters each.

**The secret is the sensitive half.** Copy both into your password manager immediately,
labelled clearly, before you navigate away from the page. Then put them into wherever your
automation reads its settings from, as two values:

```
LOOKER_BASE_URL=https://yourcompany.looker.com:19999
LOOKER_CLIENT_ID=<the client ID>
LOOKER_CLIENT_SECRET=<the client secret>
```

Those three values are the entire credential. Nothing else from this page is needed.

**Step 7 — Understand what happens at run time, because it surprises people.**

The client ID and secret are not what gets sent on each request. The automation exchanges
them for a temporary **access token** that lasts about **one hour**, and sends that token
instead.

**There is no refresh token.** When the hour is up, the automation logs in again with the
ID and secret from scratch. This matters for anything running on a schedule: it needs a
"log in again" path, not a "refresh the token" path. If somebody has built a refresh flow,
it is built on an assumption Looker does not support.

---

## 3. What to choose, and why

This is the section that decides whether the setup works properly or fails quietly in a
month. Each permission below is on the **permission set** attached to the service user's
role.

| Permission | Why it is needed |
|---|---|
| `access_data` | Without it the user cannot retrieve any data at all. This is the floor. |
| `see_looks` | Lets the automation open saved reports ("Looks"). Needed to run an existing saved report rather than rebuilding it. |
| `see_user_dashboards` | Lets it see dashboards that users built, so it can find and read them. |
| `see_lookml_dashboards` | Dashboards defined in code are a separate category from user-built ones, with a separate permission. Include it if the company has any. |
| `explore` | Lets the automation build a query rather than only re-running saved ones. Without it, anything ad-hoc fails. |
| `see_sql` | Lets it see the database query behind a result, which is how it can explain and check a number instead of asserting one. |
| **`see_lookml`** | **The important one — see the note below.** |

**Why `see_lookml` matters more than it looks.** LookML is the code that defines what every
metric in Looker actually means — what "revenue" sums, which rows a filter excludes, how
two tables are joined. **`see_lookml` is the permission that lets the automation read those
definitions.**

Without it, the automation can still return numbers. It cannot tell you what they mean. It
will describe a metric by its display name and nothing else, which is how two people end up
arguing about a figure that both of them read correctly. **If the goal is trustworthy
reporting rather than raw figures, this permission is not optional.**

Some data teams are cautious about `see_lookml` because the model code can contain business
logic they consider sensitive. That is a reasonable position and worth raising early rather
than discovering at the end. If it is refused, the integration still works — say plainly in
every output that metric definitions could not be read.

**Do not grant `develop`, `manage_models`, or `administer`.** Those allow changing the data
model, not reading it. An automation with them can alter what every report in the company
means.

**The model set matters as much as the permission set.** A model set lists which LookML
models the role can see. A role with perfect permissions and an empty model set returns
nothing, with no error. If the automation reports that it can see no data at all, check the
model set before anything else.

**Row-level filters follow the user too.** Looker can restrict which rows a user sees based
on attributes on their account. Whatever restriction sits on the service user silently
applies to every number the automation produces. It does not warn you. Decide deliberately
whether this user should see everything or a slice, and write the decision down, because
six months later nobody will remember.

---

## 4. How to check it worked

Two commands. Run the first, then the second.

The first exchanges the ID and secret for a temporary token:

```bash
TOKEN=$(curl -s -X POST "$LOOKER_BASE_URL/api/4.0/login" \
  -d "client_id=$LOOKER_CLIENT_ID&client_secret=$LOOKER_CLIENT_SECRET" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

**Success looks like:** nothing at all printed. That is correct — the token went into a
variable. If you see a Python error about a missing key, the login failed; run the same
`curl` without the pipe to read the actual message.

The second asks Looker who you are:

```bash
curl -s -H "Authorization: token $TOKEN" "$LOOKER_BASE_URL/api/4.0/user"
```

**Success looks like** a block of JSON describing a user — it contains an `id`, a
`display_name`, and an `email`. **Read the email and check it is the service user you
created, not a person.** This is the identity every future number will be attributed to.
If it shows a real person's account, the wrong key is in use.

---

## 5. If it does not work

**"Connection refused", "Could not connect", or a request that hangs and times out.**
This is almost always the port number, not the credential. Try the other port — if you used
`https://company.looker.com`, try `https://company.looker.com:19999`, and the other way
round. Nothing about the message will suggest a port problem, which is why it costs people
an afternoon.

**A 404 "not found" response on `/api/4.0/`.** The instance is running a Looker version
older than API 4.0. Older tutorials use `/api/3.1/` — that version has been removed, so any
inherited code pointing at it is broken rather than merely outdated. Ask the admin to
confirm the instance version.

**"Not authenticated", or a 401 response, on the login call.** The client ID or secret is
wrong, or the key was deleted, or the service user was disabled. Check the user is still
active in Admin → Users first; a disabled user's key fails exactly like a mistyped secret.

**Everything authenticates, but queries return nothing and no error.** This is the model
set or a row-level filter, from section 3. It is not a bug and it will not produce an error
message. Have the admin open the service user's role and confirm the model set actually
lists the models you need.

**"Requires permission" or a 403 on one specific request while others work.** A permission
is missing from the permission set. The message usually names the permission — take that
name straight back to the admin rather than re-creating the key, because the key is fine.

---

## 6. Keeping the credential safe

**The client secret is a password.** Anyone holding it can read every piece of data the
service user can read.

- **Store it in a password manager or a secrets store**, and let the automation read it from
  an environment variable. Storing it in a file is acceptable only if that file is never
  committed to version control.
- **Never paste it into a chat window, a ticket, a shared document, or an email.** Chat
  histories are searchable and are frequently backed up somewhere nobody remembers.
- **Never commit it to a code repository**, including a private one. Removing a secret from
  git history is far harder than rotating it, and until it is removed, everyone with
  repository access has it.
- **Rotating it:** create a second API key on the same user first, put the new one into the
  automation, confirm it works, and only then delete the old key. Deleting first causes an
  outage between the two actions.
- **If it leaks:** go to Admin → Users → the service user → the API keys section and
  **delete the key immediately**. Deletion is instant and total — any process using it stops
  working at once, which is what you want. Then create a fresh key. If you suspect the
  service user itself was misused, disable the user as well and ask the admin to review that
  user's query history.
