/**
 * OTel SDK bootstrap for agent-runtime worker processes.
 *
 * Template for programmatic agent-runtime users (workers, daemons):
 *
 *   const shutdown = await initWorkerOtel({ serviceName, agentDir });
 *   try { ... } finally { await shutdown(); }
 *
 * No-op when MOLTNET_OTEL_ENDPOINT is unset — `@opentelemetry/api` falls
 * back to no-op tracers, so the runtime + pi extension still call into
 * it but nothing is exported.
 */
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
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  /**
   * Path to the agent's MoltNet credentials dir (containing moltnet.json).
   * When omitted, no auth header is sent — only safe against an
   * unauthenticated receiver (e.g. local :4318), never the public one.
   */
  agentDir?: string;
  /**
   * OTLP endpoint base URL. Falls back to MOLTNET_OTEL_ENDPOINT env var.
   * Absent → bootstrap is a no-op.
   */
  endpoint?: string;
  resourceAttributes?: Record<string, string>;
}

export type OtelShutdown = () => Promise<void>;

export async function initWorkerOtel(
  options: InitWorkerOtelOptions,
): Promise<OtelShutdown> {
  const endpoint = options.endpoint ?? process.env['MOLTNET_OTEL_ENDPOINT'];
  if (!endpoint) {
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

  // Async headers factory — exporter calls it before each batch, so the
  // bearer token is always fresh. TokenManager inside connect() handles
  // caching + refresh.
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

  // register() installs the context manager + propagator too — required
  // for parent/child span linkage across await boundaries.
  // setGlobalTracerProvider() alone is NOT enough.
  provider.register();

  return async () => {
    await provider.forceFlush().catch((err) => {
      process.stderr.write(
        `[otel-bootstrap] forceFlush failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
    await provider.shutdown().catch((err) => {
      process.stderr.write(
        `[otel-bootstrap] shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
  };
}
