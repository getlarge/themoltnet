/**
 * DaemonSlotRegistry backend-parity integration tests.
 *
 * Drives the registry through the exact call sequence the agent daemon invokes
 * across a slot's lifecycle — beginSlot (warm after a task), finishSlot (mark
 * idle with TTL), findLatestProducerSlotByTaskAttempt (continuation/judge
 * resolution), reapExpiredSlots (GC on next run) — against BOTH backends:
 *
 * - SQLite (local `node:sqlite` proxy store), via a temp file.
 * - Postgres, via an ephemeral `pgvector/pgvector:pg16` testcontainer.
 *
 * Both backends are resolved through the daemon's own
 * `resolveDaemonStateStorageConfig`, so this exercises the real wiring the
 * daemon uses when `MOLTNET_AGENT_DAEMON_STATE_DATABASE_URL` is set to a
 * postgres URL versus left unset (SQLite).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type DaemonSlotIdentity,
  DaemonSlotRegistry,
  type DaemonSlotStartInput,
  resolveDaemonStateStorageConfig,
} from '../src/daemon-slot-registry.js';

const IDENTITY_A: DaemonSlotIdentity = {
  agentName: 'legreffier',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
};
// A different agent profile (different provider/model) sharing one task chain.
const IDENTITY_B: DaemonSlotIdentity = {
  agentName: 'legreffier',
  provider: 'openai-codex',
  model: 'gpt-5.4-codex',
};

const TASK_ID = '11111111-1111-4111-8111-111111111111';

function startInput(
  identity: DaemonSlotIdentity,
  overrides: Partial<DaemonSlotStartInput> = {},
): DaemonSlotStartInput {
  return {
    ...identity,
    slotKey: 'freeform:correlation:itest',
    taskType: 'freeform',
    sessionDir: null,
    sessionPath: null,
    workspaceId: `ws-${identity.provider}`,
    worktreePath: `/tmp/wt-${identity.provider}`,
    worktreeBranch: 'moltnet/itest/branch',
    lastTaskId: TASK_ID,
    lastAttemptN: 1,
    ttlSec: 1,
    ...overrides,
  };
}

interface Backend {
  name: string;
  makeRegistry: () => DaemonSlotRegistry;
  cleanup: () => void;
}

describe('DaemonSlotRegistry backend parity (integration)', () => {
  const backends: Backend[] = [];
  let stopContainer: (() => Promise<void>) | null = null;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    // SQLite backend: temp-file path resolved exactly as the daemon would.
    const sqliteRoot = mkdtempSync(join(tmpdir(), 'ds-itest-sqlite-'));
    tempRoots.push(sqliteRoot);
    backends.push({
      name: 'sqlite',
      makeRegistry: () =>
        new DaemonSlotRegistry(
          resolveDaemonStateStorageConfig(
            join(sqliteRoot, 'daemon-state.sqlite'),
            undefined,
          ),
        ),
      cleanup: () => {},
    });

    // Postgres backend: ephemeral container; resolved from a postgres:// URL.
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('daemon_state')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);
    const pgUrl = container.getConnectionUri();
    backends.push({
      name: 'postgres',
      makeRegistry: () =>
        new DaemonSlotRegistry(
          resolveDaemonStateStorageConfig('unused.sqlite', pgUrl),
        ),
      cleanup: () => {},
    });
  }, 90_000);

  afterAll(async () => {
    if (stopContainer) await stopContainer();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves a postgres URL to the postgres backend and sqlite otherwise', () => {
    expect(resolveDaemonStateStorageConfig('x.sqlite', undefined)).toEqual({
      kind: 'sqlite',
      path: 'x.sqlite',
    });
    expect(
      resolveDaemonStateStorageConfig('x.sqlite', 'postgres://h/db'),
    ).toEqual({ kind: 'postgres', connectionString: 'postgres://h/db' });
  });

  // The driver loop: each backend runs the identical assertions, proving the
  // migrator-on-open + store behave the same regardless of DB type.
  describe.each([{ idx: 0 }, { idx: 1 }])('backend[$idx]', ({ idx }) => {
    function backend(): Backend {
      const b = backends[idx];
      if (!b) throw new Error('backend not initialized');
      return b;
    }

    it('warms a slot then resolves it as a producer', async () => {
      const registry = backend().makeRegistry();
      try {
        await registry.beginSlot(startInput(IDENTITY_A));

        const found = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(found).not.toBeNull();
        expect(found?.slot.state).toBe('active');
        expect(found?.workspace?.workspaceId).toBe('ws-anthropic');
        expect(found?.workspace?.worktreeBranch).toBe('moltnet/itest/branch');
      } finally {
        await registry.reapExpiredSlots(Date.now() + 10_000);
        await registry.close();
      }
    });

    it('marks a slot idle with a fresh TTL on finish', async () => {
      const registry = backend().makeRegistry();
      try {
        // A session row only exists when the slot was warmed with a
        // sessionDir; finishSlot then updates its sessionPath.
        await registry.beginSlot(
          startInput(IDENTITY_A, {
            ttlSec: 3600,
            sessionDir: '/tmp/dir-finish',
            sessionPath: null,
          }),
        );
        await registry.finishSlot(
          IDENTITY_A,
          'freeform:correlation:itest',
          3600,
          '/tmp/session-a.jsonl',
        );

        const found = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(found?.slot.state).toBe('idle');
        expect(found?.session?.sessionPath).toBe('/tmp/session-a.jsonl');
        // Not yet expired: a reap at "now" must leave it alive.
        const reapedNow = await registry.reapExpiredSlots(Date.now());
        expect(reapedNow).toHaveLength(0);
      } finally {
        await registry.reapExpiredSlots(Date.now() + 10_000_000);
        await registry.close();
      }
    });

    it('reaps an expired slot and cascade-deletes its session + workspace', async () => {
      const registry = backend().makeRegistry();
      try {
        await registry.beginSlot(
          startInput(IDENTITY_A, {
            sessionDir: '/tmp/dir-a',
            sessionPath: '/tmp/dir-a/s.jsonl',
            ttlSec: 1,
          }),
        );

        const reaped = await registry.reapExpiredSlots(Date.now() + 2_000);
        expect(reaped).toHaveLength(1);
        expect(reaped[0]?.slot.slotKey).toBe('freeform:correlation:itest');
        expect(reaped[0]?.workspace?.workspaceId).toBe('ws-anthropic');

        // Cascade: the slot (and its session/workspace rows) are gone.
        const after = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(after).toBeNull();
      } finally {
        await registry.close();
      }
    });

    it('keeps the latest of two profiles warming the same task attempt', async () => {
      const registry = backend().makeRegistry();
      try {
        // Profile A warms first, profile B (different provider/model) second.
        // Order by lastUsedAtMs is only meaningful across distinct
        // milliseconds, so ensure B is recorded in a strictly later ms.
        await registry.beginSlot(startInput(IDENTITY_A, { ttlSec: 3600 }));
        await new Promise((resolve) => {
          setTimeout(resolve, 2);
        });
        await registry.beginSlot(startInput(IDENTITY_B, { ttlSec: 3600 }));

        // Producer lookup is profile-agnostic and returns the most recently
        // used slot for the task attempt — here, profile B.
        const found = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(found).not.toBeNull();
        expect(found?.slot.provider).toBe(IDENTITY_B.provider);
        expect(found?.workspace?.workspaceId).toBe('ws-openai-codex');
      } finally {
        await registry.reapExpiredSlots(Date.now() + 10_000_000);
        await registry.close();
      }
    });

    it('refcounts a workspace shared by two profiles across reaps', async () => {
      const registry = backend().makeRegistry();
      try {
        // Both profiles reference the SAME workspaceId — the cross-profile
        // continuation case. Pre-refcount this threw a unique violation.
        const shared = { workspaceId: 'ws-shared', worktreePath: '/tmp/wt-sh' };
        await registry.beginSlot(
          startInput(IDENTITY_A, { ...shared, ttlSec: 1 }),
        );
        await registry.beginSlot(
          startInput(IDENTITY_B, { ...shared, ttlSec: 3600 }),
        );

        // Reap profile A only — the shared workspace must survive (refcount 1).
        const reapedA = await registry.reapExpiredSlots(Date.now() + 2_000);
        expect(reapedA).toHaveLength(1);
        const afterA = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(afterA?.workspace?.workspaceId).toBe('ws-shared');

        // Reap profile B (last reference) — workspace + slot gone.
        const reapedB = await registry.reapExpiredSlots(
          Date.now() + 10_000_000,
        );
        expect(reapedB).toHaveLength(1);
        const afterB = await registry.findLatestProducerSlotByTaskAttempt(
          TASK_ID,
          1,
        );
        expect(afterB).toBeNull();
      } finally {
        await registry.reapExpiredSlots(Date.now() + 10_000_000);
        await registry.close();
      }
    });
  });
});
