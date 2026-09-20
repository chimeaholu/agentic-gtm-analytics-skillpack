# Deterministic key precedence for GTM, and the fuzzy-matching prohibition

This file covers the keys a join may run through. The person and account spine
itself belongs to `identity-resolution`; this is the narrower question of which
column you are allowed to join on.

---

## 1. The precedence

Join through the highest available rung. Do not fall through to a lower rung
without recording that you did.

| Rung | Key | Notes |
|---|---|---|
| 1 | **Platform-native primary key** | `opportunity_id`, `contact_id`, `subscription_id`. Unambiguous within the system. |
| 2 | **Maintained cross-system mapping field** | the CRM ID written onto the MAP record, or a mapping table someone owns. This is the only *good* cross-system key. |
| 3 | **Normalised email** | lowercase, trim. Plus-addressing stripping is a **policy decision**: write it down, because it changes who is the same person. |
| 4 | **Hashed user identifier** passed through the stack | good when it exists; check the hash salt is stable across systems |
| 5 | **Deterministic cookie-to-user binding captured at login** | the anonymous-to-known link. Evidence-bearing and timestamped. |
| 6 | **Deterministic device or order identifier** | order number shared between store and ESP |
| — | **Fuzzy name similarity** | **prohibited** |
| — | **Email domain similarity** | **prohibited** |

---

## 2. Why email domain matching is prohibited

It looks like the obvious way to group people into accounts. It is wrong in at
least five common ways:

1. **Free-mail domains.** `gmail.com`, `outlook.com`, `qq.com`. Matching on
   these merges thousands of unrelated people into one "account". In B2C and
   SMB B2B this is most of the list.
2. **Shared corporate domains across subsidiaries.** One domain, several legal
   entities, several contracts, several renewal dates. Merging them makes NRR
   uncomputable at the contracting entity.
3. **Separate domains for one company.** Acquisitions, regional domains,
   brand domains. The same account looks like four.
4. **Agencies, resellers and consultants.** A person at `agency.example` buying
   on behalf of three clients is not one account relationship.
5. **Domain reuse and expiry.** Domains change hands.

Where domain grouping is genuinely wanted, it is a **modelling decision with an
explicit allowlist and denylist**, owned by a human, versioned, and labelled as
a heuristic on every number derived from it. It is not a join key discovered by
this skill.

---

## 3. Why fuzzy name matching is prohibited

A similarity score is a guess with a decimal point on it. Three specific
failure shapes:

- **"Acme Corp" vs "Acme Corporation"**: probably the same, occasionally not.
- **"Acme Holdings" vs "Acme Ltd"**: often genuinely different legal entities
  with different contracts, which is exactly the distinction revenue reporting
  depends on.
- **Short or common names**: "Apex", "Summit", "Meridian". High similarity between
  unrelated companies.

The failure is asymmetric and silent. A false merge combines two accounts'
revenue, which inflates one account's ARR and deletes another account entirely
from the customer count. Nothing errors and the totals still reconcile, because
the money did not move, only the grouping did.

**If deterministic keys do not exist, the joined question is `unavailable`.**
Give the marginal totals from each side, name the missing key, and name the
change that would create it. An honest "these two systems cannot be joined
deterministically; here is each side separately" beats a fuzzy-matched answer
that nobody can audit.

---

## 4. Email normalisation is a policy, not a default

Decide and record:

| Decision | Options | Effect |
|---|---|---|
| case | always lowercase | safe, do it |
| whitespace | trim | safe, do it |
| plus-addressing | strip `+tag` or keep it | **changes who is the same person**; strip is usual for consumer, keep is safer for B2B where teams use `billing+vendor@` deliberately |
| dots in gmail addresses | ignore or respect | gmail ignores them; other providers do not. Provider-specific rules are a rabbit hole; most orgs correctly decide not to. |
| role addresses (`info@`, `sales@`) | exclude from person identity | they are not a person; treating them as one merges an organisation into a contact |

Whatever you choose, it goes in the metric contract register, because changing
it later restates every person-denominated metric in the history.

---

## 5. A monetary amount is never multiplied across multiple touches

This is a hard rule and it is separate from the join question.

If an opportunity has four preceding touchpoints, joining opportunity to
touchpoint produces four rows carrying the full amount. Summing gives 4x the
revenue. The three correct handlings:

1. **Aggregate the touch side first** and join the aggregate (touch count,
   first touch, last touch) back to the opportunity.
2. **Allocate with a stated attribution model**, producing fractional credit
   that sums to the original amount. Fractional credit is not a count of
   deals and must never be rendered as one.
3. **Keep them separate**: report opportunity revenue at opportunity grain and
   touch counts at touch grain, and say which filters move which number.

See `attribution-rule-based` for the allocation models and
`calculation-integrity-audit` for the assertion that catches the 4x.

---

## 6. Recording the fall-through

When you use a lower rung, record it, because downstream consumers need to know
the answer is weaker than it looks:

```
key_used: normalised_email
rung: 3
higher_rungs_unavailable:
  - rung 1: no shared primary key between the two systems
  - rung 2: the MAP record has a crm_id field, but it is populated on 34% of
            records, so it covers a third of the join
normalisation_policy: lowercase, trim, plus-addressing preserved
effect: people who use plus-addressing appear as multiple persons; this
        inflates person counts and deflates per-person conversion rates
```

That block is three lines of output and it is the difference between a number
someone can defend and a number someone has to re-derive.
