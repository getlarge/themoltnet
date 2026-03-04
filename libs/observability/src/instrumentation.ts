import type { IncomingMessage } from 'node:http';

import {
  type Instrumentation,
  registerInstrumentations,
} from '@opentelemetry/instrumentation';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

export interface InstrumentationConfig {
  /** Enable HTTP client/server instrumentation (default: true) */
  http?: boolean;
  /** Enable DNS instrumentation (default: true) */
  dns?: boolean;
  /** Enable net (TCP socket) instrumentation (default: true) */
  net?: boolean;
  /** Enable pg (PostgreSQL) instrumentation (default: true) */
  pg?: boolean;
  /**
   * Enable Pino trace-context injection (default: true).
   * Injects trace_id and span_id into Pino log records so logs are
   * correlated with the active OTel span. Requires PinoInstrumentation
   * to patch Pino before it is first imported.
   *
   * Note: pino-opentelemetry-transport handles log *export* to OTLP.
   * PinoInstrumentation handles log *correlation* with active spans.
   */
  pino?: boolean;
  /**
   * Incoming HTTP request paths to suppress from tracing.
   * Health check endpoints should be listed here.
   * e.g. ['/health', '/healthz']
   */
  httpIgnoreIncomingPaths?: string[];
  /**
   * Hostnames whose outgoing HTTP spans should be labelled with an
   * `ory.*` prefix so they are easy to identify in traces.
   * e.g. ['project.ory.network', 'localhost'] (for local Ory stack)
   */
  oryHostnames?: string[];
}

/**
 * Register OTel auto-instrumentation for common Node.js modules.
 *
 * MUST be called before any other imports that load pg, http, net, dns, or
 * pino. In ESM, place this in a dedicated side-effect module that is the
 * first import in the app entrypoint:
 *
 * ```ts
 * // instrumentation.ts (app-level)
 * import { initInstrumentation } from '@moltnet/observability';
 * initInstrumentation({ pg: true, httpIgnoreIncomingPaths: ['/health'] });
 * ```
 *
 * ```ts
 * // main.ts
 * import './instrumentation.js'; // ← MUST be first
 * import { bootstrap } from './bootstrap.js';
 * ```
 *
 * The registered instrumentations pick up the global TracerProvider once
 * it is set by `initObservability()`. Call this function first, then call
 * `initObservability()`.
 */
export function initInstrumentation(config: InstrumentationConfig): void {
  const {
    http = true,
    dns = true,
    net = true,
    pg = true,
    pino = true,
    httpIgnoreIncomingPaths = [],
  } = config;

  const instrumentations: Instrumentation[] = [];

  if (http) {
    instrumentations.push(
      new HttpInstrumentation({
        ignoreIncomingRequestHook:
          httpIgnoreIncomingPaths.length > 0
            ? (req: IncomingMessage) => {
                const url = req.url ?? '';
                return httpIgnoreIncomingPaths.some((path) =>
                  url.startsWith(path),
                );
              }
            : undefined,
      }),
      // Patches globalThis.fetch / undici for outgoing trace context propagation.
      // Node 22+ uses undici as the fetch implementation — without this,
      // distributed traces break across service boundaries using fetch().
      new UndiciInstrumentation(),
    );
  }

  if (dns) {
    instrumentations.push(new DnsInstrumentation());
  }

  if (net) {
    instrumentations.push(new NetInstrumentation());
  }

  if (pg) {
    instrumentations.push(new PgInstrumentation());
  }

  if (pino) {
    instrumentations.push(new PinoInstrumentation());
  }

  registerInstrumentations({ instrumentations });
}
