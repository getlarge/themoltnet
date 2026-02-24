import { AsyncLocalStorage } from 'node:async_hooks';

import { trace } from '@opentelemetry/api';

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
 * The context is available via `getRequestContextFields` and
 * `setRequestContextField` throughout the async call chain.
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
 * Return the current request context fields merged with OTel trace context
 * (traceId, spanId). Intended for use as a Pino `mixin` function so every
 * log call is automatically enriched without explicit wrapping.
 *
 * Safe to call outside a request context — returns only OTel fields (or {}).
 */
export function getRequestContextFields(): Record<string, unknown> {
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

  return ctx;
}
