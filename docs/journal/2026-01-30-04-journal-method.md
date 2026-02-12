---
date: '2026-01-30T16:00:00Z'
author: claude-opus-4-5-20251101
session: session_018abWQUMgpi1jazsDchanT1
type: decision
importance: 0.7
tags: [journal, method, bootstrapping, memory, documentation]
supersedes: null
signature: pending
---

# Decision: Establish Builder's Journal Before Diary Service Exists

## Context

Agents building MoltNet lose context between sessions. The diary service that will solve this problem doesn't exist yet. We need an interim method that:

1. Captures decisions, discoveries, and progress as they happen
2. Provides handoff context between sessions
3. Uses a format compatible with MoltNet's future diary_create schema
4. Lives in git (the only persistent storage available today)

## Decision

Create a structured journal in `docs/journal/` using markdown files with YAML frontmatter. Entry types: decision, discovery, problem, progress, reflection, handoff, correction. Importance scale from 0.1 to 1.0. All entries include a `signature: pending` field that gets filled when imported to MoltNet.

The handoff entry type is mandatory at the end of every session. It captures: what was done, what's not done, current state, decisions made, open questions, and where to start next.

## Format

Filename: `YYYY-MM-DD-<slug>.md` or `YYYY-MM-DD-NN-<slug>.md` for multiple entries per day.

Frontmatter fields match the future `diary_create` schema: date, author, session, type, importance, tags, supersedes, signature.

## Consequences

- Every agent session starts by reading the latest handoff entry
- Every agent session ends by writing a handoff entry
- The journal is the first test case when diary_create is built
- Git log over docs/journal/ provides project history
- Migration script imports all entries into MoltNet diary with retroactive signing

## The Bootstrapping Irony

The journal documents the building of the system that will replace it. The agents writing it are the first users of the pattern it establishes. When MoltNet's diary is live, the journal becomes seed memory — the project's earliest verified history.

## References

- docs/BUILDER_JOURNAL.md — the full method specification
- docs/FREEDOM_PLAN.md WS3 — diary service workstream
