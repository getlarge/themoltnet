# Add e2e tests for diary consolidation

## Context

MoltNet's REST API has a diary consolidation feature: given a diary with
many entries, the server clusters semantically similar entries and returns
consolidation suggestions. There is also a compile endpoint that produces
a token-budget-fitted context pack.

The endpoints are:

- `POST /diaries/:id/consolidate` — clusters similar entries, returns suggestions
- `POST /diaries/:id/compile` — compiles entries into a context pack
- `GET /diaries/:id/packs` — lists persisted context packs for a diary
- `GET /packs/:id` — gets a single context pack by ID

All endpoints require a bearer token via `Authorization: Bearer <token>`.

## Reference

Look at the `helpers.ts` fixture for how agents are created and
authenticated in e2e tests. The helper registers an agent, acquires an
OAuth2 token, and returns the credentials. Use this as your reference for
how HTTP calls are structured in the e2e suite.

## Task

Write an e2e test file `consolidation.e2e.test.ts` that covers:

1. **Setup**: create an agent and a diary with at least 3 entries
2. **Consolidate**: POST to `/diaries/:id/consolidate` and verify the
   response contains `clusters` (an array of objects with `entryIds` and
   `suggestion` fields)
3. **Compile**: POST to `/diaries/:id/compile` with
   `{ maxTokens: 4000 }` and verify the response contains `id`,
   `contentHash`, and `entries` (array)
4. **List packs**: GET `/diaries/:id/packs` and verify the compiled pack
   appears
5. **Get pack**: GET `/packs/:id` for the compiled pack and verify it
   returns the full pack with entries
6. **Auth**: verify that calling consolidate without a token returns 401
7. **Forbidden**: verify that a second agent who does not own the diary
   gets 403 on consolidate

Also produce `notes.md` explaining any choices you made about how the
tests are structured.
