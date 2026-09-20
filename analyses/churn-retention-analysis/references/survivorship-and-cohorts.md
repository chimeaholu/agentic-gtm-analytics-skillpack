# Survivorship, cohorts and the observation window

Every churn diagnosis is built from a population that survived some selection.
This page is how to name the selection and correct for it, or fail honestly.

---

## 1. Exit surveys

**Who answers:** churners engaged enough to respond. Skews toward deliberate,
articulate, price-sensitive departures, and toward accounts with a human
relationship.

**Who does not:** the accounts that never onboarded, never found value, and left
without a conversation. **These are frequently the largest churn group and they
are entirely absent from the survey.**

### The correction

Profile respondents against all churners on the dimensions you have:

```sql
select
  responded,
  count(*)                        as n,
  avg(tenure_days)                as avg_tenure,
  avg(mrr)                        as avg_mrr,
  avg(days_active_last_30)        as avg_activity,
  avg(case when reached_activation then 1 else 0 end) as activation_rate
from churned_accounts group by 1;
```

Then report it inline with the findings, not in an appendix:

> Exit surveys returned 19% of churned accounts. Respondents had a median tenure
> of 14 months against 4 months for all churners, and 81% had reached activation
> against 44% overall. **These findings describe customers who used the product
> successfully and then left.** The larger group — accounts that never activated
> — is not represented here, and its reasons are different by construction.

**The response rate alone is not the disclosure.** A 19% response rate that is
representative and a 19% response rate that is entirely long-tenured customers
are different problems, and only the profile tells you which you have.

### What to use instead for the silent group

Behavioural evidence, which exists for everyone:

- **Time from signup to last activity.** Accounts whose last activity is within
  the first week never started.
- **Activation reached or not**, from `product-led-growth-analytics`.
- **Onboarding step last completed.** Where the drop-off concentrates is a
  reason, and it is measured rather than reported.

---

## 2. Tenure-milestone selection

**"Customers who reached month 12" excludes everyone who left first.** Any
analysis of that group describes survivors, and a statement like "customers who
reach month 12 retain at 94%" is close to a tautology.

**The correction is to analyse by signup cohort.** Every account that signed up
in a given month is in the cohort for good, whether it left in month 2 or is
still present.

```
retention(cohort, m) = accounts from cohort active in month m / accounts in cohort
```

The denominator never changes. That is the whole point — a denominator that
shrinks as accounts leave is how survivorship gets into a retention curve.

---

## 3. The observation-window trap in driver analysis

The most common and least-noticed one.

> "Accounts using feature X churn 40% less."

Churned accounts had less time to discover feature X. **Adoption of anything
correlates with tenure, and tenure correlates with retention, so every feature
looks retentive.**

### The correction: fix the window for everyone

```sql
-- usage measured in the first 30 days, for every account, churned or not
with early as (
  select a.account_id,
         max(case when e.event = :feature
                   and e.ts <= a.signup_ts + interval '30 days'
                  then 1 else 0 end) as used_early
  from accounts a left join events e using (account_id)
  group by 1
)
select used_early, count(*), avg(churned_within_180d)
from early join outcomes using (account_id)
where signup_ts < :now - interval '180 days'      -- full outcome window
group by 1;
```

Two further requirements:

- **The outcome window must be fully elapsed for every account in the cohort.**
  An account that signed up 60 days ago cannot have churned within 180 days.
- **Even corrected, the relationship is correlational.** Accounts that adopt a
  feature early were more engaged to begin with. The corrected version removes
  the survivorship artefact; it does not establish causation.

---

## 4. Cohort construction

| Decision | Guidance |
|---|---|
| **Cohort key** | signup or first-paid month. **Say which** — they differ by the trial length and the difference shows up as a shifted curve |
| **Active definition** | must be versioned. If "active" changed meaning, cohorts either side are not comparable and the chart will not say so |
| **Grain** | account for B2B, user for consumer. Mixing them mid-analysis is a silent error |
| **Contract-term businesses** | monthly retention curves are misleading when everyone renews annually; use renewal-event retention instead |
| **Cohort size** | printed on every curve, always |

### Truncation

**A cohort three months old has no month-12 point. Leave it absent.**

- Never carry the last value forward. It produces a flat line at the cohort's
  current retention and reads as excellent.
- Never interpolate across the truncation boundary.
- In a triangle chart, leave the cells empty rather than zero. **Zero and missing
  are different states** — see `answer-contract`.

### The small-n floor

Below roughly 30 accounts, a cohort curve moves several points per account and
invites reading structure into noise.

**Report the counts instead.** "Of the 19 accounts in that cohort, 14 are still
active at month 6" is honest, informative and immune to over-reading. A jagged
percentage line is none of those.

---

## 5. The pre-cancellation usage trajectory

The most under-used evidence in churn analysis, and it exists for every account
whether or not they answered anything.

```sql
select account_id,
       date_trunc('week', ts) as wk,
       count(*)               as events
from events
where ts between cancel_ts - interval '180 days' and cancel_ts
group by 1, 2;
```

Read the shape. Four recur:

| Shape | Reading |
|---|---|
| **Flat then cliff** | a decision event — a champion left, a competitor won, a budget cycle. The cause is external to product usage |
| **Slow decay over months** | value erosion. The cancellation is the last step, not the cause, and the reason field will say "price" |
| **Never started** | onboarding failure. This account was lost in week one and stayed on the invoice |
| **Healthy until cancellation** | a budget or consolidation decision, or a champion departure. Worth a human conversation, genuinely unpredictable from usage |

**Cross-tabulate trajectory shape against the recorded churn reason.** Where
they disagree — "price" against a slow decay that started six months before any
price change — the trajectory is the better evidence, and the disagreement is a
finding about your reason-capture process worth reporting on its own.
