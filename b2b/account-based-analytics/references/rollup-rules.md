# Roll-up rules: person → account

The roll-up is the whole analysis. Everything downstream inherits its match
rate and its ambiguity. This file is the decision table, the per-platform field
names, and the cases that break the simple rule.

## 1. The precedence ladder, in full

Apply in order. A touch is matched at the highest tier that resolves it, and
the tier is recorded on the row so the match ledger can be produced later.

### Tier 1 — explicit CRM association

**Salesforce**

| Object | Fields | Notes |
|---|---|---|
| `Contact` | `Id`, `AccountId`, `Email`, `CreatedDate` | one account per contact; the simple case |
| `AccountContactRelation` | `ContactId`, `AccountId`, `Roles`, `IsActive`, `IsDirect`, `StartDate`, `EndDate` | the many-to-many model; **only exists if Contacts to Multiple Accounts is enabled** |
| `Lead` | `Id`, `Email`, `Company`, `ConvertedAccountId`, `IsConverted` | an unconverted lead has **no** `AccountId` — `Company` is free text typed by a human |
| `OpportunityContactRole` | `ContactId`, `OpportunityId`, `Role`, `IsPrimary` | the buying-group evidence; usually sparsely populated |
| `Account` | `Id`, `ParentId`, `Website`, `Type` | `ParentId` is the hierarchy; climb or don't, but declare which |
| `Task` / `Event` | `WhoId` (Contact/Lead), `WhatId` (Account/Opportunity), `ActivityDate` | `WhatId` gives a direct account link when populated |

**HubSpot**

| Surface | Path / property | Notes |
|---|---|---|
| contact→company | `GET /crm/v4/objects/contacts/{id}/associations/companies` | association labels distinguish primary from secondary |
| deal→contact | `GET /crm/v4/objects/deals/{id}/associations/contacts` | the buying-group proxy |
| company hierarchy | parent/child company associations | same climb-or-not decision as `ParentId` |
| rollups | `num_associated_contacts` and similar | **computed asynchronously; can be stale or null on read**, and cannot be filtered reliably in search |

Note the permission asymmetry when you compare the two: a Salesforce report is
scoped to the running user's sharing rules and can show *fewer* rows than an
admin sees, while a HubSpot private-app token is portal-scoped and ignores user
roles and field permissions, so it typically shows *more* than any UI user.
Neither is wrong; both must be labelled (`permission-effect-audit`).

### Tier 2 — ABM platform mapping

The ABM tool has already resolved person→account with its own logic. Use it,
and record it as a vendor decision: which vendor, which mapping version, what
the vendor's own confidence field said. Do not merge a vendor mapping with your
own domain match into one undifferentiated "matched" bucket — they have
different error profiles and the vendor's is opaque.

### Tier 3 — email domain match

```sql
lower(split_part(contact_email, '@', 2)) = lower(account_domain)
```

Requires a company-domain table with one row per account and per known alias
domain (acquisitions, country domains, brand domains). Without alias handling,
every acquired subsidiary reads as a separate unmatched company.

**Exclude before matching:**

- free-mail and ISP domains (`gmail`, `outlook`, `yahoo`, `icloud`, and the
  long tail of national ISPs)
- education and government generic domains where they are not targets
- your own domain and any test domains — internal traffic matched to a customer
  account is a silent contaminant in every engagement score

Excluded contacts go to **unmatched**, never to a synthetic account.

### Tier 4 — probabilistic / reverse-IP / firmographic vendor

Carries a confidence score. **Keep the score.** A 0.62-confidence match and a
1.0 CRM association must not be summed into one count without the composition
being statable. Where a decision is expensive (a target-list add, a seller
assignment), set a confidence floor and report what fell below it.

### Unmatched

Not an error state. A number, reported next to the result, with its direction
of effect named: unmatched touches make reach and engagement **understate**,
because the numerator loses them while the target-list denominator is unchanged.

## 2. The ambiguity ledger

Emit with every roll-up:

```
touches_total
matched_tier1, matched_tier2, matched_tier3, matched_tier4    count + share
unmatched                                                      count + share
contacts_multi_account        count, and the tie-break rule applied
accounts_from_free_domain     count excluded (should be 0 after filtering)
accounts_rolled_to_parent     count, if hierarchy climbing is on
job_change_suspected          contacts whose domain disagrees with CRM account
```

## 3. Cases that break the simple rule

**A contact at two accounts.** Three defensible rules:

| Rule | Effect | Use when |
|---|---|---|
| Primary association wins | one touch, one account | the CRM marks a primary and it is maintained |
| Earliest association wins | stable over time, ages badly | historical analysis where today's state is wrong |
| Duplicate to both | account-level counts inflate | per-account engagement matters more than totals |

If you duplicate, **the sum of account-level touches exceeds total touches**,
and any total computed from the account table is wrong. Keep the un-duplicated
total as the reportable one.

**Parent and child.** Rolling a subsidiary's touches to the ultimate parent
makes a global account look engaged when one country engaged. Not rolling makes
a genuinely coordinated enterprise pursuit look like six unrelated accounts.
There is no right answer; there is a declared one. State it, and where it
matters, show both.

**Agencies, resellers and partners.** They engage on behalf of an end customer.
Domain match sends the touch to the agency. If partner-sourced motion matters,
it needs its own account type and its own line in the report, not silent
inclusion.

**Job changes.** Where `AccountContactRelation.StartDate` / `EndDate` exist,
attribute the touch to the relationship active at the touch timestamp. Where
they do not, the roll-up is as-of-today, and long windows accumulate error in
one direction: recent employers gain touches that happened at old ones.

**Unconverted leads.** No `AccountId` exists. `Lead.Company` is free text —
"IBM", "I.B.M.", "ibm corp" and "IBM UK Ltd" are four accounts by string match.
Normalise on domain, not on company name, and report leads with a free-mail
address as unmatched rather than guessing.

## 4. Validating the roll-up before using it

Four cheap checks that catch most roll-up defects:

1. **Account count sanity.** Distinct accounts after roll-up versus accounts in
   the CRM. Far more means the domain table is missing aliases; far fewer means
   over-aggressive parent climbing.
2. **Top-account concentration.** If one account holds an implausible share of
   touches, look for a free-mail domain that escaped the filter or an internal
   domain matched to a customer.
3. **Match rate by source.** A source with a much lower match rate than the
   others (content syndication, list purchase) is usually supplying free-mail
   addresses, and its engagement will be structurally understated.
4. **Reconcile one account by hand.** Pick an account with a known deal, list
   its touches, and have a seller confirm the people are real. One manual check
   catches association errors that no aggregate test will surface.
