import { Value } from 'typebox/value';

import {
  DEFAULT_HOST_CAPABILITY_MAX_BODY_BYTES,
  DEFAULT_HOST_CAPABILITY_TIMEOUT_MS,
  normalizeGuestPath,
} from './define.js';
import {
  decideHostCapabilityCall,
  type HostCapabilityPolicy,
} from './policy.js';
import type {
  GuestProjection,
  HostCapabilityContext,
  HostCapabilityContribution,
  HostCapabilityManifestEntry,
  HostOriginHandler,
} from './types.js';

export interface HostCapabilityEvidenceLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export type HostCapabilityInvokeResult<O = unknown> =
  | { ok: true; output: O }
  | { ok: false; status: number; code: string; message: string };

export interface HostCapabilityRouter {
  /** Origin → in-process handler, for the sandbox proxy. */
  readonly origins: Record<string, HostOriginHandler>;
  /** Attested in the executor manifest; sorted by capability name. */
  readonly manifest: HostCapabilityManifestEntry[];
  readonly guestProjection: GuestProjection;
  /** Install (or replace) the session policy; requests fail closed until then. */
  setPolicy(policy: HostCapabilityPolicy): void;
  /**
   * Run one operation through the full gate (policy, limits, schemas,
   * deadline, evidence) without HTTP. Host-side callers such as tools must
   * use this rather than the injected state directly, so every signing path
   * is authorized and evidenced identically.
   */
  invoke<O = unknown>(
    capability: string,
    operation: string,
    input: unknown,
  ): Promise<HostCapabilityInvokeResult<O>>;
}

export const DEFAULT_HOST_CAPABILITY_RATE_LIMIT_PER_MINUTE = 60;
export const DEFAULT_HOST_CAPABILITY_MAX_IN_FLIGHT = 8;

const RATE_WINDOW_MS = 60_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class BodyTooLargeError extends Error {
  override name = 'BodyTooLargeError';
}

/** Read at most `limit` bytes; reject as soon as the stream exceeds it. */
async function readBounded(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    throw new BodyTooLargeError('request body exceeds the operation limit');
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError('request body exceeds the operation limit');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Compile host capability contributions into what the sandbox consumes:
 * origin handlers, a manifest entry list and the guest projection. Every
 * request passes policy, rate and concurrency limits, schema validation and a
 * deadline before a handler runs; every decision is evidenced without values.
 */
export function createHostCapabilityRouter(input: {
  capabilities: readonly HostCapabilityContribution<never>[];
  context: Omit<HostCapabilityContext<never>, 'signal' | 'injected'>;
  /** Capability-owned state (e.g. `{ signer }`), opaque to core. */
  injected: Record<string, unknown>;
  paths: { mountPath: string };
  logger: HostCapabilityEvidenceLogger;
  /** Aborted when the attempt is cancelled; every in-flight call observes it. */
  signal?: AbortSignal;
  rateLimitPerMinute?: number;
  maxInFlightPerCapability?: number;
}): HostCapabilityRouter {
  const limit =
    input.rateLimitPerMinute ?? DEFAULT_HOST_CAPABILITY_RATE_LIMIT_PER_MINUTE;
  const maxInFlight =
    input.maxInFlightPerCapability ?? DEFAULT_HOST_CAPABILITY_MAX_IN_FLIGHT;
  let policy: HostCapabilityPolicy | undefined;
  const buckets = new Map<string, number[]>();
  const inFlight = new Map<string, number>();
  const origins: Record<string, HostOriginHandler> = {};
  const manifest: HostCapabilityManifestEntry[] = [];
  const guestProjection: GuestProjection = { env: {}, files: [], services: [] };
  const byName = new Map<string, HostCapabilityContribution<never>>();
  const base = {
    taskId: input.context.taskId,
    attemptN: input.context.attemptN,
    teamId: input.context.teamId,
  };

  // Compile-time collisions are rejected: two capabilities must never
  // silently redirect a socket, overwrite a file or share a service id.
  const seenFiles = new Set<string>();
  const seenServices = new Set<string>();
  const seenEnv = new Set<string>();
  const sorted = [...input.capabilities].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const capability of sorted) {
    if (byName.has(capability.name)) {
      throw new Error(`Duplicate host capability "${capability.name}"`);
    }
    byName.set(capability.name, capability);
    manifest.push({
      name: capability.name,
      origin: capability.origin,
      operations: Object.keys(capability.operations).sort(),
      descriptorCid: capability.descriptorCid,
    });
    for (const [key, value] of Object.entries(capability.guest?.env ?? {})) {
      if (seenEnv.has(key)) {
        throw new Error(
          `Guest env "${key}" is projected by more than one host capability`,
        );
      }
      seenEnv.add(key);
      guestProjection.env[key] = value.replaceAll(
        '${origin}',
        capability.origin,
      );
    }
    for (const file of capability.guest?.files ?? []) {
      const filePath = normalizeGuestPath(file.path);
      if (seenFiles.has(filePath)) {
        throw new Error(
          `Guest file "${filePath}" is projected by more than one host capability`,
        );
      }
      seenFiles.add(filePath);
      guestProjection.files.push({
        path: filePath,
        mode: file.mode,
        content: file.content(input.context.identity, input.paths),
      });
    }
    for (const service of capability.guest?.services ?? []) {
      if (seenServices.has(service.id)) {
        throw new Error(
          `Guest service "${service.id}" is declared by more than one host capability`,
        );
      }
      seenServices.add(service.id);
      guestProjection.services.push(service);
    }
  }

  async function invoke<O>(
    capabilityName: string,
    operation: string,
    body: unknown,
  ): Promise<HostCapabilityInvokeResult<O>> {
    const capability = byName.get(capabilityName);
    const spec = capability?.operations[operation];
    const evidenceBase = { ...base, capability: capabilityName, operation };
    if (!capability || !spec) {
      return {
        ok: false,
        status: 404,
        code: 'unknown_operation',
        message: `unknown operation "${operation}"`,
      };
    }

    const decision = decideHostCapabilityCall({
      capability: capabilityName,
      operation,
      policy,
    });
    const audited =
      !decision.allow &&
      policy?.enforcement === 'watch' &&
      decision.reasonCode === 'capability_not_permitted';
    if (!decision.allow && !audited) {
      input.logger.warn(
        { ...evidenceBase, decision: 'deny', reason: decision.reasonCode },
        'host_capability.denied',
      );
      const notReady = decision.reasonCode === 'policy_not_ready';
      return {
        ok: false,
        status: notReady ? 503 : 403,
        code: notReady ? 'policy_not_ready' : 'host_capability_denied',
        message: decision.reason,
      };
    }

    const now = Date.now();
    const bucketKey = `${capabilityName}/${operation}`;
    const recent = (buckets.get(bucketKey) ?? []).filter(
      (at) => now - at < RATE_WINDOW_MS,
    );
    if (recent.length >= limit) {
      buckets.set(bucketKey, recent);
      input.logger.warn(
        { ...evidenceBase, decision: 'deny', reason: 'rate_limited' },
        'host_capability.denied',
      );
      return {
        ok: false,
        status: 429,
        code: 'rate_limited',
        message: 'too many requests',
      };
    }
    recent.push(now);
    buckets.set(bucketKey, recent);

    if ((inFlight.get(capabilityName) ?? 0) >= maxInFlight) {
      input.logger.warn(
        { ...evidenceBase, decision: 'deny', reason: 'too_many_in_flight' },
        'host_capability.denied',
      );
      return {
        ok: false,
        status: 429,
        code: 'too_many_in_flight',
        message: 'too many concurrent requests',
      };
    }

    if (!Value.Check(spec.request, body)) {
      input.logger.warn(
        { ...evidenceBase, decision: 'deny', reason: 'invalid_request' },
        'host_capability.denied',
      );
      return {
        ok: false,
        status: 400,
        code: 'invalid_request',
        message: 'request does not match the operation schema',
      };
    }
    const evidence = { ...evidenceBase, ...spec.evidence(body as never) };

    // Short-circuit an already-cancelled parent BEFORE charging a slot or
    // scheduling the handler. Racing the handler against an abort promise only
    // changes the caller-visible result — `spec.handle` would still be queued
    // on a microtask and run to completion (the stock signing handlers ignore
    // the signal), so a privileged signature could be submitted after the
    // router reports cancellation. Returning here guarantees the handler is
    // never invoked once the parent is aborted.
    if (input.signal?.aborted) {
      input.logger.warn(
        { ...evidence, decision: 'cancel', reason: 'parent_aborted' },
        'host_capability.cancelled',
      );
      return {
        ok: false,
        status: 503,
        code: 'operation_cancelled',
        message: 'operation cancelled before dispatch',
      };
    }

    const timeoutMs = spec.timeoutMs ?? DEFAULT_HOST_CAPABILITY_TIMEOUT_MS;
    // Separate the two abort reasons so evidence distinguishes a deadline from
    // parent (task) cancellation.
    const controller = new AbortController();
    let deadlineExpired = false;
    const onParentAbort = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) onParentAbort();
    else input.signal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort(new Error('timeout'));
    }, timeoutMs);

    // The slot stays charged until the handler promise actually settles, even
    // when a deadline returns a response first: a handler that ignores its
    // signal must not free capacity while it keeps running.
    inFlight.set(capabilityName, (inFlight.get(capabilityName) ?? 0) + 1);
    const context: HostCapabilityContext<never> = {
      ...input.context,
      signal: controller.signal,
      injected: input.injected as never,
    };
    const handlerPromise = Promise.resolve().then(() =>
      spec.handle(body as never, context),
    );
    handlerPromise
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onParentAbort);
        inFlight.set(capabilityName, (inFlight.get(capabilityName) ?? 1) - 1);
      });

    // Reject as soon as the signal aborts — including when it is already
    // aborted before this listener would run.
    const abortPromise = new Promise<never>((_, reject) => {
      const fail = () => {
        const reason: unknown = controller.signal.reason;
        reject(reason instanceof Error ? reason : new Error('aborted'));
      };
      if (controller.signal.aborted) fail();
      else controller.signal.addEventListener('abort', fail, { once: true });
    });

    try {
      const output = await Promise.race([handlerPromise, abortPromise]);
      if (!Value.Check(spec.response, output)) {
        const mismatch = new Error('response does not match schema');
        mismatch.name = 'ResponseSchemaMismatch';
        throw mismatch;
      }
      if (decision.allow) {
        input.logger.info(
          { ...evidence, decision: 'allow', reason: decision.reasonCode },
          'host_capability.allowed',
        );
      } else {
        input.logger.info(
          { ...evidence, decision: 'audit', reason: decision.reasonCode },
          'host_capability.audit',
        );
      }
      return { ok: true, output: output as O };
    } catch (error) {
      const outcome = deadlineExpired
        ? 'deadline'
        : controller.signal.aborted
          ? 'cancelled'
          : 'error';
      // Only an allow-listed outcome (or the error class name) leaves the
      // handler: messages may carry values that must not reach the guest or
      // the evidence stream.
      const name =
        outcome === 'error'
          ? error instanceof Error
            ? error.name
            : 'Error'
          : outcome;
      const event =
        outcome === 'deadline'
          ? 'host_capability.timeout'
          : outcome === 'cancelled'
            ? 'host_capability.cancelled'
            : 'host_capability.failed';
      input.logger.warn({ ...evidence, decision: 'error', error: name }, event);
      if (outcome === 'deadline') {
        return {
          ok: false,
          status: 504,
          code: 'operation_timeout',
          message: 'operation timed out',
        };
      }
      if (outcome === 'cancelled') {
        return {
          ok: false,
          status: 503,
          code: 'operation_cancelled',
          message: 'operation cancelled',
        };
      }
      return {
        ok: false,
        status: 500,
        code: 'operation_failed',
        message: name,
      };
    }
  }

  for (const capability of sorted) {
    origins[capability.origin] = async (
      request: Request,
    ): Promise<Response> => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/identity') {
        return json(200, input.context.identity);
      }
      const operation = url.pathname.replace(/^\/+/, '');
      const spec = capability.operations[operation];
      if (!spec || request.method !== 'POST') {
        // Transport-level denial: evidence every rejected decision (unknown
        // operation or wrong method), value-free, per the router audit
        // contract — probing guest traffic must not be invisible.
        input.logger.warn(
          {
            ...base,
            capability: capability.name,
            operation,
            method: request.method,
            decision: 'deny',
            reason: !spec ? 'unknown_operation' : 'method_not_allowed',
          },
          'host_capability.denied',
        );
        return json(404, {
          code: 'unknown_operation',
          message: `unknown operation "${operation}"`,
        });
      }
      let body: unknown;
      try {
        const raw = await readBounded(
          request,
          spec.maxBodyBytes ?? DEFAULT_HOST_CAPABILITY_MAX_BODY_BYTES,
        );
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          input.logger.warn(
            {
              ...base,
              capability: capability.name,
              operation,
              decision: 'deny',
              reason: 'body_too_large',
            },
            'host_capability.denied',
          );
          return json(413, { code: 'body_too_large', message: error.message });
        }
        input.logger.warn(
          {
            ...base,
            capability: capability.name,
            operation,
            decision: 'deny',
            reason: 'invalid_request',
          },
          'host_capability.denied',
        );
        return json(400, {
          code: 'invalid_request',
          message: 'body must be JSON',
        });
      }
      const result = await invoke(capability.name, operation, body);
      return result.ok
        ? json(200, result.output)
        : json(result.status, { code: result.code, message: result.message });
    };
  }

  return {
    origins,
    manifest,
    guestProjection,
    setPolicy(next) {
      policy = next;
    },
    invoke,
  };
}
