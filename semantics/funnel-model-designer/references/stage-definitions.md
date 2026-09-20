# Worked stage definitions

Two models. Pick one, do not blend them, and record which.

---

## Model A: lead-centric (SiriusDecisions Demand Waterfall lineage)

Unit: **a person**. Scope: new acquisition.

### Inquiry

- **entry**: any inbound hand-raise. Form fill, content download, event scan,
  chat, inbound call, trial signup.
- **exit**: scored to MQL (forward), disqualified (terminal), or dormant after
  N days (terminal, and N must be stated).
- **source**: MAP person record creation, or first form submission timestamp.
- **trap**: list purchases and content syndication land here and convert at a
  fraction of inbound rates. **Always split by source**, because the blended
  Inquiry→MQL rate moves with source mix, not with quality.

### MQL

- **entry**: score crosses the threshold, or a hand-raise of a designated type
  (demo request, pricing page plus form).
- **exit**: accepted by sales (forward), recycled (backward), disqualified
  (terminal).
- **source**: MAP lifecycle stage change, or a score-crossing event.
- **trap**: **no industry-standard definition exists**. The threshold is
  versioned and usually undocumented. If marketing is compensated on MQL count,
  the threshold drifts down over time; the signature is rising MQL volume with
  falling MQL→SQL rate.

### SAL (Sales Accepted Lead)

- **entry**: a sales rep accepts the lead. **This is a receipt, not a
  judgment.**
- **exit**: qualified to SQL (forward), rejected back to marketing (backward,
  with a reason), or disqualified (terminal).
- **source**: a lead status value, an accepted timestamp, or an owner
  assignment plus first activity.
- **trap**: **frequently not instrumented at all.** Without it, MQL→SQL
  conflates "worked and rejected" with "never touched", and these have opposite
  fixes. If it is missing, say so as a finding.

### SQL / SQO

- **entry**: sales confirms fit, need, and usually budget or timing. Where the
  org means SQO, an opportunity record exists.
- **exit**: opportunity created or advanced (forward), disqualified (terminal).
- **source**: lead status, or opportunity creation.
- **trap**: **"SQL" and "SQO" are different objects at different grains** and
  orgs use the terms interchangeably. Resolve the noun before using any rate
  that involves it.

### Opportunity

- **entry**: an opportunity record with an amount.
- **exit**: stage progression, or closure.
- **trap**: orgs create opportunities at wildly different trigger points, from
  first meeting to verbal commitment. **Identical win rates at different
  creation triggers mean completely different things**, and this makes
  cross-org benchmarking of win rate close to meaningless.

### Closed Won / Lost / No Decision

- **trap**: **bucketing "Closed - No Decision" as Lost inflates the loss rate**
  and hides the real competitive picture. If the CRM has no separate value, win
  rate cannot be computed on the decision-basis denominator, and you say so
  rather than approximating.

---

## Model B: buying-group centric (Forrester B2B Revenue Waterfall lineage)

Unit: **a demand unit**, a buying group within an account. Scope: the full
revenue lifecycle including retention and expansion.

### Why it exists

In enterprise B2B, six or more people are involved in a purchase. Measuring
each of them as an independent funnel entrant produces conversion rates
roughly `1/n` of the truth, and a "lead" that converts is really a group that
converted.

### Stage shape

| Stage | Entry | Exit |
|---|---|---|
| **Audience** | accounts in the ICP | any group-level signal |
| **Engaged buying group** | ≥2 identified roles from one account show intent within a window | group-level qualification |
| **Prioritised group** | the group meets fit and intent thresholds | sales engagement |
| **Qualified opportunity** | opportunity exists at account grain with an identified group | progression or closure |
| **Won** | closed won | onboarding |
| **Retained / expanded** | renewal or expansion event | churn or further expansion |

### What it requires that Model A does not

1. **Role identification within an account.** Champion, economic buyer,
   technical evaluator, end user. Most CRMs do not populate these natively; it
   is a data-collection project.
2. **A group-formation rule.** How many identified people, within what window,
   with what intent, constitute a buying group? This is a modelling decision
   and it must be versioned.
3. **Account-grain touch rollup.** Individual touches roll up to the account or
   the opportunity, and person-level journeys are not the analysis unit.

**If roles are not identified, Model B cannot be measured.** Say that, rather
than approximating it by counting accounts with more than one contact, which is
a different thing and will be quoted as if it were the buying group.

---

## Model C: product / PLG funnel

Unit: **user** or **account**, and the two give different answers in a
team-adoption product.

| Stage | Definition | Trap |
|---|---|---|
| **Signup** | account created | free-mail signups and internal test accounts must be excluded, with the exclusion rule stated |
| **Activated** | the user completed the value action | **"activation" is a chosen threshold**; different choices produce different retention curves, so version it |
| **Habituated** | N actions in M days | the N and M are the metric, not settings |
| **Team-expanded** | a second user from the same account joins | needs account-level identity, which is where domain grouping tempts people (see `relationship-discovery`) |
| **Converted to paid** | first payment | trial expiry versus active conversion are different events |
| **Retained** | still active at day 30 / 90 | "active" needs the same definition it had last quarter |

Three structural decisions to record:

- **Step ordering**: strict sequence or any-order set completion?
- **Conversion window**: within a session, 7 days, 30 days? The window is part
  of the metric.
- **First-time-only steps**: activation can only happen once, so its
  denominator differs from a repeatable step's.

---

## Model D: ecommerce funnel

Unit: **session** for the top, **order** for the bottom, and **this is a
legitimate unit change that must be declared** rather than papered over.

| Stage | Denominator | Trap |
|---|---|---|
| Session | sessions | sessionization gap is a convention; changing it restates history |
| Product view | sessions | bot traffic inflates it more than any other step |
| Add to cart | sessions | carts persist across sessions, so cart-grain and session-grain rates differ |
| Checkout start | carts or sessions, declare which | |
| Order | sessions (for CVR) or checkouts (for checkout completion) | **conversion rate and checkout completion rate are different metrics with different denominators, and both get called "conversion rate"** |

Guest checkout breaks the person link, so anything downstream of the order that
needs a customer (repeat rate, LTV) has a coverage gap that must be disclosed.

---

## The stage definition template

Copy this per stage. Every field earns its place; an unfilled field is a finding.

```yaml
stage:
  name:
  order:
  unit_of_analysis:         # must match the funnel's declared unit
  entry_criteria:           # testable
  exit_criteria:            # forward, backward and terminal, each named
  owner:                    # a role, accountable for movement
  source_field:             # field and system where the transition is observable
  instrumented:             # yes | no | partial
  definition_version:
  effective_from:
  known_gaming_vector:      # how this stage gets inflated when incentivised
  min_cohort_size: 30
```
