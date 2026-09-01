import type {
  CompiledExecutionPlan,
  ControlDecision,
  ExecutionMode,
} from './compile-execution-plan.js';
import { credentialAuthorityControl } from './control-ids.js';
import type {
  CredentialReadinessRecord,
  CredentialReadinessState,
  ExecutionIntent,
} from './execution-intent.js';

export interface ExplainedRequirement {
  name: string;
  kind: string;
  projection: string;
  required: boolean;
  destinations: readonly string[];
  bindingDigest: string | null;
  readiness: CredentialReadinessState | 'unknown';
  readinessSource: string | null;
  authority: 'granted' | 'denied' | 'unresolved';
}

export interface ExecutionPlanExplanation {
  mode: ExecutionMode;
  launchable: boolean;
  pins: {
    profileRevision: number;
    profileDefinitionCid: string;
    policySnapshotHash: string;
    policySnapshotVersion: string;
    executorFingerprint: string;
  };
  provenance: ExecutionIntent['provenance'] | null;
  requirements: readonly ExplainedRequirement[];
  decisions: readonly ControlDecision[];
  notEnforced: readonly ControlDecision[];
  blockingReasons: readonly string[];
  effectiveNetwork: CompiledExecutionPlan['effectiveNetwork'];
}

/** Pure value-free explanation of requested, offered, and resolved controls. */
export function explainExecutionPlan(input: {
  intent: ExecutionIntent;
  plan: CompiledExecutionPlan;
  credentialReadiness: readonly CredentialReadinessRecord[];
}): ExecutionPlanExplanation {
  const readiness = new Map(
    input.credentialReadiness.map((record) => [record.name, record]),
  );
  const authority = input.intent.authority.authorizedControls;
  const requirements = input.intent.credentialRequirements.map(
    (requirement): ExplainedRequirement => {
      const record = readiness.get(requirement.name);
      const control = credentialAuthorityControl(requirement.name);
      return {
        name: requirement.name,
        kind: requirement.kind,
        projection: requirement.projection,
        required: requirement.required,
        destinations: requirement.destinations.map(
          (destination) =>
            `${destination.protocol}://${destination.host}:${destination.port}`,
        ),
        bindingDigest: record?.bindingDigest ?? null,
        readiness: record?.status ?? 'unknown',
        readinessSource: record?.source ?? null,
        authority:
          authority === undefined
            ? 'unresolved'
            : authority.includes(control)
              ? 'granted'
              : 'denied',
      };
    },
  );
  const notEnforced = input.plan.decisions.filter(
    (decision) => decision.state !== 'enforced',
  );
  return {
    mode: input.plan.mode,
    launchable: input.plan.launchable,
    pins: {
      profileRevision: input.intent.profile.revision,
      profileDefinitionCid: input.intent.profile.definitionCid,
      policySnapshotHash: input.intent.authority.policySnapshotHash,
      policySnapshotVersion: input.intent.authority.policySnapshotVersion,
      executorFingerprint: input.plan.executor.fingerprint,
    },
    provenance: input.intent.provenance ?? null,
    requirements,
    decisions: input.plan.decisions,
    notEnforced,
    blockingReasons: notEnforced
      .filter(
        (decision) =>
          decision.state === 'failed' ||
          decision.state === 'failed-open' ||
          decision.state === 'unsupported',
      )
      .map(
        (decision) =>
          `${decision.control}: ${decision.reason ?? decision.state}`,
      ),
    effectiveNetwork: input.plan.effectiveNetwork,
  };
}
