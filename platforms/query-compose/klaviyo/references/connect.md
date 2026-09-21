# Connecting Klaviyo — a guided walkthrough

This is written to be read out loud, one step at a time, to somebody who has never opened
Klaviyo's API settings. Do not skip ahead and do not batch the steps.

---

## 1. What you will need before starting

**Who has to do this.** You need an account on the Klaviyo organisation with permission to
manage API keys — in practice an **Owner, Admin or Manager**. A user with a lower role can
send campaigns but will not see the API keys page at all.

**If you need to ask, ask for exactly this:**

> "Please create a Klaviyo private API key for an automated reporting integration, with
> custom scopes set to read-only on Metrics, Campaigns, Flows, Lists, Segments and Profiles,
> and send it to me through our password manager. Please do not give it full access."

**Plan and tier.** Any paid Klaviyo account has API access. Some reporting endpoints depend
on which channels the account uses — an account without SMS has no SMS statistics to read —
but there is no separate API add-on to buy.

**How long it takes.** **Ten minutes.** This is one of the gentlest setups in the pack.

**The part that is not gentle, and it is not the key.** Klaviyo reporting has two traps that
produce confidently wrong numbers rather than errors:

1. **Every single request must carry a date-stamped version header.** Without it the request
   fails on the very first call. This is covered in step 4.
2. **A parameter called `conversion_metric_id` defines what the word "revenue" means for the
   whole response, and nothing in the response records which one was used.** Two people can
   pull the same campaign and get figures that differ by a large multiple, both correct.
   This is covered in step 6 and it is the reason this walkthrough is longer than the setup
   deserves.

---

## 2. The steps

**Step 1 — Sign in and open the API keys page.**

Sign in to Klaviyo. Open the account settings — reached from the account or organisation
name, which in current versions sits at the **bottom left** of the screen and in older
versions at the **top right**. Within settings, find **API keys**.

**UI wording check:** Klaviyo has moved this menu between releases. If the path above does
not match what you see, use the interface search and look for **"API keys"**. The page you
want lists any existing keys with their names and creation dates, and has a button to create
a new one.

**Step 2 — Create a private key.**

Click the button to create a private API key. It reads **Create Private API Key**.

Give it a name that describes the integration — "reporting automation" — not "test" or
"key1". That name is the only clue anyone will have in a year when deciding whether the key
is safe to delete.

**Step 3 — Choose the access level, and choose custom.**

You are offered a full-access option and a custom option. **Choose custom.** Section 3 lists
exactly what to tick and why. Do not accept full access because it is quicker; full access
includes the ability to send campaigns to your customers.

Create the key. Klaviyo shows it once. **It begins `pk_` followed by a long string of letters
and digits.** Copy it into your password manager now, then into your automation's settings:

```
KLAVIYO_PRIVATE_KEY=pk_...
```

It is sent on every request in a header reading
`Authorization: Klaviyo-API-Key pk_...` — note that the word before the key is
`Klaviyo-API-Key`, not the more usual `Bearer`.

**Step 4 — Set the version header. Skipping this is the most common first failure.**

Klaviyo versions its API by date. **Every request must carry a header named `revision` whose
value is a date in `YYYY-MM-DD` form.** A request without it is rejected.

The current default at the time this module was written was **`2026-07-15`**. Klaviyo
publishes a new revision roughly every quarter, and older ones — `2024-10-15`, `2025-01-15`
and `2025-04-15` among them — are already retired.

**Pin one revision in your configuration and record which one produced any number you
report.** Do not let it float to "whatever is current", because a new revision can change the
shape of a response, and a report that silently changed definition is worse than one that
broke.

```
KLAVIYO_REVISION=2026-07-15
```

**Step 5 — Set the content type.**

Klaviyo's API uses a specific JSON style. Requests and responses use the content type
`application/vnd.api+json`. If your tool lets you set a default `accept` header, set it to
that.

**Step 6 — Decide what "conversion" means, and write the decision down.**

**Do not treat this as an optional refinement. It is part of connecting.**

Klaviyo's campaign and flow reporting requires you to name a **conversion metric** — the
event that counts as a conversion. Everything downstream is computed relative to it:
conversions, conversion value, conversion rate, revenue per recipient, average order value.

| If the conversion metric is | "Conversion value" means |
|---|---|
| **Placed Order** | Revenue from completed orders attributed to the message |
| **Checkout Started** | The value of carts that reached checkout, most of which were never paid for |
| A custom metric | Whatever the account defined it to be |

**All of these are valid and all look identical in the response.** Nothing in the output says
which was used. This is the usual cause of two people producing contradictory revenue figures
for the same campaign and both defending them.

Find the available metrics and their IDs with the same call used to test the key in section
4. **Pick one — in most e-commerce accounts, Placed Order — record its ID in configuration,
and state the choice in plain words alongside every revenue figure you report.**

---

## 3. What to choose, and why

When you chose custom access in step 2, you are given a list of areas, each of which can be
set to no access, read-only, or read and write.

| Area | Set it to | Why |
|---|---|---|
| **Metrics** | Read | Required. This is how you find the conversion metric ID and read event statistics. |
| **Campaigns** | Read | Campaign reporting — sends, opens, clicks, revenue. |
| **Flows** | Read | Automated-series reporting. Omit only if the account uses no flows. |
| **Lists** | Read | Resolving which audience a campaign went to. |
| **Segments** | Read | The same, for dynamic audiences. |
| **Profiles** | Read | Only if the analysis needs person-level data. **This is personal information — leave it off if counts are enough.** |
| **Everything else** | No access | Nothing else is needed to read reports. |

**Set nothing to write.** A key with write access to Campaigns can **send email and SMS to
your customers**. That is a real-world, unrecallable action affecting real people and, on
SMS, real money. There is no reason a reporting automation should hold that ability, and
every reason it should not.

**A 403 refusal later means a missing tick here, not a bad key.** Klaviyo distinguishes the
two clearly and the distinction saves an afternoon: **401 means the key is missing or wrong;
403 means the key is genuine but lacks the scope for that request.** Sending somebody off to
regenerate a key when they need to re-scope one is the standard wasted afternoon on this
platform.

**One more choice that is about capacity rather than security.** A private key shares a
single rate-limit budget with **every other private-key integration on the account**. A
Klaviyo OAuth application gets its own budget per installation. On a busy account already
running several integrations, that difference decides whether your automation runs or is
starved. If the account is heavily integrated, raise this before building on a private key.

---

## 4. How to check it worked

```bash
curl -s "https://a.klaviyo.com/api/metrics/" \
  -H "Authorization: Klaviyo-API-Key $KLAVIYO_PRIVATE_KEY" \
  -H "revision: $KLAVIYO_REVISION" \
  -H "accept: application/vnd.api+json"
```

**Success looks like** JSON containing a `data` list, where each entry has an `id` and an
`attributes` block with a `name` — you should recognise names such as "Placed Order",
"Received Email", "Opened Email".

**Do this while you are here:** find the metric you decided on in step 6, copy its `id`, and
put it in your configuration.

```
KLAVIYO_CONVERSION_METRIC_ID=<the id of the metric you chose>
```

Nothing else in this setup is as likely to produce a wrong answer later as getting this
wrong.

---

## 5. If it does not work

**A message about a missing or invalid `revision` header.** Step 4. Every request needs it,
including the first one. This is the most common Klaviyo first failure by a wide margin.

**A 401 response.** The key is absent, mistyped, or has been deleted. Check the header spells
`Klaviyo-API-Key` correctly — using `Bearer` instead produces exactly this.

**A 403 response.** The key works; the scope is missing. Go back to the API keys page, look at
the key's custom scopes, and add the read permission for the area you were calling. **Do not
create a new key** — it will have the same problem unless you change the ticks.

**A message that the revision is deprecated or no longer supported.** The pinned date has
aged out. Move to a current revision deliberately, check that the responses you depend on are
unchanged, and update the recorded revision in your reporting.

**A 429 response.** You are sharing the account's rate-limit budget with other integrations —
see the last point in section 3. Slow down; this is a capacity problem, not a credential one.

**The revenue number looks wrong, but nothing errored.** Almost certainly the conversion
metric, from step 6. Check which metric ID was used before doubting the data.

---

## 6. Keeping the credential safe

**A Klaviyo private key reaches customer data** — email addresses, phone numbers, purchase
history. Treat it as personal data, because that is what it is.

- **Store it in a password manager or secrets store**, read from an environment variable at
  run time.
- **Never paste it into a chat window, a ticket, a spreadsheet or an email.** Keys beginning
  `pk_` are a recognised pattern and are actively scanned for by people who find them useful.
- **Never commit it to a repository**, including a private one. Public repositories are
  scraped for this pattern within minutes.
- **Never put it in a browser URL.** Some other platforms tolerate that; it also puts the key
  into server logs, browser history and analytics along the way.
- **Rotating it:** create a second private key with the same scopes, move the automation onto
  it, confirm the test in section 4 passes, then delete the old one from the API keys page.
- **If it leaks:** delete the key from the API keys page **immediately**. Deletion is instant.
  Then create a replacement. Because the key can read customer personal data, treat a leak as
  a potential data incident and tell whoever owns that process at your company — do not make
  that judgement alone.
