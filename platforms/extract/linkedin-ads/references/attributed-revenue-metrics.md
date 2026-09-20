# `q=attributedRevenueMetrics` — the ad-to-pipeline loop without a warehouse

This is the single most valuable ads endpoint for B2B in the pack. It returns CRM-joined
pipeline and revenue metrics straight from the ads API, so an agent can answer "which
campaigns produced pipeline" without building an identity spine or a warehouse join.

It also has more preconditions than anything else in this module. Check them before you
promise it.

## What it returns

| Field | Meaning |
|---|---|
| `returnOnAdSpend` | ROAS as LinkedIn computes it |
| `openOpportunities` | open opportunity count |
| `opportunityWinRate` | win rate |
| `revenueWonInUsd` | **closed-won revenue, in USD** |
| `closedWonOpportunities` | closed-won count |
| `opportunityAmountInUsd` | **open pipeline amount, in USD** |
| `averageDaysToClose` | cycle time |
| `averageDealSizeInUsd` | **average deal size, in USD** |

## Preconditions — all must hold

1. **A connected CRM in Business Manager**: Salesforce, Dynamics 365, HubSpot, or a
   Sales-Navigator-linked source. Without it the finder returns nothing.
2. **Up to 72 hours to populate initially** after the connection is made. A fresh
   connection returning empty is expected, not broken.
3. **Pivot restricted to ACCOUNT, CAMPAIGN_GROUP or CAMPAIGN.** No creative-level, no
   demographic pivots.
4. **`dateRange` between 30 and 366 days.** Shorter or longer is rejected.
5. **`dateRange.end` must be today in UTC for two specific fields.**

## The today-in-UTC null trap

**`opportunityAmountInUsd` and `openOpportunities` only return when `dateRange.end` is
today in UTC.**

A range ending yesterday returns **nulls for exactly those two fields**, with the rest of
the response populated and nothing explaining the difference. This is an easy silent-null
trap and it looks like a data problem in the CRM connection.

**Handling:**

```python
from datetime import datetime, timezone

def revenue_metrics_range(start_date):
    """Open-pipeline fields require dateRange.end == today in UTC."""
    today_utc = datetime.now(timezone.utc).date()
    return {"start": start_date, "end": today_utc}   # not "yesterday"
```

If the question genuinely needs a historical end date, say plainly that open-pipeline
fields are unavailable for a closed range and deliver the closed-won fields, which are not
subject to the restriction.

## The currency trap — do not compute ROAS naively

**A single response can mix two currencies.**

- **`costInLocalCurrency`** is in **the ad account's currency**
- **`revenueWonInUsd`, `opportunityAmountInUsd`, `averageDealSizeInUsd`** are in **USD**

**Dividing one by the other without conversion produces a silently wrong ROAS.** On a
EUR-denominated account the error is roughly the EUR/USD rate — large enough to change a
decision, small enough that nobody notices.

Two safe options:

- use **`returnOnAdSpend`** as LinkedIn computes it, and say that you did
- convert `costInLocalCurrency` to USD explicitly with a stated rate and rate date, and put
  both in the provenance block

**LinkedIn provides no conversion field**, so there is no third option that is both
automatic and correct.

## Attribution applies here too

The `attributionType` default — `LAST_TOUCH_BY_CAMPAIGN` — affects these metrics as it
affects conversions. **Under the default, an opportunity attributable to three campaigns is
counted in all three.** Summing `openOpportunities` across campaigns therefore
double-counts.

Set `attributionType` explicitly, and when presenting a per-campaign table state which
basis you used and whether the column sums to the account total.

## How to present these numbers

They are **LinkedIn's attribution of your CRM's outcomes**, not your CRM's own numbers.
They will not match a Salesforce pipeline report, and they are not supposed to: LinkedIn is
attributing, Salesforce is recording.

State that once, up front:

> "These are LinkedIn's attributed pipeline figures, computed on <attributionType> with a
> <n>-day post-click window. They will not tie to the CRM's own pipeline report, which
> records opportunities rather than attributing them."

That sentence prevents a reconciliation project nobody asked for.
