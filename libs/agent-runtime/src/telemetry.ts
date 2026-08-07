import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const tracer = trace.getTracer('@themoltnet/agent-runtime');

/** Run one bounded runtime phase as a child of the active task trace. */
export async function traceRuntimePhase<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await run(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error instanceof Error ? error : new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Record a phase after it completes. This lets callers suppress routine idle
 * work without losing the duration of non-empty or failed operations.
 */
export function recordCompletedRuntimePhase(
  name: string,
  attributes: Attributes,
  startedAt: number,
  error?: unknown,
): void {
  const span = tracer.startSpan(name, { attributes, startTime: startedAt });
  if (error === undefined) {
    span.setStatus({ code: SpanStatusCode.OK });
  } else {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown runtime phase error';
    span.recordException(error instanceof Error ? error : new Error(message));
    span.setStatus({ code: SpanStatusCode.ERROR, message });
  }
  span.end(Date.now());
}

export function addActiveTaskEvent(
  name: string,
  attributes: Attributes = {},
): void {
  trace.getActiveSpan()?.addEvent(name, attributes);
}
