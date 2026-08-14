# PackLineage — console lineage surface

**Issue:** #654 (Phase 3) · **Branch:** `issue-654-pack-detail-lineage` · **Date:** 2026-08-14

Replaces the landing page's `/labs/provenance` graph viewer with an embedded,
authenticated lineage panel on `PackDetailPage`.

## Problem

The provenance graph viewer at `apps/landing/src/pages/ProvenancePage.tsx` was
built in March 2026, before the console existed. It is a standalone public page:
the user arrives with a JSON blob, pastes it into a textarea, and pans around a
full-viewport SVG canvas. It was never linked from the landing nav or home page
— the only in-app route to it is a one-way "← Back to architecture" link.

Meanwhile the console has `usePackProvenance(packId)`
(`apps/console/src/packs/hooks.ts`), which returns exactly the
`moltnet.provenance-graph/v1` type the viewer already parses — and **no
component consumes it**. The data pipe is built and capped.

Phase 3 needs `PackComposition`, `PackLineage`, and `PackDetailPage`. The viewer
is the right raw material for `PackLineage`, but not in its current shape.

## The central structural problem

`buildPackProvenanceGraph` (`apps/rest-api/src/routes/pack-provenance.ts`)
BFS-walks the supersession chain from the root pack, and for **each** pack in
that chain emits every member entry as a node. Two very different things end up
on one canvas:

|                                                         | Nodes                          | Meaning per node | Right form    |
| ------------------------------------------------------- | ------------------------------ | ---------------- | ------------- |
| **Spine** — pack supersedes pack, plus rendered outputs | few (1–4 typical)              | high             | graph / chain |
| **Membership** — entries this pack selected             | many (10–30 typical, uncapped) | low individually | ranked list   |

A depth-3 chain of packs holding 20 entries each is ~80 entry nodes around a
4-node spine. The lab's collapse/expand feature exists to manage exactly this.

Phase 3 already names these separately. Splitting them is most of the redesign:
`PackLineage` takes the spine, `PackComposition` takes the membership. Once
split, the spine is small enough that **pan-zoom, drag, and fit-to-viewport stop
being necessary** — the interaction model the lab spent the most code on is the
first thing to delete.

## Job and audience

**Mode: Operate.** An operator on `PackDetailPage`, mid-task, who has a reason to
care about this pack — it surfaced in the catalog as expiring, or they followed a
supersession trail. They are not admiring a diagram; they are deciding what
survives.

**Primary task:** decide, across a lineage, what to keep and what to let decay.

**Product insight:** retention is a chain-level decision, not a per-pack one.
Nobody looks at one pack in isolation and asks "should this expire?" They look at
a lineage and conclude "the current one stays; the ancestors it replaced can go."
Neither the lab nor PR #1883 supports that — `PinControl` acts on one pack at a
time and the catalog is a flat list.

This is where product principle 4 (_knowledge is manufactured; decay is part of
the lifecycle_) becomes something an operator can operate.

**Success:** an operator can answer "which version is current, what is still
pinned behind it, and what happens if I do nothing" without leaving the page.

## Direction

**The spine is a control surface; membership is a list.**

**Form adapts to the data.** A vertical chain, newest first, when lineage is
linear (the common case); escalation to the node-edge graph only when the DAG
genuinely branches. One visual language across both — the graph is the chain that
outgrew a line, not a separate widget.

**Focal moment: the decay horizon.** Each spine node carries its lifecycle state
and pin control inline, so the retention decision happens where the evidence is,
not on a round trip to the catalog.

## Scope

**In:** `PackLineage` as an embedded panel; the parts of `PackComposition` and
`PackDetailPage` it touches; registering `/packs/:id`.

**Moves:** `apps/landing/src/pages/ProvenancePage.tsx` and
`apps/landing/src/provenance/` → console. The landing `/labs/provenance` route is
deleted.

**Survives — corrected after reading the source.** Of 1,561 LOC, only ~200–300
genuinely carries forward. This is a fresh build informed by the old code, not a
move:

| Module                                                               | Fate            | Reason                                                                                               |
| -------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `parse-graph.ts` (141)                                               | obsolete        | Hand-validates untrusted pasted JSON; `usePackProvenance` returns typed, validated data              |
| `graph-sharing.ts` (86)                                              | deleted         | Share links die with the move                                                                        |
| `graph-viewport.ts` (32)                                             | deleted         | Pan-zoom dies                                                                                        |
| `viewer-utils.toggleCollapsedPack` / `filterCollapsedGraph`          | obsolete        | Collapse/expand exists _because_ entries pollute the graph; `PackComposition` removes them           |
| `viewer-utils.summarizeValue` / `splitIntoLines` / `summarizeNodeId` | graph form only | SVG text-wrapping helpers                                                                            |
| `viewer-utils.countEdges`                                            | **reused**      | Counting `supersedes` / `includes` / `rendered_from`                                                 |
| `graph-layout.buildGraphLayout` (109)                                | **adapted**     | Lays out horizontal columns (`x = level * COLUMN_WIDTH`); the brief calls for vertical, newest-first |

**Deleted:** textarea, file upload, `?graph=` URL param, share-link + Safari
clipboard path, pan-zoom / drag / fit-to-viewport, the Root/Nodes/Edges/Depth
stat cards, the standalone page shell.

**Untouched:** the provenance wire format, `buildPackProvenanceGraph`,
`libs/models/src/provenance-graph.ts`, `usePackProvenance`. **No server changes.**

**Anti-goals:** no charting or graph library (it never needed one); no second
visual language for lifecycle state — `DecayBadge` owns that; not a
general-purpose graph inspector.

**Accepted loss:** unauthenticated graph sharing ends. The CLI's `--share-url`
takes a user-supplied value so it does not break, but four documentation
references need updating:
`docs/use/context-packs.md:700,708`, `docs/understand/knowledge-factory.md:118`,
`docs/reference/quick-reference.md:29`, and
`.agents/skills/legreffier-explore/SKILL.md:435,440`.

## Data ranges

From the builder, not estimates:

|                           | Min | Typical | Max                   |
| ------------------------- | --- | ------- | --------------------- |
| Spine (packs)             | 1   | 1–4     | caller-supplied depth |
| Entries per pack          | 0   | 10–30   | uncapped              |
| Rendered outputs per pack | 0   | 0–2     | —                     |

## Material states

- **No lineage** — root pack, nothing superseded. The common first case, and the
  one most likely to be designed badly.
- **Linear chain** — the typical case; vertical chain form.
- **Branching DAG** — two packs superseded by one; escalates to graph form.
- **Loading**, **error** — bound to `usePackProvenance`.
- **Partial** — the operator lacks read access to an ancestor pack. Must render
  as an explicit gap, never a silent omission.

## Interaction and layout

Vertical, newest-first, reading with the page rather than fighting it. Fixed
panel height; no viewport capture, no scroll hijack. Node selection navigates to
real console routes. Lifecycle state via `DecayBadge`; retention via inline pin
controls. The lineage must be readable as structure, not only as a picture — a
real list for assistive technology, per the binding accessibility baseline.

## Constraints

React + `@themoltnet/design-system`; dark and light themes; WCAG AA binding; no
`paths` aliases; source-direct workspace exports.

## Decisions a builder must not invent

1. **Rendered-pack pinning has no control.** `usePinRenderedPack` exists;
   nothing calls it. Lineage contains `rendered_pack` nodes, so this either
   builds that control or renders those nodes explicitly read-only.
   **Decision: render read-only in this phase**; a rendered-pack pin control is
   out of scope and belongs with #655 (rendered pack viewer).
2. **`isExpiringSoon` / `EXPIRING_SOON_DAYS` are exported, tested, and unused**
   (flagged in the #1883 review). A decay-horizon panel is where that threshold
   earns its keep. **Decision: `PackLineage` consumes it** to distinguish
   "expiring soon" from "expires eventually" in the spine.
3. **Pin/unpin scope from lineage.** The product insight argues for chain-level
   retention, but that is a new API shape. **Decision: per-node controls in this
   phase**, reusing the existing `usePinPack`. Chain-level retention is recorded
   as a follow-up, not built here.

## Verification

- Unit tests for the adaptive form selection (linear → chain, branching → graph)
  and every material state above.
- Existing `parse-graph` tests move with the code and must keep passing.
- Browser verification against the local Docker stack with a real supersession
  chain, in both themes.
