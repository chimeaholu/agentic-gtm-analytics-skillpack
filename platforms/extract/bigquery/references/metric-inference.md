# BigQuery has no metric layer — so say "inferred"

**BigQuery has no native metric or semantic layer.** There is no object that declares what
revenue means, no additivity rules, and **no non-summable markers** of the kind Snowflake's
`NON ADDITIVE BY` provides.

So if a customer's metrics live only in BigQuery, **they live in SQL text**, and **any
metric the agent produces from scratch is reinvention** — a second definition that will
quietly disagree with whatever the business already uses.

## The naming problem, concretely

A GTM dataset routinely contains all of these:

- `revenue`
- `revenue_usd`
- `net_revenue`
- `amount`
- `total_amount`
- `booked_amount`

**Nothing tells the agent which one the CFO means.** Column descriptions may help or may be
absent, stale or aspirational. Picking one and reporting it as "revenue" is a guess
presented as a fact.

**The correct move is to ask, or to read the layer above.**

## Where a metric layer actually lives

Read these before defining anything:

| Source | What it gives you | Confidence |
|---|---|---|
| **LookML** | measures with explicit `type`, `sql`, and a **declared join graph with relationships** | **declared** |
| **dbt `manifest.json`** | models, tests, declared relationships, and dbt metrics where defined | **declared** where metrics exist; otherwise inferred from model SQL |
| **Dataplex glossary / catalog** | business terms attached to columns | declared, but often incomplete |
| Column descriptions and labels | intent, sometimes units | unverified |
| **View SQL (`INFORMATION_SCHEMA.VIEWS.VIEW_DEFINITION`)** | the logic someone curated | **inferred** |

`semantic-layer-introspector` runs before any metric is defined. **Do not invent a
definition the customer already has.**

## The word discipline

**Say "inferred", not "discovered", when joins come from view SQL rather than declared
constraints.**

This is not pedantry. The two claims have different reliability:

> **Declared:** "The LookML model declares `orders` to `customers` as `many_to_one` on
> `customer_id`."

> **Inferred:** "The view `v_gtm_pipeline` joins `opportunities` to `accounts` on
> `account_id`. I have inferred a many-to-one relationship from the SQL; BigQuery does not
> enforce or declare it, so a fan-out is possible if the assumption is wrong."

**BigQuery does not enforce primary or foreign keys in the way a transactional database
does**, so cardinality read off a join condition is a reading, not a fact. A fan-out on a
wrong assumption double-counts revenue, and nothing errors.

## Money types

**No currency type exists.**

- **Use `NUMERIC` or `BIGNUMERIC` for exact decimal money. `FLOAT64` money is a real bug
  source** — accumulated float error in a sum over millions of rows is visible at the
  cent level and occasionally above it.
- **The unit is convention only.** A `NUMERIC` column named `revenue` tells you nothing
  about the currency, and there is no metadata that will.

For a multi-currency dataset, find the currency discriminator column or say that the sum is
uninterpretable.

## Week and day conventions, which change every GTM number

Two defaults that silently decide what a report says:

- **`CURRENT_DATE()` is UTC.** **`CURRENT_DATE("America/New_York")` is what the sales team
  means.** The gap is a full day for anything reported in the evening.
- **`DATE_TRUNC(x, WEEK)` starts Sunday by default. `WEEK(MONDAY)` is a different
  answer.**

**A GTM agent reporting "this week's pipeline" must state its week convention.** Two
correct queries can produce different weekly numbers, and the difference will be blamed on
the data.

And the type-mixing trap underneath both: **`TIMESTAMP` is absolute UTC while `DATETIME` is
wall-clock with no zone, and mixing them silently shifts numbers.**

## Metadata surfaces that lie in specific ways

- **`INFORMATION_SCHEMA` is region-scoped.** Query `region-us.INFORMATION_SCHEMA.JOBS`, not
  a global view. **The wrong region returns an empty result, not an error** — so an agent
  can conclude a project has no job history when it is simply looking in the wrong region.
- **Soft deletes exist** — time travel plus fail-safe, `UNDROP TABLE`,
  `FOR SYSTEM_TIME AS OF` — and **deleted tables can still appear in some metadata
  surfaces.** An inventory over-counts unless filtered.
- **Streaming buffer rows are invisible to some operations** and **may not appear in
  `TABLE_STORAGE` counts**, so a metadata row count and a `SELECT COUNT(*)` can
  legitimately disagree on a recently-written table.
- **Views execute with the caller's permissions unless they are authorized views**, so an
  agent can see a view and get "permission denied on underlying table" when it runs. That
  is a grant question, not a broken view.

## What "create a report" means here

Since there is no report object, the honest framing when someone asks for one:

> **create a view (the definition) + a scheduled query that materialises it (the refresh) +
> a delivery surface pointed at the result (the thing a human opens).**

All three are writes and route through `write-gate`. And per the cost reference: **run the
scheduled query as a service account**, or it dies when its creator leaves.
