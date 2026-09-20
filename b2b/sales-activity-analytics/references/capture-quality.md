# Activity capture quality

The denominator you need — "activities that actually happened" — does not
exist. Everything here is an indicator of integration health, reported as such,
and used to decide whether a rep comparison is defensible at all.

## 1. What breaks capture

| Cause | Signature in the data | Direction of error |
|---|---|---|
| Email sync never enabled for a user | near-zero auto-logged email, normal meeting counts | that rep's email volume understated, arbitrarily |
| Sync token expired or revoked | activity falls to zero on a specific date and stays there | understated from that date |
| Unsupported mail client or personal account | email present but only via manual logging or BCC | understated and biased toward important threads |
| Calls placed outside the dialler | call counts far below team norm with normal email | call volume understated |
| Calendar sync one-way or partial | meetings appear without attendees, or vanish when cancelled | meeting counts unreliable in both directions |
| SDR books, AE holds | meeting attributed to the booker, the holder shows no meeting | misattributed between reps, total roughly right |
| Bulk task creation at period end | a spike of `Task` records all created within minutes | volume overstated, timing meaningless |
| Activity logged against the contact but not the deal | activity exists but `WhatId` / deal association is null | deal-level analysis undercounts; rep-level does not |

The last one is the most common and the least noticed. Rep totals look fine
while every per-opportunity metric is understated.

## 2. The indicators

```
auto_log_share(rep, week)   = auto-logged ÷ (auto-logged + manually logged)
activity_continuity(rep)    = weeks with ≥1 activity ÷ weeks in the window
opp_coverage(rep)           = open opps with ≥1 activity in 30 days ÷ open opps
deal_link_rate(rep)         = activities with a deal/opportunity association
                              ÷ activities
channel_mix(rep)            = share by email / call / meeting
bulk_create_flag(rep, day)  = true if >N activities share a create timestamp
                              within a few minutes
```

Report them as a small table per rep before any comparison. The table is
frequently more useful than the analysis that was requested, because it
explains an argument the sales leader has already been having.

## 3. The comparison gate

Before comparing reps on any activity metric:

1. Compute `auto_log_share` and `deal_link_rate` per rep.
2. If the spread across the compared reps exceeds roughly 20 percentage points
   on either, **the comparison is not a performance statement.** Report the
   volumes as observed-only, report the capture indicators, and name the
   direction each rep's figure is wrong in.
3. If continuity shows a cliff for any rep, find the date and check whether it
   coincides with a known integration change before reading it as behaviour.
4. Where capture is uneven but a comparison is still required, compare on
   metrics that survive it better: meeting-held counts (usually calendar-sourced
   and more uniform), multithreading (derived from distinct contacts rather than
   from volume), and buyer-generated events like replies.

## 4. Buyer-generated versus seller-generated

Splitting these changes what the analysis means. Where the fields allow:

| Seller-generated | Buyer-generated |
|---|---|
| email sent, call placed, task completed, sequence step delivered | email reply received, meeting accepted, meeting attended, inbound call, form submitted, content viewed |

- Salesforce: `Task.TaskSubtype` plus the direction indicator on email
  (`EmailMessage.Incoming`); meetings held via `Event` with attendee status
  where the sync populates it.
- HubSpot: engagement type plus `hs_email_direction`, meeting outcome
  properties, and inbound call disposition.

**Buyer-generated activity is a much better outcome signal and a much worse
quota.** It is the half of the correlation that reflects the buyer's interest
rather than the seller's effort, which is exactly why it predicts well and
exactly why targeting it directly does not work.

## 5. What to say when capture is bad

The answer still leads with what is computable:

> Logged activity per open opportunity ranges from 4 to 31 across the team.
> That range is not a range of effort. Three reps have no auto-logged email at
> all, and their figures count only manually logged work, which understates them
> by an unknown amount — one of the three is second on meetings held, which is
> calendar-sourced and more uniform. The defensible comparison across this team
> is on meetings held and on multithreading, both of which are shown below. The
> activity-per-opportunity column should not be used for anything until email
> sync is enabled for those three reps; that is a one-setting change and it
> would make this comparison real next quarter.

Note the shape: the number is given, the direction of error is named, a better
comparison is offered in the same breath, and the fix is specific.
