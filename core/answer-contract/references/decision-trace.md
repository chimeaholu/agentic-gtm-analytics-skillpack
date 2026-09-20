# Decision trace

## Why

Six weeks after an answer ships, someone disputes it. Without a trace, the only
way to defend the number is to recompute it and hope the platform has not
restated. With a trace, the dispute resolves to a named decision that can be
agreed or overruled.

## Record schema

```json
{
  "step_name": "string, stable identifier for the kind of decision",
  "decision": "string, what was chosen",
  "reasoning": "string, why, in one sentence",
  "confidence": 0.0,
  "alternatives": ["string, what was not chosen"],
  "evidence": "string, the observation that supports the choice"
}
```

One record per **interpretive** decision. Not one per API call. If a step had no
alternative, it was not a decision and does not need a record.

## The decisions that always need a record

| step_name | The choice being made |
|---|---|
| `metric_definition` | which definition of the metric, and whose |
| `denominator_selection` | for any rate |
| `date_basis` | event date, click date, conversion date, close date, created date |
| `window_endpoints` | exact boundaries, inclusive or exclusive |
| `timezone_resolution` | which timezone, confirmed or assumed |
| `currency_handling` | reporting currency, FX rate and date, or none applied |
| `join_key_selection` | what was joined on, and what the match rate was |
| `exclusion_set` | test accounts, internal traffic, archived records, refunds, bots |
| `cap_disposition` | what was done when a cap was hit |
| `comparability_verdict` | from `comparability-rules`, whenever two sources met |

## Confidence derivation

**Overall confidence is derived, never asserted.** State which rule you used.

- **Minimum over steps.** The default. Correct when the steps are chained, which
  they usually are: the answer depends on every step being right, so it is as
  strong as the weakest one.
- **Mean over steps.** Only when the steps are genuinely independent
  contributions to the answer, such as four platform legs of a sum, none of which
  depends on the others.

```
overall_confidence = min(step.confidence for step in trace)     # chained, default
overall_confidence = mean(step.confidence for step in trace)    # independent legs
```

Write the rule into the output so a reader can check it:

> Overall confidence 0.6, derived as the minimum across seven steps. The
> binding step is the join key: the match rate between ad-platform click IDs and
> CRM records was 61%.

An asserted "high confidence" with no step behind it is a vibe, and a vibe in a
numeric answer is worse than an error bar, because it cannot be checked.

## Calibrating step confidence

| Confidence | What it means |
|---|---|
| 0.95+ | the source states it explicitly and there is one reading |
| 0.8 | conventional choice, documented, but the platform allows another |
| 0.6 | defensible, materially different alternatives exist, evidence is thin |
| 0.4 | a guess with a reason |
| below 0.4 | not a decision; escalate to `ambiguous` in `answer-contract` |

## Audit example

A disputed cost-per-opportunity figure resolves in one pass:

```json
[
  {"step_name": "metric_definition", "decision": "paid spend / opportunities with paid first touch",
   "reasoning": "user said 'cost per opp from paid'", "confidence": 0.85,
   "alternatives": ["all opportunities in denominator", "last-touch attribution"],
   "evidence": "question scoped to paid channels"},
  {"step_name": "join_key_selection", "decision": "account domain",
   "reasoning": "no shared person key across ad platforms and CRM", "confidence": 0.6,
   "alternatives": ["click ID where present", "email hash"],
   "evidence": "click ID present on 38% of CRM records"},
  {"step_name": "currency_handling", "decision": "convert to USD at quarter-end rate",
   "reasoning": "reporting currency is USD; spend is in three currencies", "confidence": 0.9,
   "alternatives": ["daily rates", "report per currency"],
   "evidence": "three ad accounts with different account currencies"}
]
```

Overall: 0.6, minimum rule, binding step `join_key_selection`. The dispute is now
a conversation about the join key, which is the right conversation, instead of a
conversation about whether the number is wrong.
