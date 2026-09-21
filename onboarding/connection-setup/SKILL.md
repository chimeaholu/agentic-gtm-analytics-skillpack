---
name: connection-setup
description: Use when anyone asks for help connecting a platform, getting API access, or finding a key — "help me connect my stack", "set up HubSpot", "how do I give you access to Salesforce", "I don't know where to get an API key", "why is this returning 403". Runs the guided connection walkthrough for the right platform, one step at a time, out loud, for a person who has never opened a developer settings page. States the auth-cost gradient before anything starts, because the difference between two minutes and three weeks decides what the person should do today. Checks for an official MCP server first. Runs the verification call at the end and interprets the result. Resumes a half-finished setup without starting over.
---

# Connection setup

**This skill is a conversation, not a document.** Its entire job is to get one credential
working for one person who does not already know where things live, without losing them
halfway through.

Three rules govern everything below.

1. **One step at a time. Always.** Read a step, wait, get confirmation, read the next.
   **Never paste a whole walkthrough into the chat.** A person who receives twenty steps at
   once does not do twenty steps — they do three, get lost on the fourth, and abandon it.
   The walkthroughs are written to be read aloud in pieces; reading them out whole defeats
   the format they were written in.
2. **The cost comes first.** Before anyone opens a settings page, say how long their
   platform takes. Someone who starts Google Ads believing it takes five minutes quits on
   day two. Someone told it takes three weeks starts the application today and does
   something else meanwhile. **Same facts, opposite outcome.**
3. **The person is not the problem.** These setups are genuinely hard, scattered across
   multiple consoles, and documented for developers. **Never say "simply" or "just".** If
   they are stuck, the process is badly designed, and saying so out loud keeps them in the
   chair.

---

## 1. Open by finding out what they actually need

Two questions, in this order.

**"Which platform do you want to connect?"**

If they name one, go to section 2.

**If they say they are not sure, or "all of them", do not list platforms. Ask what they
are trying to find out.**

> "What's the question you're hoping to answer? I'll tell you the cheapest platform that
> answers it — some of these take two minutes and some take three weeks, and there's no
> point starting a three-week one if a two-minute one gets you there."

Then route on the answer:

| They want to know | Cheapest platform that answers it | What it costs |
|---|---|---|
| How people use our product, activation, retention, funnels | **PostHog** | **Two minutes** |
| Which campaigns brought traffic, where visitors came from, what pages work | **GA4** | About 30 minutes |
| What's in the pipeline, win rates, who's stalling, forecast | **HubSpot** or **Salesforce** — whichever they actually use | About an hour |
| Email and lifecycle performance | **Klaviyo** (B2C) or **Marketo** (B2B) | Minutes / about an hour |
| Ad spend and return | the platform the money is on: **Meta**, **LinkedIn** or **Google Ads** | **Days to weeks — say so now** |
| Everything joined together | **The warehouse if there is one.** Otherwise start with one platform | varies |

**Always recommend the cheapest platform that genuinely answers the question**, and say why
you picked it. **Do not recommend connecting several platforms at once.** One working
connection beats three abandoned ones, and the first success is what makes the second
attempt happen.

**If they genuinely have no specific question yet, recommend PostHog** — it takes two
minutes, it needs no approval from anybody, and it ends the session with something working
rather than something pending.

---

## 2. State the cost before anything else

**Say this before the first instruction, every time. Quote the specific number for their
platform.**

| Time to working access | Platforms | What the time actually is |
|---|---|---|
| **Minutes** | PostHog, Mixpanel, Amplitude, Klaviyo, Segment, Iterable, Braze, RudderStack, Cube | Creating a key. No approval, no waiting. |
| **About 30 minutes** | GA4, BigQuery, Snowflake | Several settings across more than one console. No waiting on anybody. |
| **About an hour** | Salesforce, HubSpot, Marketo, Looker, Tableau | Needs an administrator, and careful permission choices. No external approval. |
| **Hours to days** | Power BI / Fabric | A tenant administrator must enable service principals, and capacity questions apply. |
| **Days** | **Meta Ads, LinkedIn Ads** | **A human at the vendor reviews an application. You cannot accelerate it.** |
| **Days to weeks** | **Google Ads** | **Tiered, human-reviewed developer-token approval. Each tier is a separate, rejectable application. The starting tier cannot reach production accounts at all.** |

Then add the two sentences that change what people do:

> **"Auth cost has nothing to do with how useful the data is. The two-minute platforms have
> some of the best query surfaces in the stack, and the three-week one has a three-tool
> read-only interface."**

> **"If yours is in the days or weeks band, start the application today and let's connect
> something fast while it sits in the queue. You'll have real answers this afternoon
> instead of in three weeks."**

**For Meta, LinkedIn and Google Ads, say the number before step 1 of the walkthrough, not
after.** Someone who learns on day four that they are waiting until day twenty concludes
the tool is broken.

---

## 3. Check for an official MCP server first

**Do this before sending anyone to a settings page.** An MCP server that is already
connected can skip the entire credential process, and finding that out costs one tool
listing.

Call `core/mcp-detect-fallback` and run its probe:

1. **Is a server for this platform connected in this session?** List the available tools and
   look. Do not assume from memory — a tool that existed last week may not exist now.
2. **If one is connected, does it expose the capability needed?** A connected server is not
   evidence it can do the job. HubSpot's official server has **zero analytics tools**.
   Salesforce's official server is developer tooling with **no reporting tools at all**.
   Both are routinely assumed to cover reporting; neither does.
3. **If it covers the need, say so and stop.** "There's already a HubSpot connection
   available here and it can read your CRM records. We don't need to create an API key at
   all." That is a two-minute outcome instead of an hour.
4. **If it is connected but does not cover the need, say exactly that**, then continue to
   the walkthrough: "There is a HubSpot server connected, but it has no analytics tools, so
   for the traffic question we do need a Private App token. Here's the walkthrough."
5. **If none exists, say so plainly and continue.** For LinkedIn Ads there is no official
   server and the community field is a clone farm — **do not suggest installing one.**

**Never invent an MCP server that might exist.** The register in `core/mcp-detect-fallback`
lists which platforms genuinely have official servers. Check it rather than guessing.

---

## 4. Drive the walkthrough, one step at a time

Each platform's walkthrough lives at `platforms/<tier>/<platform>/references/connect.md`:

| Platform | Walkthrough | Cost |
|---|---|---|
| PostHog | `platforms/authoring/posthog/references/connect.md` | Two minutes |
| HubSpot | `platforms/extract/hubspot/references/connect.md` | About an hour |
| Salesforce | `platforms/authoring/salesforce/references/connect.md` | One to four hours |
| GA4 | `platforms/extract/ga4/references/connect.md` | About 30 minutes |
| Marketo | `platforms/extract/marketo/references/connect.md` | 30 to 60 minutes |
| Meta Ads | `platforms/extract/meta-ads/references/connect.md` | **Days** |
| LinkedIn Ads | `platforms/extract/linkedin-ads/references/connect.md` | **Days** |
| Google Ads | `platforms/extract/google-ads/references/connect.md` | **Days to weeks** |

**If the platform has no walkthrough yet, say so plainly** and work from the module's
`(a) Auth setup` section, applying the same one-step-at-a-time discipline. Do not pretend a
walkthrough exists.

### How to run one

**Read section 1 of the walkthrough first, in full.** That is the prerequisites: the
permission level, the plan requirement, how long it takes and any damage warnings.
**Confirm they have the access before starting the steps.** Discovering at step 9 that they
were never an administrator wastes the whole session — and section 1 of every walkthrough
contains the exact wording to send their administrator, so send that instead of improvising.

**Then, for each numbered step:**

1. Read the step, and only that step.
2. Read the "what you should be seeing" description with it. **This is what stops people
   completing a step on the wrong screen** — which is invisible until much later.
3. Wait for confirmation.
4. **If they say they cannot find it, do not repeat the same words louder.** The
   walkthroughs give a search term for exactly this reason. Vendor interfaces move between
   releases; the search box is reliable and the menu path is not.
5. **If their screen does not match the description, believe them.** Ask what they see.
   Never insist on a menu path against the evidence of the person looking at it — that is
   how a walkthrough becomes a fight. Record the mismatch in the final report.
6. Move to the next step.

**When the walkthrough reaches its "what to choose" section — scopes, permissions, roles —
slow down.** That section is where setups fail silently, hours later, on the one call that
mattered. Read the reasons, not only the names, and let them ask.

**Stop the walkthrough and check in when:**

- They have to copy a credential — remind them where it goes and where it must not go
- The walkthrough warns about damage or cost — read the warning out, do not summarise it
- A step needs someone else — send the prepared request wording and pause

**Never ask them to paste the credential into the chat.** Not to check it, not to help
debug. Ask for the **first four characters** and the **length** — enough to tell `phx_`
from `phc_`, or to spot a truncated paste, and not enough to be useful to anyone.

---

## 5. Run the verification and interpret the result

**Always finish by running the verification call.** A setup that has not been tested is not
finished, it is merely believed.

Section 4 of every walkthrough holds one copy-pasteable call and the exact successful
response.

**Then interpret it. Do not paste raw output at the person.**

| What came back | What to say |
|---|---|
| Success with data | **"That's working."** Say what it proved, and what they can now ask for. |
| **Success with an empty result** | **This is a real finding, not a failure.** The credential works and that project, portal or account is empty. Usually it means the wrong project, the wrong region, or a sandbox instead of the live system. **On Meta and LinkedIn it usually means the access tier, not an empty account** — check that before concluding anything. |
| A permission error | Name the specific missing permission from the walkthrough's section 5, and whether it is fixable without redoing the setup. On HubSpot, Salesforce and Marketo it is a five-minute edit and the credential does not change — **say that, because people assume they have to start over.** |
| An authentication error | Check the host and the region before the credential. Wrong region and wrong instance address produce authentication errors far more often than a wrong key does. |
| Anything else | Go to the walkthrough's section 5, which translates that platform's common failures into plain language. |

**Then report back in plain terms:**

> "Connected. I can read your deals, companies and contacts. I can't read your marketing
> email statistics yet — that needs one more scope ticked, which takes about two minutes
> whenever you want it. Want me to pull the pipeline now?"

**End with something concrete they can ask for.** The point of a connection is the first
answer it produces, and the session should not end on a green tick.

---

## 6. Resuming a half-finished setup

**People stop partway through constantly** — a meeting, an administrator who has not
replied, a multi-day review. Resuming well is most of this skill's value.

**Never restart from step 1 without checking.** Redoing completed work is how a person
decides the tool is not worth it.

**Ask what exists already, in this order:**

1. **"Do you have a credential already — a key, token, or file — even if you're not sure it
   works?"** If yes, **go straight to the verification call in section 5.** A failing
   credential tells you precisely which step is incomplete, faster than any conversation
   can. This is the single most efficient move in the whole skill.
2. **"Did you submit an application?"** For Google Ads, Meta and LinkedIn, check the
   current status in the vendor console before anything else. If it is still pending,
   there is nothing to do and saying so is the entire answer — **do not invent work while
   waiting.**
3. **"Did you get as far as asking an administrator?"** If it is waiting on a person, offer
   the prepared request wording from section 1 of the walkthrough again, and offer to
   connect a fast platform meanwhile.

**Use the error to locate the step.** Each walkthrough's section 5 maps failures to the
step that causes them:

| Symptom | Resume at |
|---|---|
| Permission or scope error | The walkthrough's "what to choose" section — the credential is fine |
| GA4 403 on the property | **Step 9 — the property-level access grant.** Nearly always this |
| Google Ads `USER_PERMISSION_DENIED` | The login customer ID, before checking any permissions |
| Meta or LinkedIn empty results | The access tier — the review, not the configuration |
| Salesforce 401 | The instance address, before the token |
| Marketo returns less than expected | The role's permissions — a silent failure by design |

**Then resume at that step, not at the beginning**, and say why: "Your token is fine. What's
missing is one grant inside Google Analytics itself, which is step 9. That's about two
minutes."

---

## 7. Things to say, and things never to say

**Say:**

- **The honest time cost, first.** Including when it is days or weeks.
- **"This is a genuinely awkward setup"** when it is. It keeps people in the chair.
- **"You'll need to ask an administrator, and here's exactly what to send them"** — with
  the wording ready.
- **The damage warnings, read out rather than summarised.** GA4 Editor access can lose data
  permanently with no backfill. Write access on any ad platform spends real money with no
  undo. A Marketo campaign permission can email the entire database.

**Never say:**

- **"Simply" or "just".** Not once. These setups are not simple, which is the reason this
  skill exists.
- **A menu path you are not confident about.** Describe the destination and give the search
  term. Vendor interfaces move; a confidently wrong path destroys trust faster than an
  honest "search for this".
- **"It should work now"** without running the verification.
- **"Paste your key here so I can check it."** Ever.

---

## Files

- `references/gradient.md` — the auth-cost gradient in full, what the time is actually
  spent on per platform, and what connecting each one does *not* buy you.
- `references/resume.md` — the resume playbook: symptom-to-step mapping for every platform
  with a walkthrough, and how to tell a pending approval from a broken setup.
- `evals/cases.json` — behavioural cases, including the ones that matter most: not dumping
  the whole list, stating multi-day costs before starting, and never asking for the
  credential in chat.

## Calls

- `core/mcp-detect-fallback` — **first**, before sending anyone to a settings page
- The platform module's `references/connect.md` — the walkthrough itself
- `platforms/platform-router` — after the connection works, to route the first real question
