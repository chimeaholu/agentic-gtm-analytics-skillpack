# Connecting Power BI — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Microsoft's admin portals. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting — read all of this before touching anything

**This is the hardest setup in the pack, and it is not close.** Every other platform here
can be connected by one person in an afternoon. This one cannot, because **one of the
required steps can only be performed by a tenant administrator** — the person who
administers your organisation's entire Microsoft environment — **and nobody else in the
company can do it or work around it.**

**Be honest with yourself about the timeline before you begin.** Realistically:

- **30 to 60 minutes** of your own clicking.
- Plus **however long it takes to get a tenant administrator to agree and act**, which in a
  large organisation is commonly **several days to several weeks**, because the change they
  must make is organisation-wide and usually goes through a security review.

**Do not start this and promise a date. Have the tenant-administrator conversation first.**
People abandon this setup halfway more than any other, having already created things they
then forget about.

**Three separate permissions are involved, and they are held by different people.**

| What is needed | Who can do it | Typical job title |
|---|---|---|
| Register an application in Microsoft Entra ID | Someone allowed to register apps — in many organisations this is restricted | IT administrator |
| Turn on the organisation-wide switch that allows automations to use Power BI at all | **A Fabric / Power BI tenant administrator. Only them.** | Microsoft 365 or Fabric admin |
| Add the automation to each workspace it must read | Whoever administers that particular workspace | The BI team, or a report owner |

**If you need to ask, ask for exactly this:**

> "I need to connect an automated reporting integration to Power BI. This needs three
> things. First, an app registration in Microsoft Entra ID with a client secret. Second — and
> this one only a Fabric or Power BI tenant admin can do — the tenant setting 'Allow service
> principals to use Power BI APIs' turned on, with a security group containing this app added
> to its allowlist. Third, that app added as a Member or Contributor on each workspace it
> needs to read. Without the second item the first and third do nothing."

**A licensing warning, because it costs real money.** Reading data through the API is
covered by ordinary Power BI licensing, but some operations — particularly writing to or
reading the internals of a semantic model through the XMLA endpoint, which is Power BI's
low-level model interface — **require the workspace to sit on paid dedicated capacity**
(a Fabric or Premium capacity). **Dedicated capacity is a substantial monthly commitment.**
If nobody has mentioned capacity, assume you have the read-only subset and confirm before
promising anything that writes.

**Vocabulary you need for the rest of this document, defined once:**

- **Microsoft Entra ID** — Microsoft's identity system. It was called Azure Active Directory
  until 2023, and **plenty of documentation and older menus still say "Azure AD"**. They are
  the same thing.
- **Tenant** — your organisation's whole Microsoft environment.
- **App registration** — an entry in Entra saying "this piece of software exists and may
  sign in".
- **Service principal** — the account that app registration acts as. When people say "the
  service principal", they mean the app signing in as itself rather than on behalf of a
  human.
- **Workspace** — a container in Power BI holding reports and semantic models.
- **Semantic model** — the data model behind reports. Older menus call it a **dataset**, and
  the API still uses the word `datasets`.

---

## 2. The steps

**Step 1 — Register the application in Microsoft Entra ID.**

Go to the Microsoft Entra admin centre at `entra.microsoft.com`, or reach the same screens
through the Azure portal at `portal.azure.com`. Sign in with a work account.

In the left navigation find **Applications**, then **App registrations**. Click **New
registration**.

Give it a name that says what it is — something like "Reporting automation" — so that the
person auditing app registrations in two years knows not to delete it. For the supported
account types, choose the single-tenant option, whose label reads roughly **"Accounts in
this organizational directory only"**. Leave the redirect URI blank. Click **Register**.

**Step 2 — Copy the two identifiers.**

You land on the app's Overview page. It shows, among other things:

- **Application (client) ID** — a long value in the shape
  `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, all letters and digits with dashes.
- **Directory (tenant) ID** — the same shape, a different value.

Copy both. They are identifiers rather than passwords, but treat them as configuration:

```
POWERBI_CLIENT_ID=<Application (client) ID>
POWERBI_TENANT_ID=<Directory (tenant) ID>
```

**Step 3 — Create the password for the application.**

Still inside the app registration, click **Certificates & secrets** in the left menu, then
the **Client secrets** tab, then **New client secret**.

Give it a description and choose an expiry period. **Read this before choosing:** the secret
**will expire**, and when it does, every automated report stops working with an
authentication error that gives no hint that an expiry was the cause. Choose the longest
period your security policy permits, **write the expiry date in a shared calendar today**,
and set a reminder a month before.

Click **Add**. The secret now appears in the table.

**Copy the value in the `Value` column immediately — not the one labelled `Secret ID`.**
People copy the wrong column constantly. The value is a long string of mixed letters,
digits and punctuation, usually around 40 characters, often ending in a tilde or similar.

**You cannot see it again.** Leave the page and it is gone for good; your only option then
is to delete it and create another. Put it straight into your password manager:

```
POWERBI_CLIENT_SECRET=<the Value column, not the Secret ID>
```

**A certificate is the more secure alternative** to a secret and is what a security team
will prefer. It is more work to set up and rotate. If your organisation has a standard for
this, follow it rather than this document.

**Step 4 — Decide which of the two sign-in styles you are building, because the next step
differs.**

- **The automation signs in as itself** (no human involved, runs on a schedule). This is the
  service principal path and is almost certainly what you want. **Go to step 5.**
- **The automation acts on behalf of a signed-in person.** This is the delegated path. It
  needs API permissions granted in Entra and an administrator to consent to them. **Go to
  step 4b.**

**Step 4b — Delegated path only: grant and consent to permissions.**

In the app registration, click **API permissions**, then **Add a permission**, then find
**Power BI Service** in the list of Microsoft APIs. Choose **Delegated permissions** and
tick the ones listed in section 3. Then click **Grant admin consent for [your
organisation]** — a button at the top of the permissions table.

**That consent button requires an administrator.** If it is greyed out for you, you cannot
finish this path yourself. When consent has been given, the Status column shows a green tick
reading **Granted for [your organisation]** on every row. **A permission that is listed but
not consented does nothing at all**, and the failure appears later as a refusal on one
specific request.

**Step 5 — The tenant switch. This is the step the whole setup hinges on.**

**Only a Fabric or Power BI tenant administrator can do this.** If that is not you, send
them the paragraph from section 1 and wait. There is no alternative route, no per-workspace
override, and no way to tell from any error message that this is what is missing.

The administrator goes to the Power BI or Fabric service at `app.powerbi.com`, opens the
**Settings** gear in the top right, chooses **Admin portal**, then **Tenant settings** in the
left menu. Under the **Developer settings** group there is a setting whose name reads
**"Allow service principals to use Power BI APIs"**.

They set it to **Enabled**, and — this half is missed as often as the switch itself —
**restrict it to a specific security group and add a security group containing your app
registration to that allowlist.** Enabling the switch for the whole organisation is a much
broader change than needed and a security team will reasonably object.

**Creating that security group is a separate task in Entra** (Entra admin centre →
**Groups** → **New group**, type **Security**, then add the app registration as a member).
Do that before asking the tenant admin to flip the switch, so they are not blocked waiting
on you.

**Tenant settings take time to propagate.** After the switch is flipped, **allow roughly
15 minutes** before concluding anything is broken.

**Step 6 — Add the automation to each workspace.**

**Being allowed to use the API grants access to nothing.** Workspace membership is a
completely separate system. Every workspace must be done individually.

In `app.powerbi.com`, open a workspace. Near the top there is an access control entry —
depending on version it reads **Manage access**, or **Access**, or appears under the
workspace's "..." menu. Open it, click **Add people or groups**, and type the **name of the
app registration** (or the security group containing it). It will appear in the results even
though it is not a person.

Assign the role **Member** or **Contributor**. Section 3 explains which.

**Repeat this for every workspace the automation needs.** A report that works for one
workspace and fails for another is nearly always this step, half-done.

**Step 7 — Note the one thing that will never work.**

**"My Workspace" is not usable by a service principal.** It is a personal area tied to an
individual. If a report lives there, it has to be moved into a real workspace first. Nothing
in the error message will tell you this.

---

## 3. What to choose, and why

**Permissions, for the delegated path only (step 4b):**

| Permission | Why |
|---|---|
| `Dataset.Read.All` | Read semantic models and run queries against them. This is the core read capability. |
| `Workspace.Read.All` | List workspaces and see what exists in them, so the automation can find the model it needs. |
| `Report.ReadWrite.All` | Only if the automation must create or modify reports. **Omit it if the work is read-only.** |

**Expect to justify these, and the objection is legitimate.** The `.All` suffix means
"across everything this user can reach", not "one specific model" — Power BI does not offer
a narrower version. What actually limits the scope is workspace membership in step 6, not
the permission name. Say that plainly to a security reviewer; it is the honest answer and it
is usually accepted.

**Workspace role, for step 6:**

| Role | Grants | Choose it when |
|---|---|---|
| **Viewer** | Read reports only. **Usually not enough** — it commonly cannot query a semantic model directly. | Rarely useful here. |
| **Contributor** | Read and query models, create and edit content. | **The default choice for a read-and-analyse automation.** |
| **Member** | Contributor, plus the ability to add others to the workspace. | Only if the automation must manage access, which is unusual. |
| **Admin** | Everything, including deleting the workspace. | **Do not choose this.** |

**Start at Contributor.** If a query is refused, moving up to Member is a small change; going
down from Admin after the fact rarely happens because nobody wants to break what works.

**The point that confuses nearly everyone.** When an automation signs in **as itself**, Power
BI does not consult the API permissions you granted in Entra. What governs its access is the
**tenant switch** from step 5 plus its **workspace role** from step 6. This is why an app
with a perfect-looking permissions page still fails, and why the permissions page is not
where to look when it does. The Entra permissions in step 4b matter for the **delegated**
path, where a human signs in.

**Capacity, and where it costs money.** Reading data through the standard API does not
require dedicated capacity. **Writing to a semantic model, or reading its internals, through
the XMLA endpoint does** — that needs the workspace on a Fabric or Premium capacity, and on
some capacities the read/write XMLA mode must additionally be turned on by a capacity
administrator. **Do not buy capacity to solve an authentication error.** Confirm the tenant
switch and workspace membership first; capacity is rarely the actual cause and is by far the
most expensive thing to change.

---

## 4. How to check it worked

First, exchange the three values for a token. The token lasts about an hour.

```bash
TOKEN=$(curl -s -X POST \
  "https://login.microsoftonline.com/$POWERBI_TENANT_ID/oauth2/v2.0/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$POWERBI_CLIENT_ID" \
  -d "client_secret=$POWERBI_CLIENT_SECRET" \
  -d "scope=https://analysis.windows.net/powerbi/api/.default" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

**Success looks like:** nothing printed. **A Python error here means the sign-in itself
failed** — re-run the `curl` without the pipe to read Microsoft's message, which is usually
specific and usually about the secret.

Then ask Power BI what workspaces the automation can see:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "https://api.powerbi.com/v1.0/myorg/groups"
```

**Success looks like** JSON containing a `value` list with one entry per workspace, each
with an `id` and a `name`.

**`{"value":[]}` — an empty list — is the result to watch for.** It is not an error and it
is not a sign that everything is fine. **It means the automation authenticated and can see
no workspaces**, which is step 5 or step 6 undone. This is the single most common outcome of
a half-finished Power BI setup.

Finally, confirm you can actually query a model. Take a workspace `id` and a semantic model
id from the call above and run:

```bash
curl -s -X POST \
  "https://api.powerbi.com/v1.0/myorg/groups/$WORKSPACE_ID/datasets/$DATASET_ID/executeQueries" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"queries":[{"query":"EVALUATE ROW(\"ok\", 1)"}],"serializerSettings":{"includeNulls":true}}'
```

**Success looks like** JSON containing a results structure with a single row whose value is
`1`. That is a deliberately trivial query whose only purpose is to prove the path works end
to end.

---

## 5. If it does not work

**A 401 response, or "AADSTS" followed by a number, on the sign-in call.** The problem is
the credential itself. The most common causes, in order: the **Secret ID was copied instead
of the Value** in step 3; the secret **expired**; the tenant ID or client ID has a character
missing. The `AADSTS` code in the message is precise — search for that exact code rather
than guessing.

**A 403 response on a Power BI call, after sign-in succeeded.** The token is fine and the
permission is not. In practice this is **step 5 (the tenant switch) or step 6 (workspace
membership)**, and the message will not say so. Check in that order. If the tenant admin says
the switch is on, confirm the app is actually inside the security group on its allowlist —
switching it on without adding the group is the usual half-completion.

**An empty workspace list, with a 200 success.** Same causes as the 403 above. It is worse
than an error because it looks like success and an automation may report "no data found"
rather than "not connected".

**"PowerBINotAuthorizedException", or a refusal naming "My Workspace".** Either the tenant
switch is off, or the target is a personal workspace, which service principals cannot reach
at all. Move the content to a proper workspace.

**It worked for weeks and then stopped, with no changes made.** Check the client secret's
expiry date first. This is the most common cause of a Power BI integration failing on a
random Tuesday, and it is why step 3 asks you to diary the date.

**"Operation not supported" on an XMLA or model-write operation.** Capacity, from section 3.
Confirm the workspace is on a Fabric or Premium capacity and that read/write XMLA is enabled
on it before doing anything else.

---

## 6. Keeping the credential safe

**The client secret is a password** for an identity that can read data across every workspace
it has been added to.

- **Store it in a secrets manager or your organisation's key vault**, not in a file and not
  in application code. A certificate is a stronger option than a secret if your security team
  offers one.
- **Never paste it into a chat window, ticket, wiki page or email.** The `Value` field is the
  part that matters; the client ID and tenant ID are identifiers and are far less sensitive,
  though there is no reason to publish them either.
- **Never commit it to a repository**, including a private one.
- **Rotating it:** in the app registration, add a **second** client secret, put the new value
  into the automation, confirm it works, and only then delete the old secret. An app
  registration can hold more than one secret at a time precisely so rotation causes no
  outage. **Do this on a schedule tied to the expiry date, not after a failure.**
- **If it leaks:** go to the app registration → **Certificates & secrets** and **delete that
  secret immediately**. Deletion takes effect at once for new sign-ins, though **an
  already-issued token stays valid until it expires — up to about an hour.** If the leak is
  serious, also remove the service principal from each workspace, which cuts access
  immediately rather than waiting the token out. Then ask the tenant administrator to review
  the app's sign-in activity in Entra.
