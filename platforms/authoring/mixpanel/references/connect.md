# Connecting Mixpanel — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Mixpanel's settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need to be an **Admin or Owner** on the Mixpanel project or
organisation. Someone with an Analyst or Consumer role can build charts in the interface but
**cannot create the credential described here**.

**If you need to ask an admin, ask for exactly this:**

> "Please create a Mixpanel service account for an automated reporting integration, scoped to
> the [name] project with the Analyst role, and send me the username and the secret through
> our password manager — the secret is only shown once. Also send me the project's numeric
> Project ID, and tell me which region the project is in: US, EU or India."

**Plan and tier.** Service accounts are available broadly and there is no application review
or approval queue. What does vary is which data the account's role can reach, which is
section 3.

**How long it takes.** **Five to ten minutes** if you are an admin. There is no waiting on
anybody outside your team.

**The one hard limit you must understand before you plan any work.** Mixpanel's query
interface allows **60 queries per hour per project, and 5 running at the same time. Mixpanel
states this cannot be raised.** There is no paid tier that lifts it and no support request
that will.

**This changes how the work is done, not only how fast it is.** An hour's budget of 60 calls
is spent in minutes by an automation that asks one question per segment. A planned analysis
that groups results in a single call uses a handful. **Say this limit out loud at the start
of any Mixpanel work, and plan the calls before making them** — `references/call-budget-planning.md`
in this module sets out how.

---

## 2. The steps

**Step 1 — Establish which region the project lives in. Do this before anything else.**

Mixpanel runs separate data centres, and **a project's data exists in exactly one of them**.

| Region | Web address you sign in at |
|---|---|
| United States (the default) | `mixpanel.com` |
| European Union | `eu.mixpanel.com` |
| India | `in.mixpanel.com` |

**Using the wrong regional address against an EU or India project returns empty results
rather than an error.** Not a refusal, not a redirect — an empty answer that looks exactly
like a project with no data in it. This is the single most expensive mistake on this platform
because it wastes hours before anyone suspects it.

Ask which region the project is in. If nobody knows, the address in the browser when
somebody is signed in to Mixpanel tells you.

**Step 2 — Sign in and open the settings area.**

Sign in at the correct regional address. Settings are reached through the **gear icon** in
the interface. Mixpanel separates **Organization Settings** from **Project Settings**, and
both contain a service accounts area — the difference is explained in section 3.

**UI wording check:** Mixpanel's navigation has been reorganised more than once. If the gear
does not lead where this describes, use the interface's own search and look for **"Service
Accounts"**.

**Step 3 — Find the Project ID and write it down.**

In **Project Settings**, on the overview page, there is a numeric **Project ID** — a plain
number, not a long random string. Most query requests need it.

```
MIXPANEL_PROJECT_ID=<the number>
```

**On the same page you will see a "Project Token".** That is a different thing and is
explained in step 6. Do not take it yet.

**Step 4 — Create the service account.**

Go to the **Service Accounts** area and create a new one. You will be asked for a name, a
**role**, and which project or projects it applies to.

Name it after what it does — something like "reporting-automation" — so that whoever audits
accounts later knows what it is. Section 3 covers the role.

**Step 5 — Copy both halves of the credential now.**

Mixpanel shows you a **username** and a **secret**. The username looks like a name followed
by a dot and a short random suffix. The secret is a long random string.

**The secret is shown once and cannot be retrieved afterwards.** If you lose it, the only
remedy is to delete the account and make another. Copy both into your password manager before
leaving the page, then into your automation's settings:

```
MIXPANEL_SA_USERNAME=<the service account username>
MIXPANEL_SA_SECRET=<the secret, shown only once>
```

They are sent together as a username-and-password pair, in the ordinary web way — the same
mechanism a browser uses when a site asks for a username and password.

**Step 6 — Make sure you are holding the right credential, because three exist and two do not
work here.**

| What it is called | What it is for | Will it authenticate a query? |
|---|---|---|
| **Service account** username and secret | The modern credential for reading data | **Yes. This is the one.** |
| **Project Token** | Sending events *into* Mixpanel from an app or website | **No.** It has no query ability at all. |
| **Project Secret** | An older per-project credential | Sometimes, but it is being phased out. Do not build on it. |

**Being handed a Project Token and being told it is "the Mixpanel API key" is extremely
common.** It produces an authentication failure that looks like a typo. If the credential you
were given came from a developer who was instrumenting a website, it is almost certainly the
Project Token.

**Step 7 — If you intend to use Mixpanel's own MCP connector, check it is switched on.**

Accounts created after 1 August 2026 have it available by default. **Older accounts need an
organisation admin to enable it**, under the organisation's settings overview. This is the
first question existing Mixpanel customers hit, and it is an admin action, not a support
ticket.

---

## 3. What to choose, and why

**The role on the service account:**

| Role | What it can do | Choose it when |
|---|---|---|
| **Consumer** | View existing saved reports and boards | The automation only ever reads things people already built. Restrictive, and usually too restrictive. |
| **Analyst** | Run queries, read events and profiles, read saved reports | **The default choice for a reporting automation.** |
| **Admin** | All of the above, plus changing project settings and managing users | **Do not choose this for an automation.** It can alter the project. |

**Start at Analyst.** If a specific call is refused, widening the role is a small change.
Starting at Admin and narrowing afterwards effectively never happens.

**Organisation-level versus project-level.** An organisation-level service account can be
given access across several projects; a project-level one is confined to one. **Scope it to
the single project it needs.** A credential that can read every project in the company is a
much larger problem if it leaks, for no benefit.

**A note on data sensitivity.** A service account that can read user profiles can read
personal information about identified users. If the analysis only concerns event counts,
consider whether profile access is needed at all, and say so when requesting the account.

---

## 4. How to check it worked

Run this, substituting the correct regional host if the project is not in the United States:

```bash
curl -s -u "$MIXPANEL_SA_USERNAME:$MIXPANEL_SA_SECRET" \
  "https://mixpanel.com/api/query/cohorts/list?project_id=$MIXPANEL_PROJECT_ID"
```

For an EU project use `https://eu.mixpanel.com/...`; for India, `https://in.mixpanel.com/...`.

**Success looks like** a JSON list — either of saved cohorts, each with a `name` and a
`count`, or `[]` if the project genuinely has no cohorts saved.

**Be careful with an empty result.** On a project the customer describes as busy, an empty
answer is **far more often a region mismatch than an empty project**. Before concluding
anything, run the same command against the other two regional hosts. If one of them returns
data, you had the region wrong.

**This test costs one of your 60 calls for the hour.** Do not loop it.

---

## 5. If it does not work

**A 401 response, or a message about invalid credentials.** Either the secret is wrong, or
you are holding a Project Token rather than a service account secret (step 6). Check which
credential you have before re-creating anything.

**An empty result on a project that should have data.** The region, from step 1. Try the
other regional hosts. Nothing in the response will hint at this.

**A 429 response, or a message about rate limiting.** You have spent the hour's 60 calls, or
have more than 5 requests running at once. **Retrying does not help and makes it worse** —
the limit is per hour, so an automation retrying in a loop stays blocked for the rest
of the hour. Stop, wait, and re-plan the analysis to use fewer, broader calls.

**A 403 on one particular request while others succeed.** The service account's role is too
narrow for that endpoint. Note which call was refused and widen the role by one step; do not
create a new credential.

**A message about the project ID being missing or invalid.** Most query calls need
`project_id` as a parameter and it is the numeric ID from step 3, not the project's name and
not the Project Token.

---

## 6. Keeping the credential safe

**The service account secret gives read access to your product analytics**, which commonly
includes identified user behaviour and profile information. Treat it as personal data
adjacent.

- **Store it in a password manager or secrets store** and have the automation read it from an
  environment variable.
- **Never paste it into a chat window, a ticket or a shared document.** It is shown once by
  design, which means people paste it somewhere convenient in the moment — that is exactly
  the habit to break.
- **Never commit it to a repository.**
- **Rotating it:** create a second service account, move the automation onto it, confirm the
  test in section 4 passes, and then delete the first. There is no way to re-issue the secret
  for an existing account, so "rotation" here always means replacement.
- **If it leaks:** go to the Service Accounts area and **delete that service account
  immediately**. Deletion takes effect at once. Then create a replacement and review who had
  access to wherever it leaked. If the account could read user profiles, treat the incident
  as a potential personal-data exposure and involve whoever owns that process at your
  company.
