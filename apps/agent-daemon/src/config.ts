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
  /** Pino log level override; empty = per-mode default (info, or debug with --debug). */
  logLevel: string;
  /** Process environment visible to profile prerequisite checks. */
  profilePrerequisiteEnv: NodeJS.ProcessEnv;
  /** PATH used when resolving profile requiredTools. */
  profilePrerequisitePath: string;
  /** Optional Pi agent dir override. Empty = daemon defaults to repo-local .pi. */
  piCodingAgentDir: string;
}

export function loadConfig(): DaemonConfig {
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
    profilePrerequisiteEnv: process.env,
    profilePrerequisitePath: process.env.PATH ?? '',
    piCodingAgentDir: process.env['PI_CODING_AGENT_DIR'] ?? '',
  };
}

export function activatePiCodingAgentDir(path: string): void {
  process.env['PI_CODING_AGENT_DIR'] = path;
}
