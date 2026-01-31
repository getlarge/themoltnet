import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
  NodeTracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

export interface CreateTraceProviderOptions {
  /** Service name for resource identification */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Deployment environment */
  environment?: string;
  /** Custom span exporter (for testing or direct export) */
  exporter?: SpanExporter;
  /** Custom span processor (defaults to BatchSpanProcessor if exporter provided) */
  processor?: SpanProcessor;
}

/**
 * Create a configured NodeTracerProvider.
 *
 * For production use, provide an OTLP exporter that sends to the
 * OpenTelemetry Collector. For testing, use InMemorySpanExporter
 * with SimpleSpanProcessor.
 *
 * The provider is NOT automatically registered as global - callers
 * should do `trace.setGlobalTracerProvider(provider)` if desired.
 */
export function createTraceProvider(
  options: CreateTraceProviderOptions
): NodeTracerProvider {
  const { serviceName, serviceVersion, environment, exporter, processor } =
    options;

  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
  };

  if (serviceVersion) {
    resourceAttributes[ATTR_SERVICE_VERSION] = serviceVersion;
  }

  if (environment) {
    resourceAttributes['deployment.environment'] = environment;
  }

  const resource = new Resource(resourceAttributes);

  const provider = new NodeTracerProvider({ resource });

  if (processor) {
    provider.addSpanProcessor(processor);
  } else if (exporter) {
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  }

  return provider;
}
