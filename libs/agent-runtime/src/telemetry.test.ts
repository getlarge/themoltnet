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
    startActiveSpan: vi.fn(
      async (
        _name: string,
        _options: unknown,
        run: (activeSpan: typeof span) => Promise<unknown>,
      ) => run(span),
    ),
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
});
