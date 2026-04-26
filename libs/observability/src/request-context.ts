import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId?: string;
  identityId?: string;
  clientId?: string;
  subjectType?: 'agent' | 'human';
  currentTeamId?: string;
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
 * Establish the request context on the current async resource without
 * a callback wrapper. Unlike `runWithRequestContext`, this mutates the
 * current async context in place — subsequent code in the same async
 * chain (even across hook boundaries scheduled by Fastify's lifecycle)
 * keeps reading the same store.
 *
 * Use this when the framework owns the continuation (e.g. Fastify's
 * `done()` callback) and a wrapping `als.run()` would leak the scope
 * the moment the framework returns to its own scheduler.
 */
export function enterRequestContext(initial: RequestContext): void {
  const store: ContextStore = new Map(
    Object.entries(initial).filter(([, v]) => v !== undefined) as [
      keyof RequestContext,
      RequestContext[keyof RequestContext],
    ][],
  );
  contextStore.enterWith(store);
}

/**
 * Set a field in the current request context. No-op when there's no
 * active store — i.e. outside both a `runWithRequestContext` callback
 * and any `enterRequestContext` on this async resource.
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
 * Return the current request context fields (requestId, identityId,
 * clientId, subjectType, currentTeamId).
 * Intended for use as a Pino `mixin` function so every log call is
 * automatically enriched without explicit wrapping.
 *
 * OTel trace context (traceId, spanId) is handled separately by issue #302.
 *
 * Safe to call outside a request context — returns {}.
 */
export function getRequestContextFields(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  const store = contextStore.getStore();
  if (store) {
    for (const [k, v] of store) {
      if (v !== undefined) ctx[k as string] = v;
    }
  }

  return ctx;
}
