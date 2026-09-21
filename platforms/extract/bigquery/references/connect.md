# Connecting BigQuery — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened the
Google Cloud console. Do not skip ahead and do not batch the steps.

**Read section 3 before you run a single query.** On BigQuery the credential is the easy part
and the cost controls are the part that matters. They are not an optimisation to add later.

---

## 1. What you will need before starting

**Who has to do this.** You need someone with administrative rights on the Google Cloud
project — a **Project Owner**, or someone holding the Service Account Admin and Project IAM
Admin roles. Most organisations restrict this to a platform or cloud team.

**If you need to ask, ask for exactly this:**

> "For an automated reporting integration against BigQuery, please create a dedicated service
> account in the [name] project, grant it BigQuery Job User on that project and BigQuery Data
> Viewer on the [names] datasets, and set a custom query quota on it — a daily bytes-scanned
> limit. Tell me the project ID to bill jobs to, and let me know whether we can use Workload
> Identity Federation rather than a downloaded key file."

**Plan and tier.** There is no plan to buy, but **BigQuery will not run at all unless billing
is enabled on the project.** This is true even within the free allowance. If billing is not
enabled, nothing below works, and this is the first thing to confirm.

**How long it takes.** **Twenty to forty minutes**, most of it waiting for permission
changes to take effect. If you must request access from a cloud team, assume a few days.

**The warning that belongs at the top.** **BigQuery's failure mode is not an error message —
it is an invoice.** On the standard pricing model you pay for the volume of data each query
reads, and nothing stops a technically valid query from reading an enormous amount. There is
no rate limit that saves you. **A single careless query against a large table can cost more
than the rest of the month's analytics spend combined, and it will succeed while doing it.**
Section 3 is the part of this document that prevents that.

---

## 2. The steps

**Step 1 — Confirm the project and that billing is enabled.**

Go to `console.cloud.google.com` and sign in. At the top of the page there is a **project
picker** showing which project you are in. Select the right one and note its **project ID** —
the lowercase identifier, not the display name.

Then, from the navigation menu, open **Billing** and confirm the project is linked to a
billing account. If it says billing is not enabled, stop — nothing further will work.

**Step 2 — Enable the BigQuery API.**

From the navigation menu choose **APIs & Services**, then **Enabled APIs & services**. Look
for **BigQuery API** in the list. If it is not there, click **Enable APIs and services**,
search for "BigQuery API", and enable it. On projects created recently it is often already on.

**Step 3 — Understand the two projects involved, because it is a real trap.**

**Jobs are billed to the project you send the request to. The data can live in a different
project entirely.** These are commonly not the same, and nothing in the interface makes the
distinction obvious.

Get a clear answer to both questions before going further:

- **Which project should the cost land on?** That is your billing project.
- **Which project holds the datasets to read?** That is the data project.

An automation pointed at the wrong billing project either fails with a permission error, or —
considerably worse — **silently bills a cost centre that has no idea it is paying for this.**

**Step 4 — Create the service account.**

A service account is an identity for software rather than a person.

From the navigation menu choose **IAM & Admin**, then **Service Accounts**. Click **Create
service account** at the top.

Give it a name describing the integration — "reporting-automation" — and a description saying
what it does and who owns it. Click **Create and continue**.

**Step 5 — Grant the roles.**

You are now offered a "Grant this service account access to project" step. Section 3 lists
exactly which roles and why. Add them, then finish creating the account.

Its email address, which is its identity, appears in the list and looks like
`name@project-id.iam.gserviceaccount.com`.

**Step 6 — Decide how the automation will prove it is that service account.**

**There are two ways, and they are not equal.**

- **Workload Identity Federation — no key file at all.** The automation proves its identity
  through the environment it runs in. **This is the right answer and Google's own
  recommendation.** It requires setup by your cloud team and is specific to where the code
  runs. **Ask for it first.**
- **A downloaded JSON key file.** Simpler, and it creates a **long-lived credential in a file
  that never expires until somebody deletes it.** Leaked Google service account keys are one
  of the most commonly exploited cloud credentials in existence.

If you must use a key file: on the service account's page, open the **Keys** tab, click **Add
key**, then **Create new key**, and choose **JSON**. The file downloads immediately and
**Google does not keep a copy** — losing it means creating another.

Point the automation at it with the standard environment variable:

```
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/to/key.json
```

**Step 7 — Grant access to the datasets, if they live elsewhere.**

If the data is in another project, the roles from step 5 on your billing project do not reach
it. Open BigQuery, find the dataset, and use its **Sharing → Permissions** option to add the
service account's email address as a **BigQuery Data Viewer**.

**Step 8 — Set the spending ceiling before the first real query.**

Do not treat this as step 8 of 8 that can wait until tomorrow. Section 3 explains what to set.

---

## 3. What to choose, and why

**The roles:**

| Role | Why |
|---|---|
| **BigQuery Job User** (`roles/bigquery.jobUser`) on the **billing** project | Permission to run queries, billed to that project. Without it nothing runs. |
| **BigQuery Data Viewer** (`roles/bigquery.dataViewer`) on each **dataset** | Permission to read those specific tables. **Grant it per dataset, not on the whole project**, so the automation cannot wander into data nobody meant to expose. |
| **BigQuery Data Editor** | **Only if the automation must write.** Omit it for reporting work. |
| **BigQuery Admin** | **Do not grant this.** It can delete datasets. |

**Do not grant `roles/bigquery.user` on the whole project as a shortcut.** It bundles the
ability to create datasets, which a reporting automation has no reason to hold.

**The cost controls. These are mandatory, not advisory.**

**Control 1 — estimate every query before running it.** BigQuery offers a **dry run**: it
tells you how many bytes a query would read, costs nothing, and does not execute. **Run one
before every query and refuse to proceed above a threshold you have chosen deliberately.**

One caution that matters: **a dry run returns zero bytes on tables protected by row-level
security**, deliberately, so that the estimate cannot be used to infer hidden data. **Zero
does not mean free.** On any table that might carry row-level security, treat a zero estimate
as unknown and rely on the next control.

**Control 2 — set a hard limit on every job.** BigQuery accepts a setting called
`maximumBytesBilled`. **If the estimate exceeds it, the query fails immediately and you are
charged nothing.** This is the single most important guardrail, because it works even when
the estimate was wrong and even when nobody was watching. **Set it on every job, without
exception.**

**Control 3 — a per-identity daily quota.** In **IAM & Admin → Quotas**, BigQuery offers a
custom quota on query usage per day per user. Applied to the service account, it is a ceiling
nothing in your code can bypass. **This only works if the automation has its own service
account** — one shared by several systems cannot be bounded this way.

**Control 4 — a billing budget with alerts.** In **Billing → Budgets & alerts**, create a
budget on the project. It does not stop spending, but it tells somebody quickly. Combined
with control 2, that is a reasonable safety net.

**Control 5 — a label on every job.** Attaching a label such as `agent: reporting` to each
job is the only practical way to answer "what did this automation cost" afterwards. Add it
from the start; it cannot be applied retrospectively.

**What not to do:** do not respond to a cost overrun by switching the project to capacity
pricing. That is a much larger commitment and the wrong instrument for a query that should
never have been run in the first place.

---

## 4. How to check it worked

The safest possible test is a dry run, which reads nothing and costs nothing:

```bash
bq --project_id=$BILLING_PROJECT query --dry_run --use_legacy_sql=false \
  'SELECT 1'
```

**Success looks like** a line reading roughly `Query successfully validated. Assuming the
tables are not modified, running this query will process 0 bytes of data.`

Then confirm the identity in use and that it can see the datasets:

```bash
gcloud auth list
bq --project_id=$BILLING_PROJECT ls
```

**Success looks like** the service account's email address marked as active, followed by a
list of datasets. **Read the email address and confirm it is the service account, not your own
personal Google account** — running the test as yourself while the automation runs as the
service account is how a setup passes its test and then fails in production.

---

## 5. If it does not work

**"Access Denied: Project ... User does not have bigquery.jobs.create permission".** The
BigQuery Job User role is missing on the **billing** project. Note that the message names the
project — check it is the project you meant.

**"Access Denied: Table ... User does not have permission to query table".** Job User is
present but Data Viewer on that dataset is not. This is the step-7 case: the dataset is in a
different project from the one you set up.

**"Billing has not been enabled for this project".** Exactly what it says, and nothing
proceeds until a billing account is linked. Step 1.

**Permission changes that appear to have no effect.** Google Cloud permission changes can
take **a few minutes** to propagate. Wait before re-granting, and avoid the temptation to
grant a broader role because the narrow one "did not work" — very often it did, a minute
later.

**"Quota exceeded: Your usage exceeded the custom quota".** Control 3 doing its job. That is
a signal to look at what the automation is scanning, not to raise the quota reflexively.

**A query that succeeds but processes far more data than expected.** Read the dry-run estimate
before blaming the result. The usual causes are selecting all columns from a wide table
instead of the few needed, and a date filter that does not align with how the table is
partitioned, so every partition is read.

---

## 6. Keeping the credential safe

**A service account key file is a long-lived credential that does not expire.** It is among
the most valuable things an attacker can find in a code repository.

- **Prefer Workload Identity Federation and have no key file at all.** Every point below
  exists because key files are hard to keep safe.
- **If you have a key file, store it in a secrets manager**, or on disk readable only by the
  account that runs the automation. Point at it with `GOOGLE_APPLICATION_CREDENTIALS`.
- **Never paste the contents of a key file into a chat window, a ticket or a document.** It is
  recognisable JSON containing a private key, and it is scanned for.
- **Never commit a key file to a repository.** Add `*.json` key paths to `.gitignore` before
  you download the file, not after. Public repositories are scraped for these within minutes
  of a push.
- **Rotating it:** a service account can hold more than one key. Create the new key, move the
  automation onto it, confirm the checks in section 4, then **delete the old key** from the
  Keys tab. Do this on a schedule — a key that has existed for years and been copied between
  laptops is a liability regardless of whether it has leaked.
- **If it leaks:** go to **IAM & Admin → Service Accounts → the account → Keys** and **delete
  that key immediately**. Deletion takes effect at once for new authentication, though a token
  already issued stays valid **up to about an hour**. If the exposure is serious, **disable the
  service account** as well, which cuts access straight away. Then check **Billing** and the
  BigQuery job history for queries nobody recognises — unexplained spend is the first sign a
  leaked BigQuery credential is being used.
