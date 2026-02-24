import { AsyncLocalStorage } from 'node:async_hooks';

import { trace } from '@opentelemetry/api';
import type { Logger } from 'pino';

export interface RequestContext {
  requestId?: string;
  identityId?: string;
  clientId?: string;
}

type ContextStore = Map<
  keyof RequestContext,
  RequestContext[keyof RequestContext]
>;

const contextStore = new AsyncLocalStorage<ContextStore>();

/**
 * Run `fn` within a new request context initialised with `initial`.
 * The context is available via `getContextLogger` and `setRequestContextField`
 * throughout the async call chain, without passing a logger argument.
 */
export function runWithRequestContext<T>(
  initial: RequestContext,
  fn: () => T,
): T {
  const store: ContextStore = new Map(
    Object.entries(initial).filter(([, v]) => v !== undefined) as [
      keyof RequestContext,
      RequestContext[keyof RequestContext],
    ][],
  );
  return contextStore.run(store, fn);
}

/**
 * Set a field in the current request context.
 * No-op when called outside a `runWithRequestContext` scope.
 */
export function setRequestContextField<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K],
): void {
  const store = contextStore.getStore();
  if (store && value !== undefined) {
    store.set(key, value);
  }
}

/**
 * Return a Pino child logger enriched with the current request context
 * and OTel trace context (traceId, spanId).
 *
 * Safe to call outside a request context — returns child with only OTel fields.
 */
export function getContextLogger(baseLogger: Logger): Logger {
  const ctx: Record<string, unknown> = {};

  const store = contextStore.getStore();
  if (store) {
    for (const [k, v] of store) {
      if (v !== undefined) ctx[k as string] = v;
    }
  }

  const span = trace.getActiveSpan();
  const spanCtx = span?.spanContext();
  if (spanCtx?.traceId) {
    ctx['traceId'] = spanCtx.traceId;
    ctx['spanId'] = spanCtx.spanId;
  }

  return baseLogger.child(ctx);
}
