# Survival methods for churn

---

## 1. Censoring, stated plainly

A customer active today has not churned. That is **not** the same as "will not
churn" — we know their tenure exceeds their current age and nothing more. They
are **right-censored**.

A binary classifier at a fixed horizon labels them 0, which:

- Discards the information that they survived a known length of time.
- Mislabels recent signups, who have not had the opportunity to churn.
- Biases the model towards whatever was true of the customers who had time to
  churn — i.e. older cohorts.

The embargo from `ml-foundations-marketing` §3 is the minimum fix for a binary
framing. Survival methods handle it natively.

---

## 2. Kaplan–Meier — the first artefact, before any model

```python
def kaplan_meier(durations, events):
    """durations: tenure at observation. events: 1 = churned, 0 = censored."""
    rows = sorted(zip(durations, events))
    n_at_risk = len(rows)
    s, curve = 1.0, [(0.0, 1.0, len(rows))]
    i = 0
    while i < len(rows):
        t = rows[i][0]
        d = 0
        c = 0
        while i < len(rows) and rows[i][0] == t:
            d += rows[i][1]
            c += 1
            i += 1
        if n_at_risk > 0 and d > 0:
            s *= (1 - d / n_at_risk)
            curve.append((t, s, n_at_risk))
        n_at_risk -= c
    return curve


if __name__ == "__main__":
    # 10 customers, 4 churn at months 1..4, 6 still active at month 6
    dur = [1, 2, 3, 4] + [6] * 6
    ev = [1, 1, 1, 1] + [0] * 6
    curve = kaplan_meier(dur, ev)
    final = curve[-1][1]
    assert abs(final - (9 / 10) * (8 / 9) * (7 / 8) * (6 / 7)) < 1e-12
    assert abs(final - 0.6) < 1e-12
    # censored observations reduce the at-risk set without counting as events
    assert all(0.0 <= s <= 1.0 for _, s, _ in curve)
    print(f"KM ok: survival at last event = {final:.3f}")
```

**Plot it by cohort and by segment before modelling.** It answers most of the
questions people bring to a churn model — when do customers leave, does the
hazard fall after onboarding, which segment retains — and it takes minutes.

**Confidence bands matter.** Greenwood's formula gives the variance; at the right
tail, where few customers remain at risk, the band is very wide and the curve
looks more precise than it is. **Cut the plot where the at-risk count falls below
about 30** and say why.

---

## 3. Cox proportional hazards

```
h(t | x) = h₀(t) · exp(β₁x₁ + β₂x₂ + ...)
```

`exp(β)` is the **hazard ratio**: `exp(β) = 1.4` means a one-unit increase in
that covariate raises the instantaneous churn hazard by 40%, at every time.

**Executives like hazard ratios**, and they are genuinely interpretable — which
is a real advantage over a black-box risk score.

**The proportional-hazards assumption is that the ratio is constant over time.**
In GTM this frequently fails: onboarding quality dominates month 1, price
sensitivity dominates at renewal. Test with Schoenfeld residuals; a trend in the
residuals against time means the assumption is violated for that covariate.

When it fails:

- **Stratify** on the offending covariate (separate baseline hazards per
  stratum), or
- Add a **time-varying coefficient** (interact the covariate with time), or
- Use **discrete-time survival**, which sidesteps the issue entirely.

---

## 4. Discrete-time survival — the practical GTM choice

Explode to one row per customer per period. Label each row "churned in this
period". Fit any classifier with tenure as a feature. That is it.

```sql
create table churn_panel as
select c.customer_id,
       m.month_start                                          as as_of,
       date_diff('month', c.started_at, m.month_start)        as tenure_months,
       (c.churned_at is not null
        and date_trunc('month', c.churned_at) = m.month_start)::int
                                                              as churned_this_month
from   customers c
cross join months m
where  m.month_start >= date_trunc('month', c.started_at)
  and  m.month_start <= coalesce(date_trunc('month', c.churned_at),
                                 date_trunc('month', current_date));
-- then join point-in-time features as of m.month_start
```

**What this buys:**

- **Censoring handled by construction.** An active customer simply stops
  generating rows at the current month; they are never labelled "will not churn".
- **Time-varying features are natural.** Usage in each month is the feature for
  that month's row.
- **The hazard curve falls out** of the predicted probabilities by tenure.
- **No new library.** A logistic regression or a gradient-boosted tree on the
  panel is a discrete-time survival model.

**Three things that go wrong:**

1. **The panel is much larger than the customer table** — a 10,000-customer base
   with three years of history is around 250,000 rows. Fine, but size the compute.
2. **Rows are not independent.** The same customer contributes many rows, so
   naive standard errors are too small and a random train/test split leaks the
   customer across the boundary. **Split by customer, not by row.**
3. **The base rate per period is tiny** — a 2% monthly churn rate means a 2%
   positive rate per row. All the imbalance discipline applies.

Convert per-period hazards to a horizon probability:

```
P(churn within h periods) = 1 − Π over the h periods of (1 − hazard_t)
```

---

## 5. Which framing to choose

| Question | Framing |
|---|---|
| "Who is at risk in the next 90 days?" | Binary at 90-day horizon, or discrete-time aggregated to 90 days |
| "When will this customer churn?" | Survival — Cox or discrete-time |
| "What drives churn?" | Cox hazard ratios, or a model with per-record attributions |
| "How does retention differ by cohort?" | **Kaplan–Meier. No model needed** |
| "What is our expected retention curve for a new cohort?" | Discrete-time survival with cohort features |
| "Which accounts should the CSM team call?" | Binary at the horizon **plus** `uplift-and-causal-models` for saveability |

**Do not reach for survival methods because they sound more sophisticated.** If
the question is "who do we call this month", a calibrated binary classifier at
the right horizon is simpler to operate, easier to explain, and answers the
question asked.
