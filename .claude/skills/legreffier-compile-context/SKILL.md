---
name: legreffier-compile-context
description: 'Compile consolidation outputs into a runtime-ready .legreffier/context package with nugget index, full nugget files, and tiles.'
---

# LeGreffier Compile Context

Use this skill explicitly after scan and consolidation have already completed.

This skill is the bridge between:

- consolidation outputs optimized for analysis
- a compiled context package optimized for task-time loading

## Source of truth

Read first:

- `references/compiled-context-package.md`

Typical inputs:

- a consolidation results file with a `Compilation handoff` section
- tile entries for one `tile_session`
- nugget domain entries for one `tile_session`
- the scorecard entry for that run
- optional cross-model comparison outputs when available

Typical output:

- `.legreffier/context/nugget-index.yaml`
- `.legreffier/context/nuggets/*.md`
- `.legreffier/context/tiles/*.md`

## Core rule

Do not manually maintain the nugget index and the nugget files separately.

The compiled package should be regenerated from consolidation outputs whenever
new scan/consolidation results are available.

## Compilation flow

### Stage 1: Gather consolidation inputs

Start from one explicit consolidation handoff.

Collect:

- `scan_session`
- `tile_session`
- `model_tag`
- tile entries identified by the handoff query
- nugget entries identified by the handoff query
- scorecard entry identified by the handoff
- optional cross-model comparison data

Do not infer a run boundary by scanning the whole diary. Use the handoff data
from one consolidation run.

If a cross-model comparison input exists, do not rely on shorthand labels like
`4/4` or `2/4` unless the input explicitly defines them.

Treat cross-model agreement as structured data with:

- `agreement_count`
  - how many model runs produced an equivalent nugget
- `model_count`
  - how many total model runs were compared
- `supporting_models`
  - optional list of model identifiers

Example:

```yaml
nugget_id: testing.project.aaa-pattern
agreement_count: 4
model_count: 4
supporting_models:
  - claude-sonnet-4.6
  - opus-4.6
  - gpt-5.2
  - gpt-5.3
```

If cross-model comparison exists, use an explicit compile profile.

Default profile: `runtime-safe`

Include automatically:

- all nuggets where `agreement_count == model_count`, as long as they still
  pass the nugget acceptance gate
- nuggets where `agreement_count == model_count - 1` only if they also have:
  - `confidence: high` or equivalent reviewer approval
  - clear trigger metadata
  - bounded scope
  - concrete verification

Exclude by default:

- nuggets where `agreement_count <= model_count - 2`
- any nugget with vague trigger or vague verification, even if agreement is high

Allow manual promotion only when a lower-agreement nugget is:

- tied to a critical security or data-integrity boundary
- strongly grounded in source files or docs
- missing from higher-agreement sets because of phrasing differences rather than
  real disagreement

If a near-consensus nugget overlaps a full-consensus nugget, keep only the
narrower or more actionable one unless they cover different failure modes.

### Stage 2: Normalize nuggets

Parse nugget candidates from the nugget domain entries.

Each nugget entry should contain one YAML block per nugget, separated by `---`.

For each accepted nugget candidate:

1. assign one stable `nugget_id`
2. write one full nugget file
3. keep the rule atomic
4. write a short `hint` for preview-time selection
5. set `priority` and `load_mode`
6. preserve provenance and agreement

Do not combine multiple independent constraints into one nugget just because
they came from the same consolidation block.

## Stage 3: Normalize tiles

Write or refresh one tile file per accepted tile entry from the same handoff.

Tiles should stay broader than nuggets. If a tile starts becoming a rules dump,
split more of that content into nuggets instead.

## Stage 4: Generate nugget index

Build `.legreffier/context/nugget-index.yaml` from nugget file frontmatter.

The index should contain preview fields only:

- `nugget_id`
- `title`
- `hint`
- `priority`
- `load_mode`
- `trigger`
- `scope`
- `tiles.related`
- `provenance`

Do not duplicate the full nugget body in the index.

## Stage 5: Refresh handling

If a newer consolidation run supersedes an older one:

- regenerate the full package
- preserve stable `nugget_id`s when the rule meaning did not change
- update provenance and refresh session
- drop nuggets that no longer meet the acceptance bar

## Review gate

Before considering the package ready, check:

- every full nugget has a useful `hint`
- every hint is shorter and weaker than the full nugget body
- no two nuggets are obvious duplicates
- path and task triggers are not overly broad
- the index can be read without loading the whole package

## Output summary

Leave behind a short compile summary:

```yaml
compile_session: <timestamp>
source_scan_session: <timestamp>
source_tile_session: <timestamp>
source_model_tag: <model tag>
nuggets_written: <count>
tiles_written: <count>
index_written: true
included_agreement:
  - agreement_count: 4
    model_count: 4
  - agreement_count: 3
    model_count: 4
excluded_agreement:
  - agreement_count: 2
    model_count: 4
  - agreement_count: 1
    model_count: 4
notes:
  - <important change or ambiguity>
```
