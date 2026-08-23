import type {
  ControlEvidence,
  EnforcementState,
  EvidenceBasis,
  SandboxProbeRun,
} from './types.js';

function assertStateBasis(
  state: EnforcementState,
  basis: EvidenceBasis,
  evidence: ControlEvidence,
): void {
  if (state === 'enforced') {
    if (basis !== 'verified') {
      throw new Error(
        `${evidence.scenarioId}: enforced requires verified evidence`,
      );
    }
    if (!evidence.oracle?.passed) {
      throw new Error(
        `${evidence.scenarioId}: enforced requires a passing oracle`,
      );
    }
  }
  if (state === 'failed-open') {
    if (basis !== 'verified' || evidence.oracle?.passed !== false) {
      throw new Error(
        `${evidence.scenarioId}: failed-open requires a failing verified oracle`,
      );
    }
  }
  if (basis === 'declared' && state === 'enforced') {
    throw new Error(
      `${evidence.scenarioId}: a declaration cannot prove enforcement`,
    );
  }
}

export function assertControlEvidence(evidence: ControlEvidence): void {
  if (evidence.requestedIntent.scenarioId !== evidence.scenarioId) {
    throw new Error(`${evidence.scenarioId}: requested intent id drifted`);
  }
  if (
    evidence.resolvedAdapterConfig &&
    evidence.resolvedAdapterConfig.requested.scenarioId !== evidence.scenarioId
  ) {
    throw new Error(`${evidence.scenarioId}: adapter resolution id drifted`);
  }
  if (evidence.reasonCode.trim() === '') {
    throw new Error(`${evidence.scenarioId}: reasonCode is required`);
  }
  if (evidence.enforcementLocus.length === 0) {
    throw new Error(`${evidence.scenarioId}: enforcement locus is required`);
  }
  assertStateBasis(evidence.state, evidence.basis, evidence);
}

export function assertProbeRun(run: SandboxProbeRun): void {
  if (run.schemaVersion !== 1) throw new Error('probe schemaVersion must be 1');
  const ids = new Set<string>();
  for (const control of run.controls) {
    assertControlEvidence(control);
    if (ids.has(control.scenarioId)) {
      throw new Error(`duplicate control evidence: ${control.scenarioId}`);
    }
    ids.add(control.scenarioId);
    if (control.backend.id !== run.backend.id) {
      throw new Error(`${control.scenarioId}: backend id drifted`);
    }
    if (control.backend.version !== run.backend.version) {
      throw new Error(`${control.scenarioId}: backend version drifted`);
    }
  }
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, sortValue(record[key])]),
    );
  }
  return value;
}
