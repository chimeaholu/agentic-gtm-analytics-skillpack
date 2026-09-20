# Coverage metrics: formula, denominator, grain, miscomputation

Every metric here is a rate over the **target list**, unless stated. The target
list is version-dated; a metric computed against a list that changed mid-window
is two metrics in a trenchcoat.

## Reach and engagement

| Metric | Formula | Grain | Denominator | Common miscomputation |
|---|---|---|---|---|
| **Target-account reach** | accounts with ≥1 touch ÷ accounts on target list | account | the target list as of the window | dividing by accounts *present in the ABM tool*, which drops every unreached account and pushes reach toward 100% |
| **Engaged reach** | accounts with engagement ≥ threshold ÷ target list | account | same | threshold undeclared, so the number moves when someone retunes the score |
| **Net-new account engagement** | accounts engaged this window with no touch in the prior window ÷ target list | account | same | counting all engaged accounts as "new engagement" each period |
| **Depth of engagement** | median engaged contacts per engaged account | account | engaged accounts only | using the mean, which one enthusiastic account distorts |

Threshold choice is a decision, not a constant. Record it, and show the
distribution of account scores alongside the threshold so a reader can see how
much the rate moves if the threshold moves.

## Buying-group coverage

Requires a declared role set. A role set with no CRM field behind it makes
every metric below `unavailable`, not zero.

| Metric | Formula | Grain | Denominator | Common miscomputation |
|---|---|---|---|---|
| **Role coverage** | accounts with ≥1 known contact in *every* required role ÷ target list | account | target list | using "≥1 contact in *any* role", which is contact coverage wearing a role label |
| **Role fill rate** | filled (account, role) pairs ÷ (target accounts × required roles) | account-role | the full cross-product | computing over roles that appear in the data, which cannot fall below 100% |
| **Economic-buyer coverage** | accounts with a known, engaged economic buyer ÷ target list | account | target list | "known" quietly substituted for "engaged" — a contact record is not a relationship |
| **Multithreading** | distinct contacts with ≥1 activity on the opportunity | opportunity | none (a count) | counting contacts *associated* with the opportunity rather than *active* on it; association is free, activity is not |

**Report the role-population rate first.** If `OpportunityContactRole.Role` is
populated on 20% of opportunities, every role metric describes that 20%.
Leading with 12% role coverage when the field is 20% populated states a
property of the CRM as a property of the market.

## Velocity and timing

| Metric | Formula | Grain | Denominator | Common miscomputation |
|---|---|---|---|---|
| **Time to first engagement** | median days from list add (or programme start) to first qualifying touch | account | engaged accounts | the mean, dragged by a tail of accounts that engaged once, months later |
| **Time to buying-group formation** | median days from first touch to ≥2 roles filled | account | accounts that reached 2 roles | ignoring accounts that never got there, which is survivorship bias — report the share that never did |
| **Engagement recency** | days since last qualifying touch | account | — | treating a null (never touched) as a very large number instead of a separate state |

Accounts that never reached the event are **not** excluded quietly. Report the
median for those that did, plus the share that did not, in the same sentence.

## Penetration and pipeline linkage

| Metric | Formula | Grain | Denominator | Common miscomputation |
|---|---|---|---|---|
| **Opportunity penetration** | target accounts with ≥1 open or won opportunity ÷ target list | account | target list | counting opportunities rather than accounts, so three deals at one account read as three accounts |
| **Pipeline coverage of the target list** | open pipeline from target accounts ÷ quota | account roll-up | quota for the period | including pipeline with a close date outside the period (see `gtm-metric-dictionary` §2.1) |
| **Account win rate** | accounts with ≥1 won opportunity ÷ accounts with ≥1 closed opportunity | account | closed accounts only | mixing with the opportunity-level win rate, which is a different denominator and a different number |
| **Target-list share of pipeline** | pipeline from target accounts ÷ total pipeline | account roll-up | all pipeline | reading a low share as programme failure when the target list was small by design |

## Cohort discipline

Coverage metrics are cohort metrics. An account added to the target list three
weeks ago has had three weeks to engage.

- **Compare accounts at the same tenure on the list**, not at the same calendar
  date. A quarter-over-quarter reach comparison where one quarter's list was
  refreshed late is measuring list age.
- **Mark incomplete cohorts** rather than reading their truncation as decline
  (`answer-contract`, and check C7 in `gtm-metric-dictionary`).
- **Refuse rates below a stated minimum n.** A 9-account segment at 33% reach is
  three accounts. Name the minimum, apply it, and list the refused cells rather
  than dropping them silently.

## What the coverage table does not claim

- Reach is exposure, not attention: an impression is not a conversation.
- Engagement thresholds are internal conventions and do not compare across orgs.
- Target accounts get sales attention as well as marketing, so no coverage
  movement is attributable to one programme without a holdout.
- Accounts with no data are not accounts with no activity; unmatched touches
  push every rate here downward.
