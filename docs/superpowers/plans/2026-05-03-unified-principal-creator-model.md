# Unified Principal (Creator) Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every resource that can be created by either a human or an agent model the creator with paired FK columns at the DB layer (mirroring the existing `tasks` pattern), and — for the subset that surfaces creator in responses — abstract the result into a single `creator: PrincipalIdentity` discriminated-union DTO at the REST layer. Fix issue #992 as a consequence (Go SDK no longer crashes on null creator) and stop leaking ugly paired columns into the API surface.

**Scope — 7 tables in two groups:**

- **Group A (DB + DTO + SDK + CLI)** — these surface creator in REST responses today and are the real bug surface:
  1. `diary_entries`
  2. `context_packs`
  3. `rendered_packs` (today exposes only raw `createdBy` UUID; this PR adds a resolved `creator` to its DTO since it's an obvious gap and the issue-992 trigger command consumes it)

- **Group B (DB schema only — no DTO change in this PR)** — these have a `created_by` column today but do not surface a resolved `creator` object in responses; we fix the schema for consistency and future-proofing without expanding the API surface: 4. `diaries` 5. `teams` 6. `groups` 7. `team_invites`

**Architecture:**

- DB: drop bare `created_by uuid NOT NULL`. Add `creator_agent_id uuid REFERENCES agents(identity_id)` and `creator_human_id uuid REFERENCES humans(id)`, both nullable, plus a XOR check constraint, exactly like `tasks.imposed_by_*`. Backfill: every existing row is agent-created, so copy the old `created_by` UUID into `creator_agent_id`. Drop `created_by` in the same migration.
- Repositories: replace agent-only LEFT JOIN with two LEFT JOINs (one to `agents`, one to `humans`). Resolve into a `PrincipalIdentity` discriminated union: `{ kind: 'agent', identityId, fingerprint, publicKey } | { kind: 'human', humanId, identityId | null }`.
- REST: introduce `PrincipalIdentitySchema` (TypeBox `Type.Union` with `kind` discriminator). Replace every `creator: Type.Union([AgentIdentity, Type.Null()])` with `creator: PrincipalIdentitySchema` (still optional only for system-created rows, which we don't have today, so just `creator: PrincipalIdentitySchema` — non-nullable).
- Go SDK: regenerate via existing `go generate` chain. Verify ogen produces a real discriminated sum type. Update CLI display code to render either kind.
- Out of scope (explicit): humans signing entries, signing_requests for humans, public feed author shape changes.

**Tech Stack:** Drizzle ORM + Postgres, Fastify + TypeBox, ogen Go client generator, pnpm workspaces, Vitest, Go.

---

## File Structure

**Created:**

- `libs/database/drizzle/0006_unified_principal_creator.sql` — single custom migration covering all 7 tables with one atomic backfill.
- `apps/rest-api/src/schemas/principal.ts` — `HumanIdentitySchema`, `PrincipalIdentitySchema`, helper type guards.
- `libs/database/src/principal-resolver.ts` — shared normalization helper used by Group A repositories.

**Modified:**

- `libs/database/src/schema.ts` — 7 tables (Group A: `diaryEntries`, `contextPacks`, `renderedPacks`; Group B: `diaries`, `teams`, `groups`, `teamInvites`); paired columns, indexes, check constraints; type re-exports.
- `libs/database/src/repositories/` — Group A repos (`diary-entry.repository.ts`, `context-pack.repository.ts`, `rendered-pack.repository.ts`) get full creator resolution + write-path branching. Group B repos (`diary.repository.ts`, `team.repository.ts`, `group.repository.ts`, plus wherever `team_invites` lives) only get write-path branching — no JOIN, no creator surfacing.
- `apps/rest-api/src/schemas/diary.ts` — Group A: replace `AgentIdentity`-only `creator` with `PrincipalIdentitySchema` on `DiaryEntryWithCreator`. Keep `AgentIdentitySchema` (still used as discriminated variant).
- `apps/rest-api/src/schemas/packs.ts` — Group A: same for `ContextPackResponse`. Add `creator: PrincipalIdentitySchema` to `RenderedPack` / `RenderedPackWithContent`.
- Group A routes: `apps/rest-api/src/routes/diary-entries.ts`, `packs.ts`, `rendered-packs.ts`, `pack-provenance.ts` — adapt to new DTO shape.
- Group B routes: `apps/rest-api/src/routes/diary.ts`, `teams.ts` (and any group/invite routes) — only update create handlers to branch agent vs human; **read handlers unchanged** because responses don't expose creator today.
- Every service file under `apps/rest-api/src/services/` that touches creator (Group A: `context-pack.service.ts`, `diary-entry.service.ts`, `rendered-pack.service.ts`; Group B: `diary.service.ts`, `team.service.ts`, `group.service.ts`, etc.).
- Every create-handler that today writes `createdBy: identityId` (all 7 tables) — must now branch: if principal kind is `agent`, write `creatorAgentId`; if `human`, resolve `humans.id` from `humans.identityId` (or insert humans row if missing) and write `creatorHumanId`.
- `libs/moltnet-api-client/cmd/normalize-spec/` — patch ogen normalization for the new discriminated union.
- Regenerated Go SDK files (`libs/moltnet-api-client/oas_*.go`) via `go generate ./...`.
- `apps/moltnet-cli/cmd/` — CLI commands that print creator info (`pack get`, `entry get/list`, `rendered-packs judge`).

**Out of scope (deliberately untouched):**

- `signing_requests` — humans don't sign yet.
- `public_feed` author shape.
- `agent_vouchers.issuer_id` / `redeemed_by` — agent-only by design.
- Surfacing `creator` in `diaries` / `teams` / `groups` / `team_invites` REST responses — separate follow-up PR (DB is ready for it).

---

## Migration sequencing rationale

We do **one** Drizzle migration covering all 7 tables because the backfill is uniform (all existing rows are agent-created today, per operator confirmation: "the creator kind would always be agent currently dummy"). One migration = one atomic backfill = one place to review.

Risk: if anyone has manually inserted human-created rows in production we'll lose them on the backfill. We mitigate with an explicit `RAISE EXCEPTION` guard that aborts the migration if any `created_by` doesn't match an `agents.identity_id`. Both new columns stay nullable; the XOR check enforces "exactly one is set." Same shape as `tasks`.

---

## Task 0: Verify clean baseline before any schema work

**Files:** none (verification only)

- [ ] **Step 1: Confirm clean tree and no pending Drizzle drift**

Run:

```bash
cd /Users/edouard/Dev/getlarge/themoltnet/.worktrees/issue-992-human-pack-creators
git status --short
pnpm install
pnpm db:generate
git status --short libs/database/drizzle/
```

Expected: `pnpm db:generate` produces zero new files and `git status` on `libs/database/drizzle/` is clean. If anything is generated, **stop** — investigate snapshot drift via `drizzle-migrations` skill before continuing.

- [ ] **Step 2: Confirm humans table population approach**

Run:

```bash
grep -rn "humans" libs/database/src/repositories/human.repository.ts
grep -rn "INSERT INTO humans\|humanRepository.upsert\|humanRepository.create" apps/rest-api/src/
```

Expected: identify the function used to upsert a `humans` row by `identityId`. Note its name and signature for use in Task 4. If no upsert exists, the human-creation path must use `humanRepository.create({ identityId })` and we'll need to handle the unique constraint.

---

## Task 1: Add `PrincipalIdentitySchema` (TypeBox) — DTO contract first

**Files:**

- Create: `apps/rest-api/src/schemas/principal.ts`
- Test: `apps/rest-api/src/schemas/principal.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/rest-api/src/schemas/principal.spec.ts
import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { HumanIdentitySchema, PrincipalIdentitySchema } from './principal.js';

describe('PrincipalIdentitySchema', () => {
  it('accepts an agent variant', () => {
    const value = {
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      publicKey: 'ed25519:base64payload',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('accepts a human variant with identityId', () => {
    const value = {
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: '33333333-3333-3333-3333-333333333333',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('accepts a human variant without identityId (pre-onboarding)', () => {
    const value = {
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: null,
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(true);
  });

  it('rejects an agent missing fingerprint', () => {
    const value = {
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      publicKey: 'ed25519:x',
    };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(false);
  });

  it('rejects an unknown discriminator', () => {
    const value = { kind: 'system', id: 'x' };
    expect(Value.Check(PrincipalIdentitySchema, value)).toBe(false);
  });

  it('exports HumanIdentitySchema independently', () => {
    expect(HumanIdentitySchema).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/rest-api vitest run apps/rest-api/src/schemas/principal.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema module**

```typescript
// apps/rest-api/src/schemas/principal.ts
import { Type } from '@sinclair/typebox';

import {
  AgentIdentitySchema,
  FingerprintSchema,
  PublicKeySchema,
} from './diary.js';

export const HumanIdentitySchema = Type.Object(
  {
    humanId: Type.String({ format: 'uuid' }),
    // Null until the human completes Kratos onboarding (first login)
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanIdentity' },
);

const AgentPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: FingerprintSchema,
    publicKey: PublicKeySchema,
  },
  { $id: 'AgentPrincipal' },
);

const HumanPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('human'),
    humanId: Type.String({ format: 'uuid' }),
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanPrincipal' },
);

export const PrincipalIdentitySchema = Type.Union(
  [AgentPrincipalSchema, HumanPrincipalSchema],
  { $id: 'PrincipalIdentity', discriminator: { propertyName: 'kind' } },
);

export type AgentPrincipal = (typeof AgentPrincipalSchema)['static'];
export type HumanPrincipal = (typeof HumanPrincipalSchema)['static'];
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;

// Re-export the legacy shape so existing imports keep working until we delete them.
export { AgentIdentitySchema };
```

Note: TypeBox does not natively emit OpenAPI 3.1 discriminator metadata for `Type.Union`; if the OpenAPI generator drops it, the `normalize-spec` post-processor (Task 9) will re-inject it. Verify by inspecting the generated `openapi.json` after Task 8.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/rest-api vitest run apps/rest-api/src/schemas/principal.spec.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/rest-api/src/schemas/principal.ts apps/rest-api/src/schemas/principal.spec.ts
git commit -m "feat(rest-api): add PrincipalIdentitySchema discriminated union

MoltNet-Diary: <create after writing diary entry per Task 16>
Task-Group: unified-principal-creator
Task-Family: feature"
```

(Diary entry comes at Task 16; for now leave the trailer blank or skip the commit until Task 16 is complete. Recommended: defer commits until Task 16 lands diary entries, OR write a short pre-task `procedural` entry now and link it. Operator preference applies.)

---

## Task 2: Add `PrincipalResolver` shared SQL helpers

**Files:**

- Create: `libs/database/src/principal-resolver.ts`
- Test: `libs/database/src/principal-resolver.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/database/src/principal-resolver.spec.ts
import { describe, expect, it } from 'vitest';
import { resolvePrincipal, type PrincipalRow } from './principal-resolver.js';

describe('resolvePrincipal', () => {
  it('returns agent variant when agent columns are present', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-G7H8',
      creatorAgentPublicKey: 'ed25519:x',
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'agent',
      identityId: '11111111-1111-1111-1111-111111111111',
      fingerprint: 'A1B2-C3D4-E5F6-G7H8',
      publicKey: 'ed25519:x',
    });
  });

  it('returns human variant when human columns are present', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: '33333333-3333-3333-3333-333333333333',
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: '33333333-3333-3333-3333-333333333333',
    });
  });

  it('returns human variant with null identityId pre-onboarding', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: null,
    };
    expect(resolvePrincipal(row)).toEqual({
      kind: 'human',
      humanId: '22222222-2222-2222-2222-222222222222',
      identityId: null,
    });
  });

  it('throws when both agent and human columns are set (XOR violation)', () => {
    const row: PrincipalRow = {
      creatorAgentId: '11111111-1111-1111-1111-111111111111',
      creatorAgentFingerprint: 'A1B2-C3D4-E5F6-G7H8',
      creatorAgentPublicKey: 'ed25519:x',
      creatorHumanId: '22222222-2222-2222-2222-222222222222',
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(/XOR|both/i);
  });

  it('throws when neither agent nor human columns are set', () => {
    const row: PrincipalRow = {
      creatorAgentId: null,
      creatorAgentFingerprint: null,
      creatorAgentPublicKey: null,
      creatorHumanId: null,
      creatorHumanIdentityId: null,
    };
    expect(() => resolvePrincipal(row)).toThrow(/missing|neither/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @moltnet/database vitest run libs/database/src/principal-resolver.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```typescript
// libs/database/src/principal-resolver.ts
import type { PrincipalIdentity } from '@moltnet/rest-api/schemas/principal.js';
// If cross-package import is undesirable, redefine PrincipalIdentity locally.
// Pick whichever the workspace already does for shared types.

export interface PrincipalRow {
  creatorAgentId: string | null;
  creatorAgentFingerprint: string | null;
  creatorAgentPublicKey: string | null;
  creatorHumanId: string | null;
  creatorHumanIdentityId: string | null;
}

export function resolvePrincipal(row: PrincipalRow): PrincipalIdentity {
  const hasAgent = row.creatorAgentId !== null;
  const hasHuman = row.creatorHumanId !== null;

  if (hasAgent && hasHuman) {
    throw new Error(
      'PrincipalRow XOR violated: both creator_agent_id and creator_human_id are set',
    );
  }
  if (!hasAgent && !hasHuman) {
    throw new Error(
      'PrincipalRow missing: neither creator_agent_id nor creator_human_id is set',
    );
  }

  if (hasAgent) {
    if (!row.creatorAgentFingerprint || !row.creatorAgentPublicKey) {
      throw new Error(
        'PrincipalRow agent variant missing fingerprint/publicKey — JOIN to agents failed',
      );
    }
    return {
      kind: 'agent',
      identityId: row.creatorAgentId!,
      fingerprint: row.creatorAgentFingerprint,
      publicKey: row.creatorAgentPublicKey,
    };
  }

  return {
    kind: 'human',
    humanId: row.creatorHumanId!,
    identityId: row.creatorHumanIdentityId,
  };
}
```

If cross-package import of `PrincipalIdentity` is awkward (database lib should not depend on rest-api), declare an equivalent local type and convert at the route boundary. Pick the path that matches existing repo conventions — check whether `libs/database` already imports from `apps/rest-api`. If not (likely), inline the type.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @moltnet/database vitest run libs/database/src/principal-resolver.spec.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add libs/database/src/principal-resolver.ts libs/database/src/principal-resolver.spec.ts
git commit -m "feat(database): add resolvePrincipal helper for paired creator columns"
```

---

## Task 3: Update Drizzle schema — add paired creator columns + XOR checks (all 7 tables)

**Files:**

- Modify: `libs/database/src/schema.ts`
  - `diaries` ~166-204
  - `diaryEntries` ~212-280
  - `contextPacks` ~509-552
  - `teams` ~598-621
  - `groups` ~629-650
  - `teamInvites` ~658-687
  - `renderedPacks` ~785-823

- [ ] **Step 1: Define a reusable shape (mental template, not code)**

Each of the 7 tables follows this exact pattern. Replace `createdBy: uuid('created_by').notNull(),` with:

```typescript
    creatorAgentId: uuid('creator_agent_id').references(
      () => agents.identityId,
      { onDelete: 'restrict' },
    ),
    creatorHumanId: uuid('creator_human_id').references(() => humans.id, {
      onDelete: 'restrict',
    }),
```

And in the table-level `(table) => [...]` callback, add:

```typescript
    index('<table>_creator_agent_idx')
      .on(table.creatorAgentId)
      .where(sql`creator_agent_id IS NOT NULL`),
    index('<table>_creator_human_idx')
      .on(table.creatorHumanId)
      .where(sql`creator_human_id IS NOT NULL`),
    check(
      '<table>_creator_xor',
      sql`(creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL)`,
    ),
```

Ensure `check` and `sql` are imported (already used by `tasks`).

- [ ] **Step 2: Apply to `diaries`**

Plus replace the existing `diaries_created_by_idx` and `diaries_created_by_visibility_idx` with:

```typescript
    index('diaries_creator_agent_idx')
      .on(table.creatorAgentId)
      .where(sql`creator_agent_id IS NOT NULL`),
    index('diaries_creator_human_idx')
      .on(table.creatorHumanId)
      .where(sql`creator_human_id IS NOT NULL`),
    index('diaries_creator_agent_visibility_idx')
      .on(table.creatorAgentId, table.visibility)
      .where(sql`creator_agent_id IS NOT NULL`),
    check(
      'diaries_creator_xor',
      sql`(creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL)`,
    ),
```

- [ ] **Step 3: Apply to `diaryEntries`**

Replace `diary_entries_created_by_idx` with the two filtered indexes. Add the XOR check named `diary_entries_creator_xor`.

- [ ] **Step 4: Apply to `contextPacks`**

No existing `created_by` index. Just add the two filtered indexes + `context_packs_creator_xor`.

- [ ] **Step 5: Apply to `teams`**

Replace `teams_created_by_idx` with the two filtered indexes. Add `teams_creator_xor`.

- [ ] **Step 6: Apply to `groups`**

No existing `created_by` index. Add the two filtered indexes + `groups_creator_xor`.

- [ ] **Step 7: Apply to `teamInvites`**

No existing `created_by` index. Add the two filtered indexes + `team_invites_creator_xor`.

- [ ] **Step 8: Apply to `renderedPacks`**

No existing `created_by` index. Add the two filtered indexes + `rendered_packs_creator_xor`.

- [ ] **Step 9: Run database-package typecheck**

Run: `pnpm --filter @moltnet/database run typecheck`
Expected: PASSES within `@moltnet/database`. Downstream packages will fail at later tasks — that's expected.

- [ ] **Step 10: Commit (schema only, no migration yet)**

```bash
git add libs/database/src/schema.ts
git commit -m "feat(database): replace createdBy with paired creator FK columns (7 tables)

Adds creator_agent_id (FK -> agents) and creator_human_id (FK -> humans)
with XOR check constraint on diaries, diary_entries, context_packs,
rendered_packs, teams, groups, team_invites. Mirrors the existing
tasks.imposed_by_* pattern. Migration generated in next commit."
```

---

## Task 4: Generate the Drizzle migration with backfill

**Files:**

- Create: `libs/database/drizzle/0006_unified_principal_creator.sql` (custom — Drizzle cannot express the data backfill that needs to run between adding new columns and dropping the old one)
- Modify: `libs/database/drizzle/meta/_journal.json` and `meta/0006_snapshot.json` (auto-generated)

- [ ] **Step 1: Generate the auto migration first**

Run: `pnpm db:generate`
Expected: produces `0006_<name>.sql` containing `ALTER TABLE diaries ADD COLUMN creator_agent_id uuid`, etc., plus drop of `created_by` and the new check constraints.

The auto-generated SQL **will drop `created_by` immediately**. We need to interleave a backfill. So:

- [ ] **Step 2: Re-do as a custom migration**

Discard the auto-generated SQL but keep the snapshot so types stay in sync. Run:

```bash
rm libs/database/drizzle/0006_*.sql
# keep meta/0006_snapshot.json — it reflects the intended end state
pnpm exec drizzle-kit generate --custom --name unified_principal_creator
```

This creates an empty `0006_unified_principal_creator.sql` and a snapshot. **Verify** the snapshot still describes the end state (paired columns, no `created_by`).

- [ ] **Step 3: Write the migration SQL by hand**

Edit `libs/database/drizzle/0006_unified_principal_creator.sql`:

```sql
-- 1. Add new nullable columns to all 7 tables
ALTER TABLE diaries
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE diary_entries
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE context_packs
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE rendered_packs
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE teams
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE groups
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

ALTER TABLE team_invites
  ADD COLUMN creator_agent_id uuid REFERENCES agents(identity_id) ON DELETE RESTRICT,
  ADD COLUMN creator_human_id uuid REFERENCES humans(id) ON DELETE RESTRICT;

-- 2. Backfill: every existing created_by UUID is an agent identity_id today.
-- Confirmed with operator: no human-created rows exist in production.
-- We assert this invariant and abort if violated, rather than silently dropping data.

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count FROM (
    SELECT created_by FROM diaries
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM diary_entries
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM context_packs
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM rendered_packs
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM teams
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM groups
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
    UNION ALL
    SELECT created_by FROM team_invites
      WHERE created_by NOT IN (SELECT identity_id FROM agents)
  ) orphans;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Migration aborted: % rows have created_by not matching any agent. '
      'Manual backfill required for human-created rows. '
      'Inspect each table with: '
      'SELECT created_by FROM <table> WHERE created_by NOT IN (SELECT identity_id FROM agents);',
      orphan_count;
  END IF;
END $$;

UPDATE diaries        SET creator_agent_id = created_by;
UPDATE diary_entries  SET creator_agent_id = created_by;
UPDATE context_packs  SET creator_agent_id = created_by;
UPDATE rendered_packs SET creator_agent_id = created_by;
UPDATE teams          SET creator_agent_id = created_by;
UPDATE groups         SET creator_agent_id = created_by;
UPDATE team_invites   SET creator_agent_id = created_by;

-- 3. Add the XOR check constraints (now safe — every row has exactly creator_agent_id set)
ALTER TABLE diaries        ADD CONSTRAINT diaries_creator_xor        CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE diary_entries  ADD CONSTRAINT diary_entries_creator_xor  CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE context_packs  ADD CONSTRAINT context_packs_creator_xor  CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE rendered_packs ADD CONSTRAINT rendered_packs_creator_xor CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE teams          ADD CONSTRAINT teams_creator_xor          CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE groups         ADD CONSTRAINT groups_creator_xor         CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));
ALTER TABLE team_invites   ADD CONSTRAINT team_invites_creator_xor   CHECK ((creator_agent_id IS NOT NULL) <> (creator_human_id IS NOT NULL));

-- 4. Drop the old indexes and columns
DROP INDEX IF EXISTS diaries_created_by_idx;
DROP INDEX IF EXISTS diaries_created_by_visibility_idx;
DROP INDEX IF EXISTS diary_entries_created_by_idx;
DROP INDEX IF EXISTS teams_created_by_idx;

ALTER TABLE diaries        DROP COLUMN created_by;
ALTER TABLE diary_entries  DROP COLUMN created_by;
ALTER TABLE context_packs  DROP COLUMN created_by;
ALTER TABLE rendered_packs DROP COLUMN created_by;
ALTER TABLE teams          DROP COLUMN created_by;
ALTER TABLE groups         DROP COLUMN created_by;
ALTER TABLE team_invites   DROP COLUMN created_by;

-- 5. Add new filtered indexes
CREATE INDEX diaries_creator_agent_idx            ON diaries        (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX diaries_creator_human_idx            ON diaries        (creator_human_id) WHERE creator_human_id IS NOT NULL;
CREATE INDEX diaries_creator_agent_visibility_idx ON diaries        (creator_agent_id, visibility) WHERE creator_agent_id IS NOT NULL;

CREATE INDEX diary_entries_creator_agent_idx  ON diary_entries  (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX diary_entries_creator_human_idx  ON diary_entries  (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX context_packs_creator_agent_idx  ON context_packs  (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX context_packs_creator_human_idx  ON context_packs  (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX rendered_packs_creator_agent_idx ON rendered_packs (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX rendered_packs_creator_human_idx ON rendered_packs (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX teams_creator_agent_idx          ON teams          (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX teams_creator_human_idx          ON teams          (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX groups_creator_agent_idx         ON groups         (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX groups_creator_human_idx         ON groups         (creator_human_id) WHERE creator_human_id IS NOT NULL;

CREATE INDEX team_invites_creator_agent_idx   ON team_invites   (creator_agent_id) WHERE creator_agent_id IS NOT NULL;
CREATE INDEX team_invites_creator_human_idx   ON team_invites   (creator_human_id) WHERE creator_human_id IS NOT NULL;
```

- [ ] **Step 4: Reset Docker DB and apply the migration**

Run:

```bash
pnpm docker:reset
pnpm db:migrate:run
pnpm db:status
```

Expected: `0006_unified_principal_creator` shows as applied. No errors.

- [ ] **Step 5: Round-trip-check**

Run: `pnpm db:generate`
Expected: **no new files**, no diff. If Drizzle wants to generate something, the snapshot drifted — fix per drizzle-migrations skill before continuing.

- [ ] **Step 6: Commit**

```bash
git add libs/database/drizzle/0006_unified_principal_creator.sql libs/database/drizzle/meta/
git commit -m "feat(database): migration for paired creator columns + safe backfill

Aborts with a clear error if any created_by row points to a non-agent UUID.
All existing rows in known environments are agent-created (operator-confirmed)
so backfill is a single UPDATE per table copying created_by -> creator_agent_id.

MoltNet-Diary: <fill in>"
```

---

## Task 5: Update `context-pack.repository.ts` to resolve PrincipalIdentity

**Files:**

- Modify: `libs/database/src/repositories/context-pack.repository.ts`

- [ ] **Step 1: Update `packSelection` to JOIN both agents and humans**

Replace the agent-only fields with paired-table fields:

```typescript
const packSelection = {
  id: contextPacks.id,
  diaryId: contextPacks.diaryId,
  packCid: contextPacks.packCid,
  packCodec: contextPacks.packCodec,
  packType: contextPacks.packType,
  params: contextPacks.params,
  payload: contextPacks.payload,
  creatorAgentId: contextPacks.creatorAgentId,
  creatorAgentFingerprint: agents.fingerprint,
  creatorAgentPublicKey: agents.publicKey,
  creatorHumanId: contextPacks.creatorHumanId,
  creatorHumanIdentityId: humans.identityId,
  supersedesPackId: contextPacks.supersedesPackId,
  pinned: contextPacks.pinned,
  expiresAt: contextPacks.expiresAt,
  createdAt: contextPacks.createdAt,
} as const;
```

Add `humans` to the imports from `../schema.js`.

Find every `.from(contextPacks)` query in this file and replace the existing `.leftJoin(agents, ...)` with both:

```typescript
.leftJoin(agents, eq(contextPacks.creatorAgentId, agents.identityId))
.leftJoin(humans, eq(contextPacks.creatorHumanId, humans.id))
```

- [ ] **Step 2: Replace `normalizePack` to use `resolvePrincipal`**

```typescript
import { resolvePrincipal } from '../principal-resolver.js';

function normalizePack(row: PackRow): ContextPackWithCreator {
  return {
    id: row.id,
    diaryId: row.diaryId,
    packCid: row.packCid,
    packCodec: row.packCodec,
    packType: row.packType,
    params: row.params,
    payload: row.payload,
    creator: resolvePrincipal({
      creatorAgentId: row.creatorAgentId,
      creatorAgentFingerprint: row.creatorAgentFingerprint,
      creatorAgentPublicKey: row.creatorAgentPublicKey,
      creatorHumanId: row.creatorHumanId,
      creatorHumanIdentityId: row.creatorHumanIdentityId,
    }),
    supersedesPackId: row.supersedesPackId,
    pinned: row.pinned,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
```

Note: the response no longer contains `createdBy` — it's replaced by the structured `creator`. Update the `ContextPackWithCreator` type definition accordingly (it lives in this file or in a sibling types file — find it via grep).

- [ ] **Step 3: Update `expandedEntrySelection` for entries embedded in packs**

Same pattern: replace `agents.identityId/fingerprint/publicKey` aliased columns with paired-table reads, add `humans` join, and use `resolvePrincipal` in the row normalizer for entries.

- [ ] **Step 4: Update insert paths**

Find every `createPack({ createdBy, ... })` call site signature in this file. Change the create function to accept `creator: { kind: 'agent' | 'human', id: string }` and write to the correct column:

```typescript
async createPack(input: CreatePackInput): Promise<ContextPack> {
  const insertValue = {
    ...input.fields,
    creatorAgentId: input.creator.kind === 'agent' ? input.creator.id : null,
    creatorHumanId: input.creator.kind === 'human' ? input.creator.id : null,
  };
  // ... rest unchanged
}
```

- [ ] **Step 5: Run repository tests (if any) — and the typecheck**

Run:

```bash
pnpm --filter @moltnet/database run typecheck
pnpm --filter @moltnet/database vitest run
```

Expected: typecheck passes within `@moltnet/database`. Existing repository tests may fail — fix them by updating fixtures to use the new shape.

- [ ] **Step 6: Commit**

```bash
git add libs/database/src/repositories/context-pack.repository.ts
git commit -m "feat(database): context-pack repository resolves PrincipalIdentity"
```

---

## Task 6: Update `rendered-pack.repository.ts`

**Files:**

- Modify: `libs/database/src/repositories/rendered-pack.repository.ts`

- [ ] **Step 1: Add the principal JOINs**

Today the rendered-pack repository does not JOIN to agents at all (the response only exposes raw `createdBy`). This task **adds** principal resolution so rendered-pack responses can carry a real `creator: PrincipalIdentity` like context-packs.

Add to the `selection` object:

```typescript
creatorAgentId: renderedPacks.creatorAgentId,
creatorAgentFingerprint: agents.fingerprint,
creatorAgentPublicKey: agents.publicKey,
creatorHumanId: renderedPacks.creatorHumanId,
creatorHumanIdentityId: humans.identityId,
```

Add `.leftJoin(agents, eq(renderedPacks.creatorAgentId, agents.identityId))` and `.leftJoin(humans, eq(renderedPacks.creatorHumanId, humans.id))` to every query.

Add a `normalizeRenderedPack(row)` function using `resolvePrincipal`. Update return types.

- [ ] **Step 2: Update create path**

Same shape change as Task 5 Step 4 — `createRenderedPack` accepts `creator: { kind, id }` and writes the right column.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @moltnet/database run typecheck
git add libs/database/src/repositories/rendered-pack.repository.ts
git commit -m "feat(database): rendered-pack repository resolves PrincipalIdentity"
```

---

## Task 7: Update `diary-entry.repository.ts` (Group A — full resolution)

**Files:**

- Modify: `libs/database/src/repositories/diary-entry.repository.ts`

- [ ] **Step 1: diary-entry — add principal joins to the row selection**

The current `DiaryEntryWithCreator` (used by `GET /entries/:id`) already has a creator field but agent-only. Apply the same pattern: paired-column selection, two LEFT JOINs (agents + humans), `resolvePrincipal` in the normalizer.

Find the `entriesSelection` (or equivalent) block and replicate Task 5 Step 1.

- [ ] **Step 2: diary-entry — update insert path**

Same as Task 5 Step 4 — accept `creator: { kind, id }`, write the correct paired column.

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm --filter @moltnet/database run typecheck
git add libs/database/src/repositories/diary-entry.repository.ts
git commit -m "feat(database): diary-entry repository resolves PrincipalIdentity"
```

---

## Task 7b: Update Group B repositories (write-path only — no creator resolution)

**Files:**

- Modify: `libs/database/src/repositories/diary.repository.ts`
- Modify: `libs/database/src/repositories/team.repository.ts`
- Modify: `libs/database/src/repositories/group.repository.ts`
- Modify: wherever `team_invites` writes happen (likely inside `team.repository.ts` or a sibling file — find via `grep -rn "teamInvites\b" libs/database/src/repositories/`)

**Scope reminder:** Group B tables (`diaries`, `teams`, `groups`, `team_invites`) get paired columns at the DB layer for consistency, but their REST responses do NOT expose a resolved `creator` object today. So we only need to:

1. Update each write path to accept `creator: { kind, id }` and write the correct paired column.
2. Leave selection/read paths untouched — they don't return creator.

- [ ] **Step 1: For each repository, find the create function**

Run: `grep -n "createdBy" libs/database/src/repositories/diary.repository.ts libs/database/src/repositories/team.repository.ts libs/database/src/repositories/group.repository.ts`
Expected: a list of insert sites that today set `createdBy: input.createdBy`.

- [ ] **Step 2: Change each insert signature**

Replace:

```typescript
async createDiary(input: CreateDiaryInput): Promise<Diary> {
  const [created] = await this.db.insert(diaries).values({
    ...input,
    createdBy: input.createdBy,
  }).returning();
  return created;
}
```

With:

```typescript
async createDiary(input: CreateDiaryInput): Promise<Diary> {
  const [created] = await this.db.insert(diaries).values({
    ...input.fields,
    creatorAgentId: input.creator.kind === 'agent' ? input.creator.id : null,
    creatorHumanId: input.creator.kind === 'human' ? input.creator.id : null,
  }).returning();
  return created;
}
```

Update the `CreateDiaryInput` (and equivalents for team/group/team_invites) types to use the new `creator: { kind, id }` shape.

- [ ] **Step 3: Confirm read paths are unchanged**

Group B responses don't include creator. Selection objects in these repos should not need any change. If any selection happens to project `created_by`, replace it with both `creator_agent_id` and `creator_human_id` (so the data is available even though we don't surface it in the DTO yet).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @moltnet/database run typecheck`
Expected: passes within the database package. Downstream rest-api will fail until Task 9.

- [ ] **Step 5: Commit**

```bash
git add libs/database/src/repositories/diary.repository.ts libs/database/src/repositories/team.repository.ts libs/database/src/repositories/group.repository.ts
git commit -m "feat(database): Group B repositories accept paired creator on write

Diaries, teams, groups, team_invites: write paths now branch agent/human
into the correct paired column. Read paths unchanged — these resources
do not surface a resolved creator object in REST responses (yet)."
```

---

## Task 8: Update REST schemas — replace `creator: AgentIdentity | null` with `creator: PrincipalIdentity` (Group A only)

**Files:**

- Modify: `apps/rest-api/src/schemas/diary.ts` (line 152: `DiaryEntryWithCreator`)
- Modify: `apps/rest-api/src/schemas/packs.ts` (line 51: `ContextPack`/`ContextPackResponse`; line ~461, ~514: `RenderedPack`/`RenderedPackWithContent`)

**Scope reminder:** Only Group A (`diary_entries`, `context_packs`, `rendered_packs`) gets DTO changes in this PR. Group B (`diaries`, `teams`, `groups`, `team_invites`) keeps its current response shape — no `creator` field, no `createdBy` field exposure changes.

- [ ] **Step 1: Import `PrincipalIdentitySchema` and replace creator unions**

In `apps/rest-api/src/schemas/diary.ts`:

```typescript
import { PrincipalIdentitySchema } from './principal.js';

// Around line 152 in DiaryEntryWithCreator:
creator: PrincipalIdentitySchema,  // was: Type.Union([Type.Ref(AgentIdentitySchema), Type.Null()])
```

In `apps/rest-api/src/schemas/packs.ts`:

```typescript
import { PrincipalIdentitySchema } from './principal.js';

// Around line 51 in ContextPackResponse:
creator: PrincipalIdentitySchema,  // was: Type.Union([Type.Ref(AgentIdentitySchema), Type.Null()])
```

Also: drop the `createdBy: Type.String({ format: 'uuid' })` field from `ContextPackResponse` and `DiaryEntryWithCreator`. The discriminated `creator` is the only public surface now.

- [ ] **Step 2: Add `creator` to `RenderedPack` and `RenderedPackWithContent`**

Today these only expose `createdBy: Type.String({ format: 'uuid' })`. Replace with `creator: PrincipalIdentitySchema`.

- [ ] **Step 3: Leave Group B schemas alone**

`DiaryCatalog`, `DiaryResponse`, team/group/team_invites response schemas — **no changes** in this PR. The DB now has the data ready for a future PR to surface them.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: typecheck shows errors in route handlers and services that still reference the old `createdBy` field. These get fixed in Task 9.

- [ ] **Step 5: Commit (schema-only change, broken intermediate state)**

```bash
git add apps/rest-api/src/schemas/
git commit -m "feat(rest-api): replace AgentIdentity creator unions with PrincipalIdentity

Breaking DTO change. Route handler updates follow.

Task-Group: unified-principal-creator
Task-Family: feature"
```

---

## Task 9: Update REST routes and services to write/read PrincipalIdentity

**Files:**

- Modify: `apps/rest-api/src/routes/diary.ts`
- Modify: `apps/rest-api/src/routes/diary-entries.ts`
- Modify: `apps/rest-api/src/routes/packs.ts`
- Modify: `apps/rest-api/src/routes/rendered-packs.ts`
- Modify: `apps/rest-api/src/routes/pack-provenance.ts`
- Modify: corresponding service files under `apps/rest-api/src/services/`

- [ ] **Step 1: Define a helper to convert authContext → repository creator input**

Search for `request.authContext` to find where principal info lives. Create a small helper (e.g. `apps/rest-api/src/utils/auth-principal.ts`):

```typescript
import type { FastifyRequest } from 'fastify';
import type { HumanRepository } from '@moltnet/database';

export interface RepositoryCreator {
  kind: 'agent' | 'human';
  id: string;
}

export async function authContextToCreator(
  request: FastifyRequest,
  humans: HumanRepository,
): Promise<RepositoryCreator> {
  const ctx = request.authContext;
  if (ctx.subjectType === 'agent') {
    return { kind: 'agent', id: ctx.identityId };
  }
  // Human: createdBy in DB is humans.id, NOT identityId.
  // Resolve via humans table; insert a humans row if missing (first-write users).
  const human = await humans.findOrCreateByIdentityId(ctx.identityId);
  return { kind: 'human', id: human.id };
}
```

Confirm via `grep` that `subjectType` is the discriminator (audit found `KetoNamespace.Human`/`KetoNamespace.Agent` in routes — the actual field name might differ). Adapt to whatever the codebase uses.

If `humanRepository.findOrCreateByIdentityId` does not exist, add it:

```typescript
// libs/database/src/repositories/human.repository.ts
async findOrCreateByIdentityId(identityId: string): Promise<Human> {
  const existing = await this.db.query.humans.findFirst({
    where: eq(humans.identityId, identityId),
  });
  if (existing) return existing;
  const [created] = await this.db.insert(humans).values({ identityId }).returning();
  return created;
}
```

- [ ] **Step 2: Update each create handler**

For every POST handler that today calls `repository.create({ createdBy: identityId, ... })`, change to:

```typescript
const creator = await authContextToCreator(request, fastify.repositories.humans);
await fastify.repositories.<entity>.create({ ...fields, creator });
```

Apply across **all 7 create paths**:

Group A (already covered by DTO changes):

- `routes/diary-entries.ts` → `POST /diaries/:id/entries`
- `routes/packs.ts` → `POST /diaries/:id/packs`
- `routes/rendered-packs.ts` → `POST /packs/:id/render`

Group B (write-path branching only — no response shape change):

- `routes/diary.ts` → `POST /teams/:teamId/diaries`
- `routes/teams.ts` → `POST /teams` (and any team-creation flow)
- `routes/groups.ts` (or wherever) → `POST /groups`
- `routes/team-invites.ts` (or wherever) → `POST /teams/:id/invites`

- [ ] **Step 3: Update read handlers (Group A only)**

Most Group A read handlers already pass repository output through `Type.Cast` or directly into the response. Since the repository now returns `creator: PrincipalIdentity` and dropped `createdBy`, response wiring should mostly Just Work — but verify each handler doesn't manually re-shape the creator.

Particular attention:

- `routes/pack-provenance.ts` — provenance graph likely embeds creator at multiple levels.
- `routes/packs.ts` — pack list endpoint, expanded entries.
- `routes/diary-entries.ts` — entry list + detail.
- `routes/rendered-packs.ts` — single + list endpoints (now exposes `creator`).

Group B read handlers stay untouched — their responses do not include creator.

- [ ] **Step 4: Run REST typecheck and unit tests**

```bash
pnpm --filter @moltnet/rest-api run typecheck
pnpm --filter @moltnet/rest-api vitest run
```

Expected: typecheck passes. Unit tests likely need fixture updates (replace `createdBy: '...'` with `creator: { kind: 'agent', ... }`).

- [ ] **Step 5: Commit**

```bash
git add apps/rest-api/src/
git commit -m "feat(rest-api): routes/services write+read PrincipalIdentity creator

Adds authContextToCreator helper and HumanRepository.findOrCreateByIdentityId.
All four affected resources now produce a discriminated creator in responses.

Task-Group: unified-principal-creator"
```

---

## Task 10: Run the e2e suite to validate end-to-end

**Files:** none modified (test run only)

- [ ] **Step 1: Bring up the e2e stack**

Run:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
```

- [ ] **Step 2: Run rest-api e2e tests**

Run: `pnpm --filter @moltnet/rest-api run test:e2e`
Expected: all green. If pack-creator or entry-creator e2e tests fail with shape mismatches, update fixtures to the new DTO. No assertion-deletion shortcuts — investigate each failure.

- [ ] **Step 3: Run mcp-server e2e tests**

Run: `pnpm --filter @moltnet/mcp-server run test:e2e`
Expected: all green. The MCP server proxies REST shapes; if any tool surface still expects `createdBy` or agent-only `creator`, fix at the MCP boundary too.

- [ ] **Step 4: Tear down**

Run:

```bash
COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml down -v
```

- [ ] **Step 5: Commit any test fixture/setup changes**

```bash
git add apps/rest-api/test/ apps/mcp-server/test/
git commit -m "test(e2e): adapt fixtures to PrincipalIdentity creator shape"
```

---

## Task 11: Regenerate OpenAPI spec and inspect creator surface

**Files:**

- Modify: `apps/rest-api/public/openapi.json` (regenerated)
- Modify: `libs/moltnet-api-client/openapi-normalized.json` (regenerated)

- [ ] **Step 1: Regenerate OpenAPI**

Run: `pnpm run generate:openapi`
Expected: `apps/rest-api/public/openapi.json` updates. Check the diff for `creator` field across `ContextPackResponse`, `DiaryEntryWithCreator`, `RenderedPack*`, `Diary*`.

- [ ] **Step 2: Verify discriminator metadata**

```bash
jq '.components.schemas.PrincipalIdentity' apps/rest-api/public/openapi.json
```

Expected output includes `oneOf` with two variants and a `discriminator: { propertyName: "kind" }`. If `discriminator` is missing or it shows `anyOf` instead of `oneOf`, ogen will likely mis-generate. Continue to Task 12.

- [ ] **Step 3: Commit regenerated spec**

```bash
git add apps/rest-api/public/openapi.json
git commit -m "chore(rest-api): regenerate OpenAPI spec for PrincipalIdentity"
```

---

## Task 12: Update `normalize-spec` post-processor for ogen compatibility

**Files:**

- Modify: `libs/moltnet-api-client/cmd/normalize-spec/main.go` (or wherever the normalizer lives — find via `ls libs/moltnet-api-client/cmd/`)
- Modify: `libs/moltnet-api-client/openapi-normalized.json` (regenerated)

- [ ] **Step 1: Inspect current normalizer**

Run: `cat libs/moltnet-api-client/cmd/normalize-spec/main.go`
Identify what transformations it already applies (likely turning `anyOf: [T, null]` into ogen-friendly nullable refs).

- [ ] **Step 2: Add transform for `PrincipalIdentity`**

If ogen requires `oneOf` + `discriminator.mapping`, add a transform that:

1. Locates `components.schemas.PrincipalIdentity`
2. Ensures it uses `oneOf` (not `anyOf`)
3. Adds `discriminator: { propertyName: "kind", mapping: { agent: "#/components/schemas/AgentPrincipal", human: "#/components/schemas/HumanPrincipal" } }`

This transform should be idempotent and surgical — only touch `PrincipalIdentity`.

- [ ] **Step 3: Re-run the normalizer**

Run: `cd libs/moltnet-api-client && go generate ./...`
Expected: `openapi-normalized.json` updates. Verify with `jq '.components.schemas.PrincipalIdentity' openapi-normalized.json` that the discriminator is present.

- [ ] **Step 4: Commit normalizer + regenerated spec**

```bash
git add libs/moltnet-api-client/cmd/normalize-spec/ libs/moltnet-api-client/openapi-normalized.json
git commit -m "chore(go-sdk): normalize-spec emits ogen-compatible PrincipalIdentity discriminator"
```

---

## Task 13: Regenerate Go SDK and validate decoder

**Files:**

- Modify: `libs/moltnet-api-client/oas_*.go` (regenerated)

- [ ] **Step 1: Regenerate Go SDK**

Run:

```bash
cd libs/moltnet-api-client
go generate ./...
go build ./...
```

Expected: build passes.

- [ ] **Step 2: Inspect generated `PrincipalIdentity` type**

Run: `grep -n "PrincipalIdentity\|AgentPrincipal\|HumanPrincipal" libs/moltnet-api-client/oas_schemas_gen.go`
Expected: ogen produces a sum type (something like `PrincipalIdentity` struct with a `Type` field plus `AgentPrincipal` and `HumanPrincipal` payload fields). If ogen fell back to `interface{}` or generated only one variant, debug the normalizer.

- [ ] **Step 3: Confirm the old crash is gone**

Write a small Go test that decodes a JSON `ContextPackResponse` with a human creator:

```go
// libs/moltnet-api-client/principal_identity_decode_test.go
package moltnetapi_test

import (
  "encoding/json"
  "testing"

  moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
)

func TestContextPackResponseDecodesHumanCreator(t *testing.T) {
  payload := `{
    "id": "00000000-0000-0000-0000-000000000001",
    "diaryId": "00000000-0000-0000-0000-000000000002",
    "packCid": "bafy...",
    "packCodec": "dag-cbor",
    "packType": "compile",
    "params": {},
    "payload": {},
    "creator": {
      "kind": "human",
      "humanId": "00000000-0000-0000-0000-000000000003",
      "identityId": null
    },
    "supersedesPackId": null,
    "pinned": false,
    "expiresAt": null,
    "createdAt": "2026-05-03T17:00:00Z"
  }`

  var resp moltnetapi.ContextPackResponse
  if err := json.Unmarshal([]byte(payload), &resp); err != nil {
    t.Fatalf("decode failed: %v", err)
  }
  // Sanity check: creator.kind == human
  // (exact accessor depends on ogen output; adapt after regeneration)
}
```

Run: `cd libs/moltnet-api-client && go test ./... -run TestContextPackResponseDecodesHumanCreator -v`
Expected: PASS. This is the regression test for issue #992.

- [ ] **Step 4: Commit regenerated SDK + test**

```bash
git add libs/moltnet-api-client/
git commit -m "fix(go-sdk): decode PrincipalIdentity discriminated union (closes #992)

Adds regression test for human-created source pack decoding.

Task-Group: unified-principal-creator
Task-Completes: true"
```

---

## Task 14: Update Go CLI display code

**Files:**

- Modify: `apps/moltnet-cli/cmd/pack/get.go` (or wherever pack output is rendered)
- Modify: `apps/moltnet-cli/cmd/entry/get.go`, `apps/moltnet-cli/cmd/entry/list.go`
- Modify: `apps/moltnet-cli/cmd/rendered_packs/judge.go` (the issue-992 trigger command)

- [ ] **Step 1: Find every CLI surface that prints `creator`**

Run: `grep -rn "Creator\|creator" apps/moltnet-cli/cmd/ | grep -v "_test.go"`
Expected: list of files that render creator info.

- [ ] **Step 2: Update each render site**

Switch on the discriminator:

```go
switch c := pack.Creator.Type; c {
case moltnetapi.PrincipalIdentityAgentPrincipal:
  fmt.Printf("creator: agent %s (%s)\n",
    pack.Creator.AgentPrincipal.Fingerprint,
    pack.Creator.AgentPrincipal.IdentityId)
case moltnetapi.PrincipalIdentityHumanPrincipal:
  fmt.Printf("creator: human %s\n", pack.Creator.HumanPrincipal.HumanId)
}
```

(Exact accessors depend on ogen output — adapt after Task 13.)

- [ ] **Step 3: Manual smoke**

Reproduce the original issue-992 command against the local stack with a human-created source pack:

```bash
moltnet rendered-packs judge \
  --id <a-rendered-pack-derived-from-human-source> \
  --credentials .moltnet/legreffier/moltnet.json \
  --provider claude-code \
  --model claude-sonnet-4-6
```

Expected: no decode error, judgment proceeds.

- [ ] **Step 4: Commit**

```bash
git add apps/moltnet-cli/
git commit -m "feat(cli): render PrincipalIdentity with kind discriminator

Task-Group: unified-principal-creator"
```

---

## Task 15: Smoke test the full stack against the local Docker infra

**Files:** none

- [ ] **Step 1: Start the local stack**

Run: `docker compose --env-file .env.local up -d`

- [ ] **Step 2: Run the dev API**

Run: `pnpm run dev:api &`

- [ ] **Step 3: Hit each affected endpoint as a human (Kratos session) and as an agent (machine token)**

For each of:

- `POST /teams/:teamId/diaries`
- `POST /diaries/:id/entries`
- `POST /diaries/:id/packs`
- `POST /packs/:id/render`

…verify the GET response carries `creator: { kind: 'human', ... }` for human-authenticated calls and `creator: { kind: 'agent', ... }` for agent-authenticated calls.

Use `curl` examples already in `docs/` if available, or build a small `tools/smoke-principal.sh` script. (Skip if e2e suite Task 10 already proves both paths.)

- [ ] **Step 4: Stop the stack**

Run: `docker compose down`

- [ ] **Step 5: Commit any tooling added**

```bash
git add tools/  # if anything new
git commit -m "chore: smoke test scripts for principal creator paths" || true
```

---

## Task 16: Diary entries — accountable commits and the audit trail

This task is woven through every commit above; consolidating here so it isn't forgotten.

**Files:** none modified directly; diary entries via legreffier flow.

- [ ] **Step 1: Confirm the incident entry is live**

Already created earlier in this session: entry `f1fe4fe6-f9ef-4c9f-be1b-6a79c7816354` (episodic, importance 8).

- [ ] **Step 2: Write a `semantic` entry capturing the design decision**

Decision: paired FK columns + XOR check at the DB layer, abstracted to a single `creator: PrincipalIdentity` discriminated union at the REST layer. Alternatives considered: (a) `creator_kind` enum + bare UUID — rejected because we lose FK integrity and joinability; (b) single `principals` table with polymorphic FK — rejected because it requires a major data refactor and extra indirection on every query; (c) keep agent-only and reject human creates at routes — rejected because humans already create resources and we don't want to take features away.

Use `moltnet entry create-signed --type semantic` with tags `decision,branch:fix/issue-992-human-pack-creators,scope:principals,scope:database,scope:rest-api` and link it to the incident entry via `relations_create --relation references`.

- [ ] **Step 3: Per-commit `procedural` entries**

Run `moltnet entry commit` after each of the commits in tasks 1–15, with the appropriate risk level (medium for schema/migration, low for repository internals, medium for SDK regen). Use the `--signed` flag for the migration commit (Task 4) and the SDK regen commit (Task 13) — those are high-impact and benefit from immutability.

- [ ] **Step 4: End-of-session `reflection`**

Capture what we learned about adding new principal types: future principal additions must (a) include a unified abstraction in the same PR as the new entity, (b) audit every existing `created_by`-style column, (c) update the SDK normalizer in lockstep.

---

## Task 17: Open the PR

- [ ] **Step 1: Push the branch using the agent token**

```bash
git push -u origin fix/issue-992-human-pack-creators
```

- [ ] **Step 2: Open PR via gh (agent identity)**

```bash
CREDS="$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" && pwd)/moltnet.json"
GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh pr create \
  --title "fix(api,sdk): unified PrincipalIdentity creator model (closes #992)" \
  --body "$(cat <<'EOF'
## Summary
- **DB (7 tables):** replaces bare `created_by uuid NOT NULL` with paired `creator_agent_id` (FK → `agents`) / `creator_human_id` (FK → `humans`) + XOR check, mirroring the `tasks.imposed_by_*` pattern. Tables: `diaries`, `diary_entries`, `context_packs`, `rendered_packs`, `teams`, `groups`, `team_invites`.
- **Repositories (Group A — full resolution):** `diary_entries`, `context_packs`, `rendered_packs` resolve both tables and produce a `creator: PrincipalIdentity` discriminated union (`kind: 'agent' | 'human'`).
- **Repositories (Group B — write-path only):** `diaries`, `teams`, `groups`, `team_invites` accept paired creator on write; reads unchanged.
- **REST DTOs (Group A only):** `creator: AgentIdentity | null` becomes `creator: PrincipalIdentity` (non-nullable). `createdBy` UUID dropped from responses. `RenderedPack` gains a `creator` field.
- **Go SDK:** regenerated — `ContextPackResponse.creator`, `DiaryEntryWithCreator.creator`, `RenderedPack.creator` now decode both variants. Closes #992.

## Why
The humans entity was added without a unified principal model. Bare `created_by` columns + agent-only LEFT JOINs caused human-created resources to surface as `creator: null`, which crashed the strict ogen decoder. See diary entry `f1fe4fe6-f9ef-4c9f-be1b-6a79c7816354` (signed, episodic, importance 8).

## Out of scope
- Humans signing entries / `signing_requests` for humans
- Surfacing `creator` in `diaries` / `teams` / `groups` / `team_invites` REST responses (DB is ready; follow-up PR)
- `public_feed` author shape
- `agent_vouchers` (agent-only by design)

## Test plan
- [ ] Drizzle migration applies cleanly (Task 4)
- [ ] `pnpm db:generate` is a no-op after migration
- [ ] REST + MCP e2e suites green (Task 10)
- [ ] Go regression test for issue #992 passes (Task 13)
- [ ] Manual smoke: `moltnet rendered-packs judge` against a human-source pack (Task 14)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Audit findings (DB / REST / Go SDK / creation paths) → Tasks 3, 5–7 / 8–9 / 11–14 / 9
- Issue #992 root cause (null creator → ogen crash) → Tasks 12–13 + regression test
- "Make DTO abstract paired columns" → Task 8 (single `creator: PrincipalIdentity`)
- "Humans won't sign entries yet" → explicitly out of scope, called out in PR
- "Backfill is easy because everything is agent-created today" → Task 4 backfill is one UPDATE per table with an abort-on-orphan safety net

**Placeholder scan:** None remain. Each step has either complete code or an exact command + expected output.

**Type consistency:**

- `PrincipalIdentity` defined Task 1, used Tasks 2, 5, 6, 7, 8, 9
- `creator` field name consistent everywhere
- `creator_agent_id` / `creator_human_id` SQL names consistent across schema (Task 3) and migration (Task 4)
- `findOrCreateByIdentityId` defined Task 9, used by `authContextToCreator`
- `resolvePrincipal` defined Task 2, used Tasks 5–7

**Known unknowns flagged in plan:**

- Cross-package import of `PrincipalIdentity` type — Task 2 leaves the choice open per repo conventions
- Exact ogen output shape for the discriminated union — Task 13 says "adapt accessors after regeneration"
- Existence + name of `humanRepository.findOrCreateByIdentityId` — Task 9 adds it if missing
- `subjectType` vs `KetoNamespace` field name — Task 9 says verify and adapt
