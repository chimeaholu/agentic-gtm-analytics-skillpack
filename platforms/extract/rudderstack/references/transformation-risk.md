# Transformation deployment — the highest-risk write in the pack

**Transformations are JavaScript that runs on every event passing through the pipeline, and
the official RudderStack MCP can deploy them.**

## Why it outranks ad-spend writes

A bad ad-spend write costs money and is **visible**: the spend appears on a bill, in a
campaign, in a dashboard someone checks. It is bounded, attributable and reversible.

**A bad transformation is silent and retroactively invisible:**

- It changes what is recorded **from that moment on**.
- Because downstream systems recompute from the stream, **it can change what historical
  analyses produce**.
- **Nothing errors.** Every dashboard stays green.
- **Every number is now different and internally consistent**, which is exactly why nobody
  disputes it.

This is why `write-gate` places transformation deployment at **Tier A** — above spending
money — and why it is **always human-approved, never automatic, never batched with anything
else.**

## What the approval must contain

**A diff of the JavaScript is mandatory, not a summary of it.** "Updates the event
enrichment logic" is not an approval; it is a description of an approval that did not
happen.

The approval names:

1. **The transformation** — by name and id.
2. **The full JavaScript diff** — every changed line, not a paraphrase.
3. **The sources it attaches to** — which event streams run this code.
4. **The destinations affected** — via the connections.
5. **The fields it touches** — read and written, including any it drops.
6. **What existing analyses depend on those fields**, where knowable.

## The review checklist

Before presenting a transformation for approval, check for these — they are the shapes that
cause silent corruption:

| Pattern | Why it is dangerous |
|---|---|
| **Dropping or renaming a property** | every downstream filter on the old name silently matches nothing |
| **Changing a type** (string to number, or vice versa) | downstream casts fail or coerce differently per destination |
| **Conditional logic on a property that may be absent** | events missing the property take an unintended branch |
| **Mutating `userId` or `anonymousId`** | **breaks identity resolution for every event thereafter** |
| **Mutating timestamps** | re-buckets every downstream day |
| **Anything non-deterministic** — randomness, current time, external calls | events become unreproducible and unreplayable |
| **`return` with no value on a code path** | **drops the event entirely, silently** |

That last one is the worst: a transformation that returns nothing on an unexpected branch
**deletes events from the pipeline**, and the only symptom is a downstream count that is
slightly low.

## Test before deploy, and know what the test proves

RudderStack provides a **Test API** to verify a source-to-destination transformation and
delivery. Use it, and be precise about what it establishes:

- **It proves** the transformation runs on the sample payload and produces the output you
  expect.
- **It does not prove** the transformation handles the shape of every real event, or that
  no live event takes an untested branch.

**Test with real payload shapes pulled from the pipeline, not with hand-written samples.**
A transformation validated against an idealised event is validated against the one case
that was never going to break.

## The MCP's blast radius, stated honestly

**RudderStack states the write scope explicitly: "The only write operations are creating or
updating transformations, and connecting them to destinations. No sources or destinations
are created or deleted."**

**That is a well-designed blast radius and is worth citing as a model.** Most vendors do
not bound their MCP writes at all.

**But the one thing it permits is the riskiest write in the pack.** A narrow scope
containing a Tier A capability is still Tier A. Do not let the tidiness of the boundary
substitute for the approval.

## Prefer the direct API for transformation work

The fallback is the **safer default here**, which is unusual in this pack.

A direct, deliberate Transformation API call — with the code reviewed in a diff, applied as
a discrete action — is **easier to gate** than a conversational tool call inside a session
where the agent is also reading metrics and answering questions. The conversational path
makes it easy for a deployment to ride along with a read, which is precisely what
`write-gate` refuses.

**Refuse mixed requests whole.** "Check the pipeline health and while you're there fix the
enrichment transformation" is one request containing a Tier A write and must be split.

## The documentation tool is an LLM

**The MCP's AI-powered documentation answers "may occasionally be inaccurate" — one of its
tools is an LLM, so do not chain agent reasoning off it without verification.**

This matters most in exactly this context: a documentation answer about transformation
semantics, taken as fact and encoded into deployed JavaScript, is an LLM hallucination
running on every event. Verify against the actual docs before writing code from it.
