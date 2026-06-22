import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createApiRuntimeSlotStore, resolveDaemonId } from './runtime-slots.js';

describe('runtime slots', () => {
  it('uses the configured daemon id when present', () => {
    expect(resolveDaemonId('/tmp/state', 'daemon-a')).toBe('daemon-a');
  });

  it('writes and resolves team-scoped runtime slots through the SDK', async () => {
    const begin = vi.fn().mockResolvedValue({});
    const finish = vi.fn().mockResolvedValue({});
    const findProducer = vi.fn().mockResolvedValue({
      session: {
        sessionDir: '/tmp/session',
        sessionPath: '/tmp/session/1.jsonl',
      },
      slot: { expiresAtMs: 1234 },
      workspace: {
        kind: 'origin',
        workspaceId: 'workspace-a',
        worktreeBranch: 'issue-1414',
        worktreePath: '/tmp/worktree',
      },
    });
    const agent = {
      runtimeSlots: { begin, findProducer, finish },
    } as unknown as Agent;
    const store = createApiRuntimeSlotStore({
      agent,
      daemonId: 'daemon-a',
      daemonProfileId: 'dddddddd-0000-0000-0000-000000000004',
    });

    await store.beginSlot({
      agentName: 'legreffier',
      lastAttemptN: 1,
      lastTaskId: 'aaaaaaaa-0000-0000-0000-000000000001',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      sessionDir: '/tmp/session',
      sessionPath: '/tmp/session/1.jsonl',
      slotKey: 'freeform:correlation:test',
      taskType: 'freeform',
      teamId: 'bbbbbbbb-0000-0000-0000-000000000002',
      ttlSec: 1800,
      workspaceId: 'workspace-a',
      workspaceKind: 'origin',
      worktreeBranch: 'issue-1414',
      worktreePath: '/tmp/worktree',
    });
    await store.finishSlot(
      'bbbbbbbb-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000001',
      1,
      {
        agentName: 'legreffier',
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
      },
      'freeform:correlation:test',
      1800,
      '/tmp/session/2.jsonl',
    );
    const resolved = await store.findLatestProducerSlotByTaskAttempt(
      'bbbbbbbb-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000001',
      1,
    );

    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        daemonId: 'daemon-a',
        daemonProfileId: 'dddddddd-0000-0000-0000-000000000004',
      }),
      { teamId: 'bbbbbbbb-0000-0000-0000-000000000002' },
    );
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        daemonId: 'daemon-a',
        taskId: 'aaaaaaaa-0000-0000-0000-000000000001',
      }),
      { teamId: 'bbbbbbbb-0000-0000-0000-000000000002' },
    );
    expect(findProducer).toHaveBeenCalledWith(
      {
        attemptN: 1,
        taskId: 'aaaaaaaa-0000-0000-0000-000000000001',
      },
      { teamId: 'bbbbbbbb-0000-0000-0000-000000000002' },
    );
    expect(resolved).toEqual({
      session: {
        sessionDir: '/tmp/session',
        sessionPath: '/tmp/session/1.jsonl',
      },
      slot: { expiresAtMs: 1234 },
      workspace: {
        kind: 'origin',
        workspaceId: 'workspace-a',
        worktreeBranch: 'issue-1414',
        worktreePath: '/tmp/worktree',
      },
    });
  });
});
