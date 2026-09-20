---
name: account-based-analytics
description: Use for account-based marketing and sales analysis — account engagement scoring, buying-group coverage, account journey roll-ups, target-account penetration, or any B2B question where the unit of analysis is the account rather than the person. Rolls person-level touches and activity to the account and opportunity grain, handles multi-contact buying groups, and refuses to present person-level rates as account-level ones. Prevents an ABM programme measured on lead counts, which is the wrong grain by construction.
---

# Account-based analytics

ABM is a grain decision before it is an analysis. The programme is bought on
"we will penetrate these accounts", executed as ads and emails to individual
people, and then reported on lead counts — three different units in one
sentence. This skill fixes the unit first and computes second.

## The grain, decided once

| Unit | What one row is | When it is the right unit |
|---|---|---|
| **Person** | one contact or lead | email and ad delivery mechanics, deliverability, consent |
| **Buying group / demand unit** | the set of people at one account working one purchase | Forrester B2B Revenue Waterfall reporting, opportunity-linked coverage |
| **Account** | one company, at whatever the CRM calls a company | target-list penetration, engagement trend, territory work |
| **Account-opportunity** | one account × one open or closed deal | win rate, cycle, multithreading, pipeline questions |

**A person-grain conversion rate is roughly `1 ÷ (contacts per buying group)`
times the account-grain one.** With six contacts per deal, a 4% person-level
MQL→opportunity rate and a 24% account-level one are the same performance.
Comparing either to a benchmark computed on the other unit is comparing
nothing. See `funnel-model-designer` for the full stage mapping.

**Buying groups are not accounts.** A large account running two independent
purchases has two demand units. If your CRM has no object for the demand unit —
most do not — the defensible proxy is *account × opportunity*, and the residual
is people at the account attached to no opportunity. Count that residual and
report it; do not spread it across opportunities.

## Rolling person activity to the account

Every roll-up needs a declared rule, in this precedence order, with the match
rate for each tier reported.

| Tier | Rule | Precision | Where it comes from |
|---|---|---|---|
| 1 | **Explicit CRM association** | highest | Salesforce `Contact.AccountId`, `AccountContactRelation` (many-to-many, needs `IsActive`), `OpportunityContactRole` (`ContactId`, `OpportunityId`, `Role`, `IsPrimary`); HubSpot contact→company associations via `/crm/v4/objects/contacts/{id}/associations/companies` |
| 2 | **ABM platform mapping** | high, vendor-defined | the ABM tool's own account mapping; it is *their* resolution logic, not yours — record the vendor and version |
| 3 | **Email domain match** | medium | `split_part(email,'@',2)` against a company-domain table |
| 4 | **Reverse-IP / firmographic vendor** | low, probabilistic | vendor match confidence must be carried through, never rounded to a yes |
| — | **Unmatched** | — | counted, named, reported as its own line |

Four failure modes that the tier table does not solve:

1. **Free-email and shared domains.** `gmail.com`, `outlook.com`, ISP domains
   and university domains match hundreds of unrelated people to one "account".
   Maintain an exclusion list and route those people to unmatched, not to a
   fictional account.
2. **Multi-account contacts.** A person legitimately sits at two accounts
   (agency and client, parent and subsidiary, a job change mid-window).
   `AccountContactRelation` models this properly; a single `AccountId` does not.
   **Pick one rule and state it**: earliest association, primary association, or
   duplicate the touch to both accounts. Duplicating inflates account-level
   touch counts and must never feed a sum presented as total touches.
3. **Parent–child hierarchies.** `Account.ParentId` in Salesforce, the company
   hierarchy in HubSpot. A roll-up that stops at the legal entity and a roll-up
   that climbs to the ultimate parent produce different penetration numbers on
   the same data, often by a wide margin in enterprise. Declare the level.
4. **Job changes inside the window.** The touch happened at the old employer.
   Domain-match today attributes it to the new one. If the CRM does not keep
   association history, say the roll-up is as-of-today and that historical
   account attribution is approximate.

**Output the match ledger every time**, because it is the honest denominator:

```
touches_total                 the population being rolled up
matched_tier1 .. matched_tier4   count and share per tier
unmatched                     count and share
accounts_resolved             distinct accounts after roll-up
contacts_multi_account        count, and the rule applied to them
```

## Account engagement score

```
Account engagement (raw) = Σ over contacts at the account
                           Σ over touches in the window
                           weight(touch_type) × decay(days_since_touch)
```

- **Grain:** one row per account per window.
- **Denominator:** none — this is a sum, not a rate. It is therefore **not
  comparable across accounts of different sizes.**
- **Common miscomputation:** ranking accounts by raw engagement. A 4,000-person
  enterprise outranks a 40-person target on volume alone, and the ABM team
  chases the wrong list.

Two normalisations, both defensible, both needing a declaration:

```
Engagement per known contact = raw engagement ÷ contacts known at the account
Engagement per in-group contact = raw engagement ÷ contacts in the buying group
```

The first is dominated by how well you have mapped the account, which is a
data-completeness artefact, not buyer behaviour. The second is the one that
means something and needs a buying-group definition to exist. **If you cannot
normalise, say the score is unnormalised and rank within size bands instead.**

Weights are a choice, not a truth. Record them with the output:

```json
{"weights": {"meeting_held": 10, "demo_request": 8, "webinar_attend": 4,
             "content_download": 2, "email_click": 1, "page_view": 0.5},
 "decay": {"type": "exponential", "half_life_days": 30},
 "window_days": 90}
```

A score whose weights are not stated cannot be reproduced next quarter, and
scores from two different weight sets must never appear on one trendline
(`gtm-metric-dictionary` check C10).

## Coverage metrics that mean something

Each one below carries its denominator explicitly, because the four are
routinely swapped for each other.

```
Target-account reach     = target accounts with ≥1 touch in window
                           ÷ accounts on the target list
Target-account engagement= target accounts with engagement ≥ threshold
                           ÷ accounts on the target list
Buying-group coverage    = accounts with ≥1 known contact in each required role
                           ÷ accounts on the target list
Role fill rate           = required roles with ≥1 known contact
                           ÷ (required roles × accounts on the target list)
Multithreading           = distinct contacts with ≥1 activity on the opportunity
                           ÷ 1 (a count per opportunity, not a rate)
Time to first engagement = median days from programme start (or list add)
                           to first qualifying touch, per account
```

- **Grain:** account, except multithreading, which is opportunity.
- **The denominator is the target list, not accounts you happen to have data
  for.** Dividing by "accounts in the ABM platform" quietly drops every account
  you never reached, and reach then reads near 100%.
- **Reach is not engagement is not coverage.** One ad impression served to one
  intern is reach. "We reached 78% of the target list" alongside "we have a
  known economic buyer at 12%" is the honest pair, and the gap is usually the
  finding.
- **Use median for time-to-first-engagement**, never mean: the distribution has
  a long right tail of accounts that engaged once, late.

## Penetration against the target list

The target list must be **version-dated**. Accounts get added mid-quarter, and
penetration computed against today's list while counting last quarter's touches
mixes two populations. Emit `target_list_version` and `as_of_date`, and when
comparing periods compare against the list as it stood in each period.

Where the list lives in the CRM as a campaign, a list-membership object or a
checkbox field, read membership history where it exists and say "as-of-today"
where it does not.

## Ad-platform company data is not a target list

**LinkedIn `MEMBER_COMPANY` pivot output is not "accounts we targeted."** The
pivot includes companies you never targeted: members with multiple employers,
job-switchers, audience expansion, and parent/child company structures. Present
it as *companies where members saw the ad*, never as account coverage.

Two further LinkedIn constraints that change the numbers:

- Demographic and company pivots return only the **top 100 values per creative
  per day**, drop values with fewer than 3 events, and withhold values for ads
  with too little engagement. LinkedIn's own guidance is to **query at the
  highest level and the full period rather than summing lower levels** —
  campaign-level sums will not equal account-level totals, and daily sums will
  not equal the period total.
- Pivot values come back as URNs (`urn:li:organization:1111`). Labelling them
  requires a second resolution pass, which costs calls; budget it with
  `rate-limit-governor`.

## Where account-level attribution genuinely exists without a warehouse

The LinkedIn **Attributed Revenue Metrics** finder
(`GET /rest/adAnalytics?q=attributedRevenueMetrics`) returns CRM-joined fields:
`returnOnAdSpend`, `openOpportunities`, `opportunityWinRate`, `revenueWonInUsd`,
`closedWonOpportunities`, `opportunityAmountInUsd`, `averageDaysToClose`,
`averageDealSizeInUsd`, at ACCOUNT / CAMPAIGN_GROUP / CAMPAIGN pivots.

This is the highest-value ads endpoint in B2B because it closes the ad→pipeline
loop without a warehouse. Its documented limits are load-bearing:

- Requires a **connected CRM** in Business Manager, and takes **up to 72 hours**
  to populate after connection.
- `dateRange` must span **30 to 366 days**. Shorter windows are not available.
- **`opportunityAmountInUsd` and `openOpportunities` only return when
  `dateRange.end` is today in UTC.** Ask for a window ending yesterday and those
  fields come back null with no error — the silent-null trap. Check the end date
  before reporting "no open opportunities".
- Revenue fields are **USD** while `costInLocalCurrency` is the account's
  currency. **A single response can mix two currencies**; never divide one by
  the other without converting.
- Attribution is LinkedIn's join of LinkedIn's click to your CRM record. It is
  LinkedIn's attribution, not yours, and it will not agree with your
  multi-touch model. Label it as platform-attributed.

## Marketo Measure / Bizible touchpoints

Bizible attribution lands in Salesforce as ordinary custom objects:
`bizible2__Bizible_Attribution_Touchpoint__c` (opportunity-level),
`bizible2__Bizible_Touchpoint__c` (lead/contact-level) and
`bizible2__Bizible_Person__c`, plus Bizible-namespaced fields across Lead,
Contact, Account, Opportunity and Campaign.

Because they are ordinary Salesforce objects, SOQL, Bulk API 2.0 and
`POST /analytics/reports` all work on them — this is the one place in the stack
where an attribution report can be genuinely authored over an API.

**The trap: Bizible recalculates touchpoints in bulk on its own schedule.**
Attribution weights on an opportunity change retroactively, so the same report
run two weeks apart returns different numbers with nothing having "changed".
Snapshot outputs you intend to reproduce, and **never present Bizible
attribution as immutable.**

## Answering

Lead with the account-grain number, name the roll-up rule in one sentence, and
put the unmatched share next to it rather than in a footnote.

> **62 of the 180 target accounts have an engaged contact this quarter, so
> engaged reach is 34%.**
>
> Contacts were rolled to accounts by CRM association first and email domain
> second; 11% of touches matched no account and are excluded from the
> numerator, so 34% is a floor and the true figure is between 34% and 40% if
> every unmatched touch belonged to a target account. Role coverage is the
> weaker number: only 19 accounts have a known contact in the economic-buyer
> role, so we are reaching accounts more than we are reaching buying groups.
>
> For a programme health check the 34% is fine. For deciding where sellers
> spend next month, use the role-coverage list, which names the 43 accounts
> with engagement but no buyer contact.
>
> Does not claim the engagement caused anything: no holdout ran, and target
> accounts receive sales attention as well as marketing.

## Honest limits

- **Without identity resolution there is no account grain**, only a domain
  guess. If `identity-resolution` has not run and no CRM association exists,
  say the roll-up is domain-only and give the domain-match rate.
- **Buying-group role coverage is unavailable where roles are not captured.**
  `OpportunityContactRole.Role` populated on 20% of opportunities supports a
  statement about those 20% and nothing else. Report the population rate first.
- **Engagement scores are not comparable across accounts, across weight
  versions, or to any external benchmark.** They rank within one org, one
  window, one weight set.
- **Account-level attribution from an ad platform is the platform's own join.**
  It answers "what does LinkedIn think it influenced", which is a real and
  useful question, and it is not the same question as "what drove pipeline".

## Core contracts this skill calls

- `answer-contract` — every account-grain figure, and the `unavailable` /
  `partial` / `lower_bound` results when roll-up or role data is missing
- `provenance-block` — currency (the USD-vs-local mix above), timezone, window,
  freshness, and the measured-vs-modelled label on platform attribution
- `comparability-rules` — before any comparison or sum crosses a platform
  boundary, and before ad-platform company data sits next to CRM accounts
- `warning-field-reader` — LinkedIn's empty `elements` (indistinguishable
  between no activity and no access), thresholded demographic pivots,
  Salesforce `allData`
- `pagination-patterns` — `adAnalytics` does not paginate and caps at 15,000
  elements; Salesforce report reads cap at 2,000 rows with no pagination
- `rate-limit-governor` — LinkedIn's 45M-metric-values-per-5-minutes volume
  limit and the extra URN-resolution calls

## References

- `references/rollup-rules.md` — the roll-up decision table with per-platform
  field names, the ambiguity ledger, and worked multi-account cases
- `references/coverage-metrics.md` — every coverage metric with formula,
  denominator, grain and its common miscomputation

## Related skills

- `identity-resolution` runs before this one; its `canonical_account_id` is the
  join key
- `funnel-model-designer` for the person-versus-demand-unit stage model
- `gtm-metric-dictionary` for win rate, pipeline and ACV definitions at account
  grain
- `journey-assembler` for the ordered touch sequence this skill aggregates
- `multi-touch-attribution` when the question is credit, not coverage
