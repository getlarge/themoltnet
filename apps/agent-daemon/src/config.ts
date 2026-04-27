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
  /**
   * Pino log level override (trace|debug|info|warn|error|fatal|silent).
   * Empty falls back to the per-mode default (info, or debug when --debug).
   */
  logLevel: string;
}

export function loadConfig(): DaemonConfig {
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
  };
}
