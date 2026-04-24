/**
 * OTel SDK bootstrap for agent-runtime worker processes.
 *
 * Wires up a `NodeTracerProvider` that pushes spans to the MoltNet OTel
 * collector's authenticated OTLP endpoint, using the agent's OAuth2
 * credentials for auth. Token acquisition is dynamic (the OTLP exporter
 * calls our async `headers` factory before each batch export), so a
 * rotating token stays fresh without manual refresh logic here.
 *
 * Bootstrap is CALLED FIRST in worker entry points, BEFORE any code that
 * might emit spans — specifically before the `@themoltnet/agent-runtime`
 * task loop or the pi extension with OTel instrumentation runs. Late
 * registration of a tracer provider means early spans get a no-op tracer
 * and vanish.
 *
 * This module is a deliberate template for future programmatic agent-
 * runtime users (hosted runners, daemons). The API surface is small:
 *
 *   const shutdown = await initWorkerOtel({ serviceName, agentDir, apiUrl });
 *   // ... do work ...
 *   await shutdown();
 *
 * If `MOLTNET_OTEL_ENDPOINT` is unset, the whole bootstrap is a no-op —
 * the runtime's existing `@opentelemetry/api` calls already return
 * no-op tracers when no provider is registered, so not wiring up here
 * just means "no telemetry export, zero runtime cost."
 */
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { connect } from '@themoltnet/sdk';

export interface InitWorkerOtelOptions {
  /** Logical service name — e.g. 'work-task', 'fulfill-brief'. */
  serviceName: string;
  /** Optional service version tag. */
  serviceVersion?: string;
  /** Optional deployment environment tag (e.g. 'development'). */
  environment?: string;
  /**
   * Path to the agent's MoltNet credentials dir (the one containing
   * `moltnet.json`). Same convention as `tools/src/tasks/api.ts`.
   * When omitted, telemetry is sent without auth — only usable against
   * an unauthenticated local collector (`:4318`), never the public one.
   */
  agentDir?: string;
  /**
   * Override for the OTLP endpoint base URL. When omitted, reads from
   * the `MOLTNET_OTEL_ENDPOINT` env var. Absent → bootstrap is a no-op.
   * Examples:
   *   - `http://localhost:4319` (local dev, authenticated receiver)
   *   - `http://localhost:4318` (local dev, internal receiver)
   *   - `https://otlp.themolt.net` (future prod public endpoint)
   */
  endpoint?: string;
  /**
   * Static resource attributes to tag every exported span with. Useful
   * for e.g. `moltnet.task.id` or `moltnet.agent.id` at the root of a
   * worker's runtime.
   */
  resourceAttributes?: Record<string, string>;
}

export type OtelShutdown = () => Promise<void>;

/**
 * Register a NodeTracerProvider that exports to the MoltNet collector.
 * Returns a shutdown function the caller MUST await in their cleanup
 * path (or via a signal handler) so pending spans are flushed.
 */
export async function initWorkerOtel(
  options: InitWorkerOtelOptions,
): Promise<OtelShutdown> {
  const endpoint = options.endpoint ?? process.env['MOLTNET_OTEL_ENDPOINT'];
  if (!endpoint) {
    // No endpoint → no-op bootstrap. @opentelemetry/api already returns
    // a no-op tracer when no provider is registered, so all spans
    // emitted by the runtime + pi extension simply vanish. Zero cost.
    return async () => {};
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: options.serviceName,
    ...(options.serviceVersion && {
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    ...(options.environment && {
      'deployment.environment': options.environment,
    }),
    ...options.resourceAttributes,
  });

  // Auth headers factory. Called by the exporter before each export
  // batch, so the token is always fresh. When no agent dir is provided,
  // we skip auth entirely — the caller is responsible for pointing
  // `endpoint` at an unauthenticated receiver in that case.
  //
  // The SDK's `connect()` resolves credentials from:
  //   1. explicit client_id/client_secret (we don't pass these)
  //   2. MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET env vars
  //   3. `<agentDir>/moltnet.json` config file
  // Then TokenManager caches tokens internally and refreshes 5 min
  // before expiry — so calling `agent.getToken()` repeatedly is cheap.
  let headersFactory: (() => Promise<Record<string, string>>) | undefined;
  if (options.agentDir) {
    const agent = await connect({ configDir: options.agentDir });
    headersFactory = async () => {
      const token = await agent.getToken();
      return { Authorization: `Bearer ${token}` };
    };
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    ...(headersFactory && { headers: headersFactory }),
  });

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  // Register globally so @opentelemetry/api's `trace.getTracer(...)`
  // calls in libraries (the pi OTel extension, agent-runtime) pick
  // this provider up.
  trace.setGlobalTracerProvider(provider);

  return async () => {
    // forceFlush + shutdown so in-flight batches drain before the
    // process exits. shutdown() on NodeTracerProvider also calls
    // shutdown on all registered processors, which handle exporter
    // cleanup — no need to call it separately.
    await provider.forceFlush().catch(() => {});
    await provider.shutdown().catch(() => {});
  };
}
