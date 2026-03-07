---
name: legreffier-consolidate
description: 'Consolidate scan entries into context tiles and rule nuggets. Runs after legreffier-scan. Requires LeGreffier MCP tools. Supports multi-model evaluation.'
---

# LeGreffier Consolidate Skill

Synthesize raw scan entries into two outputs:

1. **Context tiles** — self-contained knowledge units (~200-400 tokens),
   organized by subsystem, loadable at task time
2. **Rule nuggets** — atomic constraint statements (~120 tokens) with triggers,
   scopes, and verification methods

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
  to full-text only, which severely degrades retrieval quality. Changing
  visibility after entries are created does NOT retroactively index them.
  The diary must be `moltnet` visibility BEFORE the scan entries are created.

### Internal references

- `consolidation-approach.md` (in this skill folder) — design rationale,
  merge group identification algorithm, nugget acceptance gate, multi-model
  evaluation methodology. Read this file for the "why" behind every design choice.

---

## Configuration

Set these variables before starting. All are required.

```
DIARY_ID       = "<diary UUID>"
SCAN_SESSION   = "<ISO timestamp of the scan run>"
MODEL_TAG      = "<your-model-short-tag>"   # e.g. "claude-sonnet-4.6", "gpt-5.2"
TILE_SESSION   = "<current ISO timestamp>"  # must be unique per run
```

---

## Optional preflight: run server-side clustering

Before manual tile synthesis, call the distill endpoint to get candidate
clusters:

```
diaries_consolidate({
  diary_id: "<DIARY_ID>",
  tags: ["source:scan", "scan-session:<SCAN_SESSION>"],
  strategy: "hybrid"
})
```

Use this output as a candidate grouping signal only. The skill's merge and
quality rules below remain the source of truth for what becomes a tile.

---

## Phase 1: Fetch scan entries

```
entries_search({
  query: "scan",
  tags: ["source:scan", "scan-session:<SCAN_SESSION>"],
  diary_id: "<DIARY_ID>",
  limit: 20
})
```

Filter out entries tagged `scan-category:plan` and `scan-category:summary`.
The remaining entries are your source material.

---

## Phase 2: Create tiles

### Identifying merge groups

Group scan entries by subsystem. Entries covering the same subsystem from
different scan phases (docs vs code) must be merged into a single tile.

Principles:

- One tile per subsystem — not one per source entry
- If two entries cover the same area (e.g. Phase 1 docs + Phase 2 code
  for the same lib), merge them
- Standalone entries (only one entry for that subsystem) become tiles directly
- Target: fewer tiles than source entries

See `consolidation-approach.md` § "How to identify merge groups" for the
merge algorithm and rationale.

### Tile format

Every tile MUST follow this exact structure:

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

When merging docs-derived and code-derived entries for the same subsystem:

1. **Code wins on specifics** — function names, actual patterns, real
   constraints found in source
2. **Docs win on rationale** — architecture decisions, design context,
   cross-cutting concerns
3. **Deduplicate constraints** — if both say the same thing, keep one
4. **Prefer concrete over abstract** — `getExecutor(db)` beats "uses
   repository pattern"

### Tile quality gate

Before creating each tile, verify ALL of these:

- [ ] Under 400 tokens of core content
- [ ] Contains at least one MUST or NEVER constraint
- [ ] Has a clear `applies_to` scope
- [ ] Does NOT restate CLAUDE.md verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Includes source entry IDs for provenance

### Tile tags

```
["source:tile", "tile-session:<TILE_SESSION>", "tile-scope:<scope>", "tile-id:<scope>/<topic>", "model:<MODEL_TAG>"]
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

Record each tile's entry ID.

---

## Phase 3: Extract rule nuggets

After all tiles are created, extract rule nuggets from the scan entries.

### Priority domains

| Domain   | Why first                        | Expected nuggets |
| -------- | -------------------------------- | ---------------- |
| testing  | Highest follow-through           | 4-6              |
| security | Highest value, lowest prevalence | 5-8              |
| workflow | High follow-through              | 3-5              |
| database | Error-prone domain               | 3-4              |

Target: **15-23 nuggets** total.

### Extraction strategy

Do NOT scan entries linearly. Use a constraint-first approach:

1. Collect all Constraints/Anti-patterns sections from the scan entries
2. Deduplicate — many constraints appear in both Phase 1 and Phase 2
3. Apply the acceptance gate — reject vague candidates
4. Group by trigger domain
5. Assign nugget IDs: `<domain>.<subsystem>.<constraint-slug>`

### Nugget acceptance gate

Reject any candidate that fails ANY of these 5 criteria:

1. **Triggerable** — clear when the rule applies
2. **Specific** — refers to a real repo convention or invariant
3. **Bounded** — fits one task family or subsystem
4. **Grounded** — links to concrete files or evidence
5. **Actionable** — an agent can follow it or a validator can check it

### Nugget format

Every nugget MUST follow this exact YAML structure:

```yaml
nugget_id: <domain>.<subsystem>.<constraint-slug>
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
  - <entry short IDs>
confidence: high | medium | low
```

### Nugget tags

```
["source:nugget", "nugget-session:<TILE_SESSION>", "nugget-domain:<domain>", "model:<MODEL_TAG>"]
```

### Nugget storage

Group nuggets by domain — **one diary entry per domain**, not per nugget.
Separate nuggets with `---` dividers.

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Nuggets: <domain> domain — <short description>",
  entry_type: "semantic",
  importance: <7-9>,
  tags: <nugget tags above>,
  content: "Domain: <domain>\nModel: <MODEL_TAG>\nNugget count: <N>\n\n---\n\n<nugget YAML>\n\n---\n\n<nugget YAML>\n..."
})
```

Record each nugget entry's ID.

### Compile handoff contract

The compile step should be able to consume consolidation outputs without
guessing hidden conventions.

For that reason, every consolidation run MUST leave behind compile-ready
artifacts with these properties:

1. **Tiles remain one entry per tile**
   - tagged with:
     - `source:tile`
     - `tile-session:<TILE_SESSION>`
     - `model:<MODEL_TAG>`
     - `tile-id:<tile-id>`
2. **Nuggets remain grouped by domain**
   - tagged with:
     - `source:nugget`
     - `nugget-session:<TILE_SESSION>`
     - `model:<MODEL_TAG>`
     - `nugget-domain:<domain>`
3. **Every nugget block inside a domain entry must be valid YAML**
   - separated by `---`
   - one block per nugget
4. **Every nugget block must include compileable core fields**
   - `nugget_id`
   - `statement`
   - `rule_kind`
   - `trigger`
   - `scope`
   - `verification`
   - `sources`
   - `confidence`
5. **Results file must include a compilation handoff section**
   - enough information for another agent to find the tile entries, nugget
     entries, scorecard entry, and current run identity

The consolidate skill is not responsible for writing `.legreffier/context/`.
Its responsibility is to leave behind outputs that the compile skill can read
deterministically.

### Load budget constraint

For any single task at runtime, load at most:

- 3-7 primary nuggets
- 1-2 optional caveat nuggets

If a task would trigger more than 9 nuggets, the trigger design is too noisy.

---

## Phase 4: Self-evaluation scorecard

After all tiles and nuggets are created, score your own output.

### Evaluation dimensions

| Dimension          | What it measures                    | How to score                                |
| ------------------ | ----------------------------------- | ------------------------------------------- |
| Constraint yield   | Nuggets accepted vs candidates      | `accepted / total_candidates`               |
| Specificity        | Concrete vs vague constraints       | 1-5 per nugget, averaged                    |
| Non-redundancy     | Avoids restating obvious things     | Count redundant nuggets                     |
| Trigger precision  | Triggers fire for right tasks only  | low / med / high                            |
| Merge quality      | Phase 1 + Phase 2 synthesis         | 1-5 per merged tile, averaged               |
| Token efficiency   | Content density                     | `total_constraints / total_tokens * 1000`   |
| Hallucination rate | Constraints not grounded in sources | Count ungrounded nuggets                    |
| Coverage           | Important constraints captured      | constraints found / constraints in sources  |
| Consistency        | Agreement with other runs           | Jaccard similarity (compute after all runs) |

### Scorecard format

Scorecard content MUST use this exact YAML structure:

```yaml
model: <MODEL_TAG>
tile_session: '<TILE_SESSION>'
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
notes: |
  <observations about tile merge quality, nugget specificity,
   coverage gaps, rejected candidates and why, etc.>
```

### Scorecard tags

```
["source:scorecard", "tile-session:<TILE_SESSION>", "scan-session:<SCAN_SESSION>", "model:<MODEL_TAG>"]
```

### Scorecard creation

```
entries_create({
  diary_id: "<DIARY_ID>",
  title: "Scorecard: <MODEL_TAG> consolidation run — <TILE_SESSION>",
  entry_type: "reflection",
  importance: 8,
  tags: <scorecard tags above>,
  content: "<scorecard YAML>"
})
```

---

## Phase 5: Write results file

Write a human-readable results file to:

```
docs/research/consolidation-results-<model-short-tag>.md
```

The results file MUST use this structure:

````markdown
# Consolidation Results — <Model Name>

Date: <YYYY-MM-DD>
Tile session: `<TILE_SESSION>`
Source: <N> scan entries from `scan-session:<SCAN_SESSION>`
Diary: `<DIARY_ID>`

---

## Tiles: <N> created (from <M> scan entries, <K> merges)

| #   | Tile ID   | Entry ID     | Sources merged     | Importance |
| --- | --------- | ------------ | ------------------ | ---------- |
| 1   | <tile-id> | `<short-id>` | <source short IDs> | <N>        |
| ... | ...       | ...          | ...                | ...        |

Average ~<N> tokens per tile.

---

## Nuggets: <N> accepted across <K> domains

| Domain   | Entry ID     | Count | Rule kinds |
| -------- | ------------ | ----- | ---------- |
| <domain> | `<short-id>` | <N>   | <summary>  |
| ...      | ...          | ...   | ...        |

### Nugget inventory

**<Domain> (<count>)**

- `<nugget_id>` — <one-line description>
- ...

---

## Key metrics

| Metric             | Value                                 |
| ------------------ | ------------------------------------- |
| Acceptance rate    | <N>/<M> (<ratio>)                     |
| Hallucination rate | <N>                                   |
| Redundancy         | <N> nuggets (<details>)               |
| Token efficiency   | <N> constraints per 1K tokens         |
| Compression        | ~<N>K source → ~<N>K tokens (<ratio>) |
| Coverage estimate  | <ratio>                               |
| Trigger precision  | <low/med/high>                        |
| Avg specificity    | <N>/5                                 |
| Avg merge quality  | <N>/5                                 |

---

## Observations

### Tile quality

<bullet points>

### Nugget quality

<bullet points>

### Coverage gaps

<bullet points>

---

## Scorecard entry

Entry ID: `<short-id>`

---

## Compilation handoff

```yaml
scan_session: '<SCAN_SESSION>'
tile_session: '<TILE_SESSION>'
model_tag: '<MODEL_TAG>'
tile_entry_query:
  tags:
    - 'source:tile'
    - 'tile-session:<TILE_SESSION>'
    - 'model:<MODEL_TAG>'
nugget_entry_query:
  tags:
    - 'source:nugget'
    - 'nugget-session:<TILE_SESSION>'
    - 'model:<MODEL_TAG>'
scorecard_entry_id: '<short-id>'
results_file: 'docs/research/consolidation-results-<model-short-tag>.md'
compile_ready:
  tiles: true
  nuggets: true
  scorecard: true
```
````

---

## Retrieval queries

```
# All tiles from this run
entries_search({
  query: "tile",
  tags: ["source:tile", "tile-session:<TILE_SESSION>", "model:<MODEL_TAG>"],
  diary_id: "<DIARY_ID>"
})

# All nuggets from a specific model run
entries_search({
  query: "nugget",
  tags: ["source:nugget", "nugget-session:<TILE_SESSION>", "model:<MODEL_TAG>"],
  diary_id: "<DIARY_ID>"
})

# All scorecards for cross-model comparison
entries_search({
  query: "scorecard",
  tags: ["source:scorecard", "scan-session:<SCAN_SESSION>"],
  diary_id: "<DIARY_ID>"
})
```

---

## Recovery after context compression

If context is compressed mid-run:

1. Read this skill file
2. Read `consolidation-approach.md` in this skill folder for the methodology
3. Run the retrieval queries above to find completed tiles/nuggets
4. Compare completed work against scan entries to find where to resume

---

## Permissions

This skill only needs LeGreffier MCP tools (entries_search, entries_create,
entries_get) and file write access for the results file.
