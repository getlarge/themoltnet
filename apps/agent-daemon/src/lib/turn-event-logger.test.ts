import { Writable } from 'node:stream';

import type { ClaimedTask } from '@themoltnet/agent-runtime';
import { type Logger, pino } from 'pino';
import { describe, expect, it } from 'vitest';

import {
  makeTurnEventHandler,
  makeTurnEventHandlerFactory,
} from './turn-event-logger.js';

// Capture pino output by piping into an in-memory writable. Uses pino's
// async-safe single-stream destination (default for Logger constructed
// with no transport) so we can read line-buffered NDJSON.
function captureLogger(): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      cb();
    },
  });
  const logger = pino({ level: 'debug' }, dest);
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((s) => s.length > 0)
        .map((s) => JSON.parse(s) as Record<string, unknown>),
  };
}

function fakeClaimedTask(taskId: string, attemptN = 1): ClaimedTask {
  return {
    task: { id: taskId } as ClaimedTask['task'],
    attemptN,
  } as ClaimedTask;
}

describe('makeTurnEventHandler', () => {
  it('routes turn_end to info, error to warn, others to debug', () => {
    const cap = captureLogger();
    const h = makeTurnEventHandler(cap.logger);
    h('info', { event: 'execute_start' });
    h('tool_call_start', { tool: 'bash' });
    h('turn_end', { stop_reason: 'tool_use' });
    h('error', { phase: 'session_prompt', message: 'boom' });
    const lines = cap.lines();
    const byEvent = Object.fromEntries(
      lines.map((l) => [l.event as string, l]),
    );
    expect(byEvent.tool_call_start.level).toBe(20); // debug
    expect(byEvent.turn_end.level).toBe(30); // info
    expect(byEvent.error.level).toBe(40); // warn
  });

  it('suppresses text_delta', () => {
    const cap = captureLogger();
    const h = makeTurnEventHandler(cap.logger);
    h('text_delta', { chars: 42 });
    expect(cap.lines()).toEqual([]);
  });

  it('binds the supplied context fields onto every line', () => {
    const cap = captureLogger();
    const h = makeTurnEventHandler(cap.logger, {
      taskId: 'abc-123',
      attemptN: 2,
    });
    h('turn_end', { stop_reason: 'end_turn' });
    const [line] = cap.lines();
    expect(line.taskId).toBe('abc-123');
    expect(line.attemptN).toBe(2);
    expect(line.event).toBe('turn_end');
  });
});

describe('makeTurnEventHandlerFactory', () => {
  it('binds taskId + attemptN from the claimed task into each handler', () => {
    const cap = captureLogger();
    const factory = makeTurnEventHandlerFactory(cap.logger);

    // Lifecycle 1
    const h1 = factory(fakeClaimedTask('task-1', 1));
    h1('turn_end', { stop_reason: 'end_turn' });

    // Lifecycle 2 — fresh handler, fresh context
    const h2 = factory(fakeClaimedTask('task-2', 3));
    h2('turn_end', { stop_reason: 'end_turn' });

    const lines = cap.lines();
    expect(lines).toHaveLength(2);
    expect(lines[0].taskId).toBe('task-1');
    expect(lines[0].attemptN).toBe(1);
    expect(lines[1].taskId).toBe('task-2');
    expect(lines[1].attemptN).toBe(3);
  });

  it('returns independent handlers — second factory call does not mutate the first', () => {
    const cap = captureLogger();
    const factory = makeTurnEventHandlerFactory(cap.logger);
    const h1 = factory(fakeClaimedTask('task-1'));
    const h2 = factory(fakeClaimedTask('task-2'));
    h1('turn_end', { stop_reason: 'end_turn' });
    h2('turn_end', { stop_reason: 'end_turn' });
    h1('turn_end', { stop_reason: 'end_turn' });
    const lines = cap.lines();
    expect(lines.map((l) => l.taskId)).toEqual(['task-1', 'task-2', 'task-1']);
  });
});
