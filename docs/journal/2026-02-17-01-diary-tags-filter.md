# 2026-02-17-01 — Diary tags filter (handoff)

**Issue**: #213
**Branch**: `claude/213-diary-tags-filter`
**Type**: handoff

## What was done

Added `tags` filter parameter to `diary_search` and `diary_list` across the full stack:

- **diary-service**: Extracted `buildEmbeddingText()` pure function that appends `tag:<name>` lines to content before embedding, improving semantic search. Added `tags?: string[]` to `SearchInput`, `ListInput`, and `DiaryRepository.search()`.
- **database**: Added `@>` (contains-all) operator for tags filter in `list()` and `search()` Drizzle queries. Created migration `0007` to update `diary_search()` SQL function from `&&` (overlap/ANY) to `@>` (contains/ALL).
- **rest-api**: `GET /diary/entries?tags=a,b` (comma-separated) and `POST /diary/search` body `tags` array.
- **mcp-server**: `diary_list` and `diary_search` tools accept `tags` input.
- **models**: `DiarySearchSchema` includes `tags` array.
- **api-client**: Regenerated from updated OpenAPI spec.

## Key decisions

- **`@>` not `&&`**: The original `diary_search()` SQL function used `&&` (overlap) for tags, which means "any tag matches" (OR). Changed to `@>` (contains) so filtering by `['deploy', 'production']` requires the entry to have BOTH tags (AND). This required a new migration.
- **`buildEmbeddingText` as pure function**: Extracted from the create/update methods so tag names are included in the embedding vector. This means searching for "hotfix" will find entries tagged `hotfix` even if the word doesn't appear in content.
- **Comma-separated vs array**: List endpoint uses `?tags=a,b` (comma-separated string, split server-side). Search endpoint uses JSON array in body. Consistent with how the API already handles query params vs body.

## Test coverage

- **Unit tests**: 5 `buildEmbeddingText` tests, 7 tags filter tests in diary-service, 6 REST API route tests, 4 MCP handler tests
- **E2E tests** (9 tests, all green against Docker Compose stack):
  - List: single tag, multiple AND, nonexistent, omitted
  - Search: tag match, conflicting query+tag, nonexistent
  - Embedding quality: semantic search for "hotfix" finds entry where tag is only metadata

## Discovery: port collision in e2e

E2E tests failed initially because a Vite dev server (SIMPL project) was listening on port 8080, shadowing the Docker container. Requests went to the Vue app instead of the REST API. Killing the Vite process resolved it. Worth noting for future e2e debugging.

## What's next

- PR ready for review
- Consider adding a GIN index on `diary_entries.tags` if tag filtering becomes a hot path
