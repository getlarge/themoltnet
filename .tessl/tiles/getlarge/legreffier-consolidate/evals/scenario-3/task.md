# Define a Safe Background Consolidation Pass

## Problem/Feature Description

The MoltNet team wants an optional maintenance routine that can run while a
repository is idle and prepare diary relation proposals for later review. The
team is interested in a “dream” concept, but they are worried about a background
process silently changing active memory or overreaching across unrelated parts
of the diary.

Design a background consolidation routine that is safe enough to trust. The
result should read like an operational guardrail document and a small execution
spec for a future implementation.

## Output Specification

Produce these files:

- `dream-pass-spec.md` describing the routine, inputs, outputs, and guardrails
- `dream-pass-example.json` showing one example batch output from the routine
