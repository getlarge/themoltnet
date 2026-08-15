---
target: shared provenance explorer
total_score: 20
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-08-15T08-33-20Z
slug: libs-provenance-ui-src-provenanceexplorer-tsx
---

Method: dual-agent (A: /root/provenance_design_review · B: /root/provenance_technical_audit)

## Design Health Score

| #         | Heuristic                       |     Score | Key issue                                                                                                  |
| --------- | ------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status     |         2 | Selection is visible, but collapse, invalid shared links, and copied state are weakly announced.           |
| 2         | Match system / real world       |         2 | Authentic provenance nouns coexist with raw keys, timestamps, and unexplained relation styling.            |
| 3         | User control and freedom        |         2 | Zoom and fit exist, but the canvas intercepts scrolling and selection unexpectedly changes topology.       |
| 4         | Consistency and standards       |         3 | Shared design-system composition is strong; SVG buttons and double-activation collapse are unconventional. |
| 5         | Error prevention                |         2 | Structural parsing exists, but public inputs are unbounded and invalid input can still be shared.          |
| 6         | Recognition rather than recall  |         2 | The surface lacks a relation legend and explicit collapse state.                                           |
| 7         | Flexibility and efficiency      |         2 | Multiple input and navigation methods exist, but large-graph accelerators are absent.                      |
| 8         | Aesthetic and minimalist design |         2 | Calm surfaces are undermined by a large empty canvas and dominant raw JSON/metadata.                       |
| 9         | Error recovery                  |         1 | Shared-link decode and field errors do not give a strong visible, associated recovery path.                |
| 10        | Help and documentation          |         2 | CLI guidance exists, but graph semantics and the trust boundary are under-explained.                       |
| **Total** |                                 | **20/40** | **Acceptable — significant improvement needed**                                                            |

## Design Specificity Verdict

The pack, entry, rendered-pack, CID, fingerprint, and relation model is distinctly MoltNet. The interaction model is still a category-interchangeable DAG viewer: toolbar, canvas, and raw property inspector. The experience needs to foreground causal proof, trust state, and readable lineage instead of asking users to infer those from topology and JSON.

The deterministic detector returned zero findings across the shared explorer, graph surface, Landing route, and Console integration. That clean result is useful but incomplete: both assessments independently found behavioral, responsive, and semantic failures outside the detector's coverage.

## Overall Impression

The strongest architectural choice is already made: public Labs and authenticated Console share one visualization while retaining host-specific actions. The biggest opportunity is to make the graph trustworthy and operable at first contact—especially on narrow screens—without duplicating code or adding another content surface.

## What's Working

- The real MoltNet provenance model makes the surface product-specific rather than decorative.
- The shared component boundary cleanly separates visualization from Landing import/share and Console authenticated operations.
- Design-system token use, keyboard activation, accessible outline, loading/retry states, and cleanup logic show a strong baseline.

## Priority Issues

### [P1] Fit view and page scrolling fail on narrow screens

The fit scale is clamped above the scale required at 390px, while wheel interception and `touchAction: none` can trap page scrolling. Use a narrow vertical topology, separate fit scale from manual zoom limits, observe container resize, and preserve normal page scrolling.

### [P1] Selection and collapse are overloaded

Activating an already-selected pack collapses evidence, the plus/minus mark is unnamed, and `aria-expanded` is absent. Separate node selection from an explicit collapse control and announce visible graph changes.

### [P1] Public import trust, recovery, and resource limits are incomplete

Invalid input is not associated or announced, arbitrary imports look equivalent to authenticated Console data, and URL/file/graph sizes are unbounded. Add an explicit imported-unverified state, accessible errors, graph invariants, and reasonable limits before parsing/rendering.

### [P1] Pointer state can swallow the next selection

After a pan gesture, drag suppression survives into the next unrelated node click. Scope suppression to the current pointer sequence so panning never creates a two-click selection requirement.

### [P2] The graph shows topology more clearly than proof

Relations lack direction/legend and selected details lead with raw metadata. Add directional cues, a compact legend, a human-readable proof summary, and progressive disclosure for technical metadata.

## Persona Red Flags

**First-time platform engineer:** the root can be clipped, relation semantics are unexplained, and raw JSON dominates the answer to “why should I trust this pack?”

**Keyboard/screen-reader operator:** upload focus is invisible, collapse state is absent from the accessibility API, state changes are not announced, and the selected-detail structure is weak.

**Experienced MoltNet operator:** fit prioritizes completeness over legibility, lifecycle evidence is buried, and panning can require a second click to select evidence.

## Minor Observations

- The root identifier wraps character-by-character on mobile.
- Selected node should be a real heading and metadata should use description-list semantics.
- Zoom controls do not expose scale or disable at their limits.
- Amber currently describes generic packs/supersession as well as identity/attestation.
- Sanitized node IDs can collide across explorer instances.

## Questions to Consider

- Is the primary job inspecting JSON, or proving why a pack exists?
- Should selection ever mutate topology?
- What must a skeptical engineer understand within five seconds of opening a real export?
- Which imported fields should be considered sensitive before creating a share URL?
