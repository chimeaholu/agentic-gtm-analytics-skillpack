# Connecting Snowflake — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has not set up a
Snowflake credential before. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** Creating a user, a role and a warehouse requires someone with
administrative rights in Snowflake — usually a person holding the `ACCOUNTADMIN` or
`SECURITYADMIN` role, which in most companies is the data platform team. **The commands
below are run by that person, not by you, unless you are that person.**

**If you need to ask, send them this, which is the whole request:**

> "Please create a dedicated Snowflake user for an automated reporting integration, using
> key-pair authentication — I will send the public key. Give it a read-only role with usage
> on only the databases and schemas it needs, and its own extra-small warehouse with
> auto-suspend set low and a resource monitor attached. Send me back the account identifier,
> the user name, the role name and the warehouse name."

**Plan and tier.** No special edition is required. What matters is which role the user gets
and which warehouse it runs on.

**How long it takes.** **Twenty to thirty minutes** of actual work. The delay, if there is
one, is getting the platform team's attention — the change itself is small and routine for
them.

**The warning that belongs at the top: this is the one platform in the pack where a mistake
spends money directly.** Snowflake charges for compute time on a **warehouse**, which is
Snowflake's word for a pool of compute — nothing to do with a data warehouse in the general
sense. **A query left running on a large warehouse costs real money for as long as it runs,
and an automation that retries a heavy query in a loop can run up a substantial bill
overnight with nothing to show for it.** Section 3 explains how to bound that, and it is not
optional.

---

## 2. The steps

**Step 1 — Get the account identifier.**

Every Snowflake account has an identifier used to build its web address, usually in the form
`<organisation>-<account>`. You can read it from the address bar while signed in, or the
platform team can tell you.

```
SNOWFLAKE_ACCOUNT=<organisation>-<account>
```

**Step 2 — Decide which sign-in method you are building.**

| Method | What it is | When to use it |
|---|---|---|
| **Key-pair** | You generate a matched pair of keys, give Snowflake the public half, keep the private half, and sign a short-lived token with it | **The recommended path, and the default choice for automation.** |
| **Programmatic Access Token** | A long-lived bearer token | Simpler to hold, but **usually requires a network policy attached to the user** before it will be accepted |
| **OAuth** | A person signs in and the automation acts on their behalf | When the work must be attributed to a human |
| **Username and password** | — | **Do not build on this.** Snowflake is actively removing single-factor password sign-in. |

The rest of this walkthrough follows the key-pair path.

**Step 3 — Generate the key pair.**

A key pair is two matched files: a **private key** you keep, and a **public key** you hand
over. Anything signed with the private key can be verified with the public one.

Run this on a machine you trust:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_key.p8 -nocrypt
openssl rsa -in snowflake_key.p8 -pubout -out snowflake_key.pub
```

**Success looks like** two files. `snowflake_key.p8` begins with `-----BEGIN PRIVATE KEY-----`
and `snowflake_key.pub` begins with `-----BEGIN PUBLIC KEY-----`.

**`-nocrypt` means the private key file is not itself password-protected.** That is convenient
for an unattended automation and it means **the file is the credential** — anyone who copies
it can sign in. If your security policy requires an encrypted key, remove `-nocrypt`, set a
passphrase, and supply that passphrase to the automation separately.

**Step 4 — Send the public half to the administrator.**

Open `snowflake_key.pub`, and copy everything **between** the `BEGIN` and `END` lines as a
single block with the line breaks removed.

**Send the `.pub` file. Never send the `.p8` file.** The public key is safe to email; the
private key is not safe to send anywhere at all. If you are ever asked for the private key,
the person asking has misunderstood, and sending it is a security incident.

**Step 5 — The administrator runs these, which is the whole server-side setup.**

```sql
-- the identity
CREATE USER reporting_agent
  TYPE = SERVICE
  RSA_PUBLIC_KEY = 'MIIBIjANBgkq...paste the public key body here...';

-- its own compute, so the cost is separately visible and bounded
CREATE WAREHOUSE reporting_agent_wh
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE;

-- a role that grants only what is needed
CREATE ROLE reporting_agent_role;
GRANT USAGE ON WAREHOUSE reporting_agent_wh TO ROLE reporting_agent_role;
GRANT USAGE ON DATABASE <db> TO ROLE reporting_agent_role;
GRANT USAGE ON SCHEMA <db>.<schema> TO ROLE reporting_agent_role;
GRANT SELECT ON ALL TABLES IN SCHEMA <db>.<schema> TO ROLE reporting_agent_role;
GRANT SELECT ON FUTURE TABLES IN SCHEMA <db>.<schema> TO ROLE reporting_agent_role;

GRANT ROLE reporting_agent_role TO USER reporting_agent;
ALTER USER reporting_agent SET
  DEFAULT_ROLE = reporting_agent_role,
  DEFAULT_WAREHOUSE = reporting_agent_wh;
```

Read section 3 before running these — the warehouse size and the grants are decisions, not
defaults.

**Step 6 — Record the four values.**

```
SNOWFLAKE_ACCOUNT=<organisation>-<account>
SNOWFLAKE_USER=reporting_agent
SNOWFLAKE_ROLE=reporting_agent_role
SNOWFLAKE_WAREHOUSE=reporting_agent_wh
```

Plus the private key file, stored wherever your secrets live.

**Step 7 — Understand how the private key is used at run time.**

The private key is never sent. The automation uses it to sign a short-lived token —
**maximum one hour, and there is no way to refresh one.** A scheduled job signs a new token
each run. Most Snowflake client libraries do this for you if you hand them the key file;
check before writing token-signing code by hand.

---

## 3. What to choose, and why

**The role is the security boundary. Every query runs as a role, and the role decides
everything the automation can see.** Grant usage on the specific databases and schemas it
needs and select on their tables. **Do not grant `ACCOUNTADMIN` or `SYSADMIN` to an
automation** — those can drop objects and change billing-relevant settings.

**The warehouse is a cost decision, and this is the part people get wrong.**

**How Snowflake charges, in plain terms:** you pay for the time a warehouse is running,
priced by its size. **Each size step up roughly doubles the cost per unit of time.** A query
that takes 10 minutes on an extra-small warehouse might take 5 on a small one — and cost
about the same. But a query that gains nothing from more compute costs double for no benefit.

| Setting | Choose | Why |
|---|---|---|
| `WAREHOUSE_SIZE` | **`XSMALL`** to begin with | The cheapest step. Move up only when you have measured a query that genuinely needs it — not because something felt slow once. |
| `AUTO_SUSPEND` | **60** seconds | Stops the warehouse shortly after the automation goes quiet. A warehouse left running with no queries still bills. |
| `AUTO_RESUME` | `TRUE` | Starts it again on the next query, so suspending costs nothing in convenience. |
| A **resource monitor** | **Attach one** | A hard ceiling on credits per period, which can suspend the warehouse when hit. **This is the control that turns a runaway loop from an incident into a stopped job.** Ask the administrator to set one. |
| `STATEMENT_TIMEOUT_IN_SECONDS` | Set it deliberately | Caps how long any one query may run. Without it, a badly-formed query can run for hours. |

**One detail with a real cost effect: a warehouse that resumes is billed for a minimum
period — commonly 60 seconds — even if the query takes two.** So **sixty small queries spread
across an hour can cost far more than one query that does the same work.** Batching is a cost
decision on Snowflake, not only a tidiness one.

**Give the automation its own warehouse rather than sharing one.** Two reasons: you can
answer "what did this cost" with a straight figure, and a ceiling set on a shared warehouse
punishes everyone else when the automation misbehaves.

---

## 4. How to check it worked

```bash
curl -s -X POST "https://$SNOWFLAKE_ACCOUNT.snowflakecomputing.com/api/v2/statements" \
  -H "Authorization: Bearer $SNOWFLAKE_JWT" \
  -H "X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"statement":"SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_TIMEZONE()",
       "timeout":30}'
```

**Success looks like** JSON containing a `data` block with one row of three values: the role
name, the warehouse name, and a timezone.

**Read all three and record them.**

- **The role** confirms which identity every future number is attributed to.
- **The warehouse** confirms the cost lands where you intended. If it shows a shared
  warehouse, the cost attribution you set up is not actually in effect.
- **The timezone is the one to pay attention to.** On many accounts it is **not UTC** — a
  Los Angeles timezone is a common default. That silently changes what "today" and "this
  month" mean in every query you write. **Write it down and state it alongside any
  date-bounded figure.**

---

## 5. If it does not work

**"JWT token is invalid" or a 401.** In order of likelihood: the token has **expired** (they
last at most an hour); the public key on the user does not match the private key you signed
with; the account identifier in the address is wrong. Regenerate the token first, since that
takes seconds.

**A Programmatic Access Token is rejected although it looks correct.** These commonly require
a **network policy** attached to the user — a rule listing which network addresses may
connect. This is the usual reason a correct-looking token fails, and the message does not say
so.

**"Object does not exist, or operation cannot be performed"** on a table you know exists.
Almost always a missing grant. Snowflake deliberately does not distinguish "this does not
exist" from "you may not see this", to avoid confirming the existence of objects to
unauthorised users. Take the object name to the administrator and ask for usage and select
on it.

**"No active warehouse selected in the current session".** The user has no default warehouse,
or the role lacks usage on it. Both are one command for the administrator.

**Queries succeed but are extremely slow, or the bill is larger than expected.** Check the
warehouse actually in use with `CURRENT_WAREHOUSE()`, then look at whether the automation is
issuing many small queries — each one potentially incurring the minimum billing period from
section 3. Consolidating them is usually the fix.

---

## 6. Keeping the credential safe

**The private key file is the credential. Anybody holding it can sign in as that user.**

- **Store the `.p8` file in a secrets manager**, or on disk with permissions restricting it to
  the account that runs the automation (`chmod 600`). If policy demands it, encrypt it with a
  passphrase and supply the passphrase separately.
- **Never send the private key by email or chat.** The public key is the half you share.
- **Never commit a private key to a repository.** Key files are among the most reliably
  detected secrets in automated scanning, which means an attacker finds it as fast as your
  own tooling does.
- **Never paste key contents into a support ticket.** No legitimate support process needs it.
- **Rotating it:** Snowflake lets a user hold **two public keys at once** (`RSA_PUBLIC_KEY`
  and `RSA_PUBLIC_KEY_2`) precisely so that rotation causes no outage. Add the new public key,
  move the automation to the new private key, confirm the check in section 4 passes, then
  have the administrator remove the old one.
- **If it leaks:** have the administrator run
  `ALTER USER <user> UNSET RSA_PUBLIC_KEY;` immediately, which stops any new token being
  accepted. **A token already issued remains valid until it expires — up to an hour** — so if
  the leak is serious, also disable the user with `ALTER USER <user> SET DISABLED = TRUE;`.
  Then ask the administrator to review that user's query history for anything unfamiliar, and
  check the warehouse's credit usage for unexpected spend.
