# Attribution windows, platform by platform

## The table

| | Default click window | Default view window | Attribution basis | Reported on |
|---|---|---|---|---|
| Google Ads | **30 days** (per conversion action, 1–90) | 1 day view-through; 3 days engaged-view | data-driven by default; **per conversion action** | **click date** — back-fills up to 90 days |
| Meta | **7 days** (API default `7d_click`; Ads Manager ad-set default 7d click + 1d view) | 1 day (`7d_view` and `28d_view` **removed 2026-01-12**) | ad-set setting; API now mirrors Ads Manager | impression/click date; settles over 28 days |
| LinkedIn | **30 days** (1/7/30 only) | **7 days** (1/7/30) | **`LAST_TOUCH_BY_CAMPAIGN` — counts once per campaign** | conversion event date |
| GA4 | 30-day acquisition lookback (30/90 paid&organic) | n/a — no view-throughs | data-driven by default | session/event date |

## Per platform, what you can actually set

### Google Ads

- The click window is configured **per conversion action**, not per account and
  not per campaign. Two conversion actions in one account can have different
  windows, and a total across them mixes windows silently.
- Range 1 to 90 days. Default 30.
- View-through 1 day. Engaged-view 3 days.
- Attribution model is data-driven by default on eligible accounts. Data-driven
  is a **vendor model**: it is not reproducible from raw extracts, so a warehouse
  cannot recreate the number the client sees.
- **Reported on click date with back-fill up to 90 days.** A day's conversion
  count keeps rising for weeks after that day closed. Re-running last month's
  report next month gives a different, larger number, correctly.

### Meta

- API default is `7d_click`. Set `action_attribution_windows` explicitly on every
  request; relying on the default means the default can change under you.
- Ads Manager ad-set default is 7-day click plus 1-day view.
- **`7d_view` and `28d_view` were removed on 2026-01-12.** Historical comparisons
  spanning that date compare different view-window populations. The spec's own
  research flags the exact date and scope of this change as medium confidence,
  sourced from a trade summary of Meta's changelog rather than read from Meta
  directly, so verify against the current documentation for your API revision.
- Restates for 28 days.
- Post-ATT **modelled conversions** are included in reported conversions. They
  are statistical estimates, and they are why Meta's number can exceed anything
  observable in a warehouse.

### LinkedIn

- `postClickAttributionWindowSize`: 1, 7 or 30 days. Default 30. **Only those
  three values.**
- `viewThroughAttributionWindowSize`: 1, 7 or 30 days. Default 7.
- `LAST_TOUCH_BY_CAMPAIGN` is the default basis and **counts a conversion once
  per campaign**. A person touched by three campaigns generates three
  conversions in a campaign-level pull. Summing campaign rows to an account
  total double-counts by design, before any cross-platform overlap.
- Reports on **conversion event date**, unlike Google and Meta.
- Daily granularity is only available for the trailing 6 months. Outside that,
  `timeGranularity=ALL` **silently rounds dates to month boundaries** and
  includes whole months.

### GA4

- Acquisition lookback: 30 days by default, with 30 or 90 available for paid and
  organic channels.
- Engaged-view 3 days.
- **No view-through counting at all.** Any comparison against a platform that
  includes view-throughs is comparing a click-only population to a
  click-plus-view population.
- Data-driven attribution by default, last-click available.
- Reports on session or event date, in the property's timezone.
- Reprocesses for 24 to 48 hours on standard properties.

## The normalisation recipe

Only the window is normalisable by re-querying. Everything else is structural.

```
1. Establish the common window.
   Google, Meta and LinkedIn all support 7-day click. That is the common ground.
   GA4 cannot be set to a click window at all; it is not part of the normalised
   series and must be labelled separately.

2. Re-query each platform at 7-day click.
   Google  : set the conversion action window, or filter to actions already at 7d
   Meta    : action_attribution_windows = ["7d_click"]
   LinkedIn: postClickAttributionWindowSize = 7
   Also set the view window to a common value or exclude view-throughs entirely.

3. Label the result "comparable series, 7-day click".

4. Keep the platform-default numbers as a second series labelled
   "what your Ads Manager shows".

5. Present both. Name what normalisation did NOT fix:
   - date basis still differs (click date vs conversion date vs session date)
   - event sets still differ
   - LinkedIn still counts once per campaign
   - modelled components are still included where the platform includes them
```

**Never silently pick one series.** The normalised series is the honest
comparison. The platform-default series is the number in the client's interface
and the number they will quote back. Both are real; they answer different
questions.

## Which residuals survive normalisation

| Residual | Why it cannot be re-queried away |
|---|---|
| Date basis | the platform decides which date a conversion belongs to; it is not a parameter |
| Event set | each platform's conversion definition is configured in that platform, by a human, separately |
| Per-campaign counting | LinkedIn's counting rule is the attribution basis, not a window setting |
| Modelled components | the vendor computes them; you cannot subtract them |
| Settling state | the windows settle on different schedules; only a 90-day-old window is settled everywhere |

State the residuals. A "normalised" series presented as fully comparable is a
cleaner lie than the raw one.

## Cross-platform sanity check

If the sum of platform-reported conversions is 130% to 160% of the CRM or
back-end count, that is the normal, expected consequence of the overlaps above.
It is not evidence of a tracking bug, and chasing it as one wastes days. It is
evidence that you are adding four overlapping populations, which is exactly what
the annotated-total rule exists to say out loud.
