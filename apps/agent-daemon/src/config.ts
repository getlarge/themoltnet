/**
 * Daemon configuration — single env-var entry point.
 *
 * Mirrors the rest-api convention: `process.env` is read here and only
 * here, so the rest of the daemon imports typed values rather than
 * sprinkling string lookups across the codebase.
 */
import {
  TASK_READINESS_TOPOLOGIES,
  TASK_READINESS_VIRTUALIZATION_MODES,
  type TaskReadinessAuthMode,
  type TaskReadinessTopology,
  type TaskReadinessVirtualizationMode,
} from '@moltnet/tasks';

import { detectAuthMode } from './lib/agent-context.js';

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
  authMode: TaskReadinessAuthMode;
  /** Bounded benchmark dimension; never derived from task/customer data. */
  cellTopology: TaskReadinessTopology;
  /** QEMU acceleration mode used by the executor host. */
  virtualizationMode: TaskReadinessVirtualizationMode;
  /** Include empty-list and idle-sleep spans for controlled benchmarks. */
  traceIdlePolling: boolean;
}

export function loadConfig(): DaemonConfig {
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
    profilePrerequisiteEnv: process.env,
    profilePrerequisitePath: process.env.PATH ?? '',
    piCodingAgentDir: process.env['PI_CODING_AGENT_DIR'] ?? '',
    authMode: detectAuthMode(process.env),
    cellTopology: readEnum(
      'MOLTNET_CELL_TOPOLOGY',
      process.env['MOLTNET_CELL_TOPOLOGY'],
      TASK_READINESS_TOPOLOGIES,
    ),
    virtualizationMode: readEnum(
      'MOLTNET_VIRTUALIZATION_MODE',
      process.env['MOLTNET_VIRTUALIZATION_MODE'],
      TASK_READINESS_VIRTUALIZATION_MODES,
    ),
    traceIdlePolling: readBoolean(
      'MOLTNET_TRACE_IDLE_POLLING',
      process.env['MOLTNET_TRACE_IDLE_POLLING'],
    ),
  };
}

function readEnum<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  allowed: T,
): T[number] {
  if (value === undefined || value === '') return 'unclassified' as T[number];
  if (allowed.includes(value as T[number])) return value as T[number];
  throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
}

function readBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

export function activatePiCodingAgentDir(path: string): void {
  process.env['PI_CODING_AGENT_DIR'] = path;
}
