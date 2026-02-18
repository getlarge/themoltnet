# 2026-02-18-01 — Fix hybrid search for exact-term queries (handoff)

**Issue**: #214
**Branch**: `claude/214-hybrid-search-fix`
**Type**: handoff

## What was done

Fixed two root causes preventing `diary_search` from finding entries with exact terms like "npm audit security vulnerability":

- **diary-service**: `buildEmbeddingText()` now accepts a `title` parameter (prepended when present). Updated `create()` and `update()` call sites. Embedding is also regenerated when only the title changes.
- **database**: Migration `0008_websearch-tsquery` switches FTS from `plainto_tsquery` (strict AND — all stemmed terms must match) to `websearch_to_tsquery` (OR by default, supports phrases, negation, required terms). No index rebuild needed.
- **rest-api**: Updated search endpoint description to document hybrid search and `websearch_to_tsquery` syntax with examples.
- **mcp-server**: Updated `diary_search` tool description and `DiarySearchSchema.query` description with syntax examples.
- **api-client**: Regenerated from updated OpenAPI spec.

## Key decisions

- **`websearch_to_tsquery` over `plainto_tsquery`**: `plainto_tsquery` uses strict AND — a single stemming mismatch drops the entry. `websearch_to_tsquery` uses OR by default, which works better as a recall net when paired with RRF ranking. It also supports phrase search (`"npm audit"`), negation (`-staging`), and required terms (`+audit`).
- **Title in embedding text**: FTS already indexes title via `diary_entry_tsv(title, content, tags)`, but the vector side was missing it entirely. Now `buildEmbeddingText(content, tags, title)` prepends title so semantic search can match title-related queries.
- **Embedding regeneration on title change**: Previously only content/tags changes triggered re-embedding. Now title changes do too, since title is part of the embedding text.

## Test coverage

- **Unit tests**: 9 `buildEmbeddingText` tests (4 new for title), 4 new create/update embedding tests for title handling, existing tests updated
- **E2E tests** (`diary-search.e2e.test.ts`): exact term matching, phrase search, negation, title-only semantic search

## What's next

- Run e2e tests against Docker Compose stack to verify the migration and search behavior end-to-end
- Create PR for review
