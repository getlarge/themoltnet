import { describe, expect, it } from 'vitest';

import { buildDaemonTaskExecutionPlan } from './task-execution-plan.js';

describe('buildDaemonTaskExecutionPlan', () => {
  const identity = {
    agentName: 'legreffier',
    runtimeProfileId: 'dddddddd-0000-4000-8000-000000000004',
  } as const;

  it('maps resumable fulfill_brief tasks to a persistent Pi session dir', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '11111111-1111-4111-8111-111111111111',
        taskType: 'fulfill_brief',
        title: 'Warm sessions',
        correlationId: '22222222-2222-4222-8222-222222222222',
        input: { brief: 'Fix the daemon' },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.slotKey).toBe(
      'fulfill_brief:correlation:22222222-2222-4222-8222-222222222222',
    );
    expect(out.slotId).toBe(
      'agent:legreffier:profile:dddddddd-0000-4000-8000-000000000004:key:fulfill_brief:correlation:22222222-2222-4222-8222-222222222222',
    );
    expect(out.workspaceScope).toBe('session');
    expect(out.workspaceId).toBe(
      'session-agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Afulfill_brief%3Acorrelation%3A22222222-2222-4222-8222-222222222222',
    );
    expect(out.sessionPersistence).toEqual({
      sessionDir:
        '/repo/.moltnet/d/pi-sessions/agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Afulfill_brief%3Acorrelation%3A22222222-2222-4222-8222-222222222222',
    });
  });

  it('keeps cold-started task types in-memory', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '33333333-3333-4333-8333-333333333333',
        taskType: 'assess_brief',
        title: null,
        correlationId: '22222222-2222-4222-8222-222222222222',
        input: {
          targetTaskId: '44444444-4444-4444-8444-444444444444',
          successCriteria: {
            version: 1,
            rubric: {
              rubricId: 'r',
              version: 'v1',
              scope: 'brief',
              preamble: 'p',
              criteria: [
                { id: 'c1', description: 'd', weight: 1, scoring: 'llm_score' },
              ],
            },
          },
        },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.descriptor.sessionKey).toBeNull();
    expect(out.workspaceScope).toBe('attempt');
    expect(out.sessionPersistence).toBeNull();
  });

  it('downgrades resumable policy to attempt-scoped when warm retention is disabled', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '11111111-1111-4111-8111-111111111111',
        taskType: 'fulfill_brief',
        title: 'Warm sessions',
        correlationId: '22222222-2222-4222-8222-222222222222',
        input: { brief: 'Fix the daemon' },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      0,
    );

    expect(out.descriptor.policy.workspaceScope).toBe('session');
    expect(out.sessionKey).toBeNull();
    expect(out.slotKey).toBeNull();
    expect(out.slotId).toBeNull();
    expect(out.workspaceScope).toBe('attempt');
    expect(out.workspaceId).toBe('task-11111111-1111-4111-8111-111111111111');
  });

  it('honors run_eval dedicated_worktree requested by the task creator', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
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
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.slotKey).toBe(
      'run_eval:correlation:66666666-6666-4666-8666-666666666666:variant:with-skill',
    );
    expect(out.sessionPersistence).toEqual({
      sessionDir:
        '/repo/.moltnet/d/pi-sessions/agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Arun_eval%3Acorrelation%3A66666666-6666-4666-8666-666666666666%3Avariant%3Awith-skill',
    });
    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.workspaceId).toBe(
      'session-agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Arun_eval%3Acorrelation%3A66666666-6666-4666-8666-666666666666%3Avariant%3Awith-skill',
    );
    expect(out.worktreeBranch).toBe('task/run-eval-55555555');
    expect(out.workspaceScope).toBe('session');
  });

  it('maps run_eval workspace:none to a scratch mount instead of the repo', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
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
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.slotKey).toBe(
      'run_eval:correlation:88888888-8888-4888-8888-888888888888:variant:baseline',
    );
    expect(out.sessionPersistence).toEqual({
      sessionDir:
        '/repo/.moltnet/d/pi-sessions/agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Arun_eval%3Acorrelation%3A88888888-8888-4888-8888-888888888888%3Avariant%3Abaseline',
    });
    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.workspaceId).toBe(
      'session-agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Arun_eval%3Acorrelation%3A88888888-8888-4888-8888-888888888888%3Avariant%3Abaseline',
    );
    expect(out.worktreeBranch).toBeNull();
    expect(out.workspaceScope).toBe('session');
  });

  it('defaults freeform tasks to shared_mount when no override is supplied', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '99999999-9999-4999-8999-999999999999',
        taskType: 'freeform',
        title: null,
        correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        input: { brief: 'probe' },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

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
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-bbbbbbbb');
    expect(out.workspaceScope).toBe('session');
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
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
    );

    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.worktreeBranch).toBeNull();
    expect(out.workspaceScope).toBe('session');
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
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
      {
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none', 'shared_mount'],
      },
    );

    expect(out.workspaceMode).toBe('scratch_mount');
    expect(out.workspaceId).toBe(
      'session-agent%3Alegreffier%3Aprofile%3Adddddddd-0000-4000-8000-000000000004%3Akey%3Afreeform%3Acorrelation%3A11111111-2222-4333-8444-555555555555',
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
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
      {
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none', 'dedicated_worktree'],
      },
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-12121212');
  });

  it('ignores a task workspace override that the runtime profile forbids', () => {
    const out = buildDaemonTaskExecutionPlan(
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
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
      {
        defaultWorkspaceMode: 'none',
        allowedWorkspaceModes: ['none', 'dedicated_worktree'],
      },
    );

    expect(out.workspaceMode).toBe('scratch_mount');
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
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
      },
      identity,
      1800,
      {
        allowedWorkspaceModes: ['dedicated_worktree'],
      },
    );

    expect(out.workspaceMode).toBe('dedicated_worktree');
    expect(out.worktreeBranch).toBe('task/freeform-56565656');
  });
});
