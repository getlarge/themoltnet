import { sanitizeForPersistence } from '../sandbox-policy/sanitize.js';

export const CREDENTIAL_PREFLIGHT_REASONS = [
  'required_binding_missing',
  'binding_requirement_mismatch',
  'resolution_boundary_denied',
  'destination_denied',
  'provider_unavailable',
  'host_store_inaccessible',
  'binding_absent',
  'delivery_failed',
  'ready',
] as const;

export type CredentialPreflightReason =
  (typeof CREDENTIAL_PREFLIGHT_REASONS)[number];

export interface CredentialPreflightState {
  binding: 'missing' | 'present';
  requirementMatches?: boolean;
  resolutionBoundary?: 'trusted-host' | 'sandbox-guest';
  destinationAllowed?: boolean;
  providerAvailable?: boolean;
  providerRead?: 'succeeded' | 'failed';
  valueFound?: boolean;
  delivery?: 'succeeded' | 'failed';
}

function requireState<T>(
  value: T | undefined,
  field: keyof CredentialPreflightState,
): T {
  if (value === undefined) {
    throw new Error(`credential preflight did not observe ${field}`);
  }
  return value;
}

/**
 * Classify the first failed preflight boundary. A successful provider read that
 * returns no value is deliberately different from a provider read that throws.
 */
export function classifyCredentialPreflight(
  state: CredentialPreflightState,
): CredentialPreflightReason {
  if (state.binding === 'missing') return 'required_binding_missing';
  if (!requireState(state.requirementMatches, 'requirementMatches')) {
    return 'binding_requirement_mismatch';
  }
  if (
    requireState(state.resolutionBoundary, 'resolutionBoundary') ===
    'sandbox-guest'
  ) {
    return 'resolution_boundary_denied';
  }
  if (!requireState(state.destinationAllowed, 'destinationAllowed')) {
    return 'destination_denied';
  }
  if (!requireState(state.providerAvailable, 'providerAvailable')) {
    return 'provider_unavailable';
  }
  if (requireState(state.providerRead, 'providerRead') === 'failed') {
    return 'host_store_inaccessible';
  }
  if (!requireState(state.valueFound, 'valueFound')) return 'binding_absent';
  if (requireState(state.delivery, 'delivery') === 'failed') {
    return 'delivery_failed';
  }
  return 'ready';
}

export interface CodexGondolinEvidence {
  schemaVersion: 1;
  probe: 'codex-gondolin-compatibility';
  sourceRevision: string;
  host: {
    os: string;
    architecture: string;
    codexVersion: string;
  };
  guest: {
    os: 'linux';
    architecture: 'arm64';
    codexVersion: string;
  };
  gondolinVersion: string;
  codexPackage: {
    specifier: string;
    integrity: string;
  };
  model: string;
  transport: {
    environmentStatusBeforeConnect: string;
    environmentStatusAfterConnect: string;
    relayConnectionCount: number;
  };
  execution: {
    commandStarted: boolean;
    commandCompleted: boolean;
    commandExitCode: number | null;
    turnCompleted: boolean;
    guestOsMarker: string;
    guestExecutorMarker: string;
  };
  isolation: {
    hostOnlySentinelProjected: boolean;
    credentialShapedEnvironmentNames: string[];
    delayedMarkerAfterVmClose: boolean;
  };
  cleanupComplete: boolean;
  limitations: string[];
}

const FORBIDDEN_EVIDENCE_KEYS = new Set([
  'environmentId',
  'localPath',
  'prompt',
  'threadId',
  'transcript',
]);

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EVIDENCE_KEYS.has(key)) {
      throw new Error(`refusing to persist forbidden evidence field ${key}`);
    }
    assertNoForbiddenKeys(child);
  }
}

export function compatibilityProbePassed(
  evidence: CodexGondolinEvidence,
): boolean {
  return (
    evidence.transport.environmentStatusAfterConnect === 'ready' &&
    evidence.transport.relayConnectionCount === 1 &&
    evidence.execution.commandStarted &&
    evidence.execution.commandCompleted &&
    evidence.execution.commandExitCode === 0 &&
    evidence.execution.turnCompleted &&
    evidence.execution.guestOsMarker === 'Linux' &&
    evidence.execution.guestExecutorMarker === 'guest-exec-server' &&
    !evidence.isolation.hostOnlySentinelProjected &&
    evidence.isolation.credentialShapedEnvironmentNames.length === 0 &&
    !evidence.isolation.delayedMarkerAfterVmClose &&
    evidence.cleanupComplete
  );
}

export function serializeCompatibilityEvidence(
  evidence: CodexGondolinEvidence,
  sensitiveValues: string[],
): string {
  assertNoForbiddenKeys(evidence);
  return sanitizeForPersistence(evidence, { sensitiveValues });
}
