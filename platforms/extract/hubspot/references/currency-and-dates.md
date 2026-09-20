# Currency, dates, and archived records — three silent wrong-number sources

All three of these produce a number that looks entirely reasonable and does not match any
HubSpot report. None of them raise an error.

## 1. `amount` is not the reportable number

On a multi-currency portal:

- **`amount`** is in **the deal's own currency**
- the HubSpot UI rolls up in **the portal's home currency**

**Summing raw `amount` across a multi-currency portal produces a meaningless number that
will not match any HubSpot report.** It is a sum of mixed units.

**Use the home-currency variants:**

| Raw | Reportable |
|---|---|
| `amount` | **`amount_in_home_currency`** |
| `hs_closed_amount` | **`hs_closed_amount_in_home_currency`** |

**These use a per-deal snapshotted exchange rate, not a recomputed one.** That is the
correct behaviour for revenue reporting — a deal closed at last year's rate stays at last
year's rate — but it means you cannot re-derive the figures by applying today's rates to
`amount`, and you should not try.

**Record which basis you used in the provenance block.** "Pipeline of X, in portal home
currency using HubSpot's per-deal snapshotted rates" is reproducible. "Pipeline of X" is
not.

Single-currency portals can use `amount` safely — but check rather than assume, because
the property exists either way.

## 2. Date-only properties are UTC midnight — never localise them

Two different storage shapes, two different handling rules:

| Property kind | Stored as | Rule |
|---|---|---|
| Timestamp (e.g. `createdate`, `hs_lastmodifieddate`) | epoch **milliseconds** | localise for display as normal |
| **Date-only (e.g. `closedate` where configured as a date)** | **UTC midnight** | **never apply a timezone conversion** |

**A close date of `2026-09-20` in an `America/New_York` portal renders as 2026-09-19 if you
localise the raw epoch naively.** And because the error is a whole day, **monthly pipeline
totals shift across month boundaries** — a deal closing on the 1st moves into the previous
month, and the monthly report is wrong at both ends.

**Treat date-only properties as UTC dates. Extract the calendar date from the UTC epoch and
stop there.**

```python
from datetime import datetime, timezone

def date_only(epoch_ms):
    """Date-only properties are UTC midnight. Do NOT convert to portal time."""
    return datetime.fromtimestamp(int(epoch_ms) / 1000, tz=timezone.utc).date()
```

The diagnostic when a monthly total is off: check whether the boundary deals moved by
exactly one day. If they did, this is it.

## 3. Archived records drift period-over-period counts

Deleting in HubSpot archives to a roughly **90-day recycle bin**.

- **`GET /crm/v3/objects/{type}` excludes archived by default.** Pass `?archived=true` to
  see them.
- **Search never returns archived records at all.** There is no parameter that includes
  them.

**So a period-over-period count built on Search drifts silently downward with no way to
detect it from the response.** Last month's count, re-run today, is smaller than it was —
not because the data changed, but because some records were archived in between.

**Handling:** snapshot counts at report time, or extract with the list endpoint and
`?archived=true` and filter explicitly, so the archived population is a number you can
report rather than an invisible subtraction.

## Related: properties that are stale or absent rather than wrong

- **Calculated and rollup properties are computed asynchronously and can be stale or null
  on read** — `num_associated_contacts`, deal-total rollups, scoring properties — **and
  cannot be filtered on reliably in search.** A null rollup is "not computed yet", not
  zero.
- **`hs_lifecyclestage_*_date` stamps are overwritten on re-entry.** Lifecycle stage moves
  forward and backward, and a contact that cycles twice **loses its first journey**.
  Snapshot on a schedule if journey timing matters; it cannot be reconstructed later.
- **Deal→contact→company associations are many-to-many.** A naive join multiplies revenue:
  a deal associated with three contacts appears three times. Deduplicate on the deal before
  summing.

## And the permission direction that surprises people

**Field permissions run the opposite way from Salesforce.** A private app token is
**portal-scoped, not user-scoped**: it ignores user roles, teams and field-level
permissions and returns everything its OAuth scopes allow.

**So the API commonly shows *more* than a given UI user sees.** When a sales manager says
the agent's number is too high, this is usually why — and it also means **you cannot
reproduce a specific user's filtered view**, which is worth saying plainly when someone
asks you to match their screen.
