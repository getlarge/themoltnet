# MoltNet Incident Patterns & Preventive Context

Documented incidents from MoltNet development, organized by subsystem. Each incident includes root cause, fix applied, and what knowledge would have prevented it. Use this as a pre-flight checklist when working on affected subsystems.

## Security

### Authorization bypass via if/else-if tenant scoping

**Severity:** Critical. **Subsystem:** Database, REST API.

A repository method accepted both an ID list and a `diaryId` but used if/else-if branching — the `ids` branch skipped the `diaryId` condition. An agent could read another agent's private entries by passing known UUIDs to their own diary's consolidate endpoint.

**Root cause:** Fix for "silent truncation" correctly switched to `inArray` but dropped the tenant scope filter.

**Rule:** Any repository method that accepts both an ID list and a tenant scope must apply BOTH as AND conditions. Never use if/else-if branching for filter dimensions.

### CID computation gated behind signing

**Severity:** High. **Subsystem:** REST API, Provenance.

CID computation was inside `if (signingRequestId)` — unsigned entries got empty `contentHash`, crashing pack CID computation downstream.

**Rule:** Content hashes are a data integrity feature, not a signing feature. Every entry must get a CIDv1 at creation regardless of signing status.

## Codegen Chain

### Missed OpenAPI + Go client regeneration (3 occurrences)

**Severity:** High. **Subsystem:** REST API, CLI, SDK.

After modifying TypeBox schemas in REST API routes, forgot to regenerate the full chain. The Go CLI broke silently (`moltnet diary commit` fails with decode error). SDK broke with stale type imports.

**The chain:** Schema source → `pnpm run generate:openapi` → TS api-client → `pnpm run go:generate` → Go api-client. After regenerating, run `pnpm run typecheck` to catch downstream consumers.

**Rule:** Any change to `apps/rest-api/src/routes/*.ts` TypeBox schemas or `apps/rest-api/src/schemas.ts` requires regenerating all three.

## Migration Management

### Non-monotonic Drizzle journal timestamps (4 occurrences)

**Severity:** Medium. **Subsystem:** Database.

`drizzle-kit generate` produces `_journal.json` entries with `when` timestamps earlier than existing entries because this repo uses synthetic future-dated values (1774560400000+N) while drizzle-kit uses `Date.now()`.

**Rule:** After every `drizzle-kit generate`, check that the new `when` value is greater than the previous entry's. Manually patch if not.

### DROP FUNCTION required when RETURNS TABLE changes

**Severity:** Medium. **Subsystem:** Database.

A code reviewer incorrectly said `DROP FUNCTION` was unnecessary because "the signature didn't change." They only checked input params — the RETURNS TABLE output columns had changed (superseded_by removed). PostgreSQL's `CREATE OR REPLACE` cannot change return types.

**Rule:** When modifying SQL functions, always check both input parameters AND output columns. When adding columns to a table consumed by SQL functions, update all RETURNS TABLE clauses.

### diary_search() missing columns in RETURNS TABLE

**Severity:** High. **Subsystem:** Database, Provenance.

New columns (`content_hash`, `content_signature`, `signing_nonce`, `injection_risk`) were added to `diary_entries` but not to the `diary_search()` RETURNS TABLE. This caused NULL returns and `CID.parse('')` crashes.

**Rule:** When adding columns to tables consumed by SQL functions, update all RETURNS TABLE clauses in those functions.

## Eval Pipeline

### Three root causes for Claude Code subprocess failure

**Severity:** High. **Subsystem:** Context-evals.

The GEPA eval pipeline produced score=0 on every run (28+ traces, all toolCallCount=0). Three independent root causes:

1. **CLAUDECODE env var:** Inherited by subprocess, prevents nested sessions. Fix: strip in `getRuntimeEnv()`.
2. **Project hooks in worktrees:** `.claude/settings.json` hooks fire in `/tmp` worktrees where services are unavailable. Fix: `disableAllHooks: true`.
3. **OAuth token contamination:** `process.loadEnvFile('.env.local')` loads `CLAUDE_CODE_OAUTH_TOKEN` into process.env, inherited by subprocess. Fix: rewrite to call `createClaudeQuery()` in-process.

**Debugging:** `~/.claude/debug/<session-id>.txt` contains definitive auth failure logs.

### False diagnosis: assumed Agent SDK needs ANTHROPIC_API_KEY

**Severity:** High. **Subsystem:** Context-evals.

Agent incorrectly diagnosed score=0 as "needs ANTHROPIC_API_KEY." The Claude Agent SDK authenticates via macOS keychain or OAuth, NEVER via ANTHROPIC_API_KEY.

**Rule:** Always search diary entries for known incidents before hypothesizing new causes. Never suggest "missing API key" for Agent SDK failures.

### Flaky eval: native postinstall packages fail with --ignore-scripts

**Severity:** High. **Subsystem:** Evals, Tasksmith.

`@andersmyrmel/vard` (injection scanner) requires native postinstall. Eval worktree setup uses `pnpm install --ignore-scripts`, making it non-deterministic.

**Rule:** `--ignore-scripts` in eval worktree setup is a ticking bomb for packages with native postinstall.

### Deterministic CIDs exposed duplicate-pack bug

**Severity:** Medium. **Subsystem:** Provenance.

After making CIDs deterministic, recompiling the same diary produced the same `packCid` and the workflow tried to insert a duplicate row.

**Rule:** When making identifiers deterministic/content-addressed, add idempotent upsert logic. Duplicate inserts are the expected consequence.

## CI / Release

### release-please draft releases stuck

**Severity:** High. **Subsystem:** CI.

npm packages never published — `release_created` was never set to `true`. Known release-please bug (#962): with `draft: true`, GitHub doesn't create git tags for drafts, so release-please can't find the version.

**Fix:** `force-tag-creation: true` in config + `workflow_dispatch` trigger for manual recovery.

### Published with unpublished workspace deps

**Severity:** High. **Subsystem:** CLI, Publishing.

`npm i -g @themoltnet/legreffier` failed with E404 for `@moltnet/api-client@0.1.0`. Workspace deps were in `dependencies` instead of `devDependencies`. Vite SSR bundled them, but pnpm publish rewrote `workspace:*` to concrete versions for packages that don't exist on npm.

**Rule:** Bundled workspace deps go in `devDependencies`. The `check:pack` script now catches this, and the `pre-publish` skill documents the full verification workflow.

## MCP Server

### format: uuid in MCP schemas causes validation failures

**Severity:** Medium. **Subsystem:** MCP Server.

Added `format: 'uuid'` to MCP tool input schemas per Copilot review suggestion. E2E tests failed because `fastify-mcp` validates inputs with Ajv which has no 'uuid' format checker registered.

**Rule:** Never add format annotations to MCP tool input schemas unless fastify-mcp registers the corresponding format checker. Omitting format annotations in MCP schemas is the correct convention.

## Agent Process

### Destroyed user's branch by restoring from origin/main

**Severity:** High. **Subsystem:** Agent workflow.

Moved files without reading the branch's existing plan, then tried to "fix" by restoring from `origin/main`, overwriting in-progress work.

**Rule:** Always check what branch you're on and read any existing plans before modifying files. Never `git checkout origin/main -- <file>` on a feature branch without checking the branch-local version first.

### Skill updates not mirrored to .agents/ (2 occurrences)

**Severity:** Low. **Subsystem:** Skills.

Updated `.claude/skills/` but forgot to mirror to `.agents/skills/`. Two independent directories with no automated sync.

**Rule:** Every skill file change must be mirrored: `.claude/skills/<name>/*` → `.agents/skills/<name>/*`. Also check `tiles/<name>/skills/` if a tile exists.

### Tessl-improved skill not copied back to source

**Severity:** Low. **Subsystem:** Skills, Evals.

After `tessl eval run`, Tessl improved the SKILL.md in the tile directory but the changes were not synced back to `.claude/skills/` and `.agents/skills/`.

**Rule:** After every `tessl eval run`, diff the tile's SKILL.md against the source. If Tessl improved it, copy back.

## Context Pipeline

### Server-side consolidation produces low-quality relations for within-topic entries

**Severity:** Medium. **Subsystem:** Context pipeline.

Ran `diaries_consolidate` on topically homogeneous entries. All entries landed in one cluster (cosine similarity >0.85), producing N-1 blanket "supports" relations that are semantically meaningless.

**Rule:** Server-side consolidation is useful for cross-topic separation but NOT for within-topic substructure. For same-subsystem entries, skip Phase 1 clustering and go directly to agent-proposed relations.
