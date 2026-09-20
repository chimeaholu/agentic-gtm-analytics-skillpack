# Cadence playbooks

What goes in each report, what stays out, and the two procedures that make the
monthly and quarterly worth reading.

---

## Weekly — leading indicators only

**Audience:** the GTM team and their manager. People who will act on Monday.

**Length:** one screen. If it scrolls, it is a monthly.

| Include | Why |
|---|---|
| Pipeline created (new opportunities, by created date) | moves weekly, and someone owns it |
| Qualified meetings booked | the earliest reliable leading indicator in most B2B motions |
| Activity volume by rep or team | leading, and the correlation caveat is attached |
| Stage-entry counts for the top two stages | where the funnel is actually moving |
| Engagement on the active accounts | for account-based motions |
| **Two to three sentences: what changed and why** | the part that gets read |

| Exclude | Why |
|---|---|
| Closed revenue | moves on deal-close timing, not on the week's work. Weekly revenue is noise, and a reader who learns one number is noise discounts the rest. |
| Anything requiring finance reconciliation | it cannot be reconciled weekly, so it will be wrong weekly |
| Forecast changes | a forecast that moves weekly is not a forecast |
| Any metric whose weekly volume is below roughly 30 | the week-to-week variance swamps the signal; report it monthly or as a 4-week rolling figure |

**Same definitions, every week, no exceptions.** The weekly report's value is
comparability across weeks. One redefinition destroys a quarter of trend.

**Day-of-week effects are real and they are large.** A week that contains a public
holiday is not comparable to one that does not. Report covered business days
alongside the figure, or use a per-business-day rate, per
`temporal-integrity-audit`.

---

## Monthly — reconciled before publication

**Audience:** leadership. People who will quote the numbers to other people.

**The rule that defines this cadence: if the marketing number and the finance
number differ, that is resolved before publication, not explained afterwards.**

### The reconciliation procedure

Run it every month, before the report is assembled, not after.

1. **Agree the comparison basis first.** Finance counts recognised revenue by
   accounting period; GTM counts bookings by close date. These are different
   numbers about different things and reconciling them without agreeing the basis
   produces an argument, not a reconciliation. Write the basis down.
2. **Line up the windows.** Finance's month may close on a different day
   (a 4-4-5 calendar, or a close that runs to the third business day).
3. **Diff at the transaction grain, not the total.** A matching total can hide two
   offsetting errors; a diff at deal level names the deals.
4. **Classify every difference into one of four buckets:**

   | Bucket | Example | Treatment |
   |---|---|---|
   | **Timing** | closed 31 Aug, booked 1 Sep | expected; state the lag |
   | **Scope** | finance excludes an entity or a product line | expected; state the scope |
   | **Definition** | bookings vs recognised, gross vs net of discount | expected; state both definitions |
   | **Error** | a deal in one system and not the other | **fix before publication** |

5. **Publish one number.** Where a structural difference remains, name the other
   number and quantify the gap in one sentence — never present both with equal
   billing, which puts two numbers into circulation and leaves the reader to pick.

> Bookings were 4.2M in August on close date. Finance recognised 3.9M in the
> August accounting period; the 0.3M difference is four deals that closed on
> 30–31 August and book in September. No unexplained residual.

**An unexplained residual is a blocker.** Publishing a monthly report with an
unexplained gap to finance costs more credibility than publishing a day late.
Use `cross-system-reconciliation` for the mechanics.

### The rest of the monthly

- Full metric set, month-over-month **and** against the same month last year where
  seasonality matters.
- The drivers behind the headline, from `executive-narrative-builder`.
- Forecast versus actual for the month, with the variance decomposed.
- Definition changes on the timeline.
- The negative list in full.

---

## Quarterly — the postmortem is the point

Everything in the monthly, plus the two sections that make a QBR a learning event
rather than a defence.

### 1. The forecast-accuracy postmortem

**Almost nobody does this, and it is what makes the next forecast better.**

| Column | Content |
|---|---|
| What we forecast | the number, and the date it was made |
| What happened | the actual |
| Error | signed, in absolute and percentage terms |
| Error versus the naive baseline | the same error for "next quarter = last quarter" |
| Where the error came from | volume, conversion, ASP, timing — decomposed |
| What we changed as a result | or "nothing", written explicitly |

**The naive baseline column is the one that stings and the one that matters.** A
forecasting process that does not beat "same as last quarter" is a process
consuming effort for negative value. Report the comparison honestly; see
`pipeline-forecast`.

Track the error's **sign over time**, not just its magnitude. A forecast that is
consistently 8% high is a correctable bias; one that is randomly ±8% is
irreducible noise, and the two demand opposite responses.

### 2. The definition-change log

Every definition that changed during the quarter, the date, the effect, and
whether history was restated. This is where a reader goes when a number in this
quarter's deck disagrees with one they remember from a previous deck, and without
it that disagreement becomes a discussion about the report's reliability.

### Also quarterly

- Cohort curves compared at **the same horizon**, never a mature cohort against a
  young one.
- The metrics that moved *structurally* — win rate, cycle length, ASP, retention —
  as opposed to those that moved with volume.
- Anything that was `unavailable` all quarter, with what it would take to fix. A
  persistent gap that appears in four monthlies and never gets an owner gets one
  here.

---

## Ad hoc

Still an artefact, and it still carries: timestamp, definition, window, caveats,
and the negative list. An ad-hoc answer that gets forwarded without those becomes
a decision input with no provenance three weeks later.

**Log every ad-hoc request.** The log is what drives the routing rule in §1 of the
SKILL.md — you cannot notice the fourth repeat of a question if you did not
record the first three.

```json
{ "asked_at": "2026-09-19", "requester_role": "sales_leadership",
  "question": "pipeline created by segment this quarter",
  "shape": "pipeline_created|segment|quarter", "answered_in": "chat" }
```

Match on `shape`, not on wording. The same question arrives phrased five ways,
and matching on wording finds no repeats at all.

---

## Daily — do not

A daily report is an alert with a worse delivery mechanism and no owner. Route it
to `anomaly-detection`: a threshold, an owner, an action, and a suppression
window for known events.

The exception that is genuinely a report: a **daily exceptions list** — the deals
that slipped, the accounts that went quiet, the campaigns that stopped
delivering. Note the shape: it is a list of things needing action, empty on a
normal day, and **an empty one is a successful run, not a broken report.** Say so
in the artefact, or someone will "fix" it.
