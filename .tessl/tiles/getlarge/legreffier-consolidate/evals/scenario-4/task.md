# Verify That Relation Proposals Improve Retrieval

## Problem/Feature Description

One consolidation batch has already been planned, and the maintainers want to
avoid the trap of calling it successful just because it generated a set of
edges. The actual goal is better retrieval: fewer irrelevant same-topic hits,
clearer paths from incidents to fixes, and more honest treatment of conflict.

Design a validation artifact that another agent can use to judge whether the
consolidation batch improved retrieval quality for a real recurring question.

## Output Specification

Produce these files:

- `verification-plan.md` describing the before/after checks
- `verification-checklist.json` with the concrete signals that should be
  inspected after the consolidation run
