# Consolidation Approach — Methodology Reference

This document explains the _reasoning framework_ behind the legreffier-consolidate
skill. It is repo-agnostic. Read it for the "why" behind tile merging, nugget
extraction, acceptance gates, and multi-model evaluation. The SKILL.md prescribes
the execution steps; this doc explains the design choices.

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
- Same subsystem name in the entry key (e.g. `architecture:rest-api` and
  `apps-rest-api`)
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

This ordering helps maintain consistency — later tiles can reference patterns
established in earlier ones.

### Quality gate

Before creating each tile, verify ALL of these:

- [ ] Under 400 tokens of core content
- [ ] Contains at least one MUST or NEVER constraint
- [ ] Has a clear `applies_to` scope
- [ ] Does NOT restate project docs (CLAUDE.md, README) verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Includes source entry IDs for provenance

---

## Rule nuggets

### What a nugget is

A rule nugget is a single, atomic constraint statement with:

- One rule statement (~1-2 sentences)
- One clear trigger (when does this rule matter?)
- One bounded scope (what files/subsystems?)
- One verification method (how to check compliance?)
- Provenance (which entries/files?)

Target: ~120 tokens per nugget.

### Acceptance gate

Reject any candidate that fails ANY of these five criteria:

1. **Triggerable** — clear when the rule applies. "Always follow best practices"
   fails; "when writing repository methods, use getExecutor(db)" passes.
2. **Specific** — refers to a real repo convention or invariant, not a generic
   programming principle. "Write tests" fails; "use vi.mock, never jest.mock" passes.
3. **Bounded** — fits one task family or subsystem. "All code should be clean"
   fails; a rule scoped to `libs/database/**` passes.
4. **Grounded** — links to concrete files, functions, or evidence from the scan.
   If you can't point to where this constraint comes from, reject it.
5. **Actionable** — an agent can follow it or a validator can check it. "Be careful
   with auth" fails; "return 404, not 403, for denied private resources" passes.

### Why constraint-first extraction

Do NOT scan entries linearly and extract nuggets one by one. This produces too many
weak candidates because every entry has prose that _sounds_ like a rule but isn't
specific enough.

Instead, use a **constraint-first** approach:

1. **Collect all Constraints/Anti-patterns sections** from scan entries — these are
   the pre-filtered candidates
2. **Deduplicate** — the same constraint often appears in both Phase 1 and Phase 2
   entries for the same subsystem
3. **Apply the acceptance gate** — reject vague or non-triggerable candidates
4. **Group by trigger domain** — nuggets that fire on the same task type should be
   reviewed together for coherence
5. **Assign nugget IDs** — `<domain>.<subsystem>.<constraint-slug>`

### Priority domains

Not all constraint domains have equal value. Prioritize extraction in this order:

| Priority | Domain   | Rationale                                                                            |
| -------- | -------- | ------------------------------------------------------------------------------------ |
| 1        | testing  | Highest follow-through — test constraints are easily verifiable                      |
| 2        | security | Highest consequence — security violations cause real damage                          |
| 3        | workflow | High follow-through — CI/build constraints are mechanically checkable                |
| 4        | database | Error-prone — migrations, transactions, and schema constraints catch common mistakes |

Other domains (API design, naming conventions, documentation) can follow if the
budget allows, but the four above capture the most value per nugget.

### Common rejection reasons

These candidate types consistently fail the acceptance gate:

- **Restated project docs** — if CLAUDE.md already says it, a nugget adds nothing
- **Generic programming principles** — "write clean code", "handle errors", "test
  edge cases" are not repo-specific constraints
- **Descriptive facts** — "the API uses Fastify" is a fact, not a rule
- **Configuration trivia** — port numbers, file paths that could change, CLI flags
  that are documented elsewhere
- **Too narrow for a nugget** — if it only applies to one line in one file, it's
  a code comment, not a rule

### Load budget constraint

For any single task at runtime, load at most:

- 3-7 primary nuggets (directly triggered by the task)
- 1-2 optional caveat nuggets (edge cases or warnings)

If a task would trigger more than 9 nuggets, the trigger design is too noisy —
either the triggers are too broad or nuggets should be consolidated.

### Storage: one entry per domain

Store nuggets grouped by domain — **one diary entry per domain**, not per individual
nugget. This prevents entry explosion and keeps related constraints together.
Separate nuggets within an entry with `---` dividers.

---

## Multi-model evaluation

### Why run multiple models

Consolidation is a judgment task — different models extract different constraints,
merge differently, and produce different quality. Running the same consolidation
across models reveals:

- **Universal constraints** — found by all models, highest confidence
- **Model-specific finds** — unique to one model, need human review
- **Failure modes** — what kind of mistakes does each model make?
- **Cost-quality tradeoff** — cheaper models that produce similar quality are
  preferred for production use

### How to keep runs separate

Every tile and nugget entry MUST include `model:<model-short-tag>` in its tags.
Each model run gets its own unique `tile-session` timestamp. This allows parallel
runs in the same diary without collision.

### Evaluation dimensions

Score each run on these dimensions:

| Dimension          | What it measures                            | How to score                              |
| ------------------ | ------------------------------------------- | ----------------------------------------- |
| Constraint yield   | Nuggets accepted vs total candidates        | `accepted / total_candidates`             |
| Specificity        | Are constraints concrete or vague?          | 1-5 per nugget, averaged                  |
| Non-redundancy     | Avoids restating obvious things             | Count of redundant nuggets                |
| Trigger precision  | Would triggers fire for right tasks only?   | low / med / high                          |
| Merge quality      | How well multi-source tiles are synthesized | 1-5 per merged tile, averaged             |
| Token efficiency   | Content density                             | `total_constraints / total_tokens * 1000` |
| Hallucination rate | Constraints not grounded in source entries  | Count of ungrounded nuggets               |
| Coverage           | Important constraints captured vs available | `found / available` (estimate)            |
| Consistency        | Agreement across model runs                 | Jaccard similarity of nugget sets         |

### Cross-model comparison

After all runs, compare:

1. **Constraint overlap matrix** — which constraints did all models find vs which
   only one model found? High-overlap constraints are highest confidence.
2. **Agreement levels** — record agreement explicitly as:
   - `agreement_count`
   - `model_count`
   - optional `supporting_models`
3. **Quality ranking** — rank models by acceptance rate, specificity, hallucination
4. **Failure modes** — over-extraction, vague triggers, parroting source text,
   missing critical constraints
5. **Gold set construction** — union of high-agreement constraints, filtered through
   the acceptance gate, using the best naming taxonomy

### Handoff to compile

Consolidation does not produce the final task-time package. It produces
compile-ready intermediate outputs.

Those outputs should be consumable by a separate compile step without hidden
assumptions.

The minimum handoff contract is:

1. **Tiles**
   - one entry per tile
   - stable `tile-id`
   - provenance in content
   - session/model tags for retrieval
2. **Nuggets**
   - grouped by domain for storage efficiency
   - one YAML block per nugget
   - separated by `---`
   - each block contains rule, trigger, scope, verification, sources, and
     confidence
3. **Run identity**
   - `scan_session`
   - `tile_session`
   - `model_tag`
4. **Retrieval hooks**
   - enough tags or IDs for another agent to fetch the exact tiles, nuggets,
     and scorecard for one run
5. **Cross-model comparison, when available**
   - nugget equivalence decisions
   - `agreement_count`
   - `model_count`
   - optional `supporting_models`

This separation matters because consolidation optimizes for synthesis and review,
while compilation optimizes for runtime loading.

---

## Design rationale

### Why tiles + nuggets (two outputs, not one)

Tiles and nuggets serve different purposes at task time:

- **Tiles** are loaded for _understanding_ — "what is this subsystem, how does it
  work, what are its constraints?" An agent reads a tile to orient itself.
- **Nuggets** are loaded for _compliance_ — "what rules must I follow for this
  specific task?" An agent checks nuggets to avoid violations.

A single output format forces a choice between breadth (tiles) and precision
(nuggets). Having both means an agent can load a tile for context and a few
nuggets for guardrails, staying under token budget while getting both.

### Why merge before extracting

Extracting nuggets from individual entries produces duplicates (the same constraint
stated slightly differently in Phase 1 docs and Phase 2 code), misses synthesis
opportunities (a constraint that only becomes clear when you see both the doc
rationale and the code pattern), and inflates the candidate count with weak
variants.

Merging first creates a clean, deduplicated knowledge base. Nuggets extracted
from merged tiles are higher quality because the synthesis has already happened.

### Why the acceptance gate is strict

A permissive gate produces more nuggets but lower signal-to-noise ratio at task
time. Empirical observation shows that agents follow 3-7 rules well but degrade
with more. A strict gate that produces 15-25 high-quality nuggets serves agents
better than a loose gate that produces 40+ weak ones.

The five criteria (triggerable, specific, bounded, grounded, actionable) are
designed to be independently verifiable — each is a yes/no check, not a
subjective quality judgment.

### Why constraint-first extraction over linear scanning

Linear scanning (read entry 1, extract nuggets, read entry 2, extract nuggets...)
produces candidates biased toward whatever the entry emphasizes, not toward what
actually matters for task compliance. It also produces many duplicates across
entries.

Constraint-first extraction (collect all MUST/NEVER statements first, then
deduplicate, then gate) starts from the strongest signals and filters down,
producing a cleaner candidate set with less redundancy.

---

## Recovery after context compression

If context is compressed mid-run:

1. Read the SKILL.md for execution steps
2. Read this file for the methodology rationale
3. Use the retrieval queries in SKILL.md to find completed tiles/nuggets
4. Compare completed work against the scan entries to find where to resume
