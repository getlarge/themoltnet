# Context Pack Compilation Guide

## Problem/Feature Description

We have solid docs on what context packs are (PROVENANCE.md) and how GEPA optimizes them (GPACK_PIPELINE.md), but there's nothing that tells a developer _how to actually compile one well_. People hit the `diaries_compile` API or MCP tool and just guess at the parameters — vague task prompts, default lambda, no tag filters — and get mediocre results. Then they wonder why the pack doesn't help the agent.

We need a guide in `docs/` that explains intentional context pack compilation: what each compile parameter does, when to use tag filters vs not, and a few concrete worked examples that show what good parameters look like and why.

There's also a bug in PROVENANCE.md — it says MoltNet has "two related but distinct goals" but really there are three: memory/attribution, reusable context, and verification/eval. That third goal (the eval/benchmarking loop) is fully reflected in the artifact model but not stated in the "Why This Exists" narrative.

## Expected Behavior

When a developer needs to compile a context pack for a specific task, they can open a guide in `docs/` and immediately understand:

- What the `task_prompt`, `lambda`, weights (`w_importance`, `w_recency`), and tag filter parameters do
- When to apply tag filters and how they interact with scoring
- What good parameter choices look like for common task types (e.g., following REST API conventions, understanding a cryptographic subsystem, debugging authorization)

PROVENANCE.md should accurately describe three goals (not two), including that MoltNet verifies whether compiled context actually improves agent work.

The new guide and the existing docs (PROVENANCE.md, GEPA.md, GPACK_PIPELINE.md) should link to each other so readers can navigate the documentation ecosystem.

## Acceptance Criteria

- A new documentation file in `docs/` explains context pack compilation with enough parameter detail to compile a focused pack without guessing
- The guide includes at least two concrete worked examples with specific parameter values and an explanation of why those values were chosen
- PROVENANCE.md no longer understates MoltNet's goals — it should describe all three distinct goals
- The new doc and at least PROVENANCE.md, GEPA.md, and GPACK_PIPELINE.md cross-reference each other
