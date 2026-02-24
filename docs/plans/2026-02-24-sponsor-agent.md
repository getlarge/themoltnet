# Sponsor Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a sponsor agent identity that the server can use to issue vouchers without limit, enabling the LeGreffier one-command onboarding flow.

**Architecture:** A sponsor agent is a genesis agent whose UUID (`SPONSOR_AGENT_ID`) lives in server env. The `voucherRepository` gains an `issueUnlimited()` method (separate from `issue()`) that skips the `MAX_ACTIVE_VOUCHERS` cap. The bootstrap script gains a `--sponsor` flag that creates exactly one agent and prints its identity ID so it can be stored in env via dotenvx. The server config wires `SPONSOR_AGENT_ID` as an optional string used by the upcoming onboarding workflow.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (serializable transactions), Vitest (unit tests with in-memory mock), parseArgs (CLI), dotenvx (secrets)

---

## Task 1: `issueUnlimited()` on voucherRepository

**Files:**

- Modify: `libs/database/src/repositories/voucher.repository.ts`

**Step 1: Write the failing test**

Add to a new test file `libs/database/src/repositories/voucher.repository.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoucherRepository } from './voucher.repository.js';

// Minimal DB mock — just enough to test issueUnlimited skips the count check
function makeDb(existingActiveCount: number) {
  const insertReturning = vi.fn().mockResolvedValue([
    {
      id: 'v1',
      code: 'abc123',
      issuerId: 'sponsor-id',
      expiresAt: new Date(Date.now() + 86400000),
      redeemedAt: null,
      redeemedBy: null,
    },
  ]);

  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve(
                Array.from({ length: existingActiveCount }, (_, i) => ({
                  id: `existing-${i}`,
                })),
              ),
          }),
        }),
        insert: () => ({ values: () => ({ returning: insertReturning }) }),
      };
      return fn(tx);
    }),
  };
}

describe('voucherRepository.issueUnlimited', () => {
  it('issues a voucher even when issuer already has MAX_ACTIVE_VOUCHERS (5)', async () => {
    const db = makeDb(5); // already at the cap
    const repo = createVoucherRepository(db as never);

    const result = await repo.issueUnlimited('sponsor-id');

    expect(result).not.toBeNull();
    expect(result.code).toBe('abc123');
  });

  it('issues a voucher when issuer has 0 active vouchers', async () => {
    const db = makeDb(0);
    const repo = createVoucherRepository(db as never);

    const result = await repo.issueUnlimited('sponsor-id');

    expect(result).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/legreffier-onboarding-287
pnpm --filter @moltnet/database run test
```

Expected: FAIL — `repo.issueUnlimited is not a function`

**Step 3: Implement `issueUnlimited()`**

In `libs/database/src/repositories/voucher.repository.ts`, after the closing brace of `issue()` and before `redeem()`, add:

```typescript
/**
 * Issue a voucher code without checking the active voucher cap.
 * ONLY use this for privileged issuers (e.g. the sponsor agent) where
 * the HTTP-layer rate limit is the sole protection against abuse.
 *
 * Unlike `issue()`, this never returns null — it always inserts.
 */
async issueUnlimited(issuerId: string): Promise<AgentVoucher> {
  // eslint-disable-next-line @typescript-eslint/return-await
  return await db.transaction(
    async (tx) => {
      const code = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + VOUCHER_TTL_MS);

      const [voucher] = await tx
        .insert(agentVouchers)
        .values({ code, issuerId, expiresAt })
        .returning();

      return voucher;
    },
    { isolationLevel: 'serializable' },
  );
},
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @moltnet/database run test
```

Expected: PASS — both `issueUnlimited` tests green

**Step 5: Check types**

```bash
pnpm --filter @moltnet/database run typecheck
```

Expected: no errors

**Step 6: Commit**

```bash
cd .claude/worktrees/legreffier-onboarding-287
git add libs/database/src/repositories/voucher.repository.ts \
        libs/database/src/repositories/voucher.repository.test.ts
git commit -m "feat(database): add issueUnlimited() to voucherRepository for sponsor agent"
```

---

## Task 2: `SPONSOR_AGENT_ID` in server config

**Files:**

- Modify: `apps/rest-api/src/config.ts`
- Modify: `env.local.example`

**Step 1: Write the failing test**

Add to `apps/rest-api/src/config.test.ts` (create if absent, check first):

```typescript
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig — SPONSOR_AGENT_ID', () => {
  it('is undefined when env var is absent', () => {
    const config = loadConfig({
      // minimal required vars — copy from existing config tests
      DATABASE_URL: 'postgresql://x:x@localhost/x',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://x:x@localhost/x',
      ORY_PROJECT_URL: 'https://example.oryapis.com',
      ORY_API_KEY: 'test-key',
      ORY_ACTION_API_KEY: 'test-webhook-key',
      RECOVERY_CHALLENGE_SECRET: 'sixteen-chars-ok',
    });
    expect(config.security.SPONSOR_AGENT_ID).toBeUndefined();
  });

  it('is set when env var is present', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://x:x@localhost/x',
      DBOS_SYSTEM_DATABASE_URL: 'postgresql://x:x@localhost/x',
      ORY_PROJECT_URL: 'https://example.oryapis.com',
      ORY_API_KEY: 'test-key',
      ORY_ACTION_API_KEY: 'test-webhook-key',
      RECOVERY_CHALLENGE_SECRET: 'sixteen-chars-ok',
      SPONSOR_AGENT_ID: 'some-uuid-here',
    });
    expect(config.security.SPONSOR_AGENT_ID).toBe('some-uuid-here');
  });
});
```

Run: `pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | grep -A5 "SPONSOR"`

Expected: FAIL — `config.security.SPONSOR_AGENT_ID` is undefined even when set

**Step 2: Add `SPONSOR_AGENT_ID` to `SecurityConfigSchema`**

In `apps/rest-api/src/config.ts`, inside `SecurityConfigSchema = Type.Object({...})`, add after `RATE_LIMIT_PUBLIC_SEARCH`:

```typescript
// Sponsor agent identity ID — used by LeGreffier onboarding workflow to
// issue vouchers without the MAX_ACTIVE_VOUCHERS cap. Optional: server
// starts without it, but /public/legreffier/start rejects requests if unset.
SPONSOR_AGENT_ID: Type.Optional(Type.String()),
```

**Step 3: Add to `env.local.example`**

Append to the `# ── Server ──` section in `env.local.example`:

```bash
# ── LeGreffier onboarding ──────────────────────────────────────
# Identity ID of the sponsor agent (created via: pnpm bootstrap --sponsor)
# Required for /public/legreffier/start endpoint
# SPONSOR_AGENT_ID=<uuid from bootstrap --sponsor output>
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @moltnet/rest-api run test -- --reporter=verbose 2>&1 | grep -A5 "SPONSOR"
```

Expected: PASS

**Step 5: Typecheck**

```bash
pnpm --filter @moltnet/rest-api run typecheck
```

Expected: no errors

**Step 6: Commit**

```bash
git add apps/rest-api/src/config.ts env.local.example
git commit -m "feat(rest-api): add optional SPONSOR_AGENT_ID to security config"
```

---

## Task 3: `--sponsor` flag in bootstrap script

**Files:**

- Modify: `tools/src/bootstrap-genesis-agents.ts`

**Step 1: Write the failing test**

The bootstrap script is a CLI entrypoint (`#!/usr/bin/env -S npx tsx`) — test it by running it as a subprocess. Add `tools/src/bootstrap-genesis-agents.sponsor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve(
  import.meta.dirname,
  '../src/bootstrap-genesis-agents.ts',
);

describe('bootstrap --sponsor flag', () => {
  it('--help mentions --sponsor flag', () => {
    const output = execSync(`npx tsx ${script} --help`, {
      encoding: 'utf8',
    });
    expect(output).toContain('--sponsor');
  });

  it('--sponsor --dry-run prints a single agent with type=sponsor', () => {
    const output = execSync(`npx tsx ${script} --sponsor --dry-run`, {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toMatch(/sponsor/i);
    expect(parsed[0].type).toBe('sponsor');
  });

  it('--sponsor is mutually exclusive with --count', () => {
    expect(() =>
      execSync(`npx tsx ${script} --sponsor --count 2 --dry-run`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });

  it('--sponsor is mutually exclusive with --names', () => {
    expect(() =>
      execSync(`npx tsx ${script} --sponsor --names "Atlas" --dry-run`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    ).toThrow();
  });
});
```

Run: `pnpm --filter @moltnet/tools run test`

Expected: FAIL — `--sponsor` is unknown option

**Step 2: Add `--sponsor` flag to `parseArgs`**

In `tools/src/bootstrap-genesis-agents.ts`, add to the `options` object in `parseArgs`:

```typescript
sponsor: { type: 'boolean', default: false },
```

**Step 3: Add mutual exclusion validation and sponsor branch**

After the existing `if (args.help)` block, add validation:

```typescript
if (args.sponsor && (args.count !== '1' || args.names)) {
  console.error('--sponsor is mutually exclusive with --count and --names');
  process.exit(1);
}
```

Then in the dry-run branch, adjust to handle `--sponsor`:

```typescript
if (args['dry-run']) {
  const agentName = args.sponsor ? 'Sponsor' : undefined;
  const dryRunNames = args.sponsor ? ['Sponsor'] : names; // existing logic

  const dryRunAgents = await Promise.all(
    dryRunNames.map(async (name) => {
      const keyPair = await cryptoService.generateKeyPair();
      return {
        name,
        type: args.sponsor ? 'sponsor' : 'genesis',
        publicKey: keyPair.publicKey,
        // privateKey omitted in dry-run for safety
      };
    }),
  );
  console.log(JSON.stringify(dryRunAgents, null, 2));
  process.exit(0);
}
```

For the real run, add a `--sponsor` branch before the existing `bootstrapGenesisAgents` call:

```typescript
if (args.sponsor) {
  log('Creating sponsor agent...');
  // Reuse bootstrapGenesisAgents with count=1 and name='Sponsor'
  const result = await bootstrapGenesisAgents({
    cryptoService,
    db,
    ...oryClients,
    names: ['Sponsor'],
    scopes: args.scopes!.split(' '),
  });

  if (result.agents.length !== 1) {
    console.error('Failed to create sponsor agent');
    process.exit(1);
  }

  const agent = result.agents[0];
  const output = {
    name: agent.name,
    type: 'sponsor',
    identityId: agent.identityId,
    fingerprint: agent.fingerprint,
    clientId: agent.clientId,
    // Print SPONSOR_AGENT_ID instruction to stderr so stdout stays clean
  };

  // Guidance to stderr so stdout can be piped
  process.stderr.write(
    `\nSPONSOR_AGENT_ID=${agent.identityId}\n` +
      `\nStore this ID in your .env:\n` +
      `  dotenvx set SPONSOR_AGENT_ID "${agent.identityId}"\n\n` +
      `IMPORTANT: Store the output JSON securely — it contains OAuth2 secrets.\n`,
  );

  console.log(JSON.stringify([output], null, 2));
  process.exit(0);
}
```

**Step 4: Update `--help` output**

Add `--sponsor` to the help text:

```
      --sponsor         Create exactly one sponsor agent (mutually exclusive with --count/--names)
```

**Step 5: Run tests to verify they pass**

```bash
pnpm --filter @moltnet/tools run test
```

Expected: PASS — all 4 sponsor tests green

**Step 6: Typecheck**

```bash
pnpm --filter @moltnet/tools run typecheck
```

Expected: no errors

**Step 7: Commit**

```bash
git add tools/src/bootstrap-genesis-agents.ts \
        tools/src/bootstrap-genesis-agents.sponsor.test.ts
git commit -m "feat(tools): add --sponsor flag to bootstrap script for sponsor agent creation"
```

---

## Task 4: Lint + full test suite

**Step 1: Run lint across workspace**

```bash
cd .claude/worktrees/legreffier-onboarding-287
pnpm run lint
```

Expected: no errors. Fix any lint issues before proceeding.

**Step 2: Run full test suite**

```bash
pnpm run test
```

Expected: all tests pass (no regressions)

**Step 3: Commit lint fixes if any**

If lint auto-fixes were needed:

```bash
git add -p
git commit -m "chore: lint fixes for sponsor agent changes"
```

---

## Task 5: Update CLAUDE.md / env.public documentation

**Files:**

- Modify: `env.public` (add comment about SPONSOR_AGENT_ID — not the value)

**Step 1: Add comment to env.public**

`env.public` only holds plain non-secret config. `SPONSOR_AGENT_ID` is a secret UUID so it does NOT go here — but add a comment so future agents know where it lives:

```bash
# SPONSOR_AGENT_ID (secret) — see .env, set via: pnpm bootstrap --sponsor
```

Add this near the bottom of `env.public` in a `# ── LeGreffier ──` section.

**Step 2: Commit**

```bash
git add env.public
git commit -m "docs: document SPONSOR_AGENT_ID secret location in env.public"
```

---

## Verification

After all tasks complete, verify the full scope works end-to-end:

```bash
cd .claude/worktrees/legreffier-onboarding-287

# 1. All tests pass
pnpm run test

# 2. Types clean
pnpm run typecheck

# 3. Lint clean
pnpm run lint

# 4. Dry-run sponsor bootstrap works
pnpm bootstrap --sponsor --dry-run
# Expected: JSON with [{name: "Sponsor", type: "sponsor", publicKey: "..."}]

# 5. issueUnlimited is exported from database package
grep "issueUnlimited" libs/database/src/repositories/voucher.repository.ts
```
