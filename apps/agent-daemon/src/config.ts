/**
 * Daemon configuration — single env-var entry point.
 *
 * Mirrors the rest-api convention: `process.env` is read here and only
 * here, so the rest of the daemon imports typed values rather than
 * sprinkling string lookups across the codebase.
 */
import { type DaemonAuthMode, detectAuthMode } from './lib/agent-context.js';
import type { IdentityPin } from './lib/identity-pin.js';

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
  /**
   * Profile-side/private input for the observe-only #1970 governance plan:
   * JSON map of profile id → credential requirements. Distinct provenance
   * from `credentialBindings` by design (#2022 review).
   */
  profileCredentialRequirements: string;
  /** Trusted local/deployment bindings: logical name → secret reference. */
  credentialBindings: string;
  /** Credential-governance mode: '', off, watch or enforce (see resolveCredentialEnforcement). */
  credentialEnforcement: string;
  /** Include empty-list and idle-sleep spans for controlled benchmarks. */
  traceIdlePolling: boolean;
  /** Identity pin supplied by the local Agent Server. */
  expectedIdentity?: IdentityPin;
}

export function loadConfig(): DaemonConfig {
  assertSingleCredentialForm('MOLTNET_AGENT_KEY', 'MOLTNET_AGENT_KEY_REF');
  assertSingleCredentialForm('MOLTNET_PRIVATE_KEY', 'MOLTNET_PRIVATE_KEY_REF');
  const expectedIdentity = readExpectedIdentity();
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
    profileCredentialRequirements:
      process.env['MOLTNET_PROFILE_CREDENTIAL_REQUIREMENTS'] ?? '',
    credentialBindings: process.env['MOLTNET_CREDENTIAL_BINDINGS'] ?? '',
    credentialEnforcement: process.env['MOLTNET_CREDENTIAL_ENFORCEMENT'] ?? '',
    traceIdlePolling: readBoolean(
      'MOLTNET_TRACE_IDLE_POLLING',
      process.env['MOLTNET_TRACE_IDLE_POLLING'],
    ),
    ...(expectedIdentity ? { expectedIdentity } : {}),
  };
}

function readExpectedIdentity(): DaemonConfig['expectedIdentity'] {
  const identityId = process.env['MOLTNET_EXPECTED_IDENTITY_ID']?.trim() ?? '';
  const publicKey = process.env['MOLTNET_EXPECTED_PUBLIC_KEY']?.trim() ?? '';
  const fingerprint = process.env['MOLTNET_EXPECTED_FINGERPRINT']?.trim() ?? '';
  const present = [identityId, publicKey, fingerprint].filter(Boolean).length;
  if (present === 0) return undefined;
  if (present !== 3) {
    throw new Error(
      'MOLTNET_EXPECTED_IDENTITY_ID, MOLTNET_EXPECTED_PUBLIC_KEY, and MOLTNET_EXPECTED_FINGERPRINT must be set together',
    );
  }
  return { identityId, publicKey, fingerprint };
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

/** Env-derived defaults for `server` (single process.env entry point). */
export interface AgentServerEnvConfig {
  port: string;
  allowedOrigins: string;
  root: string;
  xdgConfigHome: string;
  apiUrl: string;
  logLevel: string;
}

export function loadAgentServerEnvConfig(): AgentServerEnvConfig {
  return {
    port: process.env['MOLTNET_AGENT_SERVER_PORT'] ?? '',
    allowedOrigins: process.env['MOLTNET_AGENT_SERVER_ALLOWED_ORIGINS'] ?? '',
    root: process.env['MOLTNET_AGENT_SERVER_ROOT'] ?? '',
    xdgConfigHome: process.env['XDG_CONFIG_HOME'] ?? '',
    apiUrl: process.env['MOLTNET_API_URL'] ?? '',
    logLevel: process.env['LOG_LEVEL'] ?? '',
  };
}

/** Full process environment for spawned Agent Server run children. */
export function processEnvSnapshot(): NodeJS.ProcessEnv {
  return process.env;
}
