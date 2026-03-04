---
name: legreffier-load-nuggets
description: 'Load the most relevant scan-derived nuggets and optional tiles for a concrete task. Reads nugget hints first, then fully loads only the shortlisted artifacts.'
---

# LeGreffier Load Nuggets

Use this skill explicitly when a task should benefit from scan-derived repo
knowledge, but loading the full ruleset would add noise.

This skill is the **Load** stage of the context flywheel.

It does not create nuggets. It resolves which existing nuggets should be loaded
for the current task.

## Source of truth

Read first:

- `references/compiled-context-package.md`

Assume the repo exposes these artifacts:

- `.legreffier/context/nugget-index.yaml`
- `.legreffier/context/nuggets/*.md`
- `.legreffier/context/tiles/*.md`

If the paths differ, adapt, but keep the same loading pattern.

## Core rule

Never load all nuggets in full up front.

Always use two stages:

1. read the nugget index only
2. fully load only the shortlisted nuggets

## When to use

- Implementing a task in a repo with scan/consolidation artifacts
- Validating a spec or plan against repo-specific conventions
- Reviewing a change with task-scoped context
- Comparing `baseline` vs `with nuggets` in the pilot

## Inputs

Gather these before selection:

- task prompt
- optional target files or file globs
- optional diff or changed files
- optional task type if the user already gave one

If target files are unknown, infer them from the prompt or inspect the repo
lightly before loading full nuggets.

## Stage 1: Read the nugget index

Read `.legreffier/context/nugget-index.yaml` and inspect only:

- `nugget_id`
- `title`
- `hint`
- `priority`
- `load_mode`
- `trigger`
- `scope`
- `tiles.related`

Do not open full nugget bodies yet.

## Stage 2: Build a shortlist

Select the smallest useful set.

Target budget:

- 3-5 primary nuggets
- 0-2 caveat nuggets
- 0-1 tile

Use judgment based on:

- direct file/path overlap
- task class overlap
- prompt intent overlap
- subsystem overlap
- priority
- whether the nugget looks like a sharp failure-prevention rule

Prefer narrower nuggets over broad ones.

Prefer critical security and workflow nuggets when clearly in scope.

Do not select two nuggets that appear to say the same thing unless they cover
different failure modes.

## Stage 3: Fully load shortlisted nuggets

Open only the selected nugget files from `.legreffier/context/nuggets/`.

Read these sections:

- `Rule`
- `Why`
- `Verification`
- `Caveats`

Read `Examples` only if the task is ambiguous or pattern-sensitive.

## Stage 4: Tile backfill

Load a tile only if one of these is true:

- the task spans a subsystem, not just one narrow rule
- fewer than 2 strong nuggets matched
- the task is exploratory, architectural, or review-heavy
- the shortlisted nuggets reference the same tile

Never load more than one tile by default.

## Stage 5: Produce the task context pack

Before doing the actual task, summarize the selected context into a compact
bundle:

- task understanding
- selected nuggets
- one-line reason per nugget
- optional tile
- verification reminders

Keep the final bundle shorter than the combined raw artifact text when
possible. The goal is useful compression, not artifact dumping.

## Resolution heuristics

The model should make the final selection. Do not force a brittle deterministic
matcher.

Still, use these guardrails:

- if a nugget has `load_mode: full_if_direct_match` and the task clearly fits
  its path or subsystem, load it
- if a nugget has `priority: critical` and the task touches security, auth,
  permissions, secrets, writes, or transactions, bias toward inclusion
- if a nugget is only weakly related and another selected nugget already covers
  the same area, leave it out
- if the task is still unclear after reading hints, inspect target files before
  loading more nuggets

## Failure modes

Stop and adjust if:

- more than 7 nuggets seem necessary
- every nugget looks vaguely relevant
- the selected nuggets conflict
- no nugget looks convincingly relevant

In those cases:

1. tighten the task framing
2. inspect target files or diff
3. retry selection
4. load one tile if needed

## Output contract

The skill should leave behind a simple selection record in the working notes or
task output:

```yaml
task: <short task label>
selected_nuggets:
  - nugget_id: <id>
    why: <short reason>
  - nugget_id: <id>
    why: <short reason>
selected_tile: <tile-id or none>
skipped_candidates:
  - nugget_id: <id>
    why: <short reason>
```

This is mainly for evaluation. It makes later review easier without forcing a
full selector framework.
