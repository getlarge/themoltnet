# Scan → Rules Experiment

Date: 2026-03-03
Purpose: Simulate scan entries using current templates, attempt to derive
`.instructions.md`-style rules, identify gaps in scan templates.

## Round 1: What the current scan template produces

### Simulated scan entry: Architecture — REST API

Using the current architecture template from SKILL.md:

```
Component: REST API (apps/rest-api)
Purpose: Main HTTP API surface for MoltNet. Handles agent registration,
  diary CRUD, signing requests, voucher management, and public feed.
Boundaries: Owns HTTP routing, request validation, JWT auth. Delegates
  to diary-service for business logic, auth lib for JWT/Keto, database
  lib for persistence.
Key abstractions: Fastify plugins, TypeBox schemas for validation,
  repository pattern for DB access, DBOS durable workflows for signing.
Dependencies: depends on auth, database, diary-service, crypto-service,
  embedding-service, models, observability. Landing app and MCP server
  are peers, not dependents.
Conventions: Fastify plugin pattern for cross-cutting concerns. TypeBox
  for request/response schemas. Repository pattern for database access.
Data flow: HTTP request → Fastify route → TypeBox validation → service
  layer → repository → Drizzle ORM → Postgres.
Helps with: add-feature, add-endpoint, debug-api, review-code
Confidence: high
```

### Attempted rule derivation from above entry

What I'd want to produce (`.instructions.md` style):

```markdown
---
applyTo: 'apps/rest-api/**'
---

# REST API Architecture Rules

## Adding a New Endpoint

1. Create a route file in `apps/rest-api/src/routes/`
2. Use TypeBox for request/response schemas
3. Register the route as a Fastify plugin
4. ...?

## Request Validation

- ALWAYS use TypeBox schemas, not Zod or manual validation
- ...?

## Database Access

- ALWAYS use repository pattern, never direct Drizzle queries in routes
- ...?
```

### What's missing

The scan entry tells me the REST API uses "Fastify plugins" and "TypeBox" and
"repository pattern" but it doesn't tell me:

1. **HOW** — what does a Fastify plugin registration look like? What's the
   canonical file structure? The on-board-nx instructions include actual code
   snippets showing the decorator stack.

2. **WHERE** — "Create a route file in routes/" is a guess. The scan entry
   says "owns HTTP routing" but doesn't say where route files live or what
   naming convention they follow.

3. **NEVER** — what are the anti-patterns? The on-board-nx instructions say
   "do NOT manually format error responses" and "NEVER use findOneAndUpdate".
   The scan entry has no anti-pattern field.

4. **MUST** — what are the hard constraints? "Every controller MUST include
   this decorator combination" has no equivalent in the scan output.

5. **SCOPE** — the `applyTo` glob. The scan entry has `scope:api` as a
   semantic tag but not a file glob like `apps/rest-api/**`.

6. **CODE PATTERN** — the canonical example. The on-board-nx architecture
   instructions include a full controller class with all required decorators.
   The scan entry mentions "TypeBox schemas for validation" but doesn't show
   one.

---

## Round 1: Testing conventions

### Simulated scan entry: Testing conventions

```
Framework: Vitest 3.x
Test types:
  - unit: `**/*.test.ts` colocated with source, `pnpm run test`
  - e2e: `apps/*/test/` directories, `pnpm --filter <app> run test:e2e`
    Prerequisites: Docker Compose stack must be running
Patterns: AAA (Arrange, Act, Assert)
Fixtures: test-fixtures/ at repo root for shared fixtures
CI integration: Vitest runs in CI via `pnpm run test`, e2e runs after
  Docker stack is up
Known issues: none documented
Helps with: write-test, write-e2e-test, debug-test-failure
Confidence: medium
```

### Attempted rule derivation

```markdown
---
applyTo: '**/*.test.ts'
---

# Testing Rules

## Test Structure

- Use AAA pattern (Arrange, Act, Assert)
- ...what does an AAA test look like in this repo?

## E2E Tests

- Docker Compose stack must be running before e2e tests
- ...which compose file? `docker-compose.e2e.yaml`?
- ...what health endpoints to poll?

## Mocking

- ...how does this repo mock dependencies? vi.mock? manual mocks?
```

### What's missing

1. **No canonical test example.** The on-board-nx testing guide includes full
   test files showing TestingModule setup, mock patterns, assertion style.
   The scan entry says "AAA pattern" but doesn't show what that looks like
   in this specific repo.

2. **No prerequisite commands.** The on-board-nx guide says "Run `yarn pre:e2e`"
   before E2E. My scan entry says "Docker Compose stack must be running" but
   doesn't specify the exact command or compose file.

3. **No anti-patterns.** "Don't use `jest.fn()` — use `vi.fn()`" type rules
   are missing because the scan doesn't extract what NOT to do.

4. **No mock/fixture patterns.** How does this repo handle mocks? The scan
   mentions `test-fixtures/` but not how fixtures are structured or used.

---

## Gap Analysis: What the scan templates need

### Missing fields per category

| Category     | Missing field        | What it captures                     | Rule type it feeds        |
| ------------ | -------------------- | ------------------------------------ | ------------------------- |
| All          | `Constraints:`       | MUST/NEVER/ALWAYS rules from docs    | Hard rules                |
| All          | `Anti-patterns:`     | What NOT to do, common mistakes      | Negative rules            |
| All          | `Applies to:`        | File glob pattern for this knowledge | `applyTo` in instructions |
| Architecture | `Canonical pattern:` | Code snippet showing the right way   | Pattern rules             |
| Architecture | `File conventions:`  | Where files go, naming patterns      | Structure rules           |
| Workflow     | `Exact commands:`    | Copy-paste commands with flags       | Procedural rules          |
| Workflow     | `Common mistakes:`   | What breaks and why                  | Negative rules            |
| Testing      | `Test example:`      | A representative test from this repo | Pattern rules             |
| Testing      | `Mock pattern:`      | How this repo handles test doubles   | Pattern rules             |
| Security     | `Hard rules:`        | Non-negotiable security constraints  | Security rules            |
| Security     | `Verification:`      | How to check compliance              | Audit rules               |

### What the scanner CAN'T do (and shouldn't try)

The scanner reads docs and config, not source code line by line. So:

- **Canonical code patterns** must come from docs that include code examples
  (like CLAUDE.md's "Code Style" section) or from config files that imply
  patterns (like eslint config implying import rules). The scanner can't
  read every route handler to extract the common pattern.

- **Anti-patterns** mostly come from TROUBLESHOOTING docs, journal entries
  about things that broke, or explicit "don't do this" statements in docs.
  The scanner can capture these IF the docs contain them.

- **File conventions** can be partially inferred from workspace config
  (pnpm-workspace.yaml shows apps/ and libs/) and from existing file
  structure. The scanner already does some of this in the "Project structure"
  template.

### What the scanner SHOULD add

The gap is narrower than it looks. The scanner doesn't need to read source
code — it needs to **extract rule-shaped statements** from the docs it already
reads. CLAUDE.md alone contains:

- "NEVER use `paths` aliases in any tsconfig.json"
- "Every change to schema.ts MUST be followed by generating a migration"
- "Use `catalog:` protocol for any dependency that already exists"
- "AAA pattern for tests"

These are already in the docs. The current scan templates just don't have
fields that prompt for their extraction.

### Proposed template additions

Add to **every** category template, between `Helps with:` and `Confidence:`:

```
Constraints:
  - MUST: <list of hard requirements from docs>
  - NEVER: <list of prohibitions from docs>
Anti-patterns:
  - <what goes wrong and why>
Applies to: <file glob pattern, e.g., apps/rest-api/**, **/*.test.ts>
```

Add to **architecture** template specifically:

```
File conventions: <where new files go, naming pattern>
Canonical pattern: <code snippet from docs showing the right way, if available>
```

Add to **testing** template specifically:

```
Test example: <representative test structure from docs or CLAUDE.md>
Mock pattern: <how this repo handles test doubles>
```

Add to **workflow** template specifically:

```
Exact commands:
  - <copy-paste command with all flags>
Common mistakes:
  - <what breaks if you skip a step>
```

### What this means for the consolidation step

The consolidation/rules step becomes much simpler if scan entries already
contain:

1. `Constraints:` → becomes MUST/NEVER rules directly
2. `Anti-patterns:` → becomes "Don't do X" sections
3. `Applies to:` → becomes `applyTo:` frontmatter
4. `Canonical pattern:` → becomes code examples in rule files
5. `File conventions:` → becomes "Where to put new files" sections

The consolidation step's job reduces from "infer rules from descriptions" to
"organize and format already-extracted rules."

---

## Round 2: Research findings that change the design

### Papers reviewed

1. **Gloaguen et al. 2026** — "Evaluating AGENTS.md: Are Repository-Level
   Context Files Helpful for Coding Agents?" (arxiv:2602.11988)
2. **Chatlatanagulchai et al. 2025** — "Agent READMEs: An Empirical Study of
   Context Files for Agentic Coding" (arxiv:2511.12884)
3. **"Codified Context" 2026** — "Codified Context: Infrastructure for AI
   Agents in a Complex Codebase" (arxiv:2602.20478)

### Key finding #1: More context ≠ better performance

Gloaguen et al. tested 4 coding agents on 438 tasks. LLM-generated context
files **reduced** task success rates by 0.5-2% while increasing cost by 20-23%.
Developer-written context files improved success by only ~4% but increased
costs 19%.

The mechanism: agents reliably follow instructions in context files, but
following unnecessary instructions adds cognitive load and exploration overhead.
Agents with context files took 2-4 more steps before reaching relevant files.

**Implication for scan → rules**: The scan-derived rules must be MINIMAL and
TASK-RELEVANT. Producing comprehensive documentation of everything the scanner
finds is counterproductive. The rules should be the smallest set that prevents
the most common mistakes.

### Key finding #2: LLM-generated context is redundant with existing docs

When Gloaguen et al. removed all .md files and /docs/ from repos, LLM-generated
context files suddenly improved performance by 2.7%. The context files were
restating what the docs already said.

**Implication for scan → rules**: The scan reads docs. If the rules just
restate what's in the docs, they're worthless — the agent already has access
to the docs. Rules must add **synthesis** the docs don't provide:

- Cross-cutting constraints spanning multiple docs
- Inferred patterns not explicitly documented
- Negative rules (anti-patterns) buried in troubleshooting docs
- Task-specific command sequences that require combining info from multiple sources

### Key finding #3: Command-based instructions are followed; abstract guidance isn't

Chatlatanagulchai et al. found that concrete categories (Build and Run F1=0.92,
Testing F1=0.94) are reliably parsed and followed. Abstract categories
(Maintenance F1=0.56, Project Management F1=0.42) confuse agents.

Gloaguen et al. confirmed: when context files said "use uv", agents used uv
1.6x/instance vs <0.01x without the instruction. Tool-specific instructions
work.

**Implication for scan → rules**: Rules should be CONCRETE and ACTIONABLE.
"Use TypeBox for validation" is useful. "Follow good coding practices" is noise.
The scan templates should bias toward extracting specific commands, tool names,
file patterns, and exact constraints rather than high-level principles.

### Key finding #4: Security and performance rules are almost always missing

Chatlatanagulchai et al. found security guidance in only 14.5% of context files,
performance in 14.5%. Testing was in 75%, architecture in 67.7%.

**Implication for scan → rules**: The scanner should actively look for security
constraints and performance requirements even when they're sparse. These are
the highest-value rules because they're almost never provided elsewhere. A
scan-derived rule like "private keys NEVER leave the agent's machine" is more
valuable than "the project uses Fastify" (which is already obvious from
package.json).

### Key finding #5: Three-tier knowledge works better than flat files

The "Codified Context" paper showed a 3-tier system works well:

- Tier 1 (hot): ~660-line constitution loaded every session — conventions,
  commands, checklists, failure modes
- Tier 2 (warm): 19 specialist agent specs with domain knowledge
- Tier 3 (cold): 34 on-demand docs retrieved via MCP keyword search

The key insight: Tier 2 agents with pre-loaded context made "significantly
fewer mistakes" than agents that retrieved Tier 3 docs on demand. Pre-loaded
context beats retrieval for error-prone domains.

**Implication for scan → rules**: Rules should be organized by tier:

- **Always-loaded rules** (constraints, anti-patterns, commands) → hot
- **Domain-specific rules** (architecture patterns per subsystem) → warm,
  loaded when working on that subsystem
- **Reference documentation** (full architecture docs) → cold, already
  available as docs in the repo

This maps to the `.instructions.md` format:

- `applyTo: '**'` → hot (always loaded)
- `applyTo: 'apps/rest-api/**'` → warm (subsystem-specific)
- No rule file needed for cold tier — the docs themselves serve this role

### Key finding #6: Specification staleness causes silent failures

The "Codified Context" paper reported that when implementations changed without
documentation updates, agents generated code conflicting with recent refactors.
Agents trust documentation absolutely.

**Implication for scan → rules**: This is why the scan uses content-based
digests for staleness detection. But the rules derived from scan entries
inherit this risk — if the scan entry is stale, the derived rule is stale.
The rule consolidation step should:

- Include provenance (which scan entry → which source file)
- Include the source file digest
- Flag rules whose provenance files have changed since the last scan

---

## Revised design: What the scan should capture for rule derivation

### Design principles (from research)

1. **Minimal over comprehensive** — fewer, higher-quality rules beat many vague ones
2. **Concrete over abstract** — commands, file paths, tool names, code patterns
3. **Constraints over descriptions** — MUST/NEVER/ALWAYS, not "the project uses..."
4. **Non-redundant** — only information not already obvious from the code/docs
5. **Scoped** — file glob patterns so rules load only when relevant
6. **Security-biased** — actively extract security rules even from sparse sources
7. **Provenance-linked** — every rule traces to a source file + digest

### Revised content types (per Chatlatanagulchai taxonomy)

Map the 16 Agent README categories to scan → rule priorities:

| Category               | Prevalence | Rule value                           | Scan priority                        |
| ---------------------- | ---------- | ------------------------------------ | ------------------------------------ |
| Testing                | 75%        | HIGH — concrete, actionable          | Already in scan                      |
| Implementation Details | 69.9%      | HIGH — code patterns, style          | **Missing: need canonical patterns** |
| Architecture           | 67.7%      | MEDIUM — structural, less actionable | Already in scan                      |
| Development Process    | 63.3%      | HIGH — commit, PR, workflow rules    | Partially in scan (workflow)         |
| Build and Run          | 62.3%      | HIGH — exact commands                | Partially in scan (workflow)         |
| System Overview        | 59%        | LOW — redundant with README          | Already in scan (identity)           |
| Maintenance            | 43.7%      | MEDIUM — API stability, compat rules | **Missing**                          |
| Configuration          | 38%        | MEDIUM — env setup                   | Partially in scan (infra)            |
| Documentation          | 26.8%      | LOW — meta-guidance                  | Not needed                           |
| Debugging              | 24.4%      | HIGH — failure modes, workarounds    | Partially in scan (caveat)           |
| AI Integration         | 24.4%      | LOW — agent persona guidance         | Not needed for rules                 |
| DevOps                 | 18.1%      | MEDIUM — CI/CD constraints           | Partially in scan (workflow)         |
| Security               | 14.5%      | CRITICAL — highest value             | Already in scan, needs enrichment    |
| Performance            | 14.5%      | CRITICAL — highest value             | **Missing**                          |
| UI/UX                  | 8.7%       | LOW for backend-heavy repos          | Not in scan                          |
| Project Management     | 5.4%       | LOW — planning, not actionable       | Not needed                           |

### What the scan templates should change

Based on research + Round 1 gaps:

#### All categories: add constraint extraction

```
Constraints:
  - MUST: <hard requirements extracted from docs — exact quotes preferred>
  - NEVER: <prohibitions extracted from docs — exact quotes preferred>
  - PREFER: <soft conventions — "prefer X over Y">
Anti-patterns:
  - <what NOT to do + what happens if you do>
Applies to: <file glob pattern where this knowledge is relevant>
```

These fields are the highest-value addition. They directly become rules.
The key learning from Gloaguen: only extract constraints that are NOT already
obvious from the code itself. "Use TypeScript" is noise. "NEVER use paths
aliases in tsconfig.json" is a real constraint.

#### Architecture: add pattern field

```
File conventions: <where new files go, naming pattern>
Canonical pattern: |
  <code snippet from docs showing the right way>
  <only if available in source docs — don't invent>
```

This feeds the highest-prevalence useful category (Implementation Details).
But only include if the docs actually contain code examples — the scanner
shouldn't invent patterns from code inspection.

#### Testing: add concrete examples

```
Test example: |
  <representative test structure from docs or CLAUDE.md>
Mock pattern: <how this repo handles test doubles>
Required commands:
  - <exact test commands with all flags>
```

Testing was the highest-prevalence category in Chatlatanagulchai and the
most reliably followed in Gloaguen. Concrete test commands are high value.

#### Workflow: strengthen commands

```
Required commands:
  - <exact copy-paste commands>
Common mistakes:
  - <what breaks if you skip a step>
  - <what the error looks like>
```

Build and Run commands are the most reliably followed instructions.
Including the error message for common mistakes helps agents recognize
when they've hit a known issue.

#### Security: make it mandatory extraction

Security rules appeared in only 14.5% of context files but are the highest
value. The scanner should:

- Actively search for security-related MUST/NEVER statements in ALL docs
- Extract trust boundary descriptions
- Flag when security documentation is sparse (this itself is a finding)

```
Hard rules:
  - <non-negotiable security constraints>
Verification: <how to check compliance — e.g., "run pnpm audit">
```

#### NEW category: Performance constraints

Not currently in the scan. Add if deep mode or if docs mention performance:

```
Performance: <constraints>
  - <e.g., "embedding computation must be async">
  - <e.g., "batch diary entries, don't create one-by-one">
```

#### NEW category: Maintenance / compatibility rules

Not currently explicit. Add to architecture template:

```
Compatibility rules:
  - <API stability constraints>
  - <migration requirements>
  - <backward compatibility rules>
```

### What the scan should NOT capture (from research)

1. **System overviews** — agents already get this from README. Gloaguen showed
   overviews don't help agents find relevant files faster.
2. **Abstract principles** — "follow good practices" is noise. Only concrete,
   actionable statements.
3. **Restated documentation** — if a doc says "we use Vitest" and there's a
   `vitest.config.ts`, the rule "use Vitest" adds zero value. Only constraints
   not inferable from code structure.
4. **Persona instructions** — "you are a careful developer" type guidance.
   The AI Integration category (24.4%) is irrelevant for rules.

### How this connects to the consolidation step

The consolidation step (future skill) receives scan entries and produces
`.instructions.md` files. With the revised templates:

1. **Group by `Applies to:` glob** — entries with the same glob become
   sections in the same instruction file
2. **Constraints become rules** — MUST/NEVER/PREFER lines become the body
3. **Anti-patterns become warnings** — "Don't do X" sections
4. **Canonical patterns become examples** — code blocks
5. **Provenance becomes comments** — source file + digest for staleness tracking
6. **Tier assignment by glob** — `**` is hot (always loaded),
   subsystem-specific globs are warm

The consolidation step should also:

- Deduplicate constraints that appear in multiple entries
- Merge related constraints into coherent sections
- Drop low-confidence constraints unless they're security-related
- Flag rules that have no provenance (inferred, not documented)

---

## Next step

Update the scan skill SKILL.md with the revised templates, then run the
actual scan on MoltNet to produce real entries. After the scan, attempt
rule derivation again to see if the enriched templates close the gap.

---

## Round 3: How to make scan-derived rules surgical instead of bloated

The missing piece is not just better extraction. It is better **granularity**
and better **task-time loading**.

The Gloaguen result makes this explicit: if the scanner produces a large static
repo instruction file, we will recreate the AGENTS.md failure mode under a new
name. The goal is not "more rules." The goal is:

> small rule nuggets, each grounded in evidence, loaded only when a task
> trigger says they matter.

### Rule nugget protocol

Define the scanner's downstream target as a **rule nugget**, not a free-form
section of repo guidance.

Each nugget should contain:

- one rule statement
- one clear trigger
- one bounded scope
- one verification mode
- one or more source references

Minimal shape:

```yaml
rule_id: testing.e2e.require-docker
statement: Start the Docker stack before running e2e tests.
rule_kind: hard
trigger:
  task_classes: [test-authoring, debug-e2e]
  file_paths: [apps/rest-api/test/e2e/**]
scope:
  subsystem: rest-api-e2e
verification:
  mode: checklist
  check: 'Does the task require e2e execution without Docker startup?'
sources:
  - docs/testing.md
  - apps/rest-api/package.json
confidence: high
review_status: reviewed
```

### Nugget acceptance gate

Reject any scan-derived candidate rule unless it is:

1. **Triggerable**: it is clear when the rule applies
2. **Specific**: it refers to a real repo convention, boundary, or invariant
3. **Bounded**: it fits one task family or subsystem
4. **Grounded**: it links to concrete files, docs, or evidence entries
5. **Actionable**: an agent can follow it or a validator can check it

If a candidate fails this gate, keep it as background context or a tile note,
not as an active rule.

### Nugget size target

For the first experiment, optimize for small units:

- under ~120 tokens of core text
- one decision or constraint per nugget
- at most 1-3 task classes attached

This is the direct countermeasure against the "context file bloat" failure mode.

### Trigger types to support first

Use only trigger types that scan output can support with reasonable precision:

- file-path trigger
- task-class trigger
- subsystem trigger
- command/workflow trigger
- trust/security trigger

Do **not** attempt subtle product-intent or planning-state triggers in V1.
Those will produce too much spillover.

### Load budget

For any task run, the selector should load at most:

- 3-7 primary nuggets
- 1-2 optional caveat nuggets

If a task needs more, that indicates one of two failures:

- the nuggets are too broad and need splitting
- the selector is too noisy and is over-matching

This should become a hard evaluation constraint, not a nice-to-have.

---

## What the scanner should emit for each rule candidate

The revised templates should not stop at `Constraints:` and `Applies to:`.
They should also emit the fields needed for surgical loading.

For every candidate rule, the scan/consolidation pipeline should populate:

- `statement`
- `rule_kind` (`hard`, `soft`, `heuristic`)
- `trigger`
- `scope`
- `verification`
- `task_classes`
- `sources`
- `confidence`
- `review_status`
- `fallback_escalation`

This changes the consolidation step from:

- "write a nice repo instructions file"

to:

- "normalize scan evidence into a small set of task-scoped validated nuggets"

---

## Revised scan -> rules -> Straion pipeline

The practical experiment should now be:

1. Scan repo into evidence entries
2. Distill entries into tiles
3. Emit candidate rule nuggets from those tiles
4. Reject vague or over-broad nuggets using the acceptance gate
5. Group the accepted nuggets into a small reviewable ruleset
6. Import the reviewed ruleset into Straion
7. Compare manually authored Straion rules vs Straion rules seeded from scan

This is the right product question:

> can scan-derived evidence reduce the cost of producing a high-quality initial
> ruleset for a runtime control plane?

That question is more useful than asking whether scan can replace human rule
authoring entirely.

---

## How to evaluate whether nugget loading works

Success is not "we extracted some rules." Success is:

- the right nuggets load for the right tasks
- few irrelevant nuggets load
- the loaded nuggets materially improve correctness or compliance
- the token/context overhead stays bounded

The experiment should log at least:

```yaml
selector_metrics:
  nuggets_loaded: 5
  optional_nuggets_loaded: 1
  irrelevant_nuggets: 1
  trigger_precision: 0.8
```

And the ruleset review should score:

- `rule_coverage`
- `rule_precision`
- `rule_enforceability`
- `rule_grounding`
- `trigger_quality`

This gives a concrete way to answer:

- Are the nuggets too broad?
- Are the triggers too noisy?
- Are the rules too vague to validate?
- Which rule classes reconstruct well from scan output?

---

## Concrete update to the experiment goal

The experiment goal should now be stated as:

> produce scan-derived rule nuggets that are small, grounded, reviewable, and
> selectively loadable at task time.

That implies three explicit pass conditions:

1. **Rule quality**: scan-derived nuggets are specific enough to import after
   bounded review
2. **Selector quality**: most loaded nuggets are relevant to the task
3. **Task utility**: the loaded nuggets improve plan quality, compliance, or
   execution without flooding the context window

If any of those fail, the answer is not "scan-derived rules don't work."
The answer is more likely one of:

- scan templates are still too descriptive and not constraint-shaped
- nugget boundaries are wrong
- trigger design is too weak
- some domains should remain tiles/docs, not active rules

---

## Immediate next steps

1. ~~Update scan templates to emit trigger/scope/verification-ready fields~~ ✅ Done
2. ~~Run a real scan on MoltNet~~ ✅ Done — see [scan-consolidation-approach.md](scan-consolidation-approach.md)
3. Derive the first 10-15 rule nuggets for testing and security flows
4. Review them manually and reject anything vague
5. Import the accepted set into Straion
6. Compare `straion` vs `straion-from-scan` on a small task set

## Related

- **[scan-consolidation-approach.md](scan-consolidation-approach.md)** — execution
  playbook for the 2026-03-03 scan run. Contains entry IDs, retrieval queries,
  tile merge groups, nugget extraction plan, and recovery instructions. This doc
  provides the research rationale; that doc provides the operational plan.
