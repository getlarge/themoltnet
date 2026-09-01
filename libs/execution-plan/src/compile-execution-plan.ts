import {
  credentialAuthorityControl,
  credentialProjectionControl,
  hostCapabilityControl,
} from './control-ids.js';
import type { CredentialDestination } from './credential-requirements.js';
import type {
  CredentialReadinessRecord,
  ExecutionIntent,
} from './execution-intent.js';

export const DECISION_STATES = [
  'enforced',
  'unsupported',
  'degraded',
  'failed-open',
  'failed',
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const DECISION_BASES = ['declared', 'applied', 'verified'] as const;
export type DecisionBasis = (typeof DECISION_BASES)[number];

export const EXECUTION_MODES = ['watch', 'enforce'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const EVALUATION_PHASES = [
  'preflight',
  'launch',
  'action',
  'request',
  'resume',
  'retire',
] as const;
export type EvaluationPhase = (typeof EVALUATION_PHASES)[number];

export const ENFORCEMENT_KINDS = ['native', 'compensated'] as const;
export type EnforcementKind = (typeof ENFORCEMENT_KINDS)[number];

export interface ExecutionControlOffer {
  /** Open-ended portable control identifier. */
  id: string;
  enforcement: EnforcementKind;
  /** Value-free enforcement location selected by the executor. */
  locus: string;
  /** Optional exact containment supported by this offer. */
  constraints?: {
    destinations?: readonly CredentialDestination[];
    guestEnvs?: readonly string[];
  };
}

export interface ExecutionCapabilityOffer {
  executor: {
    id: string;
    fingerprint: string;
  };
  controls: readonly ExecutionControlOffer[];
}

export interface ControlDecision {
  control: string;
  state: DecisionState;
  basis: DecisionBasis;
  mode: ExecutionMode;
  phase: EvaluationPhase;
  offerControl?: string;
  enforcement?: EnforcementKind;
  locus?: string;
  reason?: string;
}

export interface CompileExecutionPlanInput {
  intent: ExecutionIntent;
  offer: ExecutionCapabilityOffer;
  credentialReadiness: readonly CredentialReadinessRecord[];
}

export interface PlanDeliverable {
  name: string;
  projection: string;
  guestEnv?: string;
  required: boolean;
  destinations: readonly CredentialDestination[];
  offerControl: string;
  enforcement: EnforcementKind;
  locus: string;
}

export interface CompiledExecutionPlan {
  mode: ExecutionMode;
  launchable: boolean;
  executor: ExecutionCapabilityOffer['executor'];
  decisions: readonly ControlDecision[];
  deliverables: readonly PlanDeliverable[];
  effectiveNetwork: {
    allowedHosts: readonly string[];
    allowedInternalHosts: readonly string[];
  };
}

/**
 * Compile resolved authority and portable intent against one executor offer.
 * The compiler never reads policy identifiers, host bindings, provider
 * coordinates, runtime manifests, or implementation names.
 */
export function compileExecutionPlan(
  input: CompileExecutionPlanInput,
): CompiledExecutionPlan {
  const { intent, offer } = input;
  const stamp = {
    mode: intent.mode,
    phase: 'preflight' as const,
    basis: 'declared' as const,
  };
  const decisions: ControlDecision[] = [];
  const deliverables: PlanDeliverable[] = [];
  const readinessByName = uniqueReadiness(input.credentialReadiness);
  const offersByControl = groupOffers(offer.controls);
  const authorized = intent.authority.authorizedControls;
  const networkPatterns = [
    ...intent.network.allowedHosts,
    ...intent.network.allowedInternalHosts,
  ];
  let blocked = false;

  for (const requirement of intent.credentialRequirements) {
    const control = credentialAuthorityControl(requirement.name);
    const fail = (reason: string, state?: DecisionState) => {
      const decisionState =
        state ?? (requirement.required ? 'failed' : 'degraded');
      decisions.push({ control, state: decisionState, ...stamp, reason });
      blocked ||= requirement.required;
    };

    if (authorized === undefined) {
      fail('credential_authority_unresolved');
      continue;
    }
    if (!authorized.includes(control)) {
      fail('credential_authority_denied');
      continue;
    }

    const readiness = readinessByName.get(requirement.name);
    if (readiness === undefined) {
      fail('credential_readiness_missing');
      continue;
    }
    if (readiness.status !== 'ready') {
      fail(readiness.status);
      continue;
    }

    if (
      requirement.destinations.some(
        (destination) => !hostCovered(destination.host, networkPatterns),
      )
    ) {
      fail('destination_not_in_network_intent');
      continue;
    }
    if (
      requirement.lifecycle !== undefined &&
      requirement.lifecycle.maxTtlSec > intent.lease.ttlSec
    ) {
      fail('lifecycle_exceeds_lease');
      continue;
    }

    const offerControl = credentialProjectionControl(requirement.projection);
    const candidates = offersByControl.get(offerControl) ?? [];
    const matchingCandidates = candidates.filter((candidate) =>
      offerContainsRequirement(candidate, requirement),
    );
    if (matchingCandidates.length !== 1) {
      fail(
        candidates.length === 0
          ? 'control_not_offered'
          : matchingCandidates.length === 0
            ? 'offer_constraints_mismatch'
            : 'offer_ambiguous',
        'unsupported',
      );
      continue;
    }
    const candidate = matchingCandidates[0];

    decisions.push({
      control,
      state: 'enforced',
      ...stamp,
      offerControl,
      enforcement: candidate.enforcement,
      locus: candidate.locus,
    });
    deliverables.push({
      name: requirement.name,
      projection: requirement.projection,
      ...(requirement.projection === 'brokered-http' && {
        guestEnv: requirement.guestEnv,
      }),
      required: requirement.required,
      destinations: cloneDestinations(requirement.destinations),
      offerControl,
      enforcement: candidate.enforcement,
      locus: candidate.locus,
    });
  }

  for (const name of intent.requiredCapabilities) {
    const control = hostCapabilityControl(name);
    if (authorized === undefined) {
      decisions.push({
        control,
        state: 'failed',
        ...stamp,
        reason: 'capability_authority_unresolved',
      });
      blocked = true;
      continue;
    }
    if (!authorized.includes(control)) {
      decisions.push({
        control,
        state: 'failed',
        ...stamp,
        reason: 'capability_authority_denied',
      });
      blocked = true;
      continue;
    }
    const candidates = offersByControl.get(control) ?? [];
    if (candidates.length !== 1) {
      decisions.push({
        control,
        state: 'unsupported',
        ...stamp,
        reason:
          candidates.length === 0 ? 'control_not_offered' : 'offer_ambiguous',
      });
      blocked = true;
      continue;
    }
    const candidate = candidates[0];
    decisions.push({
      control,
      state: 'enforced',
      ...stamp,
      offerControl: candidate.id,
      enforcement: candidate.enforcement,
      locus: candidate.locus,
    });
  }

  for (const control of intent.lease.requiredControls) {
    const candidates = offersByControl.get(control) ?? [];
    if (candidates.length !== 1) {
      decisions.push({
        control,
        state: 'unsupported',
        ...stamp,
        reason:
          candidates.length === 0 ? 'control_not_offered' : 'offer_ambiguous',
      });
      blocked = true;
      continue;
    }
    const candidate = candidates[0];
    decisions.push({
      control,
      state: 'enforced',
      ...stamp,
      offerControl: candidate.id,
      enforcement: candidate.enforcement,
      locus: candidate.locus,
    });
  }

  return {
    mode: intent.mode,
    launchable: !blocked,
    executor: { ...offer.executor },
    decisions,
    deliverables,
    effectiveNetwork: {
      allowedHosts: [...new Set(intent.network.allowedHosts)].sort(),
      allowedInternalHosts: [
        ...new Set(intent.network.allowedInternalHosts),
      ].sort(),
    },
  };
}

function groupOffers(
  controls: readonly ExecutionControlOffer[],
): Map<string, ExecutionControlOffer[]> {
  const grouped = new Map<string, ExecutionControlOffer[]>();
  for (const control of controls) {
    const existing = grouped.get(control.id) ?? [];
    existing.push(control);
    grouped.set(control.id, existing);
  }
  return grouped;
}

function uniqueReadiness(
  readiness: readonly CredentialReadinessRecord[],
): Map<string, CredentialReadinessRecord> {
  const result = new Map<string, CredentialReadinessRecord>();
  for (const record of readiness) {
    if (result.has(record.name)) {
      throw new Error(`duplicate credential readiness for "${record.name}"`);
    }
    result.set(record.name, record);
  }
  return result;
}

function offerContainsRequirement(
  offer: ExecutionControlOffer,
  requirement: ExecutionIntent['credentialRequirements'][number],
): boolean {
  const offeredDestinations = offer.constraints?.destinations;
  if (
    offeredDestinations === undefined ||
    !sameDestinationSet(offeredDestinations, requirement.destinations)
  ) {
    return false;
  }
  if (requirement.projection === 'brokered-http') {
    return (
      offer.constraints?.guestEnvs?.includes(requirement.guestEnv) ?? false
    );
  }
  return true;
}

function sameDestinationSet(
  offered: readonly CredentialDestination[],
  requested: readonly CredentialDestination[],
): boolean {
  const offeredKeys = offered.map(destinationKey).sort();
  const requestedKeys = requested.map(destinationKey).sort();
  return (
    offeredKeys.length === requestedKeys.length &&
    offeredKeys.every((key, index) => key === requestedKeys[index])
  );
}

function destinationKey(destination: CredentialDestination): string {
  return `${destination.protocol}\0${destination.host}\0${destination.port}`;
}

function cloneDestinations(
  destinations: readonly CredentialDestination[],
): CredentialDestination[] {
  return destinations.map((destination) => ({ ...destination }));
}

/** Exact host, or a profile wildcard covering one or more subdomains. */
function hostCovered(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === host) return true;
    if (!pattern.startsWith('*.')) return false;
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  });
}
