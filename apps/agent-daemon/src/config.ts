/**
 * Daemon configuration — single env-var entry point.
 *
 * Mirrors the rest-api convention: `process.env` is read here and only
 * here, so the rest of the daemon imports typed values rather than
 * sprinkling string lookups across the codebase.
 */
import { type DaemonAuthMode, detectAuthMode } from './lib/agent-context.js';

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
  /**
   * Which credential `connect()` will use: `agent-key` when `MOLTNET_AGENT_KEY`
   * is set, otherwise the default `oauth2` client-credentials flow. The secret
   * itself is never surfaced here.
   */
  authMode: DaemonAuthMode;
  /** Bounded benchmark dimension; never derived from task/customer data. */
  cellTopology: 'compact' | 'split' | 'unclassified';
  /** QEMU acceleration mode used by the executor host. */
  virtualizationMode: 'kvm' | 'tcg' | 'unclassified';
}

export function loadConfig(): DaemonConfig {
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
    profilePrerequisiteEnv: process.env,
    profilePrerequisitePath: process.env.PATH ?? '',
    piCodingAgentDir: process.env['PI_CODING_AGENT_DIR'] ?? '',
    authMode: detectAuthMode(process.env),
    cellTopology: readEnum(process.env['MOLTNET_CELL_TOPOLOGY'], [
      'compact',
      'split',
    ] as const),
    virtualizationMode: readEnum(process.env['MOLTNET_VIRTUALIZATION_MODE'], [
      'kvm',
      'tcg',
    ] as const),
  };
}

function readEnum<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | 'unclassified' {
  return allowed.includes(value as T[number])
    ? (value as T[number])
    : 'unclassified';
}

export function activatePiCodingAgentDir(path: string): void {
  process.env['PI_CODING_AGENT_DIR'] = path;
}
