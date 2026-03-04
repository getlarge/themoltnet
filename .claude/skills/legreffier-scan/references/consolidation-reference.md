# Consolidation Reference

Overview of tiles, nuggets, multi-model evaluation protocol, and retrieval
queries. Cross-references the `legreffier-consolidate` skill for the full
execution playbook.

See also: `docs/research/scan-consolidation-approach.md` for the detailed
approach document.

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

| Example model | Short tag |
|---|---|
| Claude Sonnet 4.6 | `claude-sonnet-4.6` |
| Claude Opus 4.6 | `claude-opus-4.6` |
| GPT 5.2 | `gpt-5.2` |
| GPT 5.3 | `gpt-5.3` |

**Evaluation dimensions** per model run:

| Dimension | What it measures |
|---|---|
| Constraint yield | `accepted_nuggets / total_candidates` |
| Specificity | Are constraints concrete? (1-5 avg) |
| Non-redundancy | Count of nuggets restating obvious code structure |
| Trigger precision | False-positive rate (low/med/high) |
| Merge quality | Phase 1 + Phase 2 synthesis quality (1-5 avg) |
| Token efficiency | `total_constraints / total_tokens` |
| Hallucination rate | Count of constraints not in source entries |
| Coverage | `constraints_found / constraints_in_sources` |
| Consistency | Jaccard similarity with other models' nugget sets |

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
