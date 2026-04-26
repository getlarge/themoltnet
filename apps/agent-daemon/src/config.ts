/**
 * Daemon configuration — single env-var entry point.
 *
 * Mirrors the rest-api convention: `process.env` is read here and only
 * here, so the rest of the daemon imports typed values rather than
 * sprinkling string lookups across the codebase.
 */
export interface DaemonConfig {
  /** OTLP endpoint for trace export. Empty = OTel bootstrap is a no-op. */
  otelEndpoint: string;
}

export function loadConfig(): DaemonConfig {
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
  };
}
