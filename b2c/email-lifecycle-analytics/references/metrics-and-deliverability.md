# Messaging metrics and list health

## 1. The metric table

| Metric | Formula | Grain | Denominator | Miscomputation |
|---|---|---|---|---|
| Delivery rate | delivered ÷ sent | message | sent | using delivered as the denominator, which makes it always 100% |
| Bounce rate | bounces ÷ sent | message | **sent** | dividing by delivered — a bounce is by definition not delivered |
| Hard bounce rate | hard bounces ÷ sent | message | sent | blending hard and soft, which hides a list-hygiene problem inside a transient one |
| Open rate | unique opens ÷ delivered | recipient | delivered | **ranking on it post-MPP**; also using gross opens, which counts repeat renders |
| Click rate | unique clicks ÷ delivered | recipient | delivered | using total clicks, which one enthusiastic recipient inflates |
| Click-to-open | unique clicks ÷ unique opens | recipient | **unique opens — the noisy term** | reporting it as creative effectiveness post-MPP |
| Conversion rate | conversions ÷ delivered | recipient | delivered | the conversion definition left unstated |
| Revenue per recipient | attributed revenue ÷ delivered | recipient | delivered | attributed revenue under an unstated attribution window |
| Unsubscribe rate | unsubscribes ÷ delivered | recipient | delivered | counting list-level unsubscribes against one campaign |
| Spam complaint rate | complaints ÷ delivered | recipient | delivered | — |
| Flow conversion | conversions ÷ **distinct recipients entering** | recipient | entrants, not sends | dividing by sends, which penalises longer flows mechanically |

**Unique versus gross runs through the whole table.** Where the platform
returns both (`opens` and `totalOpens`, `uniqueClicks` and `totalClicks`), use
unique for rates and say so. Where the API only exposes gross and the UI shows
unique with undocumented de-duplication and bot filtering — Marketo being the
clearest case — the two **cannot be reconciled**, and the API figure is
presented as independently computed.

## 2. What MPP did, and what still works

Apple Mail Privacy Protection and similar proxies pre-fetch images regardless of
whether a human opened the message.

| Metric | Post-MPP status |
|---|---|
| Open rate | **unreliable**; inflated by an unmeasurable share |
| Click-to-open | **unreliable** — divides by the inflated term |
| Open-based automation triggers | unreliable; they fire on machines |
| Open-based re-engagement segments | unreliable; they retain non-engaged recipients |
| **Click rate** | **reliable** |
| **Conversion and revenue** | **reliable**, subject to the attribution definition |
| Delivery, bounce, complaint, unsubscribe | **reliable** |

**Practical rules.** Rank and optimise on clicks and conversions. Define
engagement segments on clicks, not opens. Report opens when asked, labelled,
and never divide by them. Where a historical open-rate trend crosses the MPP
rollout, mark the date — the series is not continuous.

## 3. Attribution bases

Two questions that must be answered before any revenue figure:

1. **Which conversion event counts?** On Klaviyo this is
   `conversion_metric_id`, a required input that redefines every revenue and
   conversion number in the response. Resolve it, log it, print it.
2. **Which date does a conversion land on?** Braze returns both bases side by
   side — `conversions` on the conversion date, `conversions_by_send_time` on
   the send date. **Pick one, state it, never mix them in a table.**

Guidance: **send-time basis for campaign performance** (did this message work),
**conversion-date basis for period revenue** (what did we earn in March). Say
which, because the two will not tie out and someone will ask.

Third question where it applies: **the attribution window**. Klaviyo's is an
account setting, retroactive, with different defaults for email and SMS. Change
it and every historical report changes. Snapshot outputs that must reproduce.

## 4. Flows and journeys

| Concept | Definition | Misreading |
|---|---|---|
| Processed / sends | messages sent by the flow | **read as people reached** — a 2-email journey to 50 contacts reports up to 100 |
| Entered | distinct recipients entering | — |
| **Completed** | finished all steps | summed with exited |
| **Exited** | met exit criteria and left early | **read as failure** — for a flow exiting on purchase, this is the success state |
| Leading delay step | a wait before the first message | **recent cohorts show zero processed**, which looks exactly like a broken flow |

**Check for a leading delay before reporting "this flow isn't sending."** A
1+ day delay step produces documented zeros for the most recent cohorts.

**Flow-versus-campaign comparisons carry a selection caveat.** Flows are
triggered — the recipient did something — so their audiences are self-selected.
A flow's higher conversion rate is partly that selection, not creative or timing
superiority.

## 5. Bot traffic

Security appliances and scanners click every link in every message. The effect:

- A handful of recipients with a 100% click rate on every message.
- Aggregate CTR inflated, typically by a few tenths of a point but occasionally
  much more on B2B lists behind enterprise mail gateways.
- Unsubscribe and even complaint events generated by automated crawlers.

**Where an `is_bot`-style flag exists on open, click and unsubscribe events,
filter on it explicitly and say that you did**, with the size of the correction.
Where no flag exists, state that bot traffic is present and unquantified, and
that it inflates opens more than clicks.

A useful detection heuristic without a flag: recipients clicking **every link in
a message within seconds of delivery**, repeatedly, across campaigns. Report
them as suspected automated traffic rather than removing them silently.

## 6. Deliverability and list health

```
Hard bounce rate    = hard bounces ÷ sent
Soft bounce rate    = soft bounces ÷ sent
Spam complaint rate = complaints ÷ delivered
Unsubscribe rate    = unsubscribes ÷ delivered
List growth rate    = (adds − unsubscribes − hard bounces − suppressions) ÷ list size at period start
Engaged share       = recipients with ≥1 click in N days ÷ list size
Send frequency      = messages sent ÷ distinct recipients, per period
```

Reading them:

- **Hard bounce rate trending up is a list-acquisition problem** — a form
  without validation, a purchased list, a typo-heavy source. It damages sender
  reputation fastest.
- **Soft bounce rate rising steadily is a reputation signal**, not a transient
  one, and it usually precedes inbox placement decline.
- **Complaint rate is the metric mailbox providers act on.** It is the one to
  alert on.
- **Engaged share falling while list size grows is the pattern that precedes
  deliverability collapse**, and a campaign-level table hides it completely.
  This is the single most valuable chart in the section.
- **Send frequency against engaged share** is the trade-off: more sends raise
  short-term revenue and lower engaged share, and the second effect shows up
  months later.

**A programme with healthy campaign metrics and a shrinking engaged base is on
a timer.** Report the list-health view alongside any campaign ranking, not as an
appendix.

## 7. Window discipline

- **State the window in the query and in the answer.** Report defaults are often
  short — a one-month default where the reader meant lifetime.
- Braze `data_series` caps `length` at 1–100 days per call with **no cursor**;
  stitch, and remember `ending_at` is inclusive.
- Klaviyo `timeframe` takes a key or explicit ISO-8601 `start`/`end` with
  offsets, evaluated in the account's timezone.
- **A flow's lifetime revenue and its last-30-days revenue differ by an order of
  magnitude.** Which one the platform defaulted to is not a decision anyone made.
