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
    expect(result.error.retry).toEqual({
      source: 'deterministic',
      decision: 'retry',
      confidence: 'high',
      reason: 'Matched deterministic retry policy.',
    });
  });

  it('keeps submit validation failures non-retryable after in-session retries are exhausted', () => {
    expect(
      classifyDeterministically({
        code: 'output_validation_failed',
        message:
          'Submit-output validation retry budget exhausted; validation failed',
      }),
    ).toBe('non_retryable');
  });

  it('classifies submit-missing as non-retryable through the full attempt path', async () => {
    const error: TaskError = {
      code: 'submit_output_missing',
      message:
        'Agent did not satisfy the promised submit-output criterion: ' +
        'no valid task submit tool call was captured before the session ended.',
      retryable: false,
    };

    const result = await classifyAttemptFailure({ ...BASE_INPUT, error });

    expect(result.error.retryable).toBe(false);
    expect(result.error.retry).toEqual({
      source: 'explicit',
      decision: 'do_not_retry',
      confidence: 'high',
      reason: 'Matched deterministic no-retry policy.',
    });
  });

  it('keeps submit-missing failures non-retryable once in-session re-prompts are spent', () => {
    // The Pi runtime already re-prompts within the attempt to coax a submit
    // call (#1528). If it still reaches daemon triage as submit_output_missing,
    // a fresh attempt with the same model is unlikely to behave differently.
    expect(
      classifyDeterministically({
        code: 'submit_output_missing',
        message:
          'Agent did not satisfy the promised submit-output criterion: ' +
          'no valid task submit tool call was captured before the session ended.',
      }),
    ).toBe('non_retryable');
  });

  it('marks credentials failures non-retryable', () => {
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

  it('does not call triage when attempts are exhausted', async () => {
    let called = false;
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      remainingAttempts: 0,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
      triage: () => {
        called = true;
        return Promise.resolve({
          decision: 'retry',
          confidence: 'high',
          reason: 'Would retry if called.',
        });
      },
    });

    expect(called).toBe(false);
    expect(result.source).toBe('attempts_exhausted');
    expect(result.error.retryable).toBe(false);
    expect(result.error.retry).toEqual({
      source: 'attempts_exhausted',
      reason: 'Attempt budget exhausted at attempt 1 of 2.',
    });
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
    expect(result.error.retry).toEqual({
      source: 'triage',
      decision: 'retry',
      confidence: 'low',
      reason: 'Not enough evidence.',
    });
  });

  it('does not retry when triage fails', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
      triage: () => Promise.reject(new Error('model unavailable')),
    });

    expect(result.source).toBe('triage_failed');
    expect(result.error.retryable).toBe(false);
    expect(result.error.retry).toEqual({
      source: 'triage_failed',
      reason: 'Retry triage failed: model unavailable',
    });
  });

  it('redacts secret-looking tokens from triage failure metadata', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
      triage: () =>
        Promise.reject(
          new Error(
            'provider failed with token ghp_abcdefghijklmnopqrstuvwxyz',
          ),
        ),
    });

    expect(result.error.message).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz',
    );
    expect(result.error.retry?.reason).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz',
    );
    expect(result.error.retry?.reason).toContain('[redacted]');
  });

  it('explains ambiguous failures when no triage agent is configured', async () => {
    const result = await classifyAttemptFailure({
      ...BASE_INPUT,
      error: { code: 'executor_unexpected_error', message: 'unclear failure' },
    });

    expect(result.source).toBe('triage_failed');
    expect(result.error.retryable).toBe(false);
    expect(result.error.retry).toEqual({
      source: 'triage_failed',
      reason:
        'Failure was ambiguous and no retry triage agent was configured; defaulted to no retry.',
    });
  });
});
