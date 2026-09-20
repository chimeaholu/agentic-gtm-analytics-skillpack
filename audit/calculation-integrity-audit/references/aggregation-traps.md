# Aggregation traps, worked

---

## 1. Average of averages

### The failure

```
Region   Orders   AOV
EMEA        120   $180
AMER      4,800   $ 62
APAC         40   $340

avg of the AOV column         = $194
true AOV = total / orders     = $ 67
```

**A 2.9x error**, and the wrong number looks more plausible than the right one,
which is why it survives review.

### Correct forms

```sql
-- overall
select sum(order_value) / count(*) as aov from orders;

-- explicitly weighted, if a per-region figure is genuinely the input
select sum(region_aov * region_orders) / sum(region_orders)
from (select region, avg(order_value) region_aov, count(*) region_orders
      from orders group by 1) r;
```

### Where it hides

- **A BI tool aggregating a pre-aggregated measure.** The measure is already an
  average; the tool averages it again across the visual's grain. Power BI
  implicit measures and Tableau's default aggregation both do this by default.
- **A percentage column averaged down a table.** The total row is an average of
  rates, weighting every row equally.
- **A monthly rate averaged to get an annual rate.** Months have different
  denominators; February is 10% shorter than January.
- **Segment rates averaged to a total.** Same failure, different label.
- **A "blended" figure that is actually a mean of channel figures**, rather
  than total over total.

### The tell

The average-of-averages figure sits between the group values and ignores their
sizes. If a tiny group has an extreme value and the total moves toward it,
you are averaging groups rather than observations.

---

## 2. Aggregation order

`SUM(a)/SUM(b)` and `AVG(a/b)` are different numbers and both appear on
dashboards labelled "conversion rate".

```
Day   Sessions  Orders  Daily rate
Mon      1,000      30      3.0%
Tue      1,000      30      3.0%
Wed         10       1     10.0%

SUM/SUM            = 61 / 2,010 = 3.03%
AVG of daily rates = 5.33%
```

Wednesday is a tenth of a percent of the traffic and 44% of the second figure.

**Rule: a rate over a period is computed on the period's totals.** The average
of daily rates is a different metric. If someone wants it, it should be called
"average daily conversion rate" and it should not be compared to a period rate.

### Filtering after aggregating

A filter applied to an aggregated result changes the denominator of everything
downstream. In a BI tool the order is typically:

```
row-level filters -> aggregation -> having-style filters -> visual filters
```

None of this is visible on the chart. A visual filter that removes a category
removes it from the total too, so a "share of total" computed in the same
visual is a share of the filtered total, not of the real one.

**Check:** does the chart's total match the total computed with no visual
filters? If not, every share on it is relative to a filtered base and the
labels should say so.

---

## 3. Rounding drift

### Percentages that do not sum to 100

```
Channel   True share   Rounded
Paid          33.33%      33%
Organic       33.33%      33%
Email         33.34%      33%
                          ---
                          99%
```

**Fix:** largest-remainder apportionment, and say you used it.

```sql
with s as (
  select channel, value, value / sum(value) over () as share from t
),
r as (
  select *, floor(share * 100) as base,
         share * 100 - floor(share * 100) as remainder,
         row_number() over (order by share * 100 - floor(share * 100) desc) as rk
  from s
)
select channel,
       base + case when rk <= 100 - (select sum(base) from r) then 1 else 0 end
         as apportioned_pct
from r;
```

### Rounding at each step

```
unit price 12.345 -> rounded 12.35, x 10,000 units = 123,500
unrounded                     12.345 x 10,000      = 123,450
drift                                                     50
```

**Round once, at display.** Carry full precision through the calculation.

### Floating point money

`0.1 + 0.2 != 0.3` in binary floating point. Over a million rows a
per-row epsilon becomes a real reconciliation gap. Use `NUMERIC`/`DECIMAL`, or
integer minor units.

### Percent versus percentage points

"Conversion improved 5%" from a 4% base could mean 4.2% or 9%. **Always say
which**, and prefer percentage points for differences between rates.

---

## 4. GA4 sampling, thresholding and rollup

### 4.1 Sampling

```json
"samplingMetadatas": [{"samplesReadCount": "1200000", "samplingSpaceSize": "8400000"}]
```
Sampling rate = 1,200,000 / 8,400,000 = **14.3%**.

Consequences for a calculation:

- Small segments are estimated from very few sampled rows and are unreliable.
- A period-over-period comparison where one period was sampled and the other
  was not contains a sampling artefact, not a change.
- Sums of sampled segments are estimates of estimates.

**Routes to an unsampled number:** shorten the date range, remove dimensions,
or use the BigQuery export if the property has one.

### 4.2 Thresholding

```json
"subjectToThresholding": true
```

Rows are suppressed for privacy, typically on demographic, interest and
user-identifying dimensions. **Totals will not add up.**

Two specific wrong calculations:

1. **Segment sum presented as the total.** It is lower than the true total by
   the suppressed rows.
2. **A residual "unknown" or "other" segment computed as total minus segments.**
   That residual is the suppression, not a segment, and labelling it as one
   invents a population.

The honest presentation: report the segments, report the total, state that the
difference is privacy suppression and its size, and do not name it.

### 4.3 Cardinality rollup

```json
"dataLossFromOtherRow": true
```

High-cardinality dimension values (roughly above 500 daily uniques on a
dimension) roll into `(other)`.

Wrong calculation: a long-tail analysis. **There is no tail in the data**; it
is inside `(other)`. Name the dimension that rolled up and say the tail is not
available from this report. The BigQuery export does not have this limit.

### 4.4 Empty and restricted

- `emptyReason`: an empty report is not always "no data". Read it and report
  what it says.
- `schemaRestrictionResponse`: field-level permissions changed the numbers
  **without erroring**. Two service accounts can legitimately return different
  revenue from the same property. Log the credential.

### 4.5 Quota

Set **`returnPropertyQuota: true`** on every request and self-throttle from
`PropertyQuota`. It is a response field, it costs nothing, and without it a
batch job discovers its quota by being cut off partway through, producing a
partial dataset that looks complete.

---

## 5. Fractional credit

Attributed credit is a share of a conversion, not a conversion.

| Wrong | Right |
|---|---|
| "Email drove 12.7 customers" | "Email was credited with 12.7 conversions' worth of value, a 21% share" |
| rounding 12.7 to 13 customers | do not render credit as a count at all |
| a Sankey read as user paths | an attributed flow diagram is an **aggregate flow**, explicitly not an ordered user journey |

The Sankey point matters: a channel-to-channel credit flow diagram looks
exactly like a path diagram, and people read it as "3,400 users went from Paid
to Email to Purchase". Nobody may have taken that path.

---

## 6. Mean where median belongs

| Metric | Typical mean/median ratio | Report |
|---|---|---|
| Sales cycle length | 1.3 - 1.8 | median and p90 |
| AOV | 1.1 - 1.5, higher with a B2B tail | median and mean |
| LTV | 2.0+ | median, and the cohort curve |
| Time to value | 1.4 - 2.0 | median and p90 |
| Deal size | 1.5 - 3.0 | median, and the distribution |
| Session duration | 2.0+ | median |

Practical heuristic: **if mean/median > 1.3, the mean is not describing the
typical case.** Report the median and p90, and give the mean if asked with an
explanation of why they differ. For capacity and SLA questions p90 is usually
the number that matters more than either.
