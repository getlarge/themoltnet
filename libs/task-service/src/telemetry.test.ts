import type * as OpenTelemetryApi from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => {
  const span = {
    end: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
  };
  return {
    span,
    startActiveSpan: vi.fn(async (...args: unknown[]) => {
      const run = args.at(-1) as (activeSpan: typeof span) => Promise<unknown>;
      return run(span);
    }),
  };
});

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenTelemetryApi>();
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getTracer: () => ({
        startActiveSpan: telemetryMocks.startActiveSpan,
      }),
    },
  };
});

import { traceTaskServicePhase } from './telemetry.js';

describe('traceTaskServicePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a successful phase with attributes', async () => {
    await expect(
      traceTaskServicePhase(
        'moltnet.task.workflow.wait_result',
        { 'task.id': 'task-1' },
        () => Promise.resolve('done'),
      ),
    ).resolves.toBe('done');

    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      'moltnet.task.workflow.wait_result',
      { attributes: { 'task.id': 'task-1' } },
      expect.any(Function),
    );
    expect(telemetryMocks.span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.OK,
    });
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it('records and rethrows errors before ending the span', async () => {
    const error = new Error('workflow unavailable');

    await expect(
      traceTaskServicePhase('moltnet.task.workflow.reload_result', {}, () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error);

    expect(telemetryMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(telemetryMocks.span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });
});
