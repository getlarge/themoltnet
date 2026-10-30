import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('@moltnet/runtime-session-service');
/** Logical operations include body consumption, unlike some HTTP client spans. */
export function timedRead<T>(
  phase: string,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `moltnet.runtime.read.${phase}`,
    {},
    async (span) => {
      try {
        return await run(span);
      } catch (error) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
