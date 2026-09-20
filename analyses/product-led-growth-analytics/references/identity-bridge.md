# The product-to-CRM identity bridge

Every product-to-revenue number crosses this bridge, and the bridge has a
measurable coverage figure that is almost never reported. This page is how to
measure it and how to report a number that depends on it.

---

## 1. Per-platform identity semantics

| | PostHog | Amplitude | Mixpanel |
|---|---|---|---|
| Canonical person key | `person_id` | Amplitude ID (merged) | `distinct_id` under ID Merge |
| Device/session key | `distinct_id` | Device ID | `$device_id` |
| Merge mechanism | identity merging on `identify` | user merging on `identify` | ID Merge v2 / v3 |
| **Key trap** | `person_id` is **re-resolved** on merge, so a distinct-person count for a past window can change after the fact | **merging rewrites history** — re-exports are not idempotent across a merge | the export `distinct_id` is **not necessarily** the canonical ID the UI uses; v2 and v3 semantics differ |
| Deletion | persons soft-deleted, **event rows persist** | GDPR deletion removes from queries forward; prior exports retain | same pattern |

Three consequences that all three share:

1. **A historical count is not reproducible after a merge.** Quote the count with
   its extraction date, and expect a re-run to differ. This is not a bug.
2. **Prior exports and current queries disagree**, permanently, for any period
   containing merges. Pick one as the source of truth for a given analysis and
   say which.
3. **Check the merge version before writing join logic.** On Mixpanel
   specifically, ID Merge v2 versus v3 changes what `distinct_id` means in the
   raw export, and join code written against the wrong assumption fails silently
   by matching fewer rows rather than by erroring.

---

## 2. The reconciliation

Product identity and CRM identity are two graphs. The join between them is the
bridge, and it needs an explicit key, in this order of preference:

| Rank | Key | Typical match rate | Failure mode |
|---|---|---|---|
| 1 | An ID written into both systems at signup | high | requires the integration to have existed at signup — historical accounts are unmatched |
| 2 | Account/organisation ID sent as a product event property | high for B2B | absent on events before instrumentation |
| 3 | Email address, exact match, normalised | moderate | personal versus work addresses, plus-addressing, case, role accounts |
| 4 | Email domain → CRM account | moderate for B2B | **breaks entirely on free-mail domains and on multi-entity corporates**; never use it as the only key |
| 5 | Fuzzy name matching | low | produces ambiguous matches that are worse than no match |

```sql
select
  count(*)                                             as product_accounts,
  count(crm.id)                                        as matched,
  count(*) - count(crm.id)                             as unmatched,
  sum(case when crm.dupes > 1 then 1 else 0 end)       as ambiguous,
  count(crm.id)::float / count(*)                      as match_rate,
  sum(case when crm.id is null then p.events end)::float
      / nullif(sum(p.events), 0)                       as unmatched_usage_share
from product_accounts p
left join (
  select account_key, min(id) as id, count(*) as dupes
  from crm_accounts group by 1
) crm using (account_key);
```

**`unmatched_usage_share` is the field that matters most and is always omitted.**
A 78% match rate covering 94% of product usage is a good bridge. A 78% match rate
covering 51% of product usage means the unmatched accounts are your heavy users,
and every revenue-per-usage figure is badly wrong.

---

## 3. Reporting a number that crossed the bridge

The rule from `answer-contract` applies directly: **a low match rate is a number
with a named gap; an unknown match rate is a number with no floor.**

> **Accounts using the integrations feature expand at 2.3× the rate of those that
> do not.** That is computed on the 78% of product accounts matched to a CRM
> record, covering 94% of product usage. The unmatched 22% skew self-serve and
> newer, so if anything this understates the gap — self-serve accounts expand
> less and use integrations less, and including them would widen the difference
> rather than narrow it.
>
> This is correlational: accounts that adopt integrations were likely to expand
> anyway. For prioritising which feature to invest in, the 2.3× is a reasonable
> signal. For a claim that driving integration adoption drives expansion, it is
> not, and that needs a test.

Note the shape: the number, the coverage, **the direction the gap pushes the
estimate**, the causal disclaimer, and when the rough figure is fine.

---

## 4. Improving the bridge

Ranked by effort-to-value, highest first:

1. **Send the CRM account ID as a product event property.** One instrumentation
   change, permanent fix for everything after it ships. Does nothing for history.
2. **Normalise emails before matching** — lowercase, strip plus-addressing, trim.
   Usually recovers several points at zero cost.
3. **Build a warehouse identity table** joining product person, CRM contact and
   CRM account, with a `match_method` and `match_confidence` column per row, so
   downstream queries can filter to deterministic matches when precision matters.
   See `identity-resolution`.
4. **Resolve the ambiguous rows deliberately.** One product account matching
   three CRM records is usually a CRM duplicate problem, not a product problem,
   and it is worth routing to whoever owns CRM hygiene rather than solving in SQL.
5. **Backfill from a shared historical key** — a signup source, an invite token,
   a billing customer ID — where one exists.

**Report the match rate before and after any of these**, because a jump in a
product-to-revenue metric right after an identity improvement is not a business
change, and someone will read it as one.
