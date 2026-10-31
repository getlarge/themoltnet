import { describe, expect, it } from 'vitest';

import { buildPiRetryTriagePromptForTest } from '../../src/runtime/retry-triage.js';

const BASE_INPUT = {
  task: {
    id: 'task-1',
    taskType: 'freeform',
    teamId: 'team-1',
    input: { brief: 'do it' },
  },
  attemptN: 1,
  maxAttempts: 2,
  remainingAttempts: 1,
  error: {
    code: 'executor_unexpected_error',
    message: 'unclear failure',
  },
};

describe('pi retry triage prompt', () => {
  it('redacts secret-looking fields from the triage prompt', async () => {
    const prompt = await buildPiRetryTriagePromptForTest({
      ...BASE_INPUT,
      task: {
        ...BASE_INPUT.task,
        input: {
          brief: 'use credentials',
          apiKey: 'sk-secret-value',
          nested: {
            authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
          },
        },
      },
      error: {
        code: 'executor_unexpected_error',
        message:
          // secretlint-disable-next-line @secretlint/secretlint-rule-github -- fake secret exercising the runtime scanner
          'failed with token ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AWS key AKIAABCDEFGHIJKL1234',
      },
      recentMessages: [
        {
          timestamp: '2026-06-29T11:00:00Z',
          kind: 'info',
          payload: { password: 'super-secret' },
        },
      ],
    });

    expect(prompt).toContain('"apiKey": "[redacted]"');
    expect(prompt).toContain('"authorization": "[redacted]"');
    expect(prompt).toContain('"password": "[redacted]"');
    expect(prompt).not.toContain('sk-secret-value');
    expect(prompt).not.toContain('super-secret');
    // secretlint-disable-next-line @secretlint/secretlint-rule-github -- fake secret exercising the runtime scanner
    expect(prompt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(prompt).not.toContain('AKIAABCDEFGHIJKL1234');
  });

  it('bounds large triage prompt payloads', async () => {
    const prompt = await buildPiRetryTriagePromptForTest({
      ...BASE_INPUT,
      task: {
        ...BASE_INPUT.task,
        input: { brief: 'x'.repeat(40_000) },
      },
      error: {
        code: 'executor_unexpected_error',
        message: 'y'.repeat(40_000),
      },
    });

    expect(prompt.length).toBeLessThan(13_000);
    expect(prompt).toContain('[truncated');
  });

  it('keeps output validation in-session instead of creating a task attempt retry', async () => {
    const prompt = await buildPiRetryTriagePromptForTest({
      ...BASE_INPUT,
      error: {
        code: 'output_validation_failed',
        message:
          'Submit-output recovery ended without valid output; output/variantLabel is required',
      },
    });

    expect(prompt).toContain('corrected inside the active Pi session');
    expect(prompt).toContain('same-session recovery budget is spent');
    expect(prompt).toContain('choose do_not_retry');
    expect(prompt).toContain('output_validation_failed');
  });
});
