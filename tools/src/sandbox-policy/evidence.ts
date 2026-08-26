import { canonicalJson } from '@moltnet/crypto-service';

import type {
  ControlEvidence,
  EnforcementState,
  EvidenceBasis,
  ProbeViolation,
  SandboxProbeRun,
} from './types.js';
import { ENFORCEMENT_LOCI, isReasonCodeForDomain } from './types.js';

function assertStateBasis(
  state: EnforcementState,
  basis: EvidenceBasis,
  evidence: ControlEvidence,
): void {
  const observed = basis !== 'declared';
  const provenanceMatches =
    (basis === 'applied' && evidence.oracle?.attestedBy === 'adapter') ||
    ((basis === 'verified' || basis === 'harness-observed') &&
      evidence.oracle?.attestedBy === 'harness');
  switch (state) {
    case 'enforced':
      if (!observed || !provenanceMatches || evidence.oracle?.passed !== true) {
        throw new Error(
          `${evidence.scenarioId}: enforced requires a passing oracle with matching provenance`,
        );
      }
      if (evidence.unsupportedKind !== undefined) {
        throw new Error(
          `${evidence.scenarioId}: enforced cannot declare unsupportedKind`,
        );
      }
      return;
    case 'failed-open':
      if (
        !observed ||
        !provenanceMatches ||
        evidence.oracle?.passed !== false
      ) {
        throw new Error(
          `${evidence.scenarioId}: failed-open requires a failing oracle with matching provenance`,
        );
      }
      if (evidence.unsupportedKind !== undefined) {
        throw new Error(
          `${evidence.scenarioId}: failed-open cannot declare unsupportedKind`,
        );
      }
      return;
    case 'degraded':
      // Degraded means a weaker protective behavior was verified, while the
      // oracle for the requested control did not pass.
      if (
        !observed ||
        !provenanceMatches ||
        evidence.oracle?.passed !== false ||
        evidence.oracle.weakerControl?.passed !== true ||
        evidence.unsupportedKind !== undefined
      ) {
        throw new Error(
          `${evidence.scenarioId}: degraded requires a failing requested-control oracle and a passing weaker-control oracle`,
        );
      }
      return;
    case 'unsupported':
      if (
        (basis !== 'declared' && basis !== 'applied') ||
        evidence.oracle !== null ||
        evidence.unsupportedKind === undefined
      ) {
        throw new Error(
          `${evidence.scenarioId}: unsupported requires declared or applied evidence, an unsupportedKind, and no oracle`,
        );
      }
      return;
    case 'failed':
      if (
        basis !== 'harness-observed' ||
        evidence.oracle !== null ||
        evidence.unsupportedKind !== undefined
      ) {
        throw new Error(
          `${evidence.scenarioId}: failed requires a harness-observed failure without an oracle`,
        );
      }
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
  if (
    !isReasonCodeForDomain(evidence.requestedIntent.domain, evidence.reasonCode)
  ) {
    throw new Error(
      `${evidence.scenarioId}: reasonCode ${evidence.reasonCode} is not registered for ${evidence.requestedIntent.domain}`,
    );
  }
  if (evidence.enforcementLocus.length === 0) {
    throw new Error(`${evidence.scenarioId}: enforcement locus is required`);
  }
  for (const locus of evidence.enforcementLocus) {
    if (!(ENFORCEMENT_LOCI as readonly string[]).includes(locus)) {
      throw new Error(
        `${evidence.scenarioId}: enforcement locus ${locus} is not registered`,
      );
    }
  }
  assertStateBasis(evidence.state, evidence.basis, evidence);
}

export function assertProbeRun(run: SandboxProbeRun): void {
  const violations = collectProbeViolations(run);
  if (violations.length > 0) {
    throw new Error(violations.map(({ message }) => message).join('; '));
  }
}

function collectProbeViolations(run: SandboxProbeRun): ProbeViolation[] {
  const violations: ProbeViolation[] = [];
  if (run.schemaVersion !== 1) {
    violations.push({
      code: 'evidence_validation_error',
      message: 'probe schemaVersion must be 1',
    });
  }
  const ids = new Set<string>();
  for (const control of run.controls) {
    try {
      assertControlEvidence(control);
    } catch (error) {
      violations.push({
        code: 'evidence_validation_error',
        scenarioId: control.scenarioId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (ids.has(control.scenarioId)) {
      violations.push({
        code: 'evidence_validation_error',
        scenarioId: control.scenarioId,
        message: `duplicate control evidence: ${control.scenarioId}`,
      });
    }
    ids.add(control.scenarioId);
    if (control.backend.id !== run.backend.id) {
      violations.push({
        code: 'evidence_validation_error',
        scenarioId: control.scenarioId,
        message: `${control.scenarioId}: backend id drifted`,
      });
    }
    if (control.backend.version !== run.backend.version) {
      violations.push({
        code: 'evidence_validation_error',
        scenarioId: control.scenarioId,
        message: `${control.scenarioId}: backend version drifted`,
      });
    }
  }
  return violations;
}

export function validateProbeRun(run: SandboxProbeRun): ProbeViolation[] {
  return collectProbeViolations(run);
}

export function stableJson(value: unknown): string {
  assertPlainJsonValue(value);
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

function assertPlainJsonValue(value: unknown): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    value === undefined
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertPlainJsonValue(item);
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('stable JSON supports only plain objects');
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      assertPlainJsonValue(child);
    }
    return;
  }
  throw new Error(`stable JSON does not support ${typeof value}`);
}
