# B2B metric reference

One row per metric. `Grain` is the unit each row of the computation represents.
`Time basis` is the date column the metric is bucketed by. `Trap` is the way
this metric is most commonly computed wrong.

## Demand and funnel

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Inquiries | count of hand-raises | n/a | person | created date | leading | source mix moves the blended downstream rate without quality changing |
| MQL count | count of people crossing the score threshold | n/a | person | MQL date | leading | threshold is undocumented and drifts; count without MQL→SQL is not an indicator |
| MQL→SAL rate | SALs ÷ MQLs in cohort | MQLs created in cohort | person | MQL date | leading | SAL usually not instrumented; absence is a finding, not a zero |
| MQL→SQL rate | SQLs ÷ MQLs in cohort | MQLs created in cohort | person | MQL date | leading | snapshot version of this counts current-stage populations and is not a rate |
| Lead-to-opportunity rate | opportunities created from cohort ÷ cohort | inquiries or MQLs in cohort | person | cohort entry date | leading | recent cohorts truncated; last points are incomplete, not declining |
| Opportunity creation rate | opportunities created ÷ accounts worked | accounts with any sales activity | account | activity date | leading | denominator drifts when territory changes |
| Demand-unit conversion | units advancing ÷ units entering | buying groups in cohort | buying group | cohort entry | leading | mixing person-grain touches into a unit-grain funnel |

## Pipeline

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Pipeline created | sum of amount of opportunities created in period | n/a | opportunity | created date | leading | opportunities created and then amended; use the amount at creation, from snapshot |
| Open pipeline | sum of amount where stage is open | n/a | opportunity | snapshot date | leading | needs a snapshot date filter; without one, snapshot tables fan out |
| Pipeline coverage | open pipeline closing in period ÷ quota for period | quota | opportunity | close date in period | leading | target is `1 ÷ win rate`, not 3x; mid-period compared to start-of-period benchmark |
| Net-of-stale coverage | as above, excluding deals pushed ≥3 times or inactive beyond a cycle | quota | opportunity | close date | leading | almost no CRM report does this by default |
| Pipeline velocity | `(#Opps × Win Rate × Avg Deal Value) ÷ Cycle Length` | n/a | cohort | cohort entry | leading | units are revenue per time, not a duration; inputs must share cohort and segment |
| Slippage | opportunities whose close date moved out of the period ÷ opportunities forecast to close | forecast set at period start | opportunity | snapshot | lagging | unrecoverable without daily snapshots |
| Stage duration | median days between stage entries | opportunities that entered the stage | opportunity | stage entry date | lagging | mean instead of median; open deals excluded creates survivorship bias |

## Win and cycle

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Win rate (close-date) | `Won ÷ (Won + Lost)` | closed in period | opportunity | close date | lagging | biased by which deals landed in the period |
| Win rate (cohort) | `Won ÷ all created in cohort` | created in cohort | opportunity | created date | lagging | needs a full cycle; before that it is a lower bound |
| Win rate (incl. no-decision) | `Won ÷ (Won + Lost + No decision)` | closed in period | opportunity | close date | lagging | requires a no-decision stage value to exist |
| Win rate (dollar) | `Σ won amount ÷ Σ closed amount` | closed in period | opportunity | close date | lagging | differs from count version whenever size correlates with win probability |
| Sales cycle | median (and p90) days from created to closed-won | won opportunities | opportunity | close date | lagging | mean; lost deals silently in or out; survivorship under-reports |
| Loss reason mix | losses by reason ÷ total losses | losses in period | opportunity | close date | lagging | free-text reasons and a dominant "other" bucket |

## Revenue and retention

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Bookings | Σ contract value signed | n/a | contract | signature date | lagging | conflated with revenue; multi-year deals booked at TCV |
| ARR | annualised recurring value of active subscriptions | n/a | customer | snapshot date | lagging | it is a point-in-time run rate; "Q3 ARR" is ambiguous |
| ACV | `TCV ÷ years`, or year-1 value, or recurring-only | contracts | contract | signature date | lagging | conventions diverge 30%+ on ramped multi-year deals |
| GRR | `(Start ARR − churn − downgrade) ÷ Start ARR` | ARR of customers present at period start | customer | period | lagging | **>100% is a bug**: expansion leaked in |
| NRR | `(Start ARR − churn − downgrade + expansion) ÷ Start ARR` | ARR of customers present at period start | customer | period | lagging | five conventions (see `contested.md`); in-period new logos leaking in |
| Logo retention | customers retained ÷ customers at start | customers at period start | customer | period | lagging | count-weighted, so unrelated to revenue impact |
| Expansion rate | expansion ARR ÷ starting ARR | starting ARR | customer | period | lagging | upsell and cross-sell mixed with price increases |

## Unit economics

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| CAC | fully-loaded S&M cost ÷ new customers | new customers in period | customer | acquisition date | lagging | media-only numerator; period mismatch; expansion blended in |
| CAC payback | `CAC ÷ (new MRR × gross margin)` | n/a | customer | acquisition cohort | lagging | **gross margin omitted**, understating payback by `1 ÷ GM` |
| LTV (closed form) | `(ARPA × gross margin) ÷ churn` | n/a | customer | cohort | lagging | assumes constant churn forever; invalid when NRR ≥ 100% |
| LTV (bounded) | cumulative gross profit per cohort at month N | cohort size | customer | cohort month | lagging | horizons must match to compare; state N |
| LTV:CAC | LTV ÷ CAC | n/a | customer | cohort | lagging | the 3:1 rule has no empirical basis; lead with payback |
| Magic number | `(ΔQ ARR × 4) ÷ prior-quarter S&M spend` | prior-quarter spend | company | quarter | lagging | one-quarter lag assumption fails for long cycles |
| Burn multiple | net burn ÷ net new ARR | net new ARR | company | period | lagging | undefined when net new ARR ≤ 0; say `unavailable`, not infinity |

## Sales activity and capacity

| Metric | Formula | Denominator | Grain | Time basis | Lead/lag | Trap |
|---|---|---|---|---|---|---|
| Activity per rep | logged activities ÷ active reps | reps active in period | rep | activity date | leading | auto-logged email inflates it; correlation with revenue is not causation |
| Meetings held rate | meetings held ÷ meetings booked | meetings booked | meeting | booked date | leading | no-show handling differs by system |
| Quota attainment | closed-won ÷ quota | quota | rep | close date | lagging | ramping reps carry full quota in most reports |
| Capacity | Σ (ramped rep-months × productivity) | n/a | rep-month | month | leading | **ramp is the most-omitted parameter**; a rep hired in month 1 is not productive in month 1 |
| Ramp time | median months to first quota attainment | reps with ≥1 full quota period | rep | hire date | lagging | survivorship: reps who never ramped and left are excluded |
