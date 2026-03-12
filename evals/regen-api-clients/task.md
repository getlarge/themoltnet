# Task: Regenerate API clients after route changes

## Context

The `excludeTags` query parameter was added to `GET /diaries/:diaryId/entries` in the REST API source code, but the generated API clients are stale — they don't include this new parameter.

## What to do

Regenerate all generated API clients so they reflect the current route definitions. Make sure nothing is missed.

## Constraints

- Do NOT manually edit generated files — use the project's generation scripts
- All generated clients must reflect the `excludeTags` parameter on the entry list endpoint
