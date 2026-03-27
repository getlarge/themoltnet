# Consolidation Approach — Methodology Reference

This document explains the _reasoning framework_ behind the legreffier-consolidate
skill. It is repo-agnostic. Read it for the "why" behind tile merging and
quality gates. The SKILL.md prescribes the execution steps; this doc explains
the design choices.

---

## Context tiles

### What a tile is

A tile is a self-contained knowledge unit that answers one question well:

> "What do I need to know about X to work on Y correctly?"

Tiles are NOT documentation rewrites. They synthesize multiple scan entries,
deduplicate overlapping information, and focus on what an agent needs at task time.

### Design principles

1. **Minimal over comprehensive** — fewer tokens, higher density
2. **Concrete over abstract** — commands, paths, patterns, not prose
3. **Non-redundant with project docs** — don't restate what CLAUDE.md already says
4. **Scoped** — each tile has a clear `applies_to` boundary
5. **Synthesis, not summary** — combine info from multiple entries into something
   no single source provides

### How to identify merge groups

Scan entries often overlap — docs-derived entries (Phase 1) and code-derived entries
(Phase 2) frequently describe the same subsystem from different angles. The
consolidation must merge these, not just list them side by side.

**Algorithm:**

1. List all scan entries with their `scope` and `scan-category` tags
2. Group entries that share the same subsystem scope (e.g. two entries both scoped
   to `libs/database`)
3. Group entries that cover the same conceptual area even if scoped differently
   (e.g. an `architecture:auth-flow` doc entry + a `security:auth-model` doc entry
   - a `libs/auth` code entry all describe the auth subsystem)
4. Each group becomes one tile. Standalone entries (no overlap) become tiles directly
5. The target is **fewer tiles than source entries** — if you have the same count,
   you haven't merged enough

**Signals that entries should merge:**

- Same `scope:` tag
- Same subsystem name in the entry key
- One is a docs-derived view and the other is a code-derived view of the same area
- Significant constraint overlap (>50% of MUST/NEVER items are shared)

**Signals that entries should stay separate:**

- Different subsystems with no conceptual overlap
- Different layers (e.g. database vs API routing) even if they interact
- Merging would exceed the 400-token budget

### Merge rules

When merging entries from different scan phases:

1. **Code wins on specifics** — function names, actual patterns, real constraints
   found in source files
2. **Docs win on rationale** — architecture decisions, design context, cross-cutting
   concerns, the "why"
3. **Deduplicate constraints** — if both sources say the same thing, keep one
4. **Prefer concrete over abstract** — `getExecutor(db)` beats "uses repository
   pattern"; an actual command beats a description of what the command does

### Tile execution order

Process tiles in dependency order when possible:

1. Identity/overview tiles first (frames everything)
2. Foundational library tiles (database, crypto, core utilities)
3. Service/application tiles (depend on libraries)
4. Cross-cutting tiles (workflow, testing, CI)
5. Caveat/known-issue tiles last (standalone)

### Quality gate

Before creating each tile, verify ALL of these:

- [ ] Under 400 tokens of core content
- [ ] Contains at least one MUST or NEVER constraint
- [ ] Has a clear `applies_to` scope
- [ ] Does NOT restate project docs (CLAUDE.md, README) verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Includes source entry IDs for provenance

---

## Constraint quality criteria

When extracting constraints for tiles, apply this filter to each candidate:

1. **Triggerable** — clear when the rule applies. "Always follow best practices"
   fails; "when writing repository methods, use getExecutor(db)" passes.
2. **Specific** — refers to a real repo convention or invariant, not a generic
   programming principle. "Write tests" fails; "use vi.mock, never jest.mock" passes.
3. **Bounded** — fits one task family or subsystem. "All code should be clean"
   fails; a rule scoped to `libs/database/**` passes.
4. **Grounded** — links to concrete files, functions, or evidence from the scan.
5. **Actionable** — an agent can follow it or a validator can check it. "Be careful
   with auth" fails; "return 404, not 403, for denied private resources" passes.

### Common rejection reasons

- **Restated project docs** — if CLAUDE.md already says it, a tile constraint adds nothing
- **Generic programming principles** — "write clean code", "handle errors"
- **Descriptive facts** — "the API uses Fastify" is a fact, not a rule
- **Too narrow** — if it only applies to one line in one file, it's a code comment

---

## Why merge before extracting constraints

Extracting constraints from individual entries produces duplicates (the same
constraint stated differently in Phase 1 docs and Phase 2 code), misses
synthesis opportunities, and inflates the candidate count with weak variants.

Merging first creates a clean, deduplicated knowledge base. Constraints
extracted from merged content are higher quality because the synthesis has
already happened.

---

## Recovery after context compression

If context is compressed mid-run:

1. Read the SKILL.md for execution steps
2. Read this file for the methodology rationale
3. Use the retrieval queries in SKILL.md to find completed tiles
4. Compare completed work against the scan entries to find where to resume
