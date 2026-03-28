# Plan: Context Pack Injection via Server-Side Bindings

**Issue**: #518
**Status**: Draft — ready for review
**Date**: 2026-03-28

## Problem

The identity-memory-evaluation loop is missing a context injection
mechanism. Diary entries are captured and compiled into packs, but
there is no way to:

1. Declare **when** a pack should be injected (routing conditions)
2. **Track the transformation** from raw pack export to refined
   documentation (the artifact evals actually score)
3. Keep bindings **alive** when packs are superseded
4. Work **cross-platform** (Claude Code, Codex, future agents)

Two parallel abstractions — "tiles" and "nuggets" — attempted to
solve parts of this but introduced concepts outside the pack model.
This plan replaces both with pack bindings and rendered packs.

## Design decisions

### 1. `rendered` pack type — closing the provenance gap

Today's pipeline has an invisible transformation step:

```
compile pack (CID₁)
  → pack export (raw markdown)
    → Phase 6 transformation (refine, deduplicate, structure)
      → ??? (no CID, no provenance)
        → eval scores ??? (attributes to compile CID₁ — wrong)
```

The transformation produces the most valuable artifact — structured,
actionable docs — but it has no identity. Evals score the transformed
output and attribute it to the compile pack, which is a different
artifact.

**Solution**: new `rendered` pack type, following the `optimized`
pattern (which already stores `sourcePackCid`):

```
compile pack (CID₁)
  → render
    → rendered pack (CID₂)
      → bind → resolve → inject
```

```typescript
interface RenderedParams {
  sourcePackCid: string;   // compile/custom pack this was rendered from
  renderMethod: string;    // "pack-to-docs-v1", "agent-refined", etc.
  contentHash: string;     // SHA-256 of the rendered markdown
}
```

**Key constraint: rendered packs do NOT supersede the source pack.**
The compile/custom pack is the source of truth. The rendered pack
is the consumable layer — a presentation of the same entries. They
coexist. The rendered pack references its source via
`params.sourcePackCid` only (same pattern as `optimized` packs).
`supersedesPackId` is NOT used for this relationship.

At most one rendered pack per source pack should be active. The
resolver picks the rendered version when available, falls back to
raw export when not.

A rendered pack:

- Has the **same entries** as its source (same entry IDs, same ranks)
- Stores the **transformed markdown** in its `payload` field
- Has its **own CID** (computed from rendered content + source ref)
- References source via `params.sourcePackCid` (NOT `supersedesPackId`)
- Is what **bindings prefer** (resolve returns rendered when
  available, falls back to raw export)
- Is what **evals score** (eval results reference the rendered CID)

This fixes eval attribution:

```
GEPA scores rendered pack CID₂
  → references compile pack CID₁ via sourcePackCid
    → references entries via entry CIDs
  → re-rendering same compile pack differently → different CID₂
    → separate eval score
```

### 2. `pack_bindings` table — routing conditions

Server-side model mapping packs to injection conditions:

```
pack_bindings
├── id: uuid PK
├── diary_id: uuid FK → diaries.id (CASCADE)
├── pack_id: uuid FK → context_packs.id (CASCADE)
├── name: varchar
├── tier: enum('always' | 'conditional')
├── conditions: jsonb {
│     paths?: string[]          # glob patterns
│     branches?: string[]       # glob patterns
│     task_classes?: string[]   # semantic labels
│   }
├── active: boolean
├── created_by: uuid
├── created_at: timestamp
└── updated_at: timestamp
```

**Bindings point to the source pack** (compile/custom). The resolver
looks up the rendered version at resolve time via `sourcePackCid` in
rendered pack params. This means supersession propagation only tracks
source pack chains.

**Supersession propagation**: DB trigger on `context_packs` INSERT.
When a new pack sets `supersedes_pack_id`, all active bindings
pointing to the old pack auto-update to the new one. The binding
stays stable; the underlying pack evolves.

### 3. `packs_resolve` — conditional multi-pack export

The injection mechanism. Same rendering as `moltnet pack export`,
but for N packs selected by binding conditions:

1. Evaluate which bindings match context signals (branch, paths, task)
2. Fetch each matching pack — prefer `rendered`, fall back to raw
3. Return markdown — agent reads it directly

```
POST /diaries/:id/pack-bindings/resolve
{
  "branch": "feat/api-new-route",
  "changed_paths": ["apps/rest-api/src/routes/foo.ts"],
  "task_prompt": "Adding a new authenticated REST API route",
  "tier": "always"
}
```

```
{
  "items": [
    {
      "binding": { "name": "rest-api-conventions", "tier": "always" },
      "pack_id": "...",
      "pack_cid": "bafyr...",
      "pack_type": "rendered",
      "content": "## REST API Conventions\n\n### Route Structure\n...",
      "total_tokens": 3200
    }
  ],
  "total": 2,
  "total_tokens": 5200
}
```

**Token budget**: Individual packs are already capped at 100000
tokens (same as entry content). The resolve endpoint does not impose
an aggregate cap in V1 — the binding design (3-7 packs max per
session, per the research findings) naturally limits total volume.
A `total_token_budget` parameter can be added in V2 if needed.

### 4. V1 scope

- **`always` tier**: auto-injected at session start via
  `.claude/rules/context-packs.md`
- **`conditional` tier**: exists in the model, resolved on-demand
  when agent calls `packs_resolve` with context signals
- **No automated mid-session probing** (deferred to V2)
- **No CLI `pack resolve`** (binary built separately)

## API surface

### REST endpoints

| Method | Path                                 | Auth            |
| ------ | ------------------------------------ | --------------- |
| GET    | `/diaries/:id/pack-bindings`         | `canReadDiary`  |
| POST   | `/diaries/:id/pack-bindings`         | `canWriteDiary` |
| POST   | `/diaries/:id/pack-bindings/resolve` | `canReadDiary`  |
| PATCH  | `/pack-bindings/:id`                 | `canManageDiary`|
| DELETE | `/pack-bindings/:id`                 | `canManageDiary`|

### MCP tools

- `pack_bindings_list` — list bindings for a diary
- `pack_bindings_create` — create a new binding
- `pack_bindings_update` — modify conditions/tier/active
- `pack_bindings_delete` — remove binding
- `packs_resolve` — evaluate bindings, return matching pack content

### Authorization

No new Keto namespace. Bindings inherit diary permissions. The
bound packs already have `ContextPack#parent@Diary` relations.

## Implementation steps

### Step 1: Schema changes

**1a. Extend pack type enum**

`libs/database/src/schema.ts` — add `'rendered'` to `packTypeEnum`.

`libs/crypto-service/src/pack-cid.ts` — add `RenderedParams` to
the `PackEnvelopeInput` discriminated union.

**1b. Add `pack_bindings` table**

`libs/database/src/schema.ts`:

- New enum: `bindingTierEnum` (`'always'` | `'conditional'`)
- New table: `packBindings`
- Indexes: `diaryId`, `packId`, unique `(diaryId, packId)`
- Type exports: `PackBinding`, `NewPackBinding`

**1c. Generate migrations**

```bash
pnpm db:generate              # auto SQL for enum + table
pnpm db:generate -- --custom --name pack-binding-supersession-trigger
```

Custom migration contains the supersession trigger:

```sql
CREATE OR REPLACE FUNCTION propagate_pack_supersession_to_bindings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supersedes_pack_id IS NOT NULL THEN
    UPDATE pack_bindings
    SET pack_id = NEW.id, updated_at = now()
    WHERE pack_id = NEW.supersedes_pack_id AND active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pack_supersession_binding_update
  AFTER INSERT ON context_packs
  FOR EACH ROW
  WHEN (NEW.supersedes_pack_id IS NOT NULL)
  EXECUTE FUNCTION propagate_pack_supersession_to_bindings();
```

### Step 2: Repository

Create `libs/database/src/repositories/pack-binding.repository.ts`.

Following `context-pack.repository.ts` pattern:

- `create`, `findById`, `listByDiary`, `update`, `delete`
- `resolveForDiary(diaryId, { tier? })` — joins to `contextPacks` +
  `contextPackEntries` + `diaryEntries`; prefers `rendered` type

Export from `libs/database/src/index.ts`.

### Step 3: TypeBox schemas

`apps/rest-api/src/schemas.ts`:

- `BindingTierSchema`, `BindingConditionsSchema`, `PackBindingSchema`
- `CreatePackBindingBody`, `UpdatePackBindingBody`
- `ResolvePackBindingsBody`, `ResolvePackBindingsResponse`
- `RenderedParamsSchema` (for rendered pack creation)

`apps/mcp-server/src/schemas.ts`:

- `PackBindingsListSchema`, `PackBindingsCreateSchema`,
  `PackBindingsUpdateSchema`, `PackBindingsDeleteSchema`,
  `PacksResolveSchema`

### Step 4: REST API routes

Create `apps/rest-api/src/routes/pack-bindings.ts` — 5 routes.

Modify existing pack creation route to accept
`packType: 'rendered'` with `RenderedParams`.

Wire into `apps/rest-api/src/app.ts`.

### Step 5: MCP tools

Create `apps/mcp-server/src/pack-binding-tools.ts` — 5 tools.

`packs_resolve` renders matching pack contents as markdown
(rendered packs returned as-is payload, compile/custom packs
fall back to raw export format).

Depends on API client regeneration after step 4.

### Step 6: Injection rule

Create `.claude/rules/context-packs.md`:

```markdown
# Context Pack Auto-Injection

At session start, if MoltNet MCP tools are available and a diary
ID is resolved:

1. Call `packs_resolve` with `tier: "always"` for the active diary
2. Read returned pack payloads into working context
3. For conditional packs, call `packs_resolve` on-demand when
   task scope matches binding conditions (paths, branches, task classes)
```

### Step 7: Terminology cleanup

| File | Change |
| ---- | ------ |
| `.claude/skills/legreffier-consolidate/SKILL.md` | "tiles" → "compiled packs" |
| `.claude/skills/legreffier-consolidate/references/consolidation-approach.md` | Same |
| `.claude/skills/legreffier-scan/SKILL.md` | "nugget" → "pack binding" |
| `.claude/skills/legreffier-scan/references/content-templates.md` | "rule nuggets" → "pack observations" |
| `.claude/skills/legreffier-scan/references/scan-flows.md` | Same |
| `.claude/skills/legreffier-explore/SKILL.md` | "tiles" → "rendered packs", Phase 6 produces `rendered` type |
| `docs/CONTEXT_PACK_GUIDE.md` | Add binding + rendering workflow |
| `docs/research/scan-to-rules-experiment.md` | "nugget" → "pack binding" |
| `docs/research/scan-consolidation-approach.md` | Same |

### Step 8: Tests

| Layer | File | Reference |
| ----- | ---- | --------- |
| Repository | `libs/database/__tests__/pack-binding.repository.test.ts` | `repositories.test.ts` |
| Routes | `apps/rest-api/__tests__/pack-bindings.test.ts` | `packs.test.ts` |
| MCP tools | `apps/mcp-server/__tests__/pack-binding-tools.test.ts` | `pack-tools.test.ts` |
| Rendered CID | `libs/crypto-service/__tests__/pack-cid.test.ts` | Extend existing |
| E2E | `apps/rest-api/e2e/pack-bindings.e2e.test.ts` | `custom-packs.e2e.test.ts` |
| Supersession | Within E2E: verify trigger updates bindings | |

## Execution order

```
1. Schema changes (rendered type + bindings table + trigger)  [blocking]
2. Repository + tests                                         [depends on 1]
3. TypeBox schemas                                             [parallel with 2]
4. REST routes + tests                                         [depends on 2, 3]
5. OpenAPI regen + API client                                  [depends on 4]
6. MCP tools + tests                                           [depends on 5]
7. Injection rule                                              [independent]
8. Terminology cleanup                                         [independent, can be separate PR]
9. E2E tests                                                   [depends on 4]
```

## Terminology migration

| Old concept | New concept |
| ----------- | ----------- |
| tile | compiled pack or rendered pack |
| nugget | pack observation or pack binding |
| nugget acceptance gate | pack binding criteria |
| source:tile tag | source:scan (already canonical) |
| tile-session tag | pack-session tag |
| consolidation → tiles | compilation → rendered packs |

## V2 (future)

- Automated mid-session probing: `PreToolUse` hook on `Edit`/`Write`
  checks file paths against cached binding conditions
- CLI `moltnet pack resolve` command
- Audit log for supersession propagation
- Semantic `task_classes` matching via embeddings (V1 is exact match)
- Aggregate `total_token_budget` parameter on resolve endpoint

## Risks

- **API client regen**: MCP tools import typed functions from
  `@moltnet/api-client`. Routes must be complete before MCP tools
  can reference them.
- **Trigger race condition**: If pack creation and binding creation
  happen concurrently, trigger might miss. Acceptable for V1.
- **Rendered pack size**: transformed markdown in `payload` could be
  large. Consider max payload size validation.

## References

- `docs/research/scan-to-rules-experiment.md` — original nugget protocol
- `docs/CONTEXT_PACK_GUIDE.md` — pack compilation guide
- `libs/database/src/schema.ts` — current pack schema
- `libs/crypto-service/src/pack-cid.ts` — CID computation
- `examples/compile-context.ts` — existing `pack export` usage
- `.claude/skills/legreffier-explore/SKILL.md` — Phase 6 transformation
- [Straion Claude plugin](https://github.com/straion-dev/straion-claude-marketplace) — session hook pattern (inspiration)
