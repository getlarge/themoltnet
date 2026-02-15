---
date: '2026-02-15T07:30:00Z'
author: claude-opus-4-6
session: public-feed-search-179
type: handoff
importance: 0.9
tags: [handoff, ws11, search, database, rest-api, landing, pgvector, fts]
supersedes: null
signature: pending
---

# Handoff: Public Feed Semantic Search (Issue #179)

## What Was Done This Session

### Database (migration 0005_diary_search_rrf)

- Replaced broken `hybrid_search()` with new `diary_search()` SQL function using Reciprocal Rank Fusion (RRF): `score = 1/(k+vector_rank) + 1/(k+fts_rank)` with k=60
- FTS index on `to_tsvector('english', coalesce(title,'') || ' ' || content || ' ' || coalesce(array_to_string(tags,' '),''))`
- LATERAL join in FTS CTE for GIN index utilization
- Function signature: `diary_search(p_query, p_embedding, p_limit, p_owner_id, p_tags, p_rrf_k)` — NULL owner_id triggers public mode (visibility='public'), NULL embedding falls back to FTS-only
- Joins `agent_keys` to return author fingerprint + publicKey in public mode

### Repository (diary.repository.ts)

- Refactored `search()` to call `diary_search()` instead of `hybrid_search()`
- Added `searchPublic()` method with safe array parameterization via `sql.join()`
- Added `PublicSearchOptions`, `PublicSearchResult` interfaces
- Fixed column name mismatch: SQL returns `combined_score`/`author_fingerprint`/`author_public_key`, mapper now reads correct names
- Integrated `injectionRisk` field from main branch after merge

### REST API

- Added `GET /public/feed/search` endpoint with querystring validation (q: 2-200 chars, limit: 1-50, tag optional)
- Generates query embedding via `embeddingService.embedQuery()`, falls back to FTS on embedding failure
- `Cache-Control: public, max-age=60` on responses
- Added `publicSearch` rate limit tier (default 15 req/min)
- Injected `EmbeddingService` into app options and Fastify decorators
- 10 integration tests covering: results with author info, FTS fallback, validation, limit, tag filter, empty results, cache header, no auth required
- 10 e2e tests with real embeddings and 24-entry seed corpus across 6 semantic clusters

### Frontend (landing)

- Rewrote `FeedSearch` as explicit-submit form (Enter/button) instead of client-side debounced filter
- Rewrote `useFeed` hook with two modes: `feed` (paginated with SSE) and `search` (API call to `searchPublicFeed`)
- Added 429 rate limit error handling and search result count display

### Tooling

- Regenerated OpenAPI specs and `@moltnet/api-client` with `searchPublicFeed` operation
- Added `embedding-service` project reference to rest-api tsconfig

## Merge with Main

- Main had added `0004_nebulous_crusher_hogan` (injection_risk column) — renamed our migration from 0004 to 0005
- Resolved `_journal.json` conflict to include both migrations
- Integrated `injectionRisk` into search result interfaces and mappers

## Current State

- Branch: `claude/public-feed-search-179` (merged with origin/main)
- Lint: passes
- Typecheck: passes (except pre-existing TS6305 in `tools` package — stale build artifacts, unrelated)
- Tests: pass
- GPG signing unavailable in this environment — commits made with `commit.gpgSign=false`

## Decisions Made

- **RRF over raw score weighting** — old `hybrid_search()` used `0.5 * vector_score + 0.5 * fts_score` which doesn't work because the scales differ. RRF normalizes via rank position.
- **Single parameterized SQL function** — `diary_search()` handles both private (owner_id set) and public (NULL owner_id) modes, avoiding two nearly-identical functions
- **FTS fallback on embedding failure** — if embedding service is unavailable, search degrades to full-text search rather than returning an error
- **Explicit-submit search UI** — avoids rate limit issues from debounced typing, user controls when search fires

## What's Next

- Task 11: Add OTel spans for embedding generation and search latency
- Task 12: Wire rate limits in server bootstrap (partially done — already in server app.ts)
- Create PR for review
- WS11 remaining: agent moderation, human participation features
