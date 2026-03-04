# Scan Consolidation Approach — themoltnet

Date: 2026-03-03
Scan session: `2026-03-03T19:45:00Z`
Diary: `e8c6646b-d4bc-47e9-aa6f-52d7d70efade` (scan-experiment-001, private)
Agent: `1671-B080-99BF-4270`

## Related

- **[scan-to-rules-experiment.md](scan-to-rules-experiment.md)** — research
  findings (Gloaguen, Chatlatanagulchai, Codified Context) and design rationale
  for enriched scan templates, nugget protocol, and acceptance gate. Read that
  first for the "why"; this doc is the "how".

## Purpose

Transform 17 scan evidence entries into two outputs:

1. **Context tiles** — concise, self-contained knowledge units (~200-400 tokens
   each) organized by scope, loadable at task time
2. **Rule nuggets** — surgical constraint statements (~120 tokens each) with
   triggers, scopes, and verification, suitable for import into a runtime
   control plane

This document is the approach reference. It survives context compression.

---

## Entry inventory

### Retrieval

```
# All scan entries from this session
entries_search({
  query: "scan",
  tags: ["source:scan", "scan-session:2026-03-03T19:45:00Z"],
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade",
  limit: 20
})

# Scan plan
entries_get({
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade",
  entry_id: "4f2e03b9-afdc-49db-93ed-a28f1bff04a2"
})

# Scan summary
entries_get({
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade",
  entry_id: "b6b6bae5-df42-4b63-8c99-5926d41eadeb"
})
```

### Entry map

| # | Entry Key | Entry ID | Category | Scope | Batch |
|---|-----------|----------|----------|-------|-------|
| 1 | identity:project-identity | `6ddb1d0e` | identity | misc | phase1-b1 |
| 2 | architecture:project-structure | `5b89fb53` | architecture | misc | phase1-b1 |
| 3 | architecture:rest-api | `34ccf479` | architecture | apps/rest-api | phase1-b2 |
| 4 | architecture:mcp-server | `090ad8f2` | architecture | apps/mcp-server | phase1-b2 |
| 5 | architecture:auth-flow | `d7a52a9b` | architecture | misc | phase1-b2 |
| 6 | architecture:database | `381b68fe` | architecture | libs/database | phase1-b2 |
| 7 | workflow:build-and-validate | `6b91a592` | workflow | misc | phase1-b3 |
| 8 | workflow:docker-local-dev | `18727406` | workflow | misc | phase1-b3 |
| 9 | testing:conventions | `06d0c518` | testing | misc | phase1-b3 |
| 10 | security:auth-model | `cc2cb2f9` | security | misc | phase1-b4 |
| 11 | caveat:sandbox-sigill | `812a0057` | caveat | misc | phase1-b4 |
| 12 | architecture:libs-database | `7698f6f6` | architecture | libs/database | phase2-tier0 |
| 13 | architecture:libs-crypto-service | `76319d37` | architecture | libs/crypto-service | phase2-tier0 |
| 14 | architecture:libs-auth | `9f474ac0` | architecture | libs/auth | phase2-tier0 |
| 15 | architecture:libs-diary-service | `091ef4f9` | architecture | libs/diary-service | phase2-tier1 |
| 16 | architecture:apps-rest-api | `b51c7882` | architecture | apps/rest-api | phase2-tier2 |
| 17 | architecture:apps-mcp-server | `7503187d` | architecture | apps/mcp-server | phase2-tier2 |

### Tags for retrieval

| Tag pattern | What it matches |
|---|---|
| `source:scan` | All scan-derived entries (any session) |
| `scan-session:2026-03-03T19:45:00Z` | This specific scan run |
| `scan-category:identity` | Identity entries |
| `scan-category:architecture` | Architecture entries (Phase 1 + 2) |
| `scan-category:workflow` | Workflow entries |
| `scan-category:testing` | Testing entries |
| `scan-category:security` | Security entries |
| `scan-category:caveat` | Caveat/known-issue entries |
| `scan-batch:phase1-b1` | Phase 1 batch 1 (identity + structure) |
| `scan-batch:phase1-b2` | Phase 1 batch 2 (architecture docs) |
| `scan-batch:phase1-b3` | Phase 1 batch 3 (workflow + testing) |
| `scan-batch:phase1-b4` | Phase 1 batch 4 (security + caveat) |
| `scan-batch:phase2-tier0` | Phase 2 leaf libs (db, crypto, auth) |
| `scan-batch:phase2-tier1` | Phase 2 mid libs (diary-service) |
| `scan-batch:phase2-tier2` | Phase 2 apps (rest-api, mcp-server) |
| `scope:apps/rest-api` | REST API scoped entries |
| `scope:apps/mcp-server` | MCP server scoped entries |
| `scope:libs/database` | Database lib scoped entries |
| `scope:libs/crypto-service` | Crypto lib scoped entries |
| `scope:libs/auth` | Auth lib scoped entries |
| `scope:libs/diary-service` | Diary service scoped entries |
| `scope:misc` | Cross-cutting / project-wide entries |

---

## Phase 1: Context tiles

### What a tile is

A tile is a self-contained knowledge unit that answers one question well:

> "What do I need to know about X to work on Y correctly?"

Tiles are NOT documentation rewrites. They are synthesized from multiple scan
entries, deduplicated, and focused on what an agent needs at task time.

### Tile design principles (from scan-to-rules-experiment.md)

1. **Minimal over comprehensive** — fewer tokens, higher density
2. **Concrete over abstract** — commands, paths, patterns, not prose
3. **Non-redundant with source docs** — don't restate what CLAUDE.md says
4. **Scoped** — each tile has a clear `applies_to` boundary
5. **Synthesis, not summary** — combine info from multiple entries into
   something no single doc provides

### Tile structure

```
tile_id: <scope>/<topic>
applies_to: <file glob or "**" for project-wide>
token_budget: 200-400 tokens

## <Topic>

[Synthesized content: what you need to know, constraints, patterns]

### Constraints
- MUST: ...
- NEVER: ...

### When this matters
[1-2 sentence trigger description]

Sources: [entry IDs]
```

### Input merging strategy

Several scan entries overlap. The consolidation must merge, not just list:

| Tile | Input entries (merge) | Rationale |
|---|---|---|
| `project/identity` | #1 identity + #2 structure | Single "what is this project" tile |
| `auth/flow` | #5 auth-flow + #10 security + #14 libs-auth | Auth is scattered across 3 entries |
| `database/schema-and-access` | #6 architecture:database + #12 libs-database | Phase 1 docs + Phase 2 code findings |
| `rest-api/wiring` | #3 architecture:rest-api + #16 apps-rest-api | Phase 1 docs + Phase 2 code findings |
| `mcp-server/wiring` | #4 architecture:mcp-server + #17 apps-mcp-server | Phase 1 docs + Phase 2 code findings |
| `crypto/signing` | #13 libs-crypto-service | Standalone — no overlap |
| `diary-service/search` | #15 libs-diary-service | Standalone — no overlap |
| `workflow/validate` | #7 build-and-validate | Standalone |
| `workflow/docker` | #8 docker-local-dev | Standalone |
| `testing/conventions` | #9 testing:conventions | Standalone |
| `caveats/known-issues` | #11 sandbox-sigill | Standalone |

**Expected output: 11 tiles** (down from 17 entries — merging removed 6
redundant boundaries).

### Merge rules

When two entries cover the same subsystem (Phase 1 docs + Phase 2 code):

1. **Phase 2 wins on specifics** — code-level patterns, actual function names,
   real constraints found in source
2. **Phase 1 wins on context** — architecture rationale, design decisions,
   cross-cutting concerns
3. **Deduplicate constraints** — if both say "MUST generate migration", keep
   one instance
4. **Prefer concrete over abstract** — if Phase 1 says "uses repository
   pattern" and Phase 2 says "repositories call getExecutor(db) for
   transaction propagation", keep the Phase 2 version

### Execution plan

Process tiles in this order (matches dependency):

1. `project/identity` — frames everything
2. `database/schema-and-access` — foundational lib
3. `crypto/signing` — foundational lib
4. `auth/flow` — depends on crypto conceptually
5. `diary-service/search` — depends on database
6. `rest-api/wiring` — depends on all libs
7. `mcp-server/wiring` — depends on rest-api conceptually
8. `workflow/validate` — cross-cutting
9. `workflow/docker` — cross-cutting
10. `testing/conventions` — cross-cutting
11. `caveats/known-issues` — standalone

Each tile is created as a new diary entry with tags:
- `source:tile`
- `tile-session:2026-03-03T19:45:00Z` (same scan session)
- `tile-scope:<scope>`
- `tile-id:<scope>/<topic>`

### Quality gate per tile

Before creating a tile entry, verify:

- [ ] Under 400 tokens of core content
- [ ] Contains at least one MUST or NEVER constraint
- [ ] Has a clear `applies_to` scope
- [ ] Does not restate information already in CLAUDE.md verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Includes source entry IDs for provenance

---

## Phase 2: Rule nuggets

### What a nugget is (from scan-to-rules-experiment.md)

A rule nugget is a single, atomic constraint statement with:

- one rule statement (~1-2 sentences)
- one clear trigger (when does this rule matter?)
- one bounded scope (what files/subsystems?)
- one verification method (how to check compliance?)
- provenance (which entries/files?)

Target: ~120 tokens per nugget.

### Nugget acceptance gate

Reject any candidate unless it passes ALL five:

1. **Triggerable** — clear when the rule applies
2. **Specific** — refers to a real repo convention or invariant
3. **Bounded** — fits one task family or subsystem
4. **Grounded** — links to concrete files or evidence
5. **Actionable** — an agent can follow it or a validator can check it

### Nugget structure

```yaml
nugget_id: <domain>.<subsystem>.<constraint>
statement: <1-2 sentence rule>
rule_kind: hard | soft | heuristic
trigger:
  task_classes: [<matching task classes>]
  file_paths: [<glob patterns>]
scope:
  subsystem: <subsystem name>
  applies_to: <file glob>
verification:
  mode: command | checklist | visual
  check: <how to verify>
sources:
  - <entry ID or file path>
confidence: high | medium | low
```

### Extraction strategy

Instead of scanning entries linearly and extracting nuggets one by one
(which produces too many weak candidates), use a **constraint-first** approach:

1. **Collect all Constraints/Anti-patterns sections** from the 17 entries
2. **Deduplicate** — many constraints appear in both Phase 1 and Phase 2
3. **Apply acceptance gate** — reject vague or non-triggerable candidates
4. **Group by trigger** — nuggets that fire together should be reviewed together
5. **Assign nugget IDs** — `<domain>.<subsystem>.<constraint-slug>`

### Priority domains for first nugget batch

Per scan-to-rules-experiment.md findings:

| Domain | Why first | Expected nuggets |
|---|---|---|
| testing | Highest follow-through (F1=0.94) | 4-6 |
| security | Highest value, lowest prevalence | 5-8 |
| workflow | High follow-through (F1=0.92) | 3-5 |
| database | Error-prone domain (migrations, transactions) | 3-4 |

Target: **15-23 nuggets** in first batch.

### Nugget output format

Nuggets are stored as diary entries with tags:
- `source:nugget`
- `nugget-session:2026-03-03T19:45:00Z`
- `nugget-domain:<domain>`
- `nugget-id:<full-nugget-id>`

One entry per domain group (not per individual nugget) to avoid entry
explosion. Each entry contains 3-8 nuggets in YAML format.

### Load budget constraint

Per the research findings: for any single task, load at most:
- 3-7 primary nuggets
- 1-2 optional caveat nuggets

If a task would trigger more than 9 nuggets, the trigger design is too noisy.

---

## Multi-model evaluation

### Why

The same 17 scan entries are the fixed input. Consolidation (tiles + nuggets)
is the variable — different models may extract different constraints, merge
differently, and produce different quality. Running the same consolidation
task across models lets us compare extraction quality objectively.

### Models under test

| Model ID | Short tag | Notes |
|---|---|---|
| Claude Sonnet 4.6 | `claude-sonnet-4.6` | Fast, cost-efficient |
| Claude Opus 4.6 | `claude-opus-4.6` | Most capable Claude |
| GPT 5.2 | `gpt-5.2` | OpenAI baseline |
| GPT 5.3 | `gpt-5.3` | OpenAI latest |

### Tagging convention

Every tile and nugget entry MUST include `model:<model-short-tag>` in its tags.
Each model run gets its own `tile-session` timestamp to keep runs separate.

Full tag set per tile:
```
source:tile
tile-session:<per-run-timestamp>
tile-scope:<scope>
tile-id:<scope>/<topic>
model:<model-short-tag>
```

Full tag set per nugget:
```
source:nugget
nugget-session:<per-run-timestamp>
nugget-domain:<domain>
nugget-id:<full-nugget-id>
model:<model-short-tag>
```

### Retrieval per model

```
# All tiles from a specific model run
entries_search({
  query: "tile",
  tags: ["source:tile", "model:<model-short-tag>"],
  diary_id: "<DIARY_ID>"
})

# All nuggets from a specific model run
entries_search({
  query: "nugget",
  tags: ["source:nugget", "model:<model-short-tag>"],
  diary_id: "<DIARY_ID>"
})
```

### Evaluation dimensions

Each model run is scored on these dimensions:

| Dimension | What it measures | Scoring method |
|---|---|---|
| **Constraint yield** | Nuggets accepted vs total candidates | `accepted / total_candidates` (ratio) |
| **Specificity** | Are constraints concrete or vague? | 1-5 per nugget, averaged |
| **Non-redundancy** | Avoids restating what's obvious from code | Count of redundant nuggets |
| **Trigger precision** | Would triggers fire for the right tasks only? | Estimated false-positive rate (low/med/high) |
| **Merge quality** | How well Phase 1 + Phase 2 are synthesized | 1-5 per tile, averaged |
| **Token efficiency** | Content density | `total_constraints / total_tokens` |
| **Hallucination rate** | Constraints not grounded in source entries | Count of ungrounded nuggets |
| **Coverage** | Are all important constraints from sources captured? | Constraints found / constraints in source entries |
| **Consistency** | Agreement with other models on same constraints | Jaccard similarity of nugget sets |

### Scorecard entry format

After each model run, store a scorecard as a diary entry:

```yaml
model: <model-short-tag>
tile_session: <timestamp>
tiles_created: <N>
tiles_avg_tokens: <N>
tiles_avg_merge_quality: <1-5>
nuggets_total_candidates: <N>
nuggets_accepted: <N>
nuggets_rejected: <N>
nuggets_acceptance_rate: <ratio>
nuggets_avg_specificity: <1-5>
nuggets_redundant: <N>
nuggets_hallucinated: <N>
nuggets_trigger_precision: <low|med|high>
token_efficiency: <constraints_per_1k_tokens>
coverage_estimate: <ratio>
notes: <free text observations>
```

Tags: `source:scorecard`, `model:<model-short-tag>`,
`scan-session:2026-03-03T19:45:00Z`

### Cross-model comparison

After all 4 runs, produce a comparison entry:

1. **Constraint overlap matrix** — which constraints did all models find vs
   which only one model found? High-overlap constraints are likely real;
   single-model constraints need human review.
2. **Quality ranking** — rank models by acceptance rate, specificity, and
   hallucination rate
3. **Cost-quality tradeoff** — cheaper models that produce similar quality
   are preferred for production use
4. **Failure modes** — what kind of mistakes does each model make?
   (e.g., over-extraction, vague triggers, parroting source text)

---

## Execution sequence

```
For each model M in [claude-sonnet-4.6, claude-opus-4.6, gpt-5.2, gpt-5.3]:

  Phase 1: Tiles (11 tiles from 17 entries)
    ├── Read entries in merge groups
    ├── Synthesize tile content (using model M)
    ├── Apply quality gate
    ├── Create tile entries in diary (tagged with model:M)
    └── Log tile IDs

  Phase 2: Nuggets (15-23 nuggets from tiles + entries)
    ├── Extract all Constraints/Anti-patterns from entries
    ├── Deduplicate
    ├── Apply acceptance gate
    ├── Group by trigger domain
    ├── Format as YAML nuggets
    ├── Create nugget entries in diary (tagged with model:M)
    └── Log nugget IDs

  Phase 3: Scorecard
    ├── Score tiles and nuggets on evaluation dimensions
    ├── Create scorecard entry (tagged with model:M)
    └── Log observations

After all runs:
  Phase 4: Cross-model comparison
    ├── Compute constraint overlap matrix
    ├── Rank models by quality dimensions
    ├── Identify failure modes per model
    └── Create comparison summary entry
```

---

## Improvements over naive consolidation

### Problem: scan entries are verbose evidence, not task-ready knowledge

The 17 entries total ~67K chars. Loading all of them at task time would
recreate the "context file bloat" failure (Gloaguen et al.).

**Fix**: Tiles compress 17 entries → 11 tiles at ~300 tokens each = ~3,300
tokens total. That's loadable.

### Problem: constraints are scattered across entries

Auth constraints appear in entries #5, #10, #14. Database constraints in #6,
#12. An agent would need to load 3+ entries to get the full picture.

**Fix**: Merge strategy groups related entries into single tiles. One tile
per subsystem, not one per source document.

### Problem: many extracted constraints are too vague for task-time loading

"Follow the repository pattern" doesn't tell an agent what to do. It's
background knowledge, not an actionable rule.

**Fix**: Acceptance gate rejects vague candidates. Only constraints that
pass all 5 criteria become nuggets. The rest stay in tiles as context.

### Problem: no way to know which tiles/nuggets to load for a given task

Without triggers, you either load everything (bloat) or nothing (missing
context).

**Fix**: Every nugget has explicit trigger types (task_classes, file_paths).
Every tile has an `applies_to` scope. A selector can match task → triggers
→ relevant tiles/nuggets.

### Problem: Phase 1 and Phase 2 entries duplicate each other

Architecture docs (Phase 1) and code inspection (Phase 2) often describe
the same subsystem. Without merging, an agent gets told twice that
"rest-api uses Fastify plugins."

**Fix**: Merge rules specify which phase wins on which type of information.
Phase 2 wins on specifics, Phase 1 wins on rationale.

---

## Recovery after context compression

If context is compressed during consolidation:

```
# Reload this document
Read docs/research/scan-consolidation-approach.md

# Reload scan summary
entries_get({
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade",
  entry_id: "b6b6bae5-df42-4b63-8c99-5926d41eadeb"
})

# Find completed tiles for current model run
entries_search({
  query: "tile",
  tags: ["source:tile", "tile-session:<current-run-timestamp>", "model:<current-model-tag>"],
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade"
})

# Find completed nuggets for current model run
entries_search({
  query: "nugget",
  tags: ["source:nugget", "nugget-session:<current-run-timestamp>", "model:<current-model-tag>"],
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade"
})

# Find scorecard for current model run
entries_search({
  query: "scorecard",
  tags: ["source:scorecard", "tile-session:<current-run-timestamp>", "model:<current-model-tag>"],
  diary_id: "e8c6646b-d4bc-47e9-aa6f-52d7d70efade"
})
```

Compare completed tile/nugget IDs against the plan above to determine
where to resume.
