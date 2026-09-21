# Connecting Amplitude — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Amplitude's project settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need to be an **Admin or Manager** on the Amplitude organisation
or project. A member with a lower role can see the API key but **usually cannot reveal the
secret key**, which is the half that matters.

**If you need to ask an admin, ask for exactly this:**

> "Please send me the API key and the secret key for the [name] Amplitude project, through our
> password manager. Also tell me whether the account is on the EU data region, and which plan
> the account is on — some reporting endpoints are restricted on the lower tiers."

**Plan and tier.** **Free and Starter plans restrict the reporting API and some endpoints
entirely.** "Amplitude has this API" and "your account may call it" are different statements.
Confirm the tier before promising anything.

**How long it takes.** **About two minutes** if you are an admin. This is the lowest-friction
setup in the pack — no application review, no approval queue, no waiting on anybody outside
your team.

**Two things to understand before starting, because neither is about the credential.**

1. **The secret key is broad and cannot be narrowed.** There is no read-only version, no
   per-endpoint scoping, no restricted variant. **You issue the key, and the key can do what
   the key can do.** Other platforms in this pack let you hand out a limited credential.
   Amplitude does not. Treat it accordingly.
2. **Amplitude does not count your requests. It prices them.** A single well-formed question
   can exceed the entire allowance on its own, and long date ranges are what make that happen.
   Section 3 explains the arithmetic. **Read it before planning any analysis**, not after the
   first refusal.

---

## 2. The steps

**Step 1 — Work out which region the account is in, before anything else.**

Amplitude runs a United States region and a **European Union** region, and they are separate
systems with different addresses.

| Region | Address for reporting requests |
|---|---|
| United States (default) | `https://amplitude.com` |
| European Union | `https://analytics.eu.amplitude.com` |

**Using the wrong address produces confusing authentication errors rather than a redirect.**
The failure looks like a bad credential, so people spend an hour re-issuing a perfectly good
key. Ask which region the account is in; the address people use to sign in tells you.

**Step 2 — Sign in and open project settings.**

Sign in at the correct regional address. Open **Settings**, then **Projects**, then click the
project you want. On that project's page open **General**.

**UI wording check:** Amplitude's navigation has changed across releases. If the path above
does not match, use the interface's own search and look for **"Projects"** — the destination
is the settings page for one specific project, which shows that project's keys.

**Step 3 — Copy the two values.**

On that page are an **API Key** and a **Secret Key**. Both are long strings of letters and
digits, roughly 32 characters, with no prefix to distinguish them — **which means it is easy
to swap them over and easy not to notice.** Label them carefully as you copy.

```
AMPLITUDE_API_KEY=<the API Key>
AMPLITUDE_SECRET_KEY=<the Secret Key>
```

The secret key may be hidden behind a reveal control, and revealing it may require an admin
role. If you cannot see it, you do not have the role — go back to section 1.

**Keys are per project.** An organisation with several Amplitude projects needs **one pair per
project**. A key from the wrong project authenticates fine and returns data about the wrong
product, with nothing to indicate the mix-up.

**Step 4 — Know how they are sent.**

The two values are sent together as an ordinary username-and-password pair — the API key as
the username, the secret key as the password. That is why the example in section 4 uses
`-u "key:secret"`.

**Step 5 — Confirm the plan tier covers what you intend to do.**

If the account is on Free or Starter, some reporting endpoints refuse regardless of the
credential. This produces a refusal on a call that "should work", and no amount of
re-issuing keys fixes it. Establish this now rather than after building something.

---

## 3. What to choose, and why

**There is nothing to tick.** Amplitude does not offer scopes, per-endpoint permissions, or a
read-only key. That absence is itself the thing to plan around:

- **The key is project-scoped and broadly capable.** Anyone holding it can read that project's
  analytics.
- **You cannot issue a reduced key to a contractor or a third party.** If you need to, the
  only mechanism is a separate project.
- **Because it cannot be narrowed, where it is stored matters more than on other platforms.**
  Section 6 is not boilerplate here.

**What you do have to choose is the shape of every query, because of the cost model.**

Amplitude meters a notion of **cost** rather than counting requests. Roughly:

```
cost = (number of days) x (number of segments and filters) x (a per-query-type cost)
```

Retention queries are the most expensive kind, funnels scale with the number of steps and
breakdowns, and sessions sit in between.

**The budgets you are working inside:**

| Limit | Value |
|---|---|
| Requests running at the same time | **5** |
| **Cost within any 5-minute window** | **1,000** |
| Cost per hour | **108,000** |

**Why this punishes long date ranges specifically.** Because the number of days multiplies
everything else, a query's cost grows in a straight line with the range. **A 90-day retention
query with three segments comes out around 2,160 — more than double the entire 5-minute
budget. It cannot succeed at any time of day, under any circumstances.** An automation that
issues it, receives a refusal, and retries politely will retry forever and never get an answer.

**So, as a matter of connecting rather than optimising:**

- **Estimate the cost before issuing a query, and refuse to issue one that cannot fit.**
- **Narrow the date range first** when something is too expensive; it is the factor with the
  largest effect.
- **Treat a refusal as a signal to re-plan, never as a signal to retry.**

---

## 4. How to check it worked

For a United States account:

```bash
curl -s -u "$AMPLITUDE_API_KEY:$AMPLITUDE_SECRET_KEY" \
  "https://amplitude.com/api/2/sessions/average?start=20260901&end=20260907"
```

For an EU account, replace the host with `https://analytics.eu.amplitude.com`.

Note the deliberately **short date range**. That is not incidental — a wide range here can
consume a large share of the budget on a test.

**Success looks like** JSON containing a `data` block with `series` and `xValues` — a set of
dates and a set of numbers.

**Failure looks like** either an authentication message, or an HTML page rather than JSON,
which usually means the address itself was wrong.

---

## 5. If it does not work

**An authentication error on credentials you are confident about.** The region, from step 1.
Try the other regional host before touching the key. This is the most common Amplitude
failure and it presents as a credential problem.

**A 403 on a request that ought to work.** The plan tier. Free and Starter restrict parts of
the reporting API. Re-issuing the key will not change this; the account needs a different
plan, or the analysis needs a different approach.

**A 401.** The key or the secret is wrong — or, very commonly, **the two were swapped**. They
look alike and there is no prefix to catch the mistake. Re-check which is which before
concluding anything.

**A 429, or a message about exceeding limits.** The cost model from section 3, not a request
count. **Do not retry.** Work out the cost of the query you issued; if it exceeds 1,000, no
retry schedule will ever let it through. Narrow the date range or reduce the segments.

**Data comes back but describes a product you do not recognise.** The keys are from a
different project. Keys are per project and nothing in a response identifies which project
answered.

---

## 6. Keeping the credential safe

**The secret key grants broad read access to your product analytics, and it cannot be
narrowed.** Storage discipline is the only control you have.

- **Store both values in a password manager or secrets store**, read from environment
  variables at run time.
- **Never paste the secret key into a chat window, a ticket or a shared document.** Because it
  is a plain string of letters and digits with no distinctive prefix, automated secret
  scanners are **less** likely to catch it in a leak than a prefixed key from another
  platform — the safety net you may be relying on elsewhere is weaker here.
- **Never commit it to a repository.**
- **Never put it in a browser URL.**
- **Rotating it:** Amplitude's project settings allow the keys to be regenerated.
  **Regeneration invalidates the old key immediately, and there is no overlap period**, so
  anything else using the same project's keys stops working the moment you do it. **Find out
  what else uses them first** — data pipelines and third-party integrations commonly share a
  project key — then rotate and update every consumer in one planned window.
- **If it leaks:** regenerate the key without waiting, accepting the brief outage. There is no
  way to revoke a leaked Amplitude key other than replacing it. Then tell whoever owns
  security at your company, because the key reaches user behaviour data that is likely to
  count as personal information.
