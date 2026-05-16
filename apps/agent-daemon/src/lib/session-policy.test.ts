import { describe, expect, it } from 'vitest';

import { deriveTaskSessionDescriptor } from './session-policy.js';

describe('deriveTaskSessionDescriptor', () => {
  it('makes fulfill_brief correlation-resumable', () => {
    const out = deriveTaskSessionDescriptor({
      id: '11111111-1111-4111-8111-111111111111',
      taskType: 'fulfill_brief',
      correlationId: '22222222-2222-4222-8222-222222222222',
      input: { brief: 'Fix the daemon', title: 'Warm sessions' },
    });

    expect(out).toEqual({
      policy: {
        resumable: true,
        workspaceMode: 'dedicated_worktree',
        workspaceScope: 'session',
        sessionScope: 'correlation',
        usesSubagents: false,
      },
      sessionKey:
        'fulfill_brief:correlation:22222222-2222-4222-8222-222222222222',
    });
  });

  it('refuses warm reuse for fulfill_brief without a correlation id', () => {
    const out = deriveTaskSessionDescriptor({
      id: '11111111-1111-4111-8111-111111111111',
      taskType: 'fulfill_brief',
      correlationId: null,
      input: { brief: 'Fix the daemon' },
    });

    expect(out.policy.resumable).toBe(true);
    expect(out.sessionKey).toBeNull();
  });

  it('keeps assess_brief cold-started and attempt-scoped', () => {
    const out = deriveTaskSessionDescriptor({
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
    });

    expect(out.policy).toMatchObject({
      resumable: false,
      workspaceMode: 'dedicated_worktree',
      workspaceScope: 'attempt',
      sessionScope: 'none',
    });
    expect(out.sessionKey).toBeNull();
  });

  it('assigns run_eval a custom resumable session key per correlation and variant', () => {
    const out = deriveTaskSessionDescriptor({
      id: '55555555-5555-4555-8555-555555555555',
      taskType: 'run_eval',
      correlationId: '66666666-6666-4666-8666-666666666666',
      input: {
        scenario: { prompt: 'Evaluate this' },
        variantLabel: 'Baseline Variant',
        execution: { mode: 'vitro', workspace: 'none' },
        context: [],
      },
    });

    expect(out.policy).toMatchObject({
      resumable: true,
      workspaceMode: 'shared_mount',
      workspaceScope: 'attempt',
      sessionScope: 'custom',
    });
    expect(out.sessionKey).toBe(
      'run_eval:correlation:66666666-6666-4666-8666-666666666666:variant:baseline-variant',
    );
  });
});
