import type { TaskError } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  classifyAttemptFailure,
  classifyDeterministically,
} from './retry-triage.js';

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
};

describe('retry triage classification', () => {
  it('marks transient provider messages retryable without LLM triage', async () => {
    const error: TaskError = {
      code: 'llm_api_error',
      message: 'provider returned 503 service unavailable',
      retryable: false,
    };

    const result = await classifyAttemptFailure({ ...BASE_INPUT, error });

    expect(result.source).toBe('deterministic');
    expect(result.error.retryable).toBe(true);
  });

  it('marks credentials and validation failures non-retryable', () => {
    expect(
      classifyDeterministically({
        code: 'output_validation_failed',
        message: 'validation failed',
      }),
    ).toBe('non_retryable');
    expect(
      classifyDeterministically({
        code: 'executor_error',
        message: '401 unauthorized: invalid api key',
      }),
    ).toBe('non_retryable');
  });

  it('lets non-retryable messages override broad retryable provider codes', () => {
    expect(
      classifyDeterministically({
        code: 'llm_api_error',
        message: 'provider returned 401 unauthorized: invalid api key',
      }),
    ).toBe('non_retryable');
    expect(
      classifyDeterministically({
        code: 'llm_api_error',
        message: 'model pi-large is not available',
      }),
    ).toBe('non_retryable');
  });

  it('uses medium/high retry triage for ambiguous errors', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: {
        code: 'executor_unexpected_error',
        message: 'agent runtime stopped after partial tool recovery',
      },
      triage: () =>
        Promise.resolve({
          decision: 'retry',
          confidence: 'medium',
          reason:
            'The failure is likely runtime-local and the task input is valid.',
        }),
    });

    expect(result.source).toBe('triage');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('Retry triage: retry/medium');
  });

  it('does not retry low-confidence triage', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
      triage: () =>
        Promise.resolve({
          decision: 'retry',
          confidence: 'low',
          reason: 'Not enough evidence.',
        }),
    });

    expect(result.error.retryable).toBe(false);
  });

  it('does not retry when triage fails', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
      triage: () => Promise.reject(new Error('model unavailable')),
    });

    expect(result.source).toBe('triage_failed');
    expect(result.error.retryable).toBe(false);
  });
});
