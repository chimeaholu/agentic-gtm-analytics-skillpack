# Google Ads attribution, windows, and what may be compared

`comparability-rules` owns the general question of whether two series may be compared. This
file holds the Google Ads specifics that feed it.

## Two different date bases live in the same API

| Metric family | Date basis | Behaviour |
|---|---|---|
| `metrics.conversions`, `metrics.conversions_value` | **click date** | the value for a past day **keeps rising** for up to 90 days as conversions land against older clicks |
| `metrics.conversions_by_conversion_date`, `metrics.conversions_value_by_conversion_date` | **conversion date** | the value for a past day is stable once the day closes |

Consequences to state plainly:

- **A "last 7 days ROAS" on the click-date basis is structurally understated**, because the
  spend is complete and the conversions are not. It is still a usable pacing number if you
  say which direction it is wrong in.
- **Never compare a click-date number to another platform's conversion-date number.**
  LinkedIn reports on conversion date. GA4 reports on session or event date. Meta reports on
  impression or click date and restates for 28 days. Putting these in one table without
  normalising produces a comparison of calendars, not of performance.
- When the question is "how did the campaign perform", click date answers it. When the
  question is "what happened in the business last month", conversion date answers it. Pick
  one, name it, and use it consistently for the whole answer.

## Windows are per conversion action

Defaults: click-through **30 days** (configurable 1 to 90), view-through **1 day**,
engaged-view **3 days**. **Changes apply prospectively only and never restate history.**

Because the window is configured per conversion action, one account can mix a 7-day
window on a lead form and a 90-day window on a purchase, which makes the account-level
conversion total a sum across incomparable definitions. Read the windows before quoting a
total:

```sql
SELECT conversion_action.name,
       conversion_action.click_through_lookback_window_days,
       conversion_action.view_through_lookback_window_days
FROM conversion_action
```

Report the spread: "the account total covers windows from 7 to 90 days, so it favours the
actions with the longer window."

## Cross-platform defaults, for orientation only

| Platform | Default click window | Default view window | Reported on |
|---|---|---|---|
| Google Ads | 30 days, per conversion action, 1 to 90 | 1 day view-through, 3 days engaged-view | **click date**, back-fills up to 90 days |
| Meta | 7 days | 1 day | impression or click date, settles over 28 days |
| LinkedIn | 30 days (1, 7 or 30 only) | 7 days (1, 7 or 30) | **conversion date** |
| GA4 | 30-day acquisition lookback default | no view-throughs | session or event date |

Four things follow, and they are the reason cross-platform conversion tables mislead:

1. **The same conversion lands on different days in different systems.**
2. **Only Google Ads back-fills for up to 90 days.** There is no date on which all four
   series are simultaneously final except roughly 90 days back.
3. **Summing platform-reported conversions always overstates**, because platforms
   double-count the same conversion. Per the pack's core rule the sum still ships when
   asked for, **annotated as an upper bound with the overlap named**, never silently
   suppressed and never presented as a total.
4. **Normalise where you can:** Google Ads and Meta both support a 7-day click window, and
   LinkedIn supports 7-day click. Re-query at a common window and label that as the
   comparable series, while keeping the platform-default numbers as the "what your Ads
   Manager shows" series. Present both. Never silently pick one.

## The provenance block for any Google Ads number

- customer id and account descriptive name
- `customer.currency_code` and `customer.time_zone`
- date range as explicit dates, on the account timezone
- **date basis: click date or conversion date**
- attribution window or window range across the conversion actions included
- whether `REMOVED` entities were included
- whether the figure is segmented, and the residual against the unsegmented control
- API version, and freshness (same-day and 1 to 3 day conversion settling)
