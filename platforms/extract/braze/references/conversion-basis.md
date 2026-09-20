# `conversions` versus `conversions_by_send_time`

Braze returns **both** in the same `/sends/data_series` response. They are different
metrics with the same name-shape, and mixing them produces numbers matching neither the
dashboard nor reality.

## What each one means

| Field | Attributes a conversion to |
|---|---|
| **`conversions`** | the day the conversion **happened** |
| **`conversions_by_send_time`** | the day the message was **sent** |

A message sent Monday, converting Thursday:

- `conversions` puts it on **Thursday**
- `conversions_by_send_time` puts it on **Monday**

Both are correct. They answer different questions.

## Which to use

| Question | Basis |
|---|---|
| "How did Monday's send perform?" | **`conversions_by_send_time`** — campaign effectiveness |
| "How much revenue landed on Thursday?" | **`conversions`** — business activity by day |
| "Did the subject-line test win?" | **`conversions_by_send_time`** — you are evaluating the send |
| "What did we book last week?" | **`conversions`** — you are counting outcomes |
| Reconciling against a finance figure | **`conversions`** — finance counts when money moved |

**The default for campaign performance work is `conversions_by_send_time`**, because the
question is almost always "how did this send do", and attributing a send's conversions to
whichever day they trickled in makes a campaign's performance depend on the reporting
window boundary.

## The three failure shapes

1. **Summing the wrong one across a date range.** A `conversions` sum over a window
   truncates the tail of sends near the window's end — those conversions have not happened
   yet. A `conversions_by_send_time` sum over the same window includes conversions that
   have not happened yet for sends inside it, and that number keeps rising.
2. **Mixing the two in one table.** A per-campaign table where some rows came from one
   field and some from the other is unreconcilable and unfixable after the fact.
3. **Comparing across bases.** Last quarter's report on one basis against this quarter's on
   the other shows a change that is entirely artefact.

## How to present it

State the basis once, in the table caption or the first line:

> "Conversions attributed by **send time** — a conversion is counted on the day the message
> went out, not the day it completed. Recent sends will continue to accrue conversions, so
> the last few rows are provisional."

Two elements matter there: **naming the basis**, and **flagging that the recent rows are
still moving** if you chose send-time attribution.

## The settling problem, and how to handle it

Under `conversions_by_send_time`, a send's number **keeps rising** for as long as the
conversion window allows. So:

- **Do not compare a send from three days ago against one from three months ago.** The old
  one has settled; the new one has not.
- **Either wait for the window to close** before reporting a send, **or compare
  like-aged sends** — day-3 numbers against day-3 numbers.
- **Label anything inside the settling window provisional.**

Under `conversions`, the settling problem moves rather than disappearing: the *day's* total
is stable once the day closes, but the *campaign's* total is spread across future days and
is therefore understated until they arrive.

## Revenue carries the same split, plus a currency issue

`revenue` in `/sends/data_series` is subject to the same attribution choice.

And it has its own trap: **currency is USD in the API.** `revenue` is documented as
dollars. **If the business transacts in other currencies, Braze has already converted using
its own rates and you cannot recover the original amounts from this endpoint.** Only
Currents and raw purchase events carry native currency.

So a multi-currency brand asking "what did the campaign earn in EUR" gets: the USD figure
Braze computed, an explanation that the conversion already happened at Braze's rates, and a
pointer to Currents if the native amounts matter.

## Per-variation breakdown

`/sends/data_series` breaks out by message variation, which is what makes A/B readouts
possible: `sent`, `delivered`, `direct_opens`, `total_opens`, `bounces`, `body_clicks`,
`revenue`, `unique_recipients`, `conversions` and variants, per variation.

When reporting a test result, use **one basis across all variations** — mixing bases
between arms of the same test invalidates the comparison entirely, and it is an easy
mistake when the two fields sit adjacent in the response.
