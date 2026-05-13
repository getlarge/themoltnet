import { describe, expect, it } from 'vitest';

import { buildDaemonTaskExecutionPlan } from './task-execution-plan.js';

describe('buildDaemonTaskExecutionPlan', () => {
  const identity = {
    agentName: 'legreffier',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
  } as const;

  it('maps resumable fulfill_brief tasks to a persistent Pi session dir', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '11111111-1111-4111-8111-111111111111',
        taskType: 'fulfill_brief',
        correlationId: '22222222-2222-4222-8222-222222222222',
        input: { brief: 'Fix the daemon', title: 'Warm sessions' },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
        registryDbPath: '/repo/.moltnet/d/daemon-state.sqlite',
      },
      identity,
      1800,
    );

    expect(out.slotKey).toBe(
      'fulfill_brief:correlation:22222222-2222-4222-8222-222222222222',
    );
    expect(out.slotId).toBe(
      'agent:legreffier:provider:anthropic:model:claude-sonnet-4-5:key:fulfill_brief:correlation:22222222-2222-4222-8222-222222222222',
    );
    expect(out.workspaceScope).toBe('session');
    expect(out.workspaceId).toBe(
      'session-agent%3Alegreffier%3Aprovider%3Aanthropic%3Amodel%3Aclaude-sonnet-4-5%3Akey%3Afulfill_brief%3Acorrelation%3A22222222-2222-4222-8222-222222222222',
    );
    expect(out.sessionPersistence).toEqual({
      sessionDir:
        '/repo/.moltnet/d/pi-sessions/agent%3Alegreffier%3Aprovider%3Aanthropic%3Amodel%3Aclaude-sonnet-4-5%3Akey%3Afulfill_brief%3Acorrelation%3A22222222-2222-4222-8222-222222222222',
    });
  });

  it('keeps cold-started task types in-memory', () => {
    const out = buildDaemonTaskExecutionPlan(
      {
        id: '33333333-3333-4333-8333-333333333333',
        taskType: 'assess_brief',
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
        registryDbPath: '/repo/.moltnet/d/daemon-state.sqlite',
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
        correlationId: '22222222-2222-4222-8222-222222222222',
        input: { brief: 'Fix the daemon', title: 'Warm sessions' },
      },
      {
        rootDir: '/repo/.moltnet/d',
        piSessionsDir: '/repo/.moltnet/d/pi-sessions',
        registryDbPath: '/repo/.moltnet/d/daemon-state.sqlite',
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
});
