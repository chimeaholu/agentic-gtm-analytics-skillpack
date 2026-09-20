# Blended, attributed and incremental

## 1. The three series

| | Platform-attributed | Blended | Incremental |
|---|---|---|---|
| **Formula** | platform conversion value ÷ platform spend | total revenue ÷ total spend | (treatment revenue − control revenue) ÷ spend |
| **Grain** | campaign / ad set / ad | business × period | test cell × period |
| **Who computed it** | the platform selling the ads | your books | an experiment |
| **Additive across platforms** | **no** | yes, by construction | only within the test design |
| **Answers** | "what does this platform claim" | "is total spend sustainable" | "did the ads cause revenue" |
| **Available** | always | always | only if you ran the test |

**Every number carries its series label.** The most common failure in paid-media
reporting is a platform-attributed figure presented in a sentence that implies
incrementality.

## 2. Why channel ROAS oversums

Three independent mechanisms, all additive in the same direction:

1. **Overlap.** Two platforms touched the same buyer; both claim the conversion.
2. **View-through.** An impression nobody engaged with counts on some platforms.
3. **Modelling.** Platforms estimate conversions they cannot observe.

The result is routinely 130–160% of actual revenue when channel figures are
summed. **Compute the sum anyway and annotate it** — a refusal sends the reader
to a spreadsheet where they will compute it with no caveat at all.

The annotated form:

```
Summed platform-attributed revenue      1,810,000
Actual revenue in the same period       1,280,000
Implied over-attribution                  141%
Direction of error                      overstates
Magnitude                               unquantified without a shared identity key
Better number                           blended MER, below
Causal number                           requires a holdout; none has run
When the rough figure is fine           channel-versus-itself trends, scale sanity
```

## 3. MER arithmetic

```
MER                      = total revenue ÷ total marketing spend
Break-even MER           = 1 ÷ contribution margin
aMER                     = new-customer revenue ÷ total marketing spend
Blended new-customer CAC = total marketing spend ÷ new customers
Contribution after spend = revenue × CM − spend
```

| Contribution margin | Break-even MER | A MER of 3.0 means |
|---|---|---|
| 50% | 2.0 | comfortably profitable on media |
| 40% | 2.5 | profitable |
| 30% | 3.33 | **below break-even** |
| 25% | 4.0 | well below break-even |
| 20% | 5.0 | losing money on every order |

Notes that decide whether the number is usable:

- **State the CM level.** `1 ÷ CM3` double-counts ad spend, because CM3 already
  subtracts it. Use CM2 for break-even MER.
- **Total marketing spend means total** — media, agency fees, tooling, creative
  production, affiliate commissions. Media-only spend inflates MER and makes the
  business look more efficient than it is.
- **Revenue must be on the same basis as the margin**: net of discounts and
  returns if the margin is, gross if it is not. Mixing them is a silent error of
  the size of the return rate.
- **aMER is the acquisition view.** Blended MER charges retention revenue
  against acquisition spend and improves automatically as the customer base
  ages, which makes it a poor trend metric for a maturing brand.

## 4. What an incremental number requires

Only an experiment. Three designs, in descending rigour and cost:

### Geo holdout

Split comparable geographies into treatment and control, suppress the channel in
control, run for at least one full purchase cycle plus the attribution window.

- **Strongest available for channels that can be geo-targeted.**
- **Requires enough geos** to balance; a two-geo test is an anecdote.
- Match on pre-period revenue trend, not just size.
- Read out on **total** revenue in the geo, never on platform-attributed
  conversions — the platform cannot see the control's counterfactual.

### Conversion-lift / platform-run study

The platform withholds ads from a randomised holdout and reports the lift.

- **Randomisation is real**; the measurement is the platform's.
- Cheap and fast, and biased toward the platform's own definition of a
  conversion. Read it as directional.
- Availability and minimum-spend thresholds vary by platform.

### Switchback / pulsing

Turn a channel off and on in alternating periods, compare total revenue.

- **Cheapest and weakest.** Confounded by seasonality, carryover and the
  platform's own learning phases after each restart.
- Needs several cycles before the comparison means anything.
- Useful as a first look when nothing else is affordable, and must be labelled
  as such.

**The sentence to use when none has run:**

> No holdout ran, so this is revenue alongside spend, not revenue caused by it.
> If the budget decision is material, a geo-holdout on one channel for four
> weeks would settle it.

## 5. Normalising for comparison

Where a cross-platform comparison is genuinely needed:

1. **Pick the common window.** 7-day click exists on Google, Meta and LinkedIn.
2. **Re-query each platform at that window.** Do not adjust numbers arithmetically
   — the platforms do not expose a conversion-level breakdown that would make
   that valid.
3. **Fix LinkedIn's attribution type** to `LAST_TOUCH_BY_CONVERSION` before any
   comparison, or its totals are inflated by the number of campaigns involved.
4. **Normalise currency** using a stated rate on a stated date, and say so.
5. **Align the date basis** as far as possible, and state where you could not —
   LinkedIn's conversion-date basis cannot be made to match Google's click-date
   basis by any query parameter.
6. **Publish both series**: platform-default ("what your Ads Manager shows") and
   normalised ("the comparable series"). Never silently pick one.

## 6. Campaign-key normalisation

The join between spend and site behaviour runs through campaign naming, which is
never clean.

```
normalised_key = lower(regexp_replace(campaign_name, '[^a-z0-9]+', '_', 'gi'))
prefer         = the platform campaign ID where it is present in the UTM
```

Report, in every channel-level analysis:

```
matched_spend            currency and share
unmatched_spend          currency and share  ← the size of the guesswork
matched_sessions         count and share
unmatched_sessions       count and share
renamed_mid_period       campaigns whose name changed inside the window
```

**Unmatched spend is the honest bound on a channel-level claim.** A 12%
unmatched share means 12% of the budget is not in the analysis, and it is not
randomly distributed — it clusters in the campaigns someone renamed or set up
outside the naming convention.
