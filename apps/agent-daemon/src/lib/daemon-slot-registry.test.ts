import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DaemonSlotRegistry,
  resolveLatestPiSessionPath,
} from './daemon-slot-registry.js';

describe('DaemonSlotRegistry', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reaps expired idle slots and removes their persisted Pi session dirs', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-slot-registry-'));
    tempRoots.push(root);
    const dbPath = join(root, 'daemon-state.sqlite');
    const sessionDir = join(root, 'pi-sessions', 'slot-1');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session-a.jsonl'), '[]\n', 'utf8');

    const registry = new DaemonSlotRegistry(dbPath);
    registry.beginSlot({
      agentName: 'legreffier',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      slotKey: 'fulfill_brief:correlation:test',
      taskType: 'fulfill_brief',
      sessionDir,
      sessionPath: join(sessionDir, 'session-a.jsonl'),
      workspaceId: null,
      worktreePath: null,
      worktreeBranch: 'moltnet/test/branch',
      lastTaskId: '11111111-1111-4111-8111-111111111111',
      lastAttemptN: 1,
      ttlSec: 1,
    });
    registry.finishSlot(
      {
        agentName: 'legreffier',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      },
      'fulfill_brief:correlation:test',
      1,
      join(sessionDir, 'session-a.jsonl'),
    );

    const expired = registry.reapExpiredSlots(Date.now() + 2_000);
    registry.close();

    expect(expired).toHaveLength(1);
    expect(expired[0]?.slot.slotKey).toBe('fulfill_brief:correlation:test');
    expect(expired[0]?.session?.sessionPath).toBe(
      join(sessionDir, 'session-a.jsonl'),
    );
    expect(() =>
      readFileSync(join(sessionDir, 'session-a.jsonl'), 'utf8'),
    ).toThrow();
  });

  it('resolves the newest persisted Pi session file within a slot dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-slot-path-'));
    tempRoots.push(root);
    const sessionDir = join(root, 'pi-sessions', 'slot-1');
    mkdirSync(sessionDir, { recursive: true });
    const older = join(sessionDir, '20260513T171700.jsonl');
    const newer = join(sessionDir, '20260513T171701.jsonl');
    writeFileSync(older, '[]\n', 'utf8');
    writeFileSync(newer, '[]\n', 'utf8');

    expect(resolveLatestPiSessionPath(sessionDir)).toBe(newer);
  });
});
