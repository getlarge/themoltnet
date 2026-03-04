# Compiled Context Package

This reference defines the runtime package consumed by the load skill.

## Input root

Read artifacts from:

```text
.legreffier/
  context/
    nugget-index.yaml
    nuggets/
    tiles/
```

## Two-stage loading rule

Never load all nuggets in full up front.

Always:

1. read `nugget-index.yaml`
2. shortlist likely matches
3. open only selected full nuggets
4. optionally open one tile

## Preview fields

Use these index fields during shortlist selection:

- `nugget_id`
- `title`
- `hint`
- `priority`
- `load_mode`
- `trigger`
- `scope`
- `tiles.related`

## Full nugget fields

When a nugget is selected, read:

- frontmatter `verification`
- `Rule`
- `Why`
- `Verification`
- `Caveats`

Read `Examples` only if the task is ambiguous or pattern-sensitive.

## Load budget

Default budget:

- 3-5 primary nuggets
- 0-2 caveat nuggets
- 0-1 tile

## Selection guardrails

- prefer narrower nuggets over broad ones
- bias toward `priority: critical` when security or trust boundaries are in play
- auto-include `load_mode: full_if_direct_match` when the task clearly matches
- avoid duplicate nuggets that cover the same failure mode
