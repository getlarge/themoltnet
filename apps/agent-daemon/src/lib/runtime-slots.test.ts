import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createApiRuntimeSlotStore } from './runtime-slots.js';

describe('runtime slots', () => {
  it('writes and resolves team-scoped runtime slots through the SDK', async () => {
    const begin = vi.fn().mockResolvedValue({});
    const finish = vi.fn().mockResolvedValue({});
    const findLatestForAttempt = vi.fn().mockResolvedValue({
      slot: {
        expiresAtMs: 1234,
        sessionDir: '/tmp/session',
        sessionPath: '/tmp/session/1.jsonl',
      },
      workspace: {
        kind: 'origin',
        workspaceId: 'workspace-a',
        worktreeBranch: 'issue-1414',
        worktreePath: '/tmp/worktree',
      },
    });
    const agent = {
      runtimeSlots: { begin, findLatestForAttempt, finish },
    } as unknown as Agent;
    const store = createApiRuntimeSlotStore({ agent });

    await store.beginSlot({
      agentName: 'legreffier',
      daemonProfileId: 'dddddddd-0000-4000-8000-000000000004',
      lastAttemptN: 1,
      lastTaskId: 'aaaaaaaa-0000-0000-0000-000000000001',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      sessionDir: '/tmp/session',
      sessionPath: '/tmp/session/1.jsonl',
      slotKey: 'freeform:correlation:test',
      taskType: 'freeform',
      teamId: 'bbbbbbbb-0000-0000-0000-000000000002',
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
        daemonProfileId: 'dddddddd-0000-4000-8000-000000000004',
      },
      'freeform:correlation:test',
      'anthropic',
      'claude-sonnet-4-5',
      '/tmp/session/2.jsonl',
    );
    const resolved = await store.findLatestSlotByTaskAttempt(
      'bbbbbbbb-0000-0000-0000-000000000002',
      'aaaaaaaa-0000-0000-0000-000000000001',
      1,
    );

    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        daemonProfileId: 'dddddddd-0000-4000-8000-000000000004',
      }),
      { teamId: 'bbbbbbbb-0000-0000-0000-000000000002' },
    );
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptN: 1,
        daemonProfileId: 'dddddddd-0000-4000-8000-000000000004',
        taskId: 'aaaaaaaa-0000-0000-0000-000000000001',
      }),
      { teamId: 'bbbbbbbb-0000-0000-0000-000000000002' },
    );
    expect(findLatestForAttempt).toHaveBeenCalledWith(
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
