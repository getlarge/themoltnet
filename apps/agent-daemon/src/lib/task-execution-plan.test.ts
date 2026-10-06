import { describe, expect, it } from 'vitest';

import { buildDaemonTaskExecutionPlan } from './task-execution-plan.js';

describe('buildDaemonTaskExecutionPlan', () => {
  it('honors run_eval dedicated_worktree requested by the task creator', () => {
    const out = buildDaemonTaskExecutionPlan({
      id: '55555555-5555-4555-8555-555555555555',
      taskType: 'run_eval',
      title: null,
      correlationId: '66666666-6666-4666-8666-666666666666',
      input: {
        scenario: { prompt: 'Evaluate this' },
        variantLabel: 'With Skill',
        execution: {
          mode: 'vivo',
          workspace: 'dedicated_worktree',
        },
        context: [],
      },
    });

    expect(out.slotKey).toBeNull();
    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/run-eval-55555555');
    expect(out.workspaceScope).toBe('attempt');
  });

  it('maps run_eval workspace:none to a scratch mount instead of the repo', () => {
    const out = buildDaemonTaskExecutionPlan({
      id: '77777777-7777-4777-8777-777777777777',
      taskType: 'run_eval',
      title: null,
      correlationId: '88888888-8888-4888-8888-888888888888',
      input: {
        scenario: { prompt: 'Evaluate this' },
        variantLabel: 'Baseline',
        execution: {
          mode: 'vitro',
          workspace: 'none',
        },
        context: [],
      },
    });

    expect(out.slotKey).toBeNull();
    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.worktreeBranch).toBeNull();
    expect(out.workspaceScope).toBe('attempt');
  });

  it('defaults freeform tasks to shared_mount when no override is supplied', () => {
    const out = buildDaemonTaskExecutionPlan({
      id: '99999999-9999-4999-8999-999999999999',
      taskType: 'freeform',
      title: null,
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      input: { brief: 'probe' },
    });

    expect(out.workspaceMode).toBe('shared_mount');
    // shared_mount keeps workspaceId null per the existing daemon contract.
    expect(out.workspaceId).toBeNull();
  });

  it('honors freeform input.execution.workspace=dedicated_worktree', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        taskType: 'freeform',
        title: null,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        input: {
          brief: 'scaffold a candidate task type',
          execution: { workspace: 'dedicated_worktree' },
        },
      },

      {},
      1,
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-bbbbbbbb');
    expect(out.workspaceScope).toBe('attempt');
    expect(out.workspaceId).toBe(
      'daemon-task-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-attempt-1',
    );
  });

  it('carries an immutable review revision into the workspace plan', () => {
    const revision = 'abcdef0123456789abcdef0123456789abcdef01';
    const out = buildDaemonTaskExecutionPlan(
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        taskType: 'freeform',
        title: null,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        input: {
          brief: 'review an exact commit',
          execution: {
            workspace: 'dedicated_worktree',
            revision: revision.toUpperCase(),
          },
        },
      },

      {},
      1,
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.workspaceRevision).toBe(revision);
    expect(out.worktreeBranch).toBeNull();
  });

  it('honors freeform input.execution.workspace=none as scratch_mount', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        taskType: 'freeform',
        title: null,
        correlationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        input: {
          brief: 'analyze diary entries; no repo access needed',
          execution: { workspace: 'none' },
        },
      },

      {},
      1,
    );

    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.workspaceKind).toBe('scratch');
    expect(out.worktreeBranch).toBeNull();
    expect(out.workspaceScope).toBe('attempt');
    expect(out.workspaceId).toBe(
      'daemon-task-dddddddd-dddd-4ddd-8ddd-dddddddddddd-attempt-1',
    );
  });

  it('uses the runtime profile default when task input has no workspace override', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        taskType: 'freeform',
        title: null,
        correlationId: '11111111-2222-4333-8444-555555555555',
        input: { brief: 'read task context only' },
      },

      {
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none', 'shared_mount'],
      },
      1,
    );

    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.workspaceId).toBe(
      'daemon-task-ffffffff-ffff-4fff-8fff-ffffffffffff-attempt-1',
    );
  });

  it('honors a task workspace override when the runtime profile allows it', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '12121212-1212-4121-8121-121212121212',
        taskType: 'freeform',
        title: null,
        correlationId: '23232323-2323-4232-8232-232323232323',
        input: {
          brief: 'needs repo edits',
          execution: { workspace: 'dedicated_worktree' },
        },
      },

      {
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none', 'dedicated_worktree'],
      },
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-12121212');
  });

  it('rejects a task workspace override that the runtime profile forbids', () => {
    expect(() =>
      buildDaemonTaskExecutionPlan(
        {
          id: '34343434-3434-4343-8343-343434343434',
          taskType: 'freeform',
          title: null,
          correlationId: '45454545-4545-4454-8454-454545454545',
          input: {
            brief: 'requests shared repo',
            execution: { workspace: 'shared_mount' },
          },
        },

        {
          workspaceExplicit: true,
          defaultWorkspaceMode: 'none',
          allowedWorkspaceModes: ['none', 'dedicated_worktree'],
        },
      ),
    ).toThrow(/not allowed/);
  });
  it('preserves profile fallback for an unbound worker', () => {
    expect(
      buildDaemonTaskExecutionPlan(
        {
          id: '34343434-3434-4343-8343-343434343434',
          taskType: 'freeform',
          title: null,
          correlationId: '45454545-4545-4454-8454-454545454545',
          input: {
            brief: 'requests shared repo',
            execution: { workspace: 'shared_mount' },
          },
        },

        {
          workspaceExplicit: false,
          defaultWorkspaceMode: 'none',
          allowedWorkspaceModes: ['none', 'dedicated_worktree'],
        },
      ),
    ).toMatchObject({ workspaceMode: 'scratch_mount' });
  });

  it('falls back to the safest allowed mode when the task default is forbidden', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '56565656-5656-4565-8565-565656565656',
        taskType: 'freeform',
        title: null,
        correlationId: '67676767-6767-4676-8676-676767676767',
        input: { brief: 'default shared_mount is not allowed' },
      },

      {
        allowedWorkspaceModes: ['dedicated_worktree'],
      },
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-56565656');
  });
});
