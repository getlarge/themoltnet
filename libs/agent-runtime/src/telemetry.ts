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

export function addActiveTaskEvent(
  name: string,
  attributes: Attributes = {},
): void {
  trace.getActiveSpan()?.addEvent(name, attributes);
}
