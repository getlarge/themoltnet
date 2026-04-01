# Agent-Side Consolidation Skill Spike

## Summary

`legreffier-consolidate` is currently stronger in documentation than in
implementation. The product schema supports a useful relation graph, but the
existing consolidation story is still too server-centric and too weakly
auditable for trustworthy diary maintenance.

This spike proposes an intentional, agent-driven consolidation workflow.

## Problem

- server-side clustering is weak at the distinctions that matter most:
  contradiction vs elaboration, causal chain vs temporal adjacency, replacement
  vs disagreement, implementation reference vs same-topic similarity
- current relation proposal logic is effectively “cluster => supports edges”
- relation proposals need provenance and review semantics
- dream-like maintenance is attractive, but unsafe if it rewrites entries or
  auto-accepts relations

## Proposal

Treat consolidation as **editorial graph curation**:

- build a bounded working set instead of processing the whole diary
- generate candidate pairs intentionally
- judge each pair relation-specifically
- create `proposed` relations by default
- attach rationale, confidence, evidence refs, reviewer, and working-set
  metadata to every proposal
- verify value against compile/search behavior for the same task prompt

## Relation policy

The skill should support:

- `supports`
- `elaborates`
- `contradicts`
- `caused_by`
- `references`
- `supersedes`

No auto-accept by default.

## Dream pass

A dream pass should be a bounded background proposal loop:

- recent `20-40` entries or one subsystem slice
- one pass only
- proposal-first, never acceptance-first
- no source-entry rewriting
- no contradiction flattening

## Deliverables in this spike

- rewrite `.agents/skills/legreffier-consolidate/SKILL.md`
- rewrite the consolidation methodology reference
- package the skill as a Tessl tile
- add eval scenarios covering bounded scope, typed proposals, contradiction
  handling, dream-pass guardrails, and verification

## Follow-up work

- align the server-side `diaries_consolidate` endpoint with an agent-side review
  role instead of pretending to perform semantic consolidation
- define a stable metadata schema for relation proposals
- decide whether any narrow auto-accept rules are ever acceptable
- evaluate whether accepted/proposed relations should influence pack ranking
  differently
