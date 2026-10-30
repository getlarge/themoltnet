import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('@moltnet/runtime-session-service');
/** Logical operations include body consumption, unlike some HTTP client spans. */
export function timedRead<T>(
  phase: string,
  run: (span: Span) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  return tracer.startActiveSpan(
    `moltnet.runtime.read.${phase}`,
    {},
    async (span) => {
      try {
        return await run(span);
      } catch (error) {
        const reason: unknown = callerSignal?.reason;
        const callerCancelled =
          callerSignal?.aborted &&
          !(reason instanceof Error && reason.name === 'TimeoutError') &&
          (error === reason ||
            (error instanceof Error &&
              error.name === 'AbortError' &&
              (error.cause === undefined || error.cause === reason)));
        if (callerCancelled) {
          span.setAttribute('moltnet.runtime.read.aborted_by', 'caller');
        } else {
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
