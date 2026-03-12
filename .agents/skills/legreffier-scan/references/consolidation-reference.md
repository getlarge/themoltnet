# Consolidation Reference

Tiles, nuggets, merge rules, quality gates, multi-model evaluation protocol,
and retrieval queries. Cross-references the `legreffier-consolidate` skill
for the interactive consolidation execution playbook.

## Context tiles

A tile is a synthesized knowledge unit (~200-400 tokens) that merges related
scan entries into a single, scoped, task-ready block. Tiles answer:

> "What do I need to know about X to work on Y correctly?"

Tile entries use these tags:

```
source:tile
tile-session:<ISO-8601 timestamp — unique per consolidation run>
tile-scope:<scope, e.g., libs/database, apps/rest-api, misc>
tile-id:<scope>/<topic>
model:<model-short-tag>
```

The `model:` tag identifies which model produced the tile. The `tile-session:`
tag isolates runs — even re-runs with the same model get a new timestamp.

## Rule nuggets

A nugget is an atomic constraint (~120 tokens) with a trigger, scope, and
verification method. Nuggets are the output that a runtime control plane
can load selectively at task time.

Nugget entries use these tags:

```
source:nugget
nugget-session:<same timestamp as tile-session for this run>
nugget-domain:<domain, e.g., testing, security, workflow, database>
nugget-id:<domain>.<subsystem>.<constraint-slug>
model:<model-short-tag>
```

## Multi-model evaluation protocol

When comparing consolidation quality across models, all runs use the same
scan entries as fixed input. Only the consolidation step varies.

**Models under test** should be tagged with their canonical short names:

| Example model     | Short tag           |
| ----------------- | ------------------- |
| Claude Sonnet 4.6 | `claude-sonnet-4.6` |
| Claude Opus 4.6   | `claude-opus-4.6`   |
| GPT 5.2           | `gpt-5.2`           |
| GPT 5.3           | `gpt-5.3`           |

**Evaluation dimensions** per model run:

| Dimension          | What it measures                                  |
| ------------------ | ------------------------------------------------- |
| Constraint yield   | `accepted_nuggets / total_candidates`             |
| Specificity        | Are constraints concrete? (1-5 avg)               |
| Non-redundancy     | Count of nuggets restating obvious code structure |
| Trigger precision  | False-positive rate (low/med/high)                |
| Merge quality      | Phase 1 + Phase 2 synthesis quality (1-5 avg)     |
| Token efficiency   | `total_constraints / total_tokens`                |
| Hallucination rate | Count of constraints not in source entries        |
| Coverage           | `constraints_found / constraints_in_sources`      |
| Consistency        | Jaccard similarity with other models' nugget sets |

**Scorecard entry** — after each run, store a scorecard:

```
Tags: source:scorecard, tile-session:<run-timestamp>,
      model:<model-short-tag>, scan-session:<original-scan-session>
Entry type: reflection
Importance: 7
```

Content: YAML block with all dimension scores + free-text observations.

**Cross-model comparison** — after all runs, produce a comparison entry:

```
Tags: source:scorecard, scorecard-type:comparison,
      scan-session:<original-scan-session>
```

Content: constraint overlap matrix, quality ranking, cost-quality tradeoff,
failure modes per model.

## Retrieval queries for evaluation

```
# All tiles from a specific model
entries_search({
  query: "tile",
  tags: ["source:tile", "tile-session:<run-timestamp>", "model:<tag>"],
  diary_id: "<DIARY_ID>"
})

# All nuggets from a specific model
entries_search({
  query: "nugget",
  tags: ["source:nugget", "nugget-session:<run-timestamp>", "model:<tag>"],
  diary_id: "<DIARY_ID>"
})

# All scorecards for cross-model comparison
entries_search({
  query: "scorecard",
  tags: ["source:scorecard", "scan-session:<original-scan-session>"],
  diary_id: "<DIARY_ID>"
})
```

---

## Tile design

### Principles

1. **Minimal over comprehensive** — fewer tokens, higher density
2. **Concrete over abstract** — commands, paths, patterns, not prose
3. **Non-redundant with source docs** — don't restate what CLAUDE.md says
4. **Scoped** — each tile has a clear `applies_to` boundary
5. **Synthesis, not summary** — combine info from multiple entries into
   something no single doc provides

### Structure

```
tile_id: <scope>/<topic>
applies_to: <file glob or "**" for project-wide>
token_budget: 200-400 tokens

## <Topic>

[Synthesized content: constraints, patterns]

### Constraints
- MUST: ...
- NEVER: ...

### When this matters
[1-2 sentence trigger description]

Sources: [entry IDs]
```

### Merge rules (Phase 1 docs + Phase 2 code entries)

1. **Phase 2 wins on specifics** — actual function names, real constraints from code
2. **Phase 1 wins on context** — architecture rationale, design decisions
3. **Deduplicate constraints** — if both sources state the same rule, keep one instance
4. **Prefer concrete over abstract** — "repositories call `getExecutor(db)`" beats "uses repository pattern"

### Quality gate per tile

- [ ] Under 400 tokens of core content
- [ ] At least one MUST or NEVER constraint
- [ ] Clear `applies_to` scope
- [ ] Does not restate CLAUDE.md verbatim
- [ ] Synthesizes from sources, not just copies
- [ ] Source entry IDs included for provenance

---

## Nugget design

### What a nugget is

A single atomic constraint (~120 tokens): one rule, one trigger, one scope,
one verification method.

### Acceptance gate

Reject any candidate unless it passes ALL five:

1. **Triggerable** — clear when the rule applies
2. **Specific** — refers to a real repo convention or invariant
3. **Bounded** — fits one task family or subsystem
4. **Grounded** — links to concrete files or evidence
5. **Actionable** — an agent can follow it or a validator can check it

### Structure

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

Use a **constraint-first** approach — do not scan entries linearly:

1. Collect all `Constraints:` and `Anti-patterns:` sections from all entries
2. Deduplicate — the same constraint often appears in Phase 1 + Phase 2
3. Apply acceptance gate — reject vague or non-triggerable candidates
4. Group by trigger domain
5. Assign nugget IDs: `<domain>.<subsystem>.<constraint-slug>`

### Priority domains

| Domain   | Rationale                                    | Expected nuggets |
| -------- | -------------------------------------------- | ---------------- |
| testing  | Highest follow-through in practice           | 4-6              |
| security | High value, low prevalence in docs           | 5-8              |
| workflow | High follow-through                          | 3-5              |
| database | Error-prone (migrations, transactions, Keto) | 3-4              |

Target: 15-23 nuggets per model run.

### Storage format

One diary entry per domain group (not one per nugget — avoids entry explosion).
Each entry contains 3-8 nuggets in YAML format.

### Load budget

Per task: at most 3-7 primary nuggets + 1-2 caveat nuggets. If a task would
trigger more than 9 nuggets, the trigger design is too noisy.

---

## Execution sequence

```
For each model M:

  Phase 1: Tiles
    ├── Read entries in merge groups
    ├── Synthesize tile content
    ├── Apply quality gate
    ├── Create tile entries (tagged source:tile, model:M)
    └── Log tile IDs

  Phase 2: Nuggets
    ├── Collect all Constraints/Anti-patterns from entries
    ├── Deduplicate
    ├── Apply acceptance gate
    ├── Group by trigger domain
    ├── Format as YAML nuggets
    ├── Create nugget entries (tagged source:nugget, model:M)
    └── Log nugget IDs

  Phase 3: Scorecard
    ├── Score on evaluation dimensions
    ├── Create scorecard entry (tagged source:scorecard, model:M)
    └── Log observations

After all runs:
  Phase 4: Cross-model comparison
    ├── Constraint overlap matrix
    ├── Quality ranking
    ├── Failure modes per model
    └── Create comparison summary entry
```

### Recovery after context compression

```
# Find completed tiles for current model run
entries_search({
  tags: ["source:tile", "tile-session:<current-run-timestamp>", "model:<model-tag>"],
  diary_id: "<DIARY_ID>"
})

# Find completed nuggets
entries_search({
  tags: ["source:nugget", "nugget-session:<current-run-timestamp>", "model:<model-tag>"],
  diary_id: "<DIARY_ID>"
})
```

Compare returned IDs against the planned tile/nugget list to determine
where to resume.
