# GTM feature families — catalogue and availability register

A working catalogue. Names are illustrative; the point is the shape, the window
and the caveat.

---

## 1. Firmographic (account, slow-moving)

| Feature | Definition | Caveat |
|---|---|---|
| `employee_band` | Bucketed headcount at `as_of_ts` | Provider-specific: legal entity vs group. Bands, not raw counts — the precision is fake |
| `revenue_band` | Bucketed revenue | Frequently modelled by the vendor, not reported. Treat as an estimate |
| `industry_norm` | Industry mapped to one standard set | Mapping is versioned. Providers disagree materially |
| `country`, `region` | Registered or operating location | HQ vs billing vs contact country are three different fields |
| `entity_age_years` | Years since founding | Missing at a high rate for private companies |
| `tech_detected_<x>` | Technology present at `as_of_ts` | **Carries an observation date.** Detections decay; a 14-month-old detection may be a removed tool |
| `is_parent`, `child_count` | Corporate hierarchy position | Hierarchy completeness varies wildly by provider |

**Coverage bias, stated once:** small, non-US and privately held companies are
systematically under-covered. A missing firmographic is missing, not low. See
`demographic-fit-scoring`.

---

## 2. Behavioural (event-derived)

| Feature | Definition | Window default |
|---|---|---|
| `events_<w>` | Count of tracked events | 7 / 28 / 90 |
| `active_days_<w>` | Distinct days with ≥1 event | 28 |
| `sessions_<w>` | Sessions, per the source's own session definition | 28 |
| `days_since_last_event` | `as_of_ts − max(event_ts)` | — |
| `event_acceleration` | `events_7d / (events_28d / 4)` | — |
| `distinct_features_<w>` | Distinct product features touched | 28 |
| `pricing_page_views_<w>` | High-intent page class | 14 |
| `docs_views_<w>` | Implementation-intent page class | 28 |
| `first_<signal>_in_window` | Boolean: first ever occurrence inside the window | 14 |
| `depth_p50` | Median session depth | 28 |

- Session definitions are **per-platform and not comparable**. A session in one
  product analytics tool is not a session in another; do not blend them into one
  feature without saying so.
- Bot and internal traffic must be excluded consistently between training and
  scoring, or the exclusion itself becomes a feature.

---

## 3. Engagement (two-way)

| Feature | Caveat |
|---|---|
| `emails_delivered_<w>` | Clean |
| `email_opens_<w>` | **Inflated and unevenly so** by privacy proxies pre-fetching images. Not a clean signal |
| `email_clicks_<w>` | Cleaner than opens; still affected by security-scanner clicks |
| `email_replies_<w>` | Cleanest email signal, lowest volume |
| `meetings_booked_<w>`, `meetings_held_<w>` | Held ≠ booked; the gap is itself a signal |
| `calls_connected_<w>` | Capture varies by dialer integration |
| `distinct_engaged_contacts_<w>` | **Multithreading — among the strongest B2B account features** |
| `senior_engaged_contacts_<w>` | Requires a title→seniority mapping, which is versioned |
| `inbound_initiated` | Who started it. Materially different signal from outbound-initiated |
| `response_latency_hours_p50` | Speed of reply. Strong, and often uncaptured |

**Activity capture is incomplete and unevenly so** across reps, teams and
channels. Every engagement feature ships with a coverage number, and a model
trained on it partly learns which reps log activity.

---

## 4. Commercial

| Feature | Caveat |
|---|---|
| `plan_tier`, `seats` | Point-in-time — from a snapshot, not the current record |
| `list_price`, `discount_pct` | Discount is often the strongest commercial feature and the most leaky: check when it was set relative to the prediction point |
| `contract_months`, `billing_period` | |
| `amount_home_currency` | **Use the home-currency variant.** Raw amounts across currencies do not sum to anything meaningful, and the conversion rate is snapshotted per record |
| `days_to_renewal` | Computed against `as_of_ts` |
| `prior_purchases`, `days_since_last_purchase` | |
| `expansion_events_<w>`, `contraction_events_<w>` | |
| `payment_method_class` | A strong involuntary-churn feature; keep it out of voluntary-churn models — see `churn-prediction-models` |

---

## 5. Relational (account roll-ups)

| Feature | Rule |
|---|---|
| `contacts_known` | Count of contacts on the account at `as_of_ts` |
| `contacts_engaged_<w>` | Count with ≥1 engagement in window |
| `max_person_score`, `sum_person_score` | **Keep both.** One strong contact and six weak ones are different situations |
| `mean_person_score` | Dilutes; useful only alongside the count |
| `seniority_mix` | Share of engaged contacts by seniority band |
| `functions_engaged` | Distinct functional areas engaged — a breadth signal |
| `account_events_<w>` | Sum of person events, deduplicated on the identity graph |

Roll-ups depend entirely on identity resolution. An account whose contacts are
not linked shows as unengaged. Report the unmatched rate from
`identity-resolution` alongside any relational feature — **the roll-up's error
direction is always "understates engagement".**

---

## 6. Availability register

Lags from the platform research. Use these to decide what a real-time score may
contain.

| Source class | Availability | Restates? | Real-time viable |
|---|---|---|---|
| Paid social insights | settles over ~28 days | Yes | No |
| Paid search conversions | back-fills up to 90 days | Yes | No |
| Web analytics (GA4-class) | reprocesses 24–48h | Yes | No |
| Ad demographics | 12–24h | Some | No |
| Ad video metrics | ~48h | Some | No |
| Product analytics (Amplitude-class) | ~2h | Rarely | Hourly batch |
| Product analytics (PostHog/Mixpanel-class) | near-real-time for events | Rarely | Yes for event features; **person properties are latest-value-wins and never point-in-time** |
| CRM read APIs | near-real-time | Fields edited after the fact | Yes, with a snapshot for history |
| Messaging platforms | vendor advises ~5 min between dependent calls | No | Pacing constraint, not freshness |
| Enrichment vendors | on-demand to weekly | **Backfills** | No |
| Warehouse metadata views | 45 min – 3 h latency | No | No |

**Rule of thumb:** a real-time score may contain CRM state, product events and
first-party web events. It may not contain ad-platform metrics, enrichment
refreshed on a batch cadence, or anything derived from a restating source without
a snapshot.
