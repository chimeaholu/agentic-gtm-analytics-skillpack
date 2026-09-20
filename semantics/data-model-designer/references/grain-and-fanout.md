# Grain catalogue and fan-out test patterns

## 1. The grain catalogue

Write the grain as a sentence: *"One row per X per Y."* If you cannot finish
the sentence, the table does not have a grain yet.

| Table | Grain sentence | Primary key | Common mistake |
|---|---|---|---|
| `dim_date` | One row per calendar day. | `date_day` | fiscal calendar assumed to be the calendar year |
| `dim_account` | One row per account per validity period. | `account_sk` | Type 1 overwrite loses segment history |
| `dim_person` | One row per person per validity period. | `person_sk` | keyed on email, which changes |
| `fact_touchpoint` | One row per person per marketing touch. | `touchpoint_id` | multiple touch sources unioned without conforming the channel |
| `fact_session` | One row per constructed session. | `session_id` | treating a source-provided session as canonical when the gap convention differs |
| `fact_lead_stage` | One row per person per stage entry. | `person_id, stage, entered_at` | using the current stage field, which has no history |
| `fact_opportunity` | One row per opportunity, current state. | `opportunity_id` | used for anything historical |
| `fact_opportunity_snapshot` | One row per opportunity per day. | `opportunity_id, snapshot_date` | queried with no date filter |
| `fact_ad_spend` | One row per platform per campaign per day. | `platform, campaign_id, date_day` | currency not stored alongside the amount |
| `fact_order` | One row per order. | `order_id` | line-level discounts summed at order grain |
| `fact_order_line` | One row per order per line item. | `order_id, line_number` | joined to `fact_order` and then order totals summed |
| `fact_subscription_event` | One row per subscription per state change. | `subscription_id, event_at, event_type` | reactivation folded into new |
| `identity_edges` | One row per observed link between two identifiers. | `edge_id` | mutated instead of appended, destroying the evidence trail |

---

## 2. Fan-out: how to detect it before it ships

### 2.1 The control-total pattern

Every mart declares a control: an upstream table and a measure whose total the
mart must preserve (or a stated, documented ratio).

```sql
-- row count control
with mart as (select count(*) n from mart_opportunity),
     ctrl as (select count(*) n from stg_crm__opportunity)
select case when mart.n = ctrl.n then 'pass'
            else 'FAIL: ' || mart.n || ' vs ' || ctrl.n end
from mart cross join ctrl;

-- sum control: the one that catches fan-out
with mart as (select sum(amount) s from mart_opportunity),
     ctrl as (select sum(amount) s from stg_crm__opportunity)
select case when abs(mart.s - ctrl.s) < 0.01 then 'pass'
            else 'FAIL: amount total moved by ' || (mart.s - ctrl.s) end
from mart cross join ctrl;
```

**Run both.** A row-count test alone misses a partial fan-out that also dropped
rows. A sum test alone misses a duplication that happens to cancel out against
a filter.

### 2.2 The cardinality probe, before you join

```sql
-- is this key unique on the right-hand side?
select count(*) as rows,
       count(distinct join_key) as distinct_keys,
       count(*) - count(distinct join_key) as duplicate_rows
from right_table;
```

If `duplicate_rows > 0` and you intended many-to-one, the join is many-to-many
and every measure on the left will multiply. Stop and resolve the grain before
joining.

### 2.3 The post-join delta

```sql
select
  (select count(*) from left_table)                         as before,
  (select count(*) from left_table l join right_table r
     on l.k = r.k)                                          as after;
```

`after > before` means fan-out. `after < before` means an inner join dropped
unmatched rows, which is a different bug with the same symptom to a
stakeholder. `relationship-discovery` requires that matched, unmatched and
ambiguous counts are disclosed for exactly this reason.

### 2.4 Snapshot fan-out

```sql
-- FAILS: returns one row per opportunity per day
select sum(amount) from fact_opportunity_snapshot;

-- correct: one snapshot date
select sum(amount) from fact_opportunity_snapshot
where snapshot_date = date '2026-09-30';

-- correct: exactly two, for a comparison
select snapshot_date, sum(amount) from fact_opportunity_snapshot
where snapshot_date in (date '2026-06-30', date '2026-09-30')
group by 1;
```

dbt snapshot equivalent:
```sql
select * from snapshots.opportunity_snapshot where dbt_valid_to is null;
```
Omitting `dbt_valid_to is null` returns every historical version of every row.
This is the single most common dbt-specific double count.

### 2.5 Many-to-many association joins

HubSpot deal-to-contact and deal-to-company associations, and Salesforce
`OpportunityContactRole`, are many-to-many. Two correct handlings:

**Aggregate the many side first:**
```sql
with contacts_per_deal as (
  select deal_id,
         count(*) as contact_count,
         array_agg(contact_id) as contact_ids
  from assoc_deal_contact group by 1
)
select d.deal_id, d.amount, c.contact_count, c.contact_ids
from deals d left join contacts_per_deal c using (deal_id);
```

**Or pick a single designated row with a stated rule:**
```sql
-- primary contact only, rule stated in the metric definition
select d.*, a.contact_id
from deals d
left join assoc_deal_contact a
  on a.deal_id = d.deal_id and a.is_primary
```

**Never** join and then sum `amount`. If a downstream consumer needs
person-level revenue, that is a modelling decision requiring an explicit
allocation rule, and **a monetary amount is never simply multiplied across
multiple touches.**

### 2.6 Session-to-event joins

```sql
-- WRONG: neither a session count nor an event count
select count(*) from sessions s join events e using (session_id);
```

Aggregate each separately, then join the aggregates on the shared grain:

```sql
with s as (select date_day, count(*) sessions from sessions group by 1),
     e as (select date_day, count(*) events   from events   group by 1)
select date_day, sessions, events from s full join e using (date_day);
```

And declare which filters move which number. A bot filter applied to events and
not to sessions produces a silently wrong events-per-session ratio.

---

## 3. Grain collapse: making it legible

When a model collapses grain, publish the reconciliation:

```yaml
models:
  - name: mart_order
    description: >
      One row per order. Collapsed from stg__order_line
      (one row per order per line item).
      Control: 40,112 lines -> 12,034 orders, 3.33 lines per order.
      Line-level detail is retained in mart_order_line; contributing
      line_ids are retained in this table's source_line_ids column.
```

Three properties this gives you: the grain is stated, the collapse is
reconciled, and the collapsed rows are traceable. A stakeholder who says "28,000
rows are missing" can be answered in one sentence instead of a half-day
investigation.

---

## 4. Currency and the missing type

No BI or warehouse platform in the research has a currency **type**. Currency
is a format string or a decimal precision everywhere.

Consequence for the model: **store the currency code in its own column next to
every monetary amount**, at the grain of the amount. Store the FX rate and the
conversion date convention in a rate table if conversion is required. Do not
convert in staging; conversion is business logic.

```
fact_order:
  amount_original      numeric
  currency_original    char(3)      -- not optional
  amount_reporting     numeric      -- converted in a mart, not in staging
  fx_rate              numeric
  fx_rate_date         date         -- order date? invoice date? month-end?
  fx_convention        text         -- state which
```

Three orgs will pick three different `fx_rate_date` conventions and all three
are defensible. Declare it.
