import type * as OpenTelemetryApi from '@opentelemetry/api';
import { type Context, SpanStatusCode } from '@opentelemetry/api';
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

import { traceRuntimePhase } from './telemetry.js';

describe('traceRuntimePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records and rethrows phase errors before ending the span', async () => {
    const error = new Error('provider unavailable');

    await expect(
      traceRuntimePhase('moltnet.test.phase', {}, () => Promise.reject(error)),
    ).rejects.toBe(error);

    expect(telemetryMocks.span.recordException).toHaveBeenCalledWith(error);
    expect(telemetryMocks.span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    expect(telemetryMocks.span.end).toHaveBeenCalledOnce();
  });

  it('uses an explicit parent context when one is supplied', async () => {
    const parentContext = {} as Context;

    await traceRuntimePhase(
      'moltnet.test.child',
      { bounded: true },
      async () => 'done',
      parentContext,
    );

    expect(telemetryMocks.startActiveSpan).toHaveBeenCalledWith(
      'moltnet.test.child',
      { attributes: { bounded: true } },
      parentContext,
      expect.any(Function),
    );
  });
});
