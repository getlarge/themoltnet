# Consolidation Approach — Methodology Reference

This document explains the design logic behind `legreffier-consolidate`.
`SKILL.md` is the operating procedure. This file explains why the workflow is
structured the way it is.

## Core position

Consolidation is a **graph curation** task.

It should improve the structure around source entries, not rewrite source
entries into a new canonical layer. Context packs remain the compiled runtime
artifact. Entry relations remain the memory-structure layer.

## Why agent-side instead of server-side

Embedding clusters are useful for rough candidate discovery, but they are weak
at the exact distinctions that matter most:

- false diagnosis vs real root cause
- implementation reference vs same-topic similarity
- replacement vs elaboration
- causal chain vs temporal adjacency

Those are editorial judgments. They need an agent to read entries
intentionally and record why the edge exists.

## Trust model

The process is trustable when it has these properties:

1. **Bounded scope**
   One branch, one subsystem, one incident family, or one retrieval problem at
   a time.
2. **Pairwise judgment**
   Every proposal is based on reading the involved entries, not cluster shape.
3. **Typed relations**
   The workflow chooses a specific relation because that relation’s criteria are
   met, not because “related” felt good enough.
4. **Proposal-first**
   New relations default to `proposed`, not `accepted`.
5. **Recorded rationale**
   Each proposal carries confidence, rationale, and evidence refs.

## Why no auto-accept

Accepted relations influence retrieval, contradiction handling, and in the case
of `supersedes`, active-state semantics. That is too much authority for a batch
process by default.

Narrow auto-accept rules may exist later for explicit user-authored or
workflow-authored edges, but that should be opt-in and relation-specific.

## Relation-first rather than summary-first

The dream/consolidation pass should improve the graph before it produces prose.

Good effects of relation-first consolidation:

- packs can prefer connected accepted evidence
- contradictions can remain visible instead of being flattened away
- stale diagnoses can be down-ranked without deleting history
- source entries remain the provenance anchor

## Candidate generation heuristics

The best candidate generators are usually cross-type:

- incident -> fix commit
- decision -> implementation
- false diagnosis -> corrected diagnosis
- repeated incidents with matching symptoms
- follow-up rule -> earlier rule on same scope

Shared tags, refs, and time windows usually outperform pure embedding
similarity for these tasks.

## Dream pass definition

A dream pass is a small periodic review loop:

1. inspect a bounded recent working set
2. detect likely missing structure
3. propose a small number of typed edges
4. stop

It is not autonomous rewriting, not full-diary compression, and not hidden
maintenance that changes the active truth silently.

## Recommended metadata fields

Relation metadata should usually capture:

- `rationale`
- `confidence`
- `evidenceRefs`
- `proposalMethod`
- `reviewedAt`
- `reviewedBy`
- `workingSet`

Additional fields may exist for specific relation kinds, such as
`contradictionKind`.

## Quality gate

A consolidation run is good when:

- every proposed edge has a clear relation-specific reason
- proposals are concentrated on one coherent working set
- there is no blanket same-cluster linking
- contradictions remain explicit
- compile/search behavior improves on the tested prompt

A run is bad when:

- most edges are generic `supports`
- rationale could apply to any pair in the same topic
- acceptance happened without explicit review
- the graph is denser but not more useful
