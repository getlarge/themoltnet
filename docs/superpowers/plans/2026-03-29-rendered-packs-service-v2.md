# Rendered Packs & Context Pack Service — V2 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce rendered packs as a **separate entity** (not a context_packs variant) with CID-based immutability, append-only versioning, and shared GC logic — plus a `@moltnet/context-pack-service` library that centralizes pack creation logic.

**Issue:** #529

---

## Lessons from V1 (what went wrong)

1. **Rendered packs are NOT context packs.** V1 tried to shoehorn rendered packs into the `context_packs` table with a `packType: 'rendered'` discriminator. This was fundamentally wrong:
   - Rendered packs store **markdown content**, not DAG-CBOR entry envelopes
   - They don't need `context_pack_entries` membership rows
   - The partial unique index on `sourcePackId` within the same table was a hack
   - PostgreSQL rejects `ALTER TYPE ADD VALUE` in the same transaction as queries referencing the new value

2. **`git add -A` during merge resolution** committed a `.moltnet` symlink (credentials). Never use `git add -A` in worktrees with credential symlinks.

3. **Subagents need explicit file boundaries.** Parallel subagents overwrote each other's work when they ran `pnpm install` or created files in the same workspace.

---

## What's reusable from V1

The **`@moltnet/context-pack-service`** library code from the old branch (`feat/rendered-packs-service`, commit `f4c6d94d`) is correct and reusable:

- `src/types.ts` — `SelectedEntry`, `ResolvedSelection`, `FittedEntry`, `FitResult`, `FitStats`, `CreateCustomPackInput`
- `src/entry-loader.ts` — `loadSelectedEntries()` with `EntryFetcher` abstraction
- `src/entry-fitter.ts` — `fitEntries()` with progressive compression
- `src/pack-renderer.ts` — `renderPackToMarkdown()` (TS port of Go CLI)
- `src/context-pack.service.ts` — `createCustomPack()` with Keto cleanup (remove `createRenderedPack` — will be rewritten)
- All unit tests (19 total, minus the 2 `createRenderedPack` tests)

Copy these from the old worktree at `.worktrees/rendered-packs/libs/context-pack-service/`.

**Do NOT copy:** `RenderedParams` from crypto-service, `sourcePackId` schema changes, provenance `rendered_from` edge, render route, MCP tool, Go CLI `pack render` — all need redesign.

---

## Architecture: Rendered Packs as Separate Entity

### Why CIDs are needed

Rendered packs will be bound to eval runs/sessions. An eval score is meaningless if the artifact it scored can change. CID-based immutability ensures:

- Eval results reference an exact, verifiable artifact
- Re-rendering creates a new version (new CID), not a silent replacement
- Provenance traversal: rendered pack CID → source pack CID → entry CIDs (full Merkle DAG)

### New table: `rendered_packs`

```
rendered_packs
├── id: uuid PK
├── pack_cid: varchar(100) NOT NULL UNIQUE (CIDv1, dag-cbor, sha2-256, base32lower)
├── source_pack_id: uuid FK → context_packs.id ON DELETE CASCADE (NOT NULL)
├── diary_id: uuid FK → diaries.id (NOT NULL, denormalized for query convenience)
├── content: text NOT NULL (the rendered markdown)
├── content_hash: varchar(100) NOT NULL (SHA-256 hex of content)
├── render_method: varchar(100) NOT NULL (e.g. 'pack-to-docs-v1')
├── total_tokens: integer NOT NULL
├── created_by: uuid NOT NULL
├── pinned: boolean DEFAULT false
├── expires_at: timestamp with time zone DEFAULT (now() + interval '7 days')
├── created_at: timestamp with time zone DEFAULT now()
└── updated_at: timestamp with time zone DEFAULT now()
```

**Key constraints:**

- `UNIQUE(pack_cid)` — content-addressed, no duplicates
- `INDEX(source_pack_id)` — multiple rendered packs per source (append-only versioning)
- `ON DELETE CASCADE` on `source_pack_id` — source pack GC'd → rendered packs cleaned automatically
- FK to `diaries.id` — denormalized from the source pack for direct diary-scoped queries

**Append-only versioning:** Re-rendering creates a new row with a new CID. The latest version for a source pack is resolved by `ORDER BY created_at DESC LIMIT 1`. No `latest` flag needed — temporal ordering is sufficient and avoids flag consistency issues.

### CID computation: `rendered_pack:v1` envelope

New DAG-CBOR envelope in `libs/crypto-service/src/rendered-pack-cid.ts` (separate from `pack-cid.ts`):

```typescript
interface RenderedPackEnvelopeInput {
  sourcePackCid: string; // IPLD CID link to source pack
  renderMethod: string; // e.g. 'pack-to-docs-v1'
  contentHash: string; // SHA-256 hex of rendered markdown
}

// Envelope schema:
// {
//   v: 'moltnet:rendered-pack:v1',
//   sourcePackCid: CID (IPLD link),
//   renderMethod: string,
//   contentHash: string,
// }
```

This gives Merkle DAG traversal: `rendered pack CID → sourcePackCid (IPLD link) → entry CIDs`.

**Not reusing `PackEnvelopeInput`**: rendered packs don't have entries, diaryId, or packType in their envelope. A separate envelope type keeps both schemas clean.

### GC: same logic as context packs

Rendered packs share the same `pinned` + `expiresAt` GC pattern as `context_packs`:

- Default TTL: 7 days from creation
- `pinned: true` → `expiresAt: null`, exempt from GC
- `listExpiredUnpinned()` finds candidates where `pinned = false AND expires_at <= now`
- Partial index on `expires_at WHERE pinned = false`
- Additionally, `ON DELETE CASCADE` from `source_pack_id` cleans up rendered packs when their source is GC'd

### Provenance

Provenance for rendered packs is a simple FK join: `rendered_packs.source_pack_id → context_packs.id`. The provenance graph builder includes rendered packs as nodes connected by a `rendered_from` edge. The CID link in the DAG-CBOR envelope provides cryptographic provenance; the FK provides query-time joins.

### API surface

| Method | Path                  | Purpose                                              |
| ------ | --------------------- | ---------------------------------------------------- |
| POST   | `/packs/:id/render`   | Create rendered pack for a source pack (append-only) |
| GET    | `/rendered-packs/:id` | Get a rendered pack by ID                            |
| GET    | `/packs/:id/rendered` | Get the latest rendered pack for a source pack       |

The render endpoint accepts `preview: true` to return markdown without persisting.

### Resolve (for #518)

When #518's `packs_resolve` needs rendered content:

1. Look up `rendered_packs` by `source_pack_id` (latest by `created_at`)
2. If found, return `content` (the markdown) + `pack_cid` for eval binding
3. If not found, fall back to raw pack export (entry content concatenation)

---

## Implementation Tasks

### Task 1: Copy service lib from V1 (cherry-pick clean parts)

Copy `libs/context-pack-service/` from `.worktrees/rendered-packs/` to `.worktrees/rendered-packs-v2/`. Remove:

- `CreateRenderedPackInput`, `RenderedPackResult` from types.ts
- `createRenderedPack` method from service
- `findRenderedBySourcePackId`, `clearSourcePackId` from deps interface
- Related test cases

Keep: scaffold, entry-loader, entry-fitter, pack-renderer, `createCustomPack`, all passing tests.

Run `pnpm install`, typecheck, test.

### Task 2: Add rendered pack CID computation

- Create `libs/crypto-service/src/rendered-pack-cid.ts`
- `RenderedPackEnvelopeInput` interface
- `buildRenderedPackEnvelope()` → DAG-CBOR bytes
- `computeRenderedPackCid()` → CIDv1 string
- Export from `libs/crypto-service/src/index.ts`
- Unit tests with deterministic fixtures

### Task 3: Add `rendered_packs` table to schema

- New table in `libs/database/src/schema.ts`
- Type exports: `RenderedPack`, `NewRenderedPack`
- Generate migration: `pnpm db:generate`
- **Verify migration SQL**: should be a simple `CREATE TABLE` with FK + indexes, no enum changes

### Task 4: Rendered pack repository

- Create `libs/database/src/repositories/rendered-pack.repository.ts`
- Methods: `create`, `findById`, `findByCid`, `findLatestBySourcePackId`, `listBySourcePackId`, `listByDiary`, `listExpiredUnpinned`, `pin`, `unpin`, `updateExpiry`, `deleteById`
- Export from `libs/database/src/index.ts`

### Task 5: Add `createRenderedPack` to service

- New method on `ContextPackService` using the rendered pack repository
- Input: `sourcePackId`, `renderedMarkdown`, `renderMethod`, `createdBy`, `pinned?`
- Logic: find source pack → SHA-256 content hash → compute CID → estimate tokens → create rendered pack
- Keto: rendered packs inherit diary permissions from source pack (no new Keto namespace)
- Unit tests with mocked deps

### Task 6: REST route — `POST /packs/:id/render` + GET endpoints

- TypeBox schemas for request/response
- Route handler with permission checks
- `preview: true` returns markdown + metadata without persisting (200)
- Normal mode creates rendered pack (201)
- `GET /rendered-packs/:id` and `GET /packs/:id/rendered` (latest)
- Wire rendered pack repository into Fastify app
- Route tests

### Task 7: Wire into app.ts + Fastify type augmentation

- Decorate with `renderedPackRepository`
- Update `ContextPackService` deps to include rendered pack repository
- Type augmentation
- Update Dockerfile to COPY `libs/context-pack-service/package.json` and `libs/context-distill/package.json`

### Task 8: Provenance graph — `rendered_from` edge

- Add `rendered_from` to `libs/models/src/provenance-graph.ts`
- Update `apps/rest-api/src/routes/pack-provenance.ts` to walk rendered packs
- Update `apps/landing/src/provenance/` viewer to render the new edge kind

### Task 9: OpenAPI + API client regeneration (TS + Go)

- `pnpm run generate:openapi`
- `pnpm --filter @moltnet/api-client run generate`
- `cd cmd/moltnet-api-client && go generate ./...`

### Task 10: MCP tool — `packs_render`

- Add to `apps/mcp-server/src/pack-tools.ts`
- Schema + handler + registration + tests

### Task 11: Go CLI — `pack render` with `--preview`

- `runPackRenderCmd` in `cmd/moltnet/pack.go`
- `newPackRenderCmd` in `cmd/moltnet/cobra_pack.go`
- `--preview` calls API with `preview: true`
- Normal mode: fetch → render locally → POST to persist
- Deprecate `pack export`

### Task 12: Refactor custom pack route to use service

- Delegate `POST /diaries/:id/packs` to `contextPackService.createCustomPack()`
- Remove inline `materializeCustomPack`, `loadSelectedEntries`, `fitCustomPackEntries` from route

### Task 13: Full validation + E2E tests

- `pnpm run validate`
- E2E test for rendered pack lifecycle (Docker Compose stack)
- Go build + test

---

## What NOT to do

- Do NOT add `'rendered'` to `packTypeEnum` — rendered packs are a separate table
- Do NOT add `sourcePackId` to `context_packs` — the FK is on `rendered_packs`
- Do NOT reuse `PackEnvelopeInput` for rendered packs — they have their own envelope schema
- Do NOT use `UNIQUE(source_pack_id)` — append-only versioning means multiple rendered packs per source
- Do NOT use `git add -A` in worktrees — stage specific files
- Do NOT dispatch parallel subagents that touch the same workspace directory
