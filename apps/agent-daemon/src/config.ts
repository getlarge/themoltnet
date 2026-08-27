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
  /** Base64 Ed25519 seed used for executor attestation in agent-key mode. */
  signingPrivateKey: string;
  /**
   * `<provider>:<key>` reference to that seed (`MOLTNET_PRIVATE_KEY_REF`),
   * resolved through the Node secret-provider registry at startup. Mutually
   * exclusive with `signingPrivateKey`.
   */
  signingPrivateKeyRef: string;
  /** `Name <email>` projected into guests for brokered commit signing. */
  gitAuthor: string;
  /** Include empty-list and idle-sleep spans for controlled benchmarks. */
  traceIdlePolling: boolean;
}

export function loadConfig(): DaemonConfig {
  assertSingleCredentialForm('MOLTNET_AGENT_KEY', 'MOLTNET_AGENT_KEY_REF');
  assertSingleCredentialForm('MOLTNET_PRIVATE_KEY', 'MOLTNET_PRIVATE_KEY_REF');
  return {
    otelEndpoint: process.env['MOLTNET_OTEL_ENDPOINT'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
    profilePrerequisiteEnv: process.env,
    profilePrerequisitePath: process.env.PATH ?? '',
    piCodingAgentDir: process.env['PI_CODING_AGENT_DIR'] ?? '',
    authMode: detectAuthMode(process.env),
    signingPrivateKey: process.env['MOLTNET_PRIVATE_KEY'] ?? '',
    signingPrivateKeyRef: process.env['MOLTNET_PRIVATE_KEY_REF'] ?? '',
    gitAuthor: process.env['MOLTNET_GIT_AUTHOR'] ?? '',
    traceIdlePolling: readBoolean(
      'MOLTNET_TRACE_IDLE_POLLING',
      process.env['MOLTNET_TRACE_IDLE_POLLING'],
    ),
  };
}

function assertSingleCredentialForm(valueName: string, refName: string): void {
  if (process.env[valueName]?.trim() && process.env[refName]?.trim()) {
    throw new Error(`Set only one of ${valueName} or ${refName}`);
  }
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
