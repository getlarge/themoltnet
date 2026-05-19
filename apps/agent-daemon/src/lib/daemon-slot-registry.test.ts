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

  it('finds the latest producer slot context by task id and attempt number', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-slot-producer-'));
    tempRoots.push(root);
    const dbPath = join(root, 'daemon-state.sqlite');
    const sessionDir = join(root, 'pi-sessions', 'slot-1');
    const worktreePath = join(root, 'worktrees', 'task-1');
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    const sessionPath = join(sessionDir, 'session-a.jsonl');
    writeFileSync(sessionPath, '[]\n', 'utf8');

    const registry = new DaemonSlotRegistry(dbPath);
    registry.beginSlot({
      agentName: 'local-eval-943',
      provider: 'ollama-cloud',
      model: 'qwen3.5',
      slotKey: 'run_eval:correlation:test:variant:baseline',
      taskType: 'run_eval',
      sessionDir,
      sessionPath,
      workspaceId: 'task-aaaaaaaa',
      worktreePath,
      worktreeBranch: null,
      lastTaskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lastAttemptN: 1,
      ttlSec: 60,
    });
    registry.finishSlot(
      {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      'run_eval:correlation:test:variant:baseline',
      60,
      sessionPath,
    );

    const resolved = registry.findLatestProducerSlotByTaskAttempt(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1,
    );
    registry.close();

    expect(resolved?.slot.slotKey).toBe(
      'run_eval:correlation:test:variant:baseline',
    );
    expect(resolved?.slot.taskType).toBe('run_eval');
    expect(resolved?.session?.sessionDir).toBe(sessionDir);
    expect(resolved?.session?.sessionPath).toBe(sessionPath);
    expect(resolved?.workspace?.workspaceId).toBe('task-aaaaaaaa');
    expect(resolved?.workspace?.worktreePath).toBe(worktreePath);
  });

  it('retains persisted producer context files after slot reap until context expiry', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-slot-producer-persist-'));
    tempRoots.push(root);
    const dbPath = join(root, 'daemon-state.sqlite');
    const sessionDir = join(root, 'pi-sessions', 'slot-1');
    const worktreePath = join(root, 'task-workspaces', 'task-1');
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    const sessionPath = join(sessionDir, 'session-a.jsonl');
    writeFileSync(sessionPath, '[]\n', 'utf8');
    writeFileSync(join(worktreePath, 'artifact.txt'), 'producer\n', 'utf8');

    const registry = new DaemonSlotRegistry(dbPath);
    registry.beginSlot({
      agentName: 'local-eval-943',
      provider: 'ollama-cloud',
      model: 'qwen3.5',
      slotKey: 'run_eval:correlation:test:variant:baseline',
      taskType: 'run_eval',
      sessionDir,
      sessionPath,
      workspaceId: 'task-aaaaaaaa',
      worktreePath,
      worktreeBranch: null,
      lastTaskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lastAttemptN: 1,
      ttlSec: 1,
    });
    registry.finishSlot(
      {
        agentName: 'local-eval-943',
        provider: 'ollama-cloud',
        model: 'qwen3.5',
      },
      'run_eval:correlation:test:variant:baseline',
      1,
      sessionPath,
    );
    registry.persistProducerTaskAttemptContext({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptN: 1,
      taskType: 'run_eval',
      sessionDir,
      sessionPath,
      workspaceId: 'task-aaaaaaaa',
      worktreePath,
      worktreeBranch: null,
      ttlSec: 60,
    });

    const expired = registry.reapExpiredSlots(Date.now() + 2_000);
    const persisted = registry.findPersistedProducerTaskAttemptContext(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1,
    );
    registry.close();

    expect(expired).toHaveLength(1);
    expect(persisted?.sessionPath).toBe(sessionPath);
    expect(readFileSync(sessionPath, 'utf8')).toBe('[]\n');
    expect(readFileSync(join(worktreePath, 'artifact.txt'), 'utf8')).toBe(
      'producer\n',
    );
  });

  it('reaps expired persisted producer contexts and cleans their files', () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-slot-producer-expire-'));
    tempRoots.push(root);
    const dbPath = join(root, 'daemon-state.sqlite');
    const sessionDir = join(root, 'pi-sessions', 'producer-context');
    const worktreePath = join(root, 'task-workspaces', 'task-1');
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    const sessionPath = join(sessionDir, 'session-a.jsonl');
    writeFileSync(sessionPath, '[]\n', 'utf8');
    writeFileSync(join(worktreePath, 'artifact.txt'), 'producer\n', 'utf8');

    const registry = new DaemonSlotRegistry(dbPath);
    registry.persistProducerTaskAttemptContext({
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      attemptN: 1,
      taskType: 'run_eval',
      sessionDir,
      sessionPath,
      workspaceId: 'task-aaaaaaaa',
      worktreePath,
      worktreeBranch: null,
      ttlSec: 1,
    });

    const expired = registry.reapExpiredProducerTaskAttemptContexts(
      Date.now() + 2_000,
    );
    const persisted = registry.findPersistedProducerTaskAttemptContext(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1,
    );
    registry.close();

    expect(expired).toHaveLength(1);
    expect(persisted).toBeNull();
    expect(() => readFileSync(sessionPath, 'utf8')).toThrow();
    expect(() =>
      readFileSync(join(worktreePath, 'artifact.txt'), 'utf8'),
    ).toThrow();
  });
});
