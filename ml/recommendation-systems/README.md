# ⚠ Provisional skill — low research backing

`recommendation-systems` is the one skill in this pack whose subject matter is
**not covered by the source research** behind the rest of the pack. The platform
research tracks (CRM, BI/warehouse, web/product/MCP) contain no material on
recommender systems, and neither does the domain coverage map.

**What that means in practice:**

- The content here is written from **general practice**, not traced to the
  research the way every other skill in this pack is.
- It is deliberately **conservative**: it recommends the simplest thing that
  works, routes most GTM "next best action" questions to
  `uplift-and-causal-models` where the framing is more honest, and declines to
  specify any platform-specific capability.
- **No platform capability claims are made here at all.** Where a recommendation
  needs to be delivered into a tool, the relevant `platforms/` module governs
  what is possible, and the activation constraints in
  `segmentation-model-support` apply.

**Status:** provisional. It should be either research-backed before it is relied
on, or superseded by folding next-best-action into `uplift-and-causal-models`.

Treat its guidance as a reasonable default, not as the pack's researched
position.
