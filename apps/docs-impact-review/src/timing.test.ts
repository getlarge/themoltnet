import type {
  SdkTask,
  SdkTaskAttempt,
  TaskMessage,
} from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

import { stageTiming } from './timing.js';

const task = {
  id: 't1',
  queuedAt: '2026-09-24T10:00:00.000Z',
} as unknown as SdkTask;

const attempt = {
  claimedAt: '2026-09-24T10:00:01.000Z',
  startedAt: '2026-09-24T10:00:01.500Z',
  completedAt: '2026-09-24T10:00:40.000Z',
  usage: { inputTokens: 900, outputTokens: 120, model: 'glm-5.3-flash' },
} as unknown as SdkTaskAttempt;

function message(
  seq: number,
  kind: string,
  payload: unknown,
  timestamp: string,
): TaskMessage {
  return { seq, kind, payload, timestamp };
}

describe('stageTiming', () => {
  it('splits queue, open, VM setup, first model event, and model time', () => {
    // Arrange
    const messages = [
      message(
        3,
        'text_delta',
        { delta: '{"version"' },
        '2026-09-24T10:00:25.000Z',
      ),
      message(
        1,
        'info',
        { event: 'execute_start' },
        '2026-09-24T10:00:19.500Z',
      ),
      message(2, 'text_delta', { delta: '  ' }, '2026-09-24T10:00:20.000Z'),
      message(
        4,
        'tool_call_start',
        { name: 'grep' },
        '2026-09-24T10:00:30.000Z',
      ),
    ];

    // Act
    const timing = stageTiming({ task, attempt, messages, observedMs: 41_000 });

    // Assert
    expect(timing).toMatchObject({
      queueMs: 1_000,
      openMs: 500,
      setupMs: 18_000,
      firstModelEventMs: 5_500,
      modelMs: 15_000,
      executionMs: 38_500,
      observedMs: 41_000,
      toolCalls: 1,
      inputTokens: 900,
      model: 'glm-5.3-flash',
    });
  });

  it('leaves phases null when the transcript lacks a marker', () => {
    // Act
    const timing = stageTiming({ task, attempt, messages: [], observedMs: 5 });

    // Assert
    expect(timing).toMatchObject({
      queueMs: 1_000,
      setupMs: null,
      firstModelEventMs: null,
      modelMs: null,
      toolCalls: null,
    });
  });
});
