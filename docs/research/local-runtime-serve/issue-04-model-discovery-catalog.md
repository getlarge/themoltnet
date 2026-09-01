# [#2064] feat(runtime-models): provider model discovery + catalog sync

> #2064 — see [design](./design.md).

## Summary

One shared discovery module that enumerates models from LLM providers, with
three consumers: `serve`'s model picker, the console's "add to team catalog"
action, and a scheduled admin job that keeps the **global**
`/runtime-models` catalog fresh.

## Scope

- `libs/` discovery module: per-provider listers — Ollama local
  (`GET /api/tags`), Ollama Cloud, OpenAI-compatible `GET /v1/models`
  generic, plus a static fallback for providers without a list endpoint.
  Input: provider config (`api`, `baseUrl`, key); output: normalized
  `{provider, model, displayName?, capabilities?}` rows compatible with the
  `/runtime-models` schema.
- `serve`: `GET /providers/:id/models` uses it (issue 1 consumes).
- Console: model picker + "add to team catalog" → existing team-scoped
  `POST /runtime-models` (409-safe on duplicates).
- `tools/` admin job (scheduled, admin credentials): sync curated global rows
  — global rows are API-read-only by design, so this is the only writer.
  Diff-based: create missing, patch changed `displayName`/`capabilities`,
  never hard-delete automatically (flag orphans for review).

## Invariants

- Discovery never logs or returns provider keys.
- Catalog remains advisory (profiles with uncataloged pairs still run —
  existing behavior).
- The admin job is not part of CI-gating anywhere.

## Acceptance

- [ ] Ollama local + cloud model lists render in the console without typing a
      model id.
- [ ] Team catalog add → profile creation flow uses the entry.
- [ ] Global sync job dry-run produces a reviewable diff; apply is
      idempotent.
