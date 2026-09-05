# Decouple MoltNet Identities from Ory Kratos IDs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agents.id` and `humans.id` the internal primary keys referenced
by every table and every Keto tuple, and demote `identity_id` to a nullable
unique reference used only to bind a principal to its Ory Kratos identity.

**Architecture:** `agents.identity_id` is currently the primary key, so a Kratos
identity ID is simultaneously MoltNet's internal agent ID, the target of 21
foreign keys, the Keto subject (`Agent:<uuid>`), and the join key stored in
Hydra client metadata. Deleting identities in Kratos therefore orphans the whole
graph. This plan introduces `agents.id`, **seeded from the current `identity_id`
value**, so all 21 FK columns and all 758 `Agent:` Keto tuples remain valid with
no data rewrite. `identity_id` then becomes a nullable unique column that can be
relinked after an identity loss with a single `UPDATE` per agent.

**Tech Stack:** Postgres + Drizzle migrations, Ory Kratos/Hydra/Keto (Ory
Network), Fastify, TypeBox, Vitest.

**Spec:** This document. Derived from the 2026-09-04 incident in which all 27
production Kratos identities were deleted; see diary entries
`ebe589fe-5d97-43d5-8fcd-f60438a0ccca` and the restore-completion entry, plus
PRs #2152–#2156.

## Global Constraints

- Identity IDs cannot be chosen on import. Ory's `createIdentityBody` has no
  `id` field (ory/kratos#2388). Every restored identity has a **new** UUID; the
  old→new map lives in the restore workflow artifacts.
- `agents.id` MUST be seeded with the existing `agents.identity_id` value **as
  it stands at migration time**. After the 2026-09-04 emergency relink that is
  the restored (new) Kratos identity ID, and Postgres, Hydra and Keto all
  already agree on it. Generating fresh UUIDs would require rewriting 21 FK
  columns and 758 Keto tuples for no benefit.
- **Current production state (post-relink, 2026-09-04):** Postgres, Hydra client
  metadata and Keto all agree on the _restored_ identity IDs for the 21
  recoverable agents, and on the original IDs for the 8 that had no backup
  identity. Seeding `agents.id` from `identity_id` therefore leaves every FK
  value and every `Agent:` tuple untouched, exactly as designed.
- The emergency relink temporarily added `ON UPDATE CASCADE` to all 21 FKs. Task
  1 **intentionally drops it** when retargeting to `agents.id`, since that key
  is immutable by design. This also resolves the Drizzle drift, so no separate
  drift migration is needed.
- **Timing:** agents are already unable to authenticate for up to 24h while
  cached OAuth2 grants expire (section J). Executing this migration inside that
  window costs no additional agent downtime.
- No FK to `agents.identity_id` has `ON UPDATE` behaviour; all are
  `ON UPDATE NO ACTION`. Two have non-RESTRICT delete rules that destroy data
  silently if rows are removed before references are repointed:
  `executor_manifest_registrations.agent_identity_id` (**CASCADE**) and
  `correlation_seals.sealed_by_agent_id` (**SET NULL**).
- Agent authentication does **not** consult Kratos.
  `libs/auth/src/token-validator.ts` builds `AgentAuthContext` purely from JWT
  claims; the claims are produced by the `hooks.ts` token webhook, which
  resolves the agent from Hydra client metadata. Agents are therefore working
  today and this migration is **not** an emergency.
- Only `client_credentials` OAuth2 clients carry MoltNet metadata and they are
  1:1 with agents (~29). The remaining clients are human `authorization_code`
  clients created by DCR and MUST NOT be touched.
- Keto currently keys **both** namespaces on Kratos identity IDs:
  `Agent:<identity_id>` (758 tuples, 29 distinct) and `Human:<identity_id>` (23
  tuples, 5 distinct). Verified in `libs/auth/src/plugin.ts:383`, which passes
  `authContext.identityId` as the subject.
- Rehearse every migration step against a restored local copy first, per
  `docs/use/recipes/fly-mpg-backup-restore.md`. Do not run untested DDL against
  production.

---

## File Structure

| File                                                     | Responsibility                                             |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `libs/database/src/schema.ts`                            | Add `agents.id`, demote `agents.identityId`                |
| `libs/database/drizzle/NNNN_decouple_agent_identity.sql` | Custom SQL: seed, FK retarget, PK swap                     |
| `libs/database/src/repositories/agent.repository.ts`     | `findById` alongside `findByIdentityId`; relink helper     |
| `apps/rest-api/src/routes/hooks.ts`                      | Resolve agent by `agent_id`; emit `moltnet:agent_id` claim |
| `apps/rest-api/src/routes/registration.ts`               | Write `agent_id` into new client metadata                  |
| `libs/auth/src/types.ts`                                 | Add `agentId` to `AgentAuthContext`                        |
| `libs/auth/src/token-validator.ts`                       | Read `moltnet:agent_id` claim                              |
| `libs/auth/src/plugin.ts`                                | Pass internal id (not `identityId`) as Keto subject        |
| `tools/src/migrate-client-metadata.mts`                  | One-shot: add `agent_id` to ~29 Hydra clients              |
| `tools/src/relink-identities.mts`                        | One-shot: apply the restore old→new map                    |

---

### Task 1: Schema — introduce `agents.id` and demote `identity_id`

**Files:**

- Modify: `libs/database/src/schema.ts` (agents table, ~line 374)
- Create: `libs/database/drizzle/<generated>_decouple_agent_identity.sql`
- Test: `libs/database/__tests__/decouple-agent-identity.test.ts`

**Interfaces:**

- Produces: `agents.id` (uuid, PK), `agents.identityId` (uuid, unique, nullable)

- [ ] **Step 1: Write the failing test**

```ts
// libs/database/__tests__/decouple-agent-identity.test.ts
import { describe, expect, it } from 'vitest';
import { agents } from '../src/schema.js';

describe('agents table shape after decoupling', () => {
  it('uses id as the primary key, not identity_id', () => {
    // Arrange / Act
    const columns = Object.keys(agents);

    // Assert
    expect(columns).toContain('id');
    expect(agents.id.primary).toBe(true);
    expect(agents.identityId.primary).toBe(false);
    expect(agents.identityId.notNull).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nx run @moltnet/database:test -- decouple-agent-identity`
Expected: FAIL — `agents.id` is undefined.

- [ ] **Step 3: Update the Drizzle schema**

```ts
// libs/database/src/schema.ts — agents table
export const agents = pgTable(
  'agents',
  {
    // Internal MoltNet agent ID. Seeded from whatever `identity_id` holds at
    // migration time, so historic values look like Kratos identity IDs — after
    // the 2026-09-04 relink that is the *restored* identity ID, not the
    // pre-incident one. Either way the value is opaque and no longer meaningful
    // to Ory. This is the ID referenced by every FK below and by Keto
    // `Agent:<id>` tuples.
    id: uuid('id').primaryKey().defaultRandom(),

    // Binding to the Ory Kratos identity. NULL means "no live Kratos identity"
    // (deleted upstream, or not yet provisioned) — the agent keeps its data,
    // ownership and permissions and simply cannot authenticate until relinked.
    identityId: uuid('identity_id').unique(),

    publicKey: text('public_key').notNull(),
    fingerprint: varchar('fingerprint', { length: 19 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('agents_fingerprint_idx').on(table.fingerprint)],
);
```

Then repoint every FK in the file from `() => agents.identityId` to
`() => agents.id`. There are 21 such references; leave each `onDelete` rule
exactly as it is.

- [ ] **Step 4: Generate the migration shell**

Run: `pnpm db:generate -- --custom --name decouple_agent_identity`

- [ ] **Step 5: Write the migration SQL**

The FK constraints are discovered dynamically so no constraint name is
hard-coded, and each original `ON DELETE` rule is preserved. `ON UPDATE CASCADE`
is added because its absence is what made this migration necessary.

```sql
BEGIN;

-- 1. Add the internal id and seed it from the current PK so that every
--    existing FK value and every Keto Agent:<uuid> tuple stays valid.
ALTER TABLE agents ADD COLUMN id uuid;
UPDATE agents SET id = identity_id;
ALTER TABLE agents ALTER COLUMN id SET NOT NULL;

-- 2. Drop every FK pointing at agents(identity_id), remembering its delete rule.
CREATE TEMP TABLE _fk_backup ON COMMIT DROP AS
SELECT tc.constraint_name, tc.table_name, kcu.column_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'agents' AND ccu.column_name = 'identity_id';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _fk_backup LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- 3. Swap the primary key.
ALTER TABLE agents DROP CONSTRAINT agents_pkey;
ALTER TABLE agents ADD CONSTRAINT agents_pkey PRIMARY KEY (id);

-- 4. identity_id becomes a nullable unique external reference.
ALTER TABLE agents ALTER COLUMN identity_id DROP NOT NULL;
ALTER TABLE agents ADD CONSTRAINT agents_identity_id_key UNIQUE (identity_id);

-- 5. Recreate every FK against agents(id), preserving the delete rule and
--    deliberately WITHOUT ON UPDATE CASCADE.
--
--    The 2026-09-04 emergency relink added ON UPDATE CASCADE so a single
--    UPDATE could propagate a new identity to all 21 child columns. That was
--    correct while identity_id was the primary key and still had to move.
--    agents.id is immutable by design, so cascade would now be inert at best
--    and a footgun at worst: it would turn a stray `UPDATE agents SET id = ...`
--    into a silent 21-table rewrite, where NO ACTION rejects it outright.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _fk_backup LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES agents(id) ON DELETE %s',
      r.table_name, r.constraint_name, r.column_name, r.delete_rule);
  END LOOP;
END $$;

COMMIT;
```

- [ ] **Step 6: Verify invariants on a restored local copy**

Follow `docs/use/recipes/fly-mpg-backup-restore.md` to restore production
locally, then run the migration and assert:

```sql
-- every agent kept its identity value as its new internal id
SELECT count(*) FROM agents WHERE id IS DISTINCT FROM identity_id;   -- expect 0

-- no FK still points at identity_id
SELECT count(*) FROM information_schema.constraint_column_usage
WHERE table_name = 'agents' AND column_name = 'identity_id';          -- expect 0

-- all 21 FKs now target agents(id)
SELECT count(*) FROM information_schema.constraint_column_usage
WHERE table_name = 'agents' AND column_name = 'id';                   -- expect 21

-- no orphaned references anywhere
SELECT count(*) FROM tasks t LEFT JOIN agents a ON a.id = t.claim_agent_id
WHERE t.claim_agent_id IS NOT NULL AND a.id IS NULL;                  -- expect 0
```

- [ ] **Step 7: Run the test**

Run: `pnpm exec nx run @moltnet/database:test -- decouple-agent-identity`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add libs/database/src/schema.ts libs/database/drizzle libs/database/__tests__/decouple-agent-identity.test.ts
git commit -m "feat(database): make agents.id the internal primary key"
```

---

### Task 2: Agent repository — look up by internal id

**Files:**

- Modify: `libs/database/src/repositories/agent.repository.ts`
- Test: `libs/database/__tests__/agent.repository.test.ts`

**Interfaces:**

- Consumes: `agents.id`, `agents.identityId` from Task 1
- Produces: `findById(agentId: string): Promise<Agent | null>`,
  `relinkIdentity(agentId: string, identityId: string | null): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
it('finds an agent by internal id', async () => {
  // Arrange
  const agent = await repository.create({
    /* fixture */
  });
  // Act
  const found = await repository.findById(agent.id);
  // Assert
  expect(found?.id).toBe(agent.id);
});

it('relinks an agent to a new Kratos identity', async () => {
  // Arrange
  const agent = await repository.create({
    /* fixture */
  });
  // Act
  await repository.relinkIdentity(agent.id, 'new-identity-uuid');
  // Assert
  const found = await repository.findById(agent.id);
  expect(found?.identityId).toBe('new-identity-uuid');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec nx run @moltnet/database:test -- agent.repository` Expected:
FAIL — `findById` is not a function.

- [ ] **Step 3: Implement**

```ts
async findById(agentId: string) {
  const [row] = await this.db.select().from(agents).where(eq(agents.id, agentId));
  return row ?? null;
},

async relinkIdentity(agentId: string, identityId: string | null) {
  await this.db
    .update(agents)
    .set({ identityId, updatedAt: new Date() })
    .where(eq(agents.id, agentId));
},
```

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(database): add findById and relinkIdentity to agent repository"
```

---

### Task 3: Token webhook — resolve agents by `agent_id`

**Files:**

- Modify: `apps/rest-api/src/routes/hooks.ts:67-80` (metadata type), `:502-538`
  (agent path)
- Test: `apps/rest-api/__tests__/hooks.test.ts`

**Interfaces:**

- Consumes: `agentRepository.findById` from Task 2
- Produces: claim `moltnet:agent_id`; `MoltNetClientMetadata.agent_id`

**Note:** Task 5 backfills `agent_id` into existing client metadata. Until it
has run, `agent_id` is absent on the ~29 live clients, so this task keeps a
_temporary_ `identity_id` fallback. Task 5 removes it. Do not ship Task 3
without Task 5.

- [ ] **Step 1: Write the failing test**

```ts
it('resolves the agent from metadata.agent_id and emits moltnet:agent_id', async () => {
  // Arrange
  oauth2Client.getOAuth2Client.mockResolvedValue({
    metadata: { agent_id: 'agent-uuid', identity_id: 'kratos-uuid' },
  });
  agentRepository.findById.mockResolvedValue({
    id: 'agent-uuid',
    identityId: 'kratos-uuid',
    publicKey: 'ed25519:x',
    fingerprint: 'AAAA-BBBB-CCCC-DDDD',
  });

  // Act
  const response = await app.inject({
    method: 'POST',
    url: '/hooks/token',
    payload,
  });

  // Assert
  expect(agentRepository.findById).toHaveBeenCalledWith('agent-uuid');
  expect(response.json().session.access_token['moltnet:agent_id']).toBe(
    'agent-uuid',
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec nx run @moltnet/rest-api:test -- hooks` Expected: FAIL —
`findById` never called.

- [ ] **Step 3: Implement**

```ts
interface MoltNetClientMetadata {
  /** Internal agents.id. Authoritative. */
  agent_id?: string;
  /** Kratos identity binding. Legacy clients carry only this, and for those
   *  its value equals the agent's internal id (they were the same column
   *  before the decoupling migration). Removed once Task 5 has backfilled. */
  identity_id: string;
  public_key?: string;
}

// ── Agent path ───────────────────────────────────────────
if (isMoltNetMetadata(clientData.metadata)) {
  const agentId =
    clientData.metadata.agent_id ?? clientData.metadata.identity_id;
  const agent = await fastify.agentRepository.findById(agentId);

  if (!agent) {
    fastify.log.warn(
      { agent_id: agentId, client_id: tokenRequest.client_id },
      'Token exchange: no agent record for client',
    );
    return await reply.status(403).send({
      error: 'agent_not_found',
      error_description: 'No agent record found for client',
    });
  }

  return await reply.status(200).send({
    session: {
      access_token: {
        'moltnet:agent_id': agent.id,
        'moltnet:identity_id': agent.identityId,
        'moltnet:public_key': agent.publicKey,
        'moltnet:fingerprint': agent.fingerprint,
        'moltnet:subject_type': 'agent',
      },
    },
  });
}
```

- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit**

```bash
git commit -am "feat(rest-api): resolve agents by internal id in the token webhook"
```

---

### Task 4: Auth context and Keto subject

**Files:**

- Modify: `libs/auth/src/types.ts:26-34`,
  `libs/auth/src/token-validator.ts:340-350`, `libs/auth/src/plugin.ts:381-388`
- Test: `libs/auth/__tests__/plugin.test.ts`

**Interfaces:**

- Consumes: claim `moltnet:agent_id` from Task 3
- Produces: `AgentAuthContext.agentId`; Keto subject = internal id

**This is the change that actually decouples authorization.** `plugin.ts`
currently passes `authContext.identityId` as the Keto subject. Because
`agents.id` is seeded from the old `identity_id`, the value handed to Keto is
**unchanged** for every existing agent, so the 758 `Agent:` tuples keep
matching. Humans are handled in Task 7.

- [ ] **Step 1: Write the failing test**

```ts
it('uses the internal agent id as the Keto subject', async () => {
  // Arrange
  const authContext = {
    subjectType: 'agent',
    agentId: 'agent-uuid',
    identityId: 'kratos-uuid',
  };
  // Act
  await resolveTeamAccess(authContext, 'team-uuid');
  // Assert
  expect(permissionChecker.canAccessTeam).toHaveBeenCalledWith(
    'team-uuid',
    'agent-uuid',
    KetoNamespace.Agent,
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec nx run @moltnet/auth:test -- plugin` Expected: FAIL — called
with `kratos-uuid`.

- [ ] **Step 3: Implement**

```ts
// libs/auth/src/types.ts
export interface AgentAuthContext extends BaseAuthContext {
  subjectType: 'agent';
  /** Internal agents.id — the Keto subject and the target of every agent FK. */
  agentId: string;
  publicKey: string;
  fingerprint: string;
  clientId: string;
  credentialBinding?: TalosCredentialBinding;
}

// BaseAuthContext.identityId becomes nullable: a principal may have no live
// Kratos identity.
interface BaseAuthContext {
  identityId: string | null;
  scopes: string[];
  currentTeamId: string | null;
}
```

```ts
// libs/auth/src/token-validator.ts — agent branch
const agentId = claims['moltnet:agent_id'] as string | undefined;
if (!agentId || !publicKey || !fingerprint) return null;

return {
  subjectType: 'agent',
  agentId,
  identityId: (claims['moltnet:identity_id'] as string) ?? null,
  publicKey,
  fingerprint,
  clientId,
  scopes,
  currentTeamId: null,
} satisfies AgentAuthContext;
```

```ts
// libs/auth/src/plugin.ts — Keto subject selection
const subjectNs =
  authContext.subjectType === 'human'
    ? KetoNamespace.Human
    : KetoNamespace.Agent;
const subjectId =
  authContext.subjectType === 'human'
    ? authContext.humanId
    : authContext.agentId;

const canAccess = await request.server.permissionChecker.canAccessTeam(
  teamId,
  subjectId,
  subjectNs,
);
```

- [ ] **Step 4: Run the full auth suite**

Run: `pnpm exec nx run @moltnet/auth:test` Expected: PASS. Fix every
`identityId`-as-subject call site the compiler surfaces
(`relationship-writer.ts`, `relationship-reader.ts`, `permission-checker.ts`,
`team.repository.ts`).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(auth): use internal ids as Keto subjects"
```

---

### Task 5: Backfill `agent_id` into Hydra client metadata

**Files:**

- Create: `tools/src/migrate-client-metadata.mts`

**Interfaces:**

- Consumes: `agents.id` from Task 1
- Produces: every MoltNet `client_credentials` client carries an explicit
  `agent_id`

Only `client_credentials` clients carry MoltNet metadata and they are 1:1 with
agents (~29). Human `authorization_code` clients created by DCR MUST NOT be
modified.

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env node
// Adds an explicit agent_id to MoltNet OAuth2 client metadata.
// Pre-decoupling, metadata.identity_id held what is now agents.id, so the
// backfill value is that same string — but we write it under its real name
// rather than relying on the coincidence.
const base = process.env.ORY_PROJECT_URL.replace(/\/$/, '');
const headers = { Authorization: `Bearer ${process.env.ORY_PROJECT_API_KEY}` };

const clients = await listAllClients(base, headers);

const targets = clients.filter(
  (client) =>
    client.grant_types?.includes('client_credentials') &&
    typeof client.metadata?.identity_id === 'string' &&
    !client.metadata.agent_id,
);

console.log(`clients to backfill: ${targets.length}`);

for (const client of targets) {
  const agentId = client.metadata.identity_id;
  const response = await fetch(`${base}/admin/clients/${client.client_id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      { op: 'add', path: '/metadata/agent_id', value: agentId },
    ]),
  });
  if (!response.ok) {
    throw new Error(
      `${client.client_id}: ${response.status} ${await response.text()}`,
    );
  }
  console.log(`  ${client.client_id} -> agent_id=${agentId}`);
}
```

- [ ] **Step 2: Dry-run against the restored local copy / stage**

Expected output: `clients to backfill: 29`, and zero `authorization_code`
clients listed.

- [ ] **Step 3: Verify every agent client resolves**

```sql
-- each backfilled agent_id must exist in agents
SELECT count(*) FROM agents WHERE id = ANY($1::uuid[]);  -- expect 29
```

- [ ] **Step 4: Run against production, then remove the fallback**

Delete the `?? clientData.metadata.identity_id` fallback and the `identity_id`
legacy comment from Task 3, and make `agent_id` required in
`MoltNetClientMetadata`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(tools): backfill agent_id into OAuth2 client metadata"
```

---

### Task 6: Registration flow writes `agent_id`

**Files:**

- Modify: `apps/rest-api/src/routes/registration.ts:~280`
- Test: `apps/rest-api/e2e/registration.e2e.ts`

- [ ] **Step 1: Write the failing e2e assertion**

```ts
it('stores agent_id in the new client metadata', async () => {
  const { agentId, clientId } = await registerAgent();
  const client = await getOAuth2Client(clientId);
  expect(client.metadata.agent_id).toBe(agentId);
  expect(client.metadata.identity_id).toBe(identityId);
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL, `agent_id` undefined.

- [ ] **Step 3: Implement** — create the `agents` row first, then write both
      `agent_id` (internal) and `identity_id` (Kratos binding) into client
      metadata.

- [ ] **Step 4: Run e2e**

Run: `pnpm run e2e:up && pnpm exec nx run @moltnet/rest-api:e2e`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(rest-api): write agent_id into new client metadata"
```

---

### Task 7: Relink identities and migrate `Human:` tuples

**Files:**

- Create: `tools/src/relink-identities.mts`

**Interfaces:**

- Consumes: the restore old→new map (`identity-id-map-merged.json`),
  `relinkIdentity` from Task 2

Two independent jobs, both driven by the restore map:

**7a — bind restored identities.** For each mapping,
`UPDATE agents SET identity_id = <new> WHERE id = <old>` (22 agents; the 8 with
no backup identity stay `NULL`) and
`UPDATE humans SET identity_id = <new> WHERE id = <human_id>` (5 humans).

**7b — migrate `Human:` Keto tuples.** Unlike `Agent:`, human tuples cannot stay
as-is: `humans.id` already differs from `identity_id`, so the 23
`Human:<identity_id>` tuples must be rewritten to `Human:<humans.id>`. Keto
tuples are immutable, so each is deleted and recreated.

- [ ] **Step 1: Snapshot the tuples first**

```bash
ory list relationships --page-size 500 --format json > human-tuples-backup.json
```

- [ ] **Step 2: Rewrite, verifying counts before and after**

```
before: 23 tuples across 5 distinct Human:<identity_id>
after : 23 tuples across 5 distinct Human:<humans.id>
```

- [ ] **Step 3: Verify a human can still read their own diary**

Log in as a restored human and confirm `GET /diaries` returns the expected rows.
A human who authenticates but sees nothing means the tuple rewrite missed a
subject.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(tools): relink restored identities and migrate Human keto tuples"
```

---

## Self-Review

**Spec coverage:** internal PKs (Task 1), repository access (2), token webhook
(3), auth context + Keto subject (4), Hydra client metadata (5), registration
(6), relink + human tuples (7). All four stores that hold an identity ID —
Postgres, Keto, Hydra client metadata, Kratos itself — are addressed.

**Ordering hazard:** Task 3 must not ship without Task 5, or clients lacking
`agent_id` fall back to `identity_id`; that is safe only while the fallback
exists. Task 1 must precede everything.

**Known gap:** `metadata_public.agent_id` on the Kratos identity is deliberately
**not** added. Agent JWT claims come from Hydra client metadata, not Kratos
(`hooks.ts`), so writing it into Kratos would create a fifth copy with no
reader. Revisit only if a flow needs to resolve an agent starting from a Kratos
identity alone.

**Rollback:** Task 1 is the only irreversible step. Its inverse (repoint FKs to
`identity_id`, restore the PK) is only valid while
`agents.id = agents.identity_id` for every row — i.e. before Task 7a runs. After
7a the old PK values no longer exist in `identity_id`, so rollback means
restoring from backup.

---

## Status — 2026-09-05

Implemented on `feat/decouple-kratos-identity` (5 commits), full workspace
typecheck green, 82 database unit tests + 15 auth suites + 4 models suites
passing. Database _integration_ suites need a local Postgres that was not
running; they were not exercised.

| Task                                                      | State                                   |
| --------------------------------------------------------- | --------------------------------------- |
| 1. Schema — `agents.id` PK, `identity_id` nullable        | done (`a940d0473`)                      |
| 2. Repository — `findById`, `findByIds`, `relinkIdentity` | done (`2d5309c60`)                      |
| 3. Token webhook resolves by `agent_id`                   | done (`a4be90e33`)                      |
| 4. Auth context + Keto subject                            | done (`a4be90e33`)                      |
| 5. Hydra `agent_id` backfill                              | **reverted — see hazard below**         |
| 6. Registration writes `agent_id`                         | not started (DBOS gate)                 |
| 7. Relink + `Human:` tuple migration                      | 7a done in the incident; 7b outstanding |

### Findings that changed the plan

**Two DBOS workflows are affected, not one.** `human-onboarding-workflow.ts`
registers Keto subjects as well as `registration-workflow.ts`. Both now carry
changed source, so the drain-before-deploy gate in
[upgrade-and-versioning](../../../.claude/skills/dbos-typescript/references/upgrade-and-versioning.md)
applies to what is already committed, not only to the registration reorder.

**The backfill has an ordering hazard.** It was run before migration 0041 and
then reverted. Its values are only correct if `agents.id` seeds from
`identity_id` _as it stands at migration time_; any identity change in between
silently desynchronises Hydra from the seeded ID, with nothing to detect it.
Redo it only after 0041 is applied, and gate it on a verification that every
Hydra `agent_id` resolves to an existing `agents.id`.

**Agents migrate for free; humans do not.** `agents.id` is seeded, so the 758
`Agent:` tuples keep matching untouched. `humans.id` already differs from
`identity_id`, so the 23 `Human:` tuples must be rewritten. Switching the human
Keto subject without that rewrite leaves every human authenticated with zero
permissions — prefer dual-writing `Human:<humans.id>` before deploy and dropping
`Human:<identity_id>` after, which removes the window.

**Two bugs were invisible to the compiler**, both `uuid` to `uuid`: 16 creator
JOINs still matched `agents.identityId`, and the batch creator path called
`findByIdentityIds` with `agents.id` values. Both would have looked correct on
seeded rows and failed only for new agents or after a relink. Any remaining
audit of this refactor should grep for identity/agent-ID conflation rather than
trusting a green typecheck.

---

## Post-Incident Follow-Ups

Work identified during the 2026-09-04 outage that is **not** part of the
decoupling migration itself. Ordered by risk.

### A. Credential rotation (do first)

- [ ] **Fly Postgres password** — leaked to a terminal (and this session's
      transcript) when `run-psql.mjs` passed the connection URL as an argv and
      psql echoed it in an error. The script now passes
      `PGHOST`/`PGUSER`/`PGPASSWORD` via the environment, but the exposed
      credential must still be rotated.
- [ ] **`ORY_BACKUP_PASSPHRASE`** — rotate, and store in a vault rather than
      only as a GitHub environment secret. During this incident the operator no
      longer had it, which forced decryption to happen inside CI. That worked,
      but a backup whose passphrase exists in exactly one place is one deleted
      secret away from being unrecoverable.
- [ ] Confirm the already-rotated `ORY_PROJECT_API_KEY` /
      `ORY_WORKSPACE_API_KEY` are consistent across: GitHub `production`
      environment, `.env.infra.local`, and any deploy targets.

### B. Remove `identity_id` from agent configuration

`.moltnet/<agent>/moltnet.json` stores `identity_id`. Every activated agent on
every machine now holds a **stale** value, because restored identities received
new UUIDs. Nothing in the auth path needs it — agents authenticate with
`oauth2.client_id` / `client_secret`, and the server derives the principal from
the token.

**Finding: `identity_id` is a keyring key-derivation input, not a server
reference.**

- `expectedSecretKey()` (`secret_provider.go:106`) derives
  `oauth2/<identity_id>/<client_id>` for the OAuth2 client secret and
  `AgentKeyKey(<identity_id>)` for the agent key.
- `agents_keys_store.go:142` raises `errAgentKeyIdentityChanged` when it moves.
- `git-setup.ts:35-36` derives the agent's git name/email from it.

Rewriting it in place orphans every keyring secret; leaving it stale forever is
avoidance. The fix is to re-anchor key derivation on a value that never changes.

**The anchor is `agents.id`.** Not `client_id`: `agents_credentials.go:486`
rotates credentials and issues a **new** `client_id`, and the recovery flow
reconciles a new one into the config, so it is not stable either. `agents.id` is
the only identifier guaranteed never to move — that is precisely what this
migration creates it for.

| Kind                 | Current key                        | Target key                      |
| -------------------- | ---------------------------------- | ------------------------------- |
| OAuth2 client secret | `oauth2/<identity_id>/<client_id>` | `oauth2/<agent_id>/<client_id>` |
| Agent key            | `agentkey/<identity_id>`           | `agentkey/<agent_id>`           |
| Identity seed        | `identityseed/<fingerprint>`       | unchanged — already stable      |

**Config shape.** Add `agent_id` as the anchor; rename the existing field to
`agent_identity_id` and mark it deprecated (retained for reference and for
reading old files), so the two concepts stop sharing a name.

**Server prerequisites** (these gate the CLI work):

- [ ] `agents whoami` returns `agent_id`.
- [ ] Registration returns `agent_id` and writes `agent_id` into the Hydra
      client metadata — replacing `identity_id` as the webhook's lookup key
      (this supersedes the earlier `agent_id ?? identity_id` fallback sketch;
      the metadata link moves to `agent_id` properly).

**CLI migration:**

- [ ] Versioned config migration on the `config_migrations_oauth.go` rails,
      triggered when `agent_id` is absent: resolve `agent_id` via
      `agents whoami`, re-key each keyring secret from its old key to the
      `agent_id`-derived key, rewrite the `*_ref` entries, move `identity_id` to
      `agent_identity_id`, bump the config version, delete the stale keyring
      entries.
- [ ] `agent_id` **cannot** be derived locally for existing installs: the config
      holds the _pre-incident_ identity, while `agents.id` seeds from the
      _restored_ one. The server round-trip is mandatory. It is also safe —
      authentication does not depend on the config's `identity_id` being correct
      (see below), so the migration can always authenticate well enough to ask.
- [ ] Keep reading `identity_id`-keyed secrets for a few releases, warning on
      use; then require the migration before further updates, gated on
      `agent_id` being present.
- [ ] Change `expectedSecretKey()` to require `agent_id` for
      `credentialOAuth2ClientSecret` and `credentialAgentKey`.
- [ ] Remove `errAgentKeyIdentityChanged` once keys no longer depend on
      `identity_id`.
- [ ] Decouple `git-setup.ts` from `identity_id`; derive the git identity from
      the agent name or fingerprint.

**Why this can be done at leisure:** agents authenticate with **no valid Kratos
identity at all**. The token path is CLI → Hydra (`client_id`/`client_secret`) →
webhook → `getOAuth2Client().metadata` → agents row → claims. Kratos is never
called; the metadata value is only a join key into Postgres. The 8 agents with
no restored identity prove it — both sides still hold their old value and they
continue to issue tokens.

### C. Detection — deferred

Nothing alerted when 27 production identities disappeared; it was noticed by a
human. **Explicitly deferred by the operator**, recorded here so the gap is not
forgotten: an identity-count floor monitor and an alert on token-webhook
`agent_not_found` 403s would have caught this in minutes.

### D. Backup completeness

- [ ] **Increase backup frequency.** The schedule is weekly
      (`cron: '17 3 * * 1'`). The 2026-08-31 bundle was 4 days stale when the
      incident hit, which is exactly why 8 agents and 2 humans could not be
      recovered. Daily would have reduced that set to near zero.
- [ ] ~~JWK sets are not backed up (`jwkSets: 0`, `ORY_JWK_SET_IDS` empty)~~ —
      **deferred by the operator**; noted so the gap is on record.
- [ ] Document explicitly that **OAuth2 client secrets cannot be exported by
      Ory**. A Hydra loss means re-provisioning every agent — consider storing
      client secrets in the vault at creation time.
- [ ] The GitHub artifact copy expires after 14 days; the Tigris copy under
      `s3://moltnet-backups/ory/` is the durable one. Make that explicit in the
      runbook.

### E. Rehearse the restore

The restore path was written during the incident and debugged through four CI
cycles because it could not be exercised locally.

- [ ] Add an `ORY_STAGE_PROJECT_API_KEY` secret so `ory-restore.yml` can target
      the stage tenant. Today `target_project: stage` fails, since data-plane
      calls need a project key.
- [ ] Schedule a periodic restore drill into stage, asserting the identity count
      matches the bundle.

### F. Blast-radius controls

The incident was a single API key used against the wrong tenant — by an agent
working in the **moltnet-operations** repo, not this one. That makes it a
cross-repo control: this repository cannot prevent it alone.

- [ ] Separate project API keys per environment and scope distribution by repo,
      so an operations-repo agent can only ever hold stage credentials. This is
      the one control that would actually have prevented the incident, and it
      has to be enforced where the keys are issued, not where they are used.
- [ ] Carry the `verifyTenant()` preflight (proving the key belongs to the
      project at `ORY_PROJECT_URL`) into every Ory-writing automation:
      `infra/ory/deploy.mjs`, `infra/ory/backup.mjs`, and the bootstrap tooling.

### G. Schema drift from the emergency relink — resolved by Task 1

The relink applied `ON UPDATE CASCADE` to all 21 FKs directly in production,
which `schema.ts` did not declare. Rather than codify that drift and revert it
later, Task 1 drops the cascade while retargeting the FKs to `agents.id`,
converging Drizzle and production in one step. **No separate drift migration is
required.** Verify with `pnpm db:generate` producing no unexpected diff after
Task 1.

### H. Principals that could not be restored

- [ ] Re-provision the **8 agents** absent from the backup. They keep their
      data, teams and Keto tuples but hold identity IDs that exist nowhere in
      Kratos, and their 8 OAuth2 clients were deliberately left untouched.
- [ ] Re-register the **2 humans** absent from the backup — `fa46c405` (owns the
      Demo and OpenAI Review teams plus a diary with 7 entries) and `1998117b`.
      On re-registration each gets a _new_ `humans` row; reconcile as done for
      `ed@getlarge.eu`: repoint the original row's `identity_id`, then delete
      the duplicate.

### I. Diary debt

The MoltNet API was down for part of the incident, so several entries could not
be written.

- [ ] Catch-up `procedural` entry for the emergency relink (Postgres + Hydra +
      Keto), referencing the commits and scripts.
- [ ] The `semantic` entry recording this decoupling decision.

### J. The OAuth2 grant cache delays every identity relink by up to 24h

`apps/rest-api/src/routes/oauth2.ts` proxies token issuance and caches
successful grants in **Redis** (`moltnet-redis`). `client_credentials` is cached
**for the token's full life**, and `hydra.yaml` sets `ttl.access_token: 24h`
with `access_token: jwt`. The code states the consequence outright: _"Revoking a
client at Hydra does not take effect here until the cached [token expires]"_.

Because JWT claims are baked in at issuance, repointing Hydra client metadata
does **not** affect tokens already minted or cached. After the 2026-09-04
relink, agents kept receiving pre-relink tokens carrying the old `identity_id`,
producing `404 Agent profile not found`. Restarting the API does not help — the
cache is in Redis, not memory.

Observed escalation to avoid repeating: revoking the token at Hydra turns a
stale-but-cached grant (404) into an invalid one (401) **without** shortening
the wait, because the dead token is still served from cache. Do not revoke as a
mitigation.

- [ ] Expose `invalidateOAuth2ClientCache(clientId)` beyond
      `/auth/rotate-secret` — an admin-only endpoint or CLI path that evicts the
      `<clientId>|` prefix without rotating secrets. Rotation is currently the
      only lever and it breaks every agent config.
- [ ] Any future identity relink runbook must invalidate the grant cache for
      affected clients as its final step, immediately after Hydra metadata is
      repointed.
- [ ] Consider whether `client_credentials` should be cached for the token's
      full 24h life, or capped (e.g. 1h) so identity/metadata changes converge
      faster. This is a deliberate Ory-billing trade-off, so it is a decision,
      not a bug.

**Not affected:** `authorization_code` is never cached (by design — the code is
single-use), so human console login converges immediately after a relink.
