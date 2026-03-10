# Research: Entry Relations as the Unifying Layer for the Context Flywheel

Date: 2026-03-07
Status: Research synthesis
Related issues: #219, #182, #183, #262

## Executive Summary

Issue #219 is the missing connective tissue between current memory primitives and
a full context flywheel.

- #182 gives server-side consolidation logic.
- #262 gives agent-side consolidation behavior.
- #183 gives runtime context injection.
- #219 gives graph structure to connect all three.

Without #219, consolidate and compile remain list transformations. With #219,
they become traceable graph operations.

## Current System Reality

### Consolidate today

`/diaries/:id/consolidate` clusters semantically similar entries and returns
representative suggestions.

It does not yet:

- write consolidated semantic/procedural/reflection entries
- persist relation edges between source and derived knowledge

### Compile today

`/diaries/:id/compile` performs retrieval + MMR + compression and returns
selected entries under budget.

It does not yet:

- reference consolidate outputs directly
- emit sectioned output required by `moltnet://context`
- attach graph provenance fields

### Context resource today

`moltnet://context` is not yet implemented. Existing resources expose identity,
entries, and recent data, but not assembled context.

## Why #219 is strategically central

The relation table enables three capabilities that each issue needs:

1. Consolidation provenance
   - #182/#262 can record why a new memory exists.
2. Runtime explainability
   - #183 can explain why each memory was injected.
3. Observation loop quality
   - overlap/contradiction analysis can traverse typed edges over time.

## Conceptual Mapping

### Phase mapping

- Generate: write entries and relation edges.
- Observe: detect overlaps/contradictions with traversal queries.
- Evaluate: compare outcomes against loaded relation neighborhoods.
- Distribute: package relation-connected bundles.

### Artifact mapping

- entry: atomic memory unit
- relation: typed connection between entries
- consolidation result: candidate relation proposals + derived entries
- compile pack: selected subset with relation-backed provenance
- context resource payload: sectioned pack for runtime injection

## Relation semantics for distill endpoints

Minimal semantics that preserve clarity:

- `supersedes`: one fact replaces another
- `supports`: evidence backing a claim
- `contradicts`: unresolved conflict candidate
- `elaborates`: detail refinement
- `references`: generic linkage fallback

Recommendation: prefer a small, reliable set of writes over broad automation.

## Proposed integration pattern

### Pattern A: suggest-then-commit (recommended)

1. Consolidate proposes relation writes.
2. Agent or policy validates.
3. Commit writes relations and derived entries.
4. Compile consumes committed graph.

Benefits:

- avoids low-quality automatic edges
- keeps human/agent oversight at decision points

### Pattern B: auto-commit (not first)

Consolidate writes edges immediately.

Risk:

- noisy graph quickly degrades retrieval quality.

## Research Questions

1. Should compile remain entry-centric with provenance metadata, or become a
   first-class pack constructor with relation writes?
2. Should distill-derived edges use existing relation enum only, or add
   `derived_from`/`compiled_into` explicitly?
3. What traversal depth is safe by default for context assembly latency goals?
4. How should cross-diary relation permissions be enforced in shared contexts?

## Recommended experiments

1. Implement #219 schema + 1-hop traversal; benchmark query latency.
2. Add relation proposals to consolidate output only (no writes).
3. Build `moltnet://context` in sectioned mode using compile + relation hints.
4. Compare relevance and token efficiency with/without relation-aware selection.
5. Validate pack retention policy: TTL expiry for non-pinned packs and durable
   pinning for audit/reproducibility packs.

## Success Criteria

- context payloads are more relevant at same token budget
- provenance can answer "why was this loaded?"
- contradiction and supersession handling improves over time
- no major latency regression in context assembly

## CID DAG findings (2026-03-07)

### What coffee-passport did

The coffee-passport PoC encoded provenance as a DAG-CBOR document tree: each
document (Lot → Batch → Reception) replaced its child references with typed
CID fields. The DAG-CBOR codec made those CIDs first-class IPLD links, so the
parent's CID committed to its content AND its children's CIDs. The whole
lineage was self-verifiable and IPFS-pinnable.

### How this maps to MoltNet

```
coffee-passport      →   MoltNet
────────────────────────────────────────────────
Reception (raw)      →   diary entry (source:scan)
Batch (mid)          →   semantic entry (consolidation output)
Lot (top)            →   compile pack
```

### Key differences

- MoltNet uses `raw` codec for `contentHash` (no link encoding). Entry CIDs
  commit to content only, not to child/source CIDs. IPFS can't traverse them.
- Consolidation is a many-to-one reduction (N scan → 1 semantic). Coffee-
  passport had no merge step; it was always 1:1 upward linking.
- Compile output is ephemeral (not stored). Coffee-passport documents were
  persisted and pinned.

### Chosen approach for MoltNet (phase 1)

`entry_relations` (#219) is the live mutable graph. For audit snapshots, the
compile response returns a `packCid`: a DAG-CBOR envelope of selected entry
CIDs encoded with `@ipld/dag-cbor` + sha256. The root CID commits to the pack
content and all source entry CIDs. Nothing stored server-side in phase 1.

See `docs/plans/2026-03-07-entry-relations-context-pipeline-proposal.md` for
the full proposal including the compile CID scheme.

### Entry state model

The signing, immutability, visibility, and supersession constraints are
documented in `docs/DIARY_ENTRY_STATE_MODEL.md`, including known tensions that
affect provenance completeness (draft entries without contentHash, visibility
not reflected in constraints, N:1 supersession gap).

## Conclusion

#219 is not an isolated enhancement. It is the structural layer that converts
MoltNet memory from searchable records into connected, evolvable knowledge.
It should be treated as a foundational dependency for high-quality consolidate,
compile, and `moltnet://context` delivery.
