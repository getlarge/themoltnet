import { MetricReader } from '@opentelemetry/sdk-metrics';

/**
 * A minimal MetricReader for testing that supports on-demand collect().
 * Replaces TestMetricReader which isn't available in all SDK versions.
 */
export class TestMetricReader extends MetricReader {
  protected async onShutdown(): Promise<void> {
    // no-op
  }

  protected async onForceFlush(): Promise<void> {
    // no-op
  }
}
