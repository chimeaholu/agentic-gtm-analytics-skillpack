# Connecting Cube Cloud — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has not opened Cube
Cloud's settings before. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need an account on the Cube Cloud deployment with enough rights
to view its settings and environment variables — in practice a **deployment owner or an
admin on the Cube Cloud account**. A person who can only open the Playground and run queries
usually cannot see the value you need in step 3.

**If you need to ask someone, ask for exactly this:**

> "For an automated reporting integration against our Cube deployment, please send me two
> things through our password manager: the deployment's REST API base URL, and the value of
> the `CUBEJS_API_SECRET` environment variable. Also tell me which security-context claims
> the model expects in the token — for example a tenant or company identifier — because a
> token without them returns wrong data rather than an error."

That last sentence is the important one and is explained in section 3.

**Plan and hosting.** There is no plan gate on API access itself. What does matter is
**whether this is Cube Cloud or self-hosted Cube Core**, because the addresses are entirely
different and some Cube Cloud features do not exist in Core. Establish which one you are
dealing with before anything else — if the person you are asking does not know, the presence
of a `cubecloud.dev` web address is a strong signal it is Cloud.

**How long it takes.** **Ten to twenty minutes**, assuming somebody can give you the two
values. This is one of the least painful setups in the pack. The difficulty here is not
getting connected — it is getting the token contents right, which is section 3.

**One thing to understand before you start.** Cube does not hand you a ready-made key to
paste. **You build the credential yourself**: you take a shared secret, and use it to sign a
short-lived token that also carries a statement of who the automation is acting as. That
statement changes which rows come back. This is a good design and it is unusual, so it
catches people out.

---

## 2. The steps

**Step 1 — Establish whether this is Cube Cloud or Cube Core.**

Ask. If it is **Cube Cloud**, each deployment has its own web address, typically in the form
`https://<something>.cubecloud.dev`. If it is **self-hosted Cube Core**, the address is
wherever the company runs it, and there is no Cube Cloud interface to visit at all — in that
case skip to step 3 and get the secret from whoever operates the service.

**Step 2 — Find the deployment's REST API address.**

Sign in to Cube Cloud and open the deployment you were told to use. The REST API base address
is shown on the deployment's own pages, in the material describing how to connect an
application to it.

**UI wording check:** Cube Cloud's navigation has changed several times, so rather than a
menu path, look for the place that shows connection details for the deployment — it is
usually reachable from the deployment's overview or from a section about connecting or
integrating. Search the interface for **"API"** if it is not obvious.

The address you want ends in `/cubejs-api/v1`. It looks roughly like:

```
https://<deployment-name>.cubecloud.dev/cubejs-api/v1
```

Copy it exactly, including the `/cubejs-api/v1` at the end. **Never hard-code a Cube address
from another project's documentation** — every deployment has its own.

```
CUBE_API_URL=https://<deployment-name>.cubecloud.dev/cubejs-api/v1
```

**Step 3 — Find the API secret.**

The credential is an environment variable on the deployment named **`CUBEJS_API_SECRET`**.
In Cube Cloud it lives with the deployment's other environment variables, under the
deployment's settings or configuration area.

**UI wording check:** the section is commonly labelled **Environment variables** and sits
under the deployment's settings. If you cannot find it, search the interface for
**"environment"**.

The value is a long random string with no meaningful prefix. Copy it into your password
manager immediately.

```
CUBEJS_API_SECRET=<the value of CUBEJS_API_SECRET>
```

**Do not confuse this with a Cube Cloud account token.** Cube Cloud also issues tokens for
managing the Cube Cloud account and its deployments — a different credential for a different
purpose. **The one you need for querying data is `CUBEJS_API_SECRET` from the deployment
itself.** If someone hands you a token and it does not work for queries, this mix-up is the
first thing to check.

**Step 4 — Work out what the token must say about who is asking.**

Read section 3 before doing this. Ask whoever maintains the Cube data model which claims
belong in the token — a claim is one named value inside it, for example a company or tenant
identifier. Write the answer down; you need it in the next step.

**Step 5 — Build a token.**

A token here is a **JSON Web Token**, meaning a short block of text containing some values
plus a signature proving it was made by somebody holding the secret. You create it; Cube
does not issue it.

```python
# pip install pyjwt
import jwt, time, os

payload = {
    "exp": int(time.time()) + 3600,   # valid for one hour
    # the security context - replace with the claims your model actually expects
    # "tenant_id": "acme",
}

token = jwt.encode(payload, os.environ["CUBEJS_API_SECRET"], algorithm="HS256")
print(token)
```

**Success looks like** a long string printed in three parts separated by full stops,
beginning `eyJ`. That is what a JSON Web Token always looks like.

Put it where your automation reads its settings from:

```
CUBE_JWT=<the token printed above>
```

**Tokens expire.** The example above lasts one hour. **Anything running on a schedule must
create a fresh token each run rather than storing one**, in exactly the way the snippet above
does. A stored token that worked yesterday fails today, which looks like a broken credential
and is not.

**Step 6 — A note about development mode, because it produces a false sense of success.**

Cube in development mode can be configured to accept requests without a token at all. **A
setup that works perfectly on a developer's machine can fail on its first real deployment
for this reason alone.** Always test against the deployment you will actually use.

---

## 3. What to choose, and why

**There are no permission checkboxes here.** What you choose instead is **what the token
says**, and that has a larger effect on the answers than any checkbox on another platform.

**The security context is the whole game.** Cube takes the values inside the token and feeds
them into the model's own logic, which uses them to decide which rows to return.

**Where this goes wrong, and it goes wrong silently:**

| What you put in the token | What comes back |
|---|---|
| The claims the model expects, with correct values | The right answer |
| The claims the model expects, with a **wrong** value | **A complete, well-formed, entirely wrong answer.** No error. |
| **No claims at all**, against a model that expects them | Usually an empty or tiny result that looks like an empty deployment |

**None of these three produce an error message.** That is the reason this section exists.
**Decide the identity deliberately, confirm it with whoever owns the model, and record it
alongside every number the automation produces.** A figure with no record of the context it
was produced under cannot be reproduced or defended.

**Token lifetime.** One hour is a reasonable default. Longer lifetimes mean a leaked token
stays useful for longer; shorter ones mean more re-signing. Do not create tokens with no
expiry.

**The model itself is the other control.** What the automation can see is bounded by what the
model exposes. If a measure is missing, that is a data-model question for whoever maintains
it, not a credential question.

---

## 4. How to check it worked

Ask Cube to describe its model:

```bash
curl -s -H "Authorization: $CUBE_JWT" "$CUBE_API_URL/meta" | head -c 400
```

Note the header has **no `Bearer` prefix** — Cube takes the token directly. This trips people
who have connected other platforms.

**Success looks like** JSON beginning with `{"cubes":[` followed by definitions of the cubes
in the model, each with a name and lists of measures and dimensions.

**The failure to watch for is not an error.** If the response is valid JSON but the cube list
is **empty or much smaller than expected**, that is almost always the security context from
section 3 — not an empty deployment. **Check the token contents before concluding anything
about the model.**

---

## 5. If it does not work

**A 403 response, or a message about an invalid token.** The signature did not verify. Either
the secret is wrong, or the token was signed with a different algorithm than the deployment
expects, or — very commonly — **the token has expired**. Generate a new one and try again
before investigating anything else.

**"Authorization header isn't set" or a 401.** The header is missing or misspelled. Remember
that Cube expects the raw token, **not** `Bearer <token>`.

**The `/meta` response is valid but nearly empty.** The security context, from section 3.
This is the characteristic Cube failure and it does not announce itself. Ask the model owner
what claims the token must carry.

**Every request fails to connect at all.** The address is wrong. Confirm it ends in
`/cubejs-api/v1` and that you are using this deployment's own host rather than one copied
from documentation or another environment.

**It works locally and fails against the deployment.** Development mode, from step 6 —
locally the token requirement may be switched off entirely, so an incorrect token appears to
work.

---

## 6. Keeping the credential safe

**`CUBEJS_API_SECRET` is more sensitive than a normal API key.** It is not a key that grants
a fixed level of access — it is the signing secret, so **anyone holding it can mint a token
claiming to be any tenant or any user the model recognises.** In a multi-customer deployment
that means reading any customer's data.

- **Store the secret in a secrets manager.** The automation should read it from an
  environment variable and sign a token at run time.
- **Never store or share a signed token as though it were the credential.** Tokens are
  disposable; create one per run.
- **Never paste the secret, or a token, into a chat window, ticket or shared document.** A
  token in a chat log is usable by anyone who finds it until it expires.
- **Never commit either to a repository.**
- **Rotating it:** changing `CUBEJS_API_SECRET` on the deployment **invalidates every
  existing token at once**, including any other integration signing with it. Find out what
  else uses it first, then change the variable and update every signer together. Expect a
  brief outage and schedule it.
- **If it leaks:** rotate the secret immediately — that is the only action that revokes
  access, because individual tokens cannot be cancelled. Until it is rotated, every token
  ever signed with it, including ones an attacker makes themselves, stays valid. Then review
  the deployment's request logs for contexts the automation would never legitimately have
  used.
