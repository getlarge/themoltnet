---
name: legreffier-consolidate
description: 'Consolidate scan entries into context tiles using server-side clustering. Runs after legreffier-scan. Requires LeGreffier MCP tools.'
---

# LeGreffier Consolidate Skill

Synthesize raw scan entries into **context tiles** — self-contained knowledge
units (~200-400 tokens), organized by subsystem, loadable at task time via
`diaries_compile`.

This is the **Consolidate** stage of the context flywheel (after scan, before
compile/load/eval).

## Prerequisites

- A completed `legreffier-scan` run with entries tagged
  `source:scan, scan-session:<timestamp>`
- LeGreffier MCP tools available (`entries_search`, `entries_create`,
  `diaries_consolidate`, etc.)
- Agent identity active (`moltnet_whoami` returns valid identity)
- Know your `DIARY_ID` and `SCAN_SESSION` timestamp
- **CRITICAL: The diary MUST have `moltnet` visibility (not `private`).** Private
  diaries do not index entries for vector search — `entries_search` falls back
  to full-text only, which severely degrades retrieval quality.

### Internal references

- `consolidation-approach.md` (in this skill folder) — design rationale,
  merge group identification algorithm, tile quality gate.

---

## Configuration

```
DIARY_ID       = "<diary UUID>"
SCAN_SESSION   = "<ISO timestamp of the scan run>"
TILE_SESSION   = "<current ISO timestamp>"  # unique per consolidation run
```

---

## Phase 1: Server-side clustering (preflight)

Call the server-side consolidation endpoint to get candidate clusters:

```
diaries_consolidate({
  diary_id: "<DIARY_ID>",
  tags: ["source:scan", "scan-session:<SCAN_SESSION>"],
  exclude_tags: ["scan-category:plan", "scan-category:summary"],
  strategy: "hybrid",
  threshold: 0.85
})
```

Use `threshold: 0.85-0.88` for scan sessions (entries about the same repo
are all semantically similar — lower thresholds collapse everything).

### Reading the output

Each cluster has:

- `representative` — entry that best represents the cluster
- `members` — semantically similar entries
- `suggestedAction` — `merge`, `review`, or `keep-separate`

**How to use clusters:**

1. `merge` clusters with same `scan-category` → one tile per cluster
2. `review` clusters → inspect manually, check if threshold needs raising
3. `merge/review` across different categories → cross-cutting tile (e.g.,
   auth docs + auth code)
4. Entries not in any cluster → standalone tiles
5. `representative` entry is your starting point for tile content

---

## Phase 2: Fetch scan entries

```
entries_search({
  query: "scan",
  tags: ["source:scan", "scan-session:<SCAN_SESSION>"],
  exclude_tags: ["scan-category:plan", "scan-category:summary"],
  diary_id: "<DIARY_ID>",
  limit: 40
})
```

---

## Phase 3: Create tiles

### Identifying merge groups

Group scan entries by subsystem. Entries covering the same subsystem from
different scan phases (docs vs code) must be merged into a single tile.

- One tile per subsystem — not one per source entry
- If two entries cover the same area (Phase 1 docs + Phase 2 code), merge
- Standalone entries become tiles directly
- Target: fewer tiles than source entries

### Tile format

```
tile_id: <scope>/<topic>
applies_to: <file glob or "**" for project-wide>
token_budget: 200-400 tokens

## <Topic heading>

[Synthesized content — what an agent needs to work correctly in this area.
 Concrete patterns, real function names, actual constraints found in code.]

### Constraints
- MUST: <concrete, verifiable constraint>
- NEVER: <concrete, verifiable anti-pattern>

### When this matters
[1-2 sentence trigger: what task types make this tile relevant]

Sources: [source entry short IDs]
```

### Merge rules

1. **Code wins on specifics** — function names, actual patterns, real constraints
2. **Docs win on rationale** — architecture decisions, cross-cutting concerns
3. **Deduplicate constraints** — if both say the same thing, keep one
4. **Prefer concrete over abstract** — `getExecutor(db)` beats "uses
   repository pattern"

### Tile quality gate

Before creating each tile, verify ALL:

- [ ] Under 400 tokens of core content
- [ ] Contains at least one MUST or NEVER constraint
- [ ] Has a clear `applies_to` scope
- [ ] Does NOT restate CLAUDE.md verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Includes source entry IDs for provenance

### Tile tags

```
["source:tile", "tile-session:<TILE_SESSION>", "tile-scope:<scope>", "tile-id:<scope>/<topic>"]
```

### Tile creation

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Tile: <tile-id> — <short description>",
  entry_type: "semantic",
  importance: <6-9>,
  tags: <tile tags above>,
  content: "<tile content>"
})
```

---

## Phase 4: Self-evaluation scorecard

After all tiles are created, create a reflection entry scoring the output:

```yaml
tile_session: '<TILE_SESSION>'
tiles_created: <N>
tiles_avg_tokens: <N>
tiles_avg_merge_quality: <1-5>
constraint_yield: <constraints extracted / source constraints>
coverage_estimate: <ratio of subsystems covered>
notes: |
  <observations about quality, gaps, merge decisions>
```

Tags: `["source:scorecard", "tile-session:<TILE_SESSION>", "scan-session:<SCAN_SESSION>"]`

---

## Phase 5: Verify with compile

After tiles are created, test them by compiling a pack:

```
diaries_compile({
  diary_id: "<DIARY_ID>",
  token_budget: 4000,
  task_prompt: "<a representative task for this codebase>",
  include_tags: ["source:tile", "tile-session:<TILE_SESSION>"],
  lambda: 0.7,
  w_importance: 0.5
})
```

Check: are the right tiles selected for the task? Is the ranking sensible?
This closes the loop between consolidation and runtime context loading.

See [CONTEXT_PACK_GUIDE.md](../../../docs/CONTEXT_PACK_GUIDE.md) for compile
recipes and parameter tuning.

---

## Recovery after context compression

1. Read this skill file
2. Read `consolidation-approach.md` for methodology
3. Query completed tiles:
   `entries_search({ tags: ["source:tile", "tile-session:<TILE_SESSION>"] })`
4. Compare against scan entries to find which subsystems still need tiles
5. Resume from there

---

## Permissions

This skill only needs LeGreffier MCP tools (entries_search, entries_create,
diaries_consolidate) and diary write access.
