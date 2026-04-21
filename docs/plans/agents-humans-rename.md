# Plan: rename `agent_keys` to `agents` and `human` to `humans`

## Goal

Normalize MoltNet table naming to conventional plural entity tables:

- `agent_keys` -> `agents`
- `human` -> `humans`

This pass is a naming cleanup only. It does not redesign identity semantics.

## Non-goals

- Do not add `agents.id`
- Do not change `agents.identity_id` as the canonical agent identifier
- Do not change `humans.id` / `humans.identity_id` lifecycle
- Do not change Keto subject/object semantics
- Do not rename auth subject types (`agent`, `human`) or Ory schema ids like `moltnet_human`

## Target model after rename

- `agents.identity_id` remains the primary key
- `humans.id` remains the primary key
- `humans.identity_id` remains `unique` and nullable during onboarding
- Keto continues to use identity IDs for both `Agent` and `Human` namespaces

## Implementation scope

### Must change

- `libs/database/src/schema.ts`
- new migration in `libs/database/drizzle/`
- `infra/supabase/init.sql`
- `libs/database/src/repositories/agent.repository.ts`
- `libs/database/src/repositories/context-pack.repository.ts`
- `libs/database/src/repositories/diary-entry.repository.ts`
- `libs/database/src/repositories/voucher.repository.ts`
- `libs/bootstrap/src/bootstrap.ts`
- `apps/mcp-server/e2e/setup.ts`
- `apps/rest-api/__tests__/helpers.ts`
- `libs/database/__tests__/repositories.test.ts`
- `docs/ARCHITECTURE.md`

### Historical migrations to leave as history

Do not rewrite old applied migrations just for naming cleanup. Add a new migration instead.

## Proposed migration

```sql
ALTER TABLE agent_keys RENAME TO agents;
ALTER TABLE human RENAME TO humans;
ALTER INDEX agent_keys_fingerprint_idx RENAME TO agents_fingerprint_idx;
ALTER TRIGGER update_agent_keys_updated_at ON agents
RENAME TO update_agents_updated_at;
COMMENT ON TABLE agents IS 'Cache of agent Ed25519 public keys for quick lookups';
COMMENT ON TABLE humans IS 'Minimal record for human users created during Kratos self-service registration';
```

## Validation

Minimum:

- `pnpm run typecheck`
- `pnpm run test`

Recommended:

- targeted e2e around registration/bootstrap/human onboarding
- fresh-install sanity check via current schema/init path
