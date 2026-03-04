# Compiled Context Package

This reference defines the runtime package produced by the compile skill.

## Output root

Write compiled artifacts under:

```text
.legreffier/
  context/
    nugget-index.yaml
    nuggets/
    tiles/
    exports/
```

## Intent

The compiled package is the task-time interface between:

- scan and consolidation outputs
- runtime loading by agents

It is allowed to be regenerated wholesale when a newer consolidation run exists.

## Expected consolidation handoff

The compile step should start from one explicit consolidation handoff, not from
an open-ended diary search.

The expected handoff payload contains:

- `scan_session`
- `tile_session`
- `model_tag`
- `tile_entry_query`
- `nugget_entry_query`
- `scorecard_entry_id`
- `results_file`

That handoff may live in a results file or another run summary artifact, but it
must be explicit enough that another agent can fetch the exact run outputs.

## Artifact types

### `nugget-index.yaml`

Cheap preview index for shortlist selection. It should contain:

- `nugget_id`
- `title`
- `hint`
- `priority`
- `load_mode`
- `trigger`
- `scope`
- `tiles.related`
- `provenance`

It must not contain the full nugget body.

### `nuggets/*.md`

One full nugget per file, with YAML frontmatter plus stable body sections:

- `Rule`
- `Why`
- `Verification`
- `Examples`
- `Caveats`

Required frontmatter:

- `nugget_id`
- `title`
- `hint`
- `priority`
- `load_mode`
- `trigger`
- `scope`
- `verification`
- `provenance`

### `tiles/*.md`

One broader subsystem briefing per file, with YAML frontmatter and a readable
body.

Required frontmatter:

- `tile_id`
- `applies_to`
- `task_classes`
- `source_entries`
- `confidence`

## Load mode values

- `full_if_selected`
- `full_if_direct_match`
- `hint_only`

## Compile rules

- The index is derived from nugget frontmatter, not hand-maintained separately
- Preserve stable `nugget_id` values when rule meaning stays the same
- Keep nuggets atomic; split independent constraints into separate files

## Agreement fields

If the compile step consumes cross-model comparison output, every candidate
nugget should expose agreement explicitly.

Required meanings:

- `agreement_count`
  - the number of model runs that produced an equivalent nugget
- `model_count`
  - the total number of model runs compared
- `supporting_models`
  - optional list of model identifiers that supported the nugget

Avoid shorthand labels like `4/4` unless they are also expanded into these
fields.

## Default compile policy

Use `runtime-safe` as the default compile profile.

### Auto-include

- all nuggets where `agreement_count == model_count`, as long as they still
  pass the nugget acceptance gate
- nuggets where `agreement_count == model_count - 1` only if they also have:
  - clear trigger metadata
  - bounded scope
  - concrete verification
  - high confidence or explicit reviewer approval

### Auto-exclude

- nuggets where `agreement_count <= model_count - 2`
- any nugget whose trigger is too broad to support surgical loading
- any nugget whose verification is too vague to check later

### Manual promotion

A lower-agreement nugget may still be compiled if all of these are true:

- it protects a critical security, auth, write-path, or data-integrity boundary
- provenance is strong
- the disagreement is about wording or abstraction level, not rule substance
- no stronger higher-agreement nugget already covers the same failure mode

### Overlap rule

If two candidate nuggets overlap:

- keep the narrower one when it is clearly more actionable
- keep both only if they guard different failure modes
