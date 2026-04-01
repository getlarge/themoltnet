# Surface Conflicting Memory Without Rewriting It

## Problem/Feature Description

The diary for a subsystem contains an earlier incident write-up that blamed the
failure on missing credentials, and a later incident write-up that concluded the
real root cause was an OAuth scope mismatch. Recent retrieval keeps surfacing
both, and different agents are treating them inconsistently.

Design a consolidation output that keeps this conflict visible and reviewable.
The team wants future retrieval to stop treating the older diagnosis as
unquestioned truth, but they do not want the original entries rewritten or
hidden behind a synthesized paragraph.

## Output Specification

Produce these files:

- `conflict-review.md` describing how the conflicting entries should be treated
- `conflict-proposals.json` with the proposed relations and metadata for that
  conflict set
