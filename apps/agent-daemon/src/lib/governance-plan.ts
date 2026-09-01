/**
 * Observe-only governance-plan compilation (#1970 private slice).
 *
 * Distinct from `task-execution-plan.ts` (workspace/session planning): this
 * module compiles the CREDENTIAL/CAPABILITY governance plan from trusted
 * local configuration and logs its value-free decisions. It gates nothing
 * yet — enforcement is a separate, later change.
 */
import {
  checkCredentialReadiness,
  type CredentialBinding,
} from '@moltnet/execution-integrations/credential-broker';
import {
  CURRENT_EFFECTIVE_POLICY_SNAPSHOT_VERSION,
  executionIntentFromRuntimeProfile,
} from '@moltnet/execution-integrations/runtime-profile';
import {
  compileExecutionPlan,
  createExecutionPlanSnapshot,
  type CredentialRequirement,
  type ExecutionCapabilityOffer,
  type ExecutionPlanSnapshot,
  parseCredentialRequirements,
} from '@moltnet/execution-plan';
import type {
  ClaimAuthority,
  ResolvedRuntimeProfile,
} from '@themoltnet/agent-runtime';
import type { SecretProviderRegistry } from '@themoltnet/sdk';

export const DEFAULT_GOVERNANCE_OBSERVE_TIMEOUT_MS = 2_000;

export interface RuntimeCredentialConfig {
  /** Profile-side/private input: requirements keyed by runtime profile id. */
  requirementsByProfile: Record<string, CredentialRequirement[]>;
  /** Trusted local/deployment input: logical name → secret reference. */
  bindings: Record<string, CredentialBinding>;
  /** Provenance labels recorded in evidence and explanations. */
  sources: { requirements: string; bindings: string };
}

export interface RuntimeCredentialConfigSources {
  /** Raw MOLTNET_PROFILE_CREDENTIAL_REQUIREMENTS JSON (profile-side). */
  profileRequirements: string;
  /** Raw MOLTNET_CREDENTIAL_BINDINGS JSON (trusted local). */
  bindings: string;
}

/**
 * Two distinct provenance sources (#2022 review): requirements come from a
 * profile-side/private input (`MOLTNET_PROFILE_CREDENTIAL_REQUIREMENTS`, a
 * JSON map of profile id → requirements) and bindings from trusted
 * local/deployment configuration (`MOLTNET_CREDENTIAL_BINDINGS`). Both raw
 * values are read once in config.ts. Both empty → null (observer disabled).
 * Malformed configuration throws — a truncated credential policy must never
 * be silently ignored.
 */
export function loadRuntimeCredentialConfig(
  raw: RuntimeCredentialConfigSources,
): RuntimeCredentialConfig | null {
  const hasRequirements = raw.profileRequirements.trim() !== '';
  const hasBindings = raw.bindings.trim() !== '';
  if (!hasRequirements && !hasBindings) return null;
  const requirementsByProfile: Record<string, CredentialRequirement[]> = {};
  if (hasRequirements) {
    const parsed: unknown = JSON.parse(raw.profileRequirements);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        'MOLTNET_PROFILE_CREDENTIAL_REQUIREMENTS must be a JSON object keyed by profile id',
      );
    }
    for (const [profileId, value] of Object.entries(parsed)) {
      requirementsByProfile[profileId] = parseCredentialRequirements(value);
    }
  }
  const bindings: Record<string, CredentialBinding> = {};
  if (hasBindings) {
    const parsed: unknown = JSON.parse(raw.bindings);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new Error('MOLTNET_CREDENTIAL_BINDINGS must be a JSON object');
    }
    for (const [name, binding] of Object.entries(
      parsed as Record<string, CredentialBinding>,
    )) {
      if (
        typeof binding?.reference?.provider !== 'string' ||
        typeof binding.reference.key !== 'string'
      ) {
        throw new Error(
          `MOLTNET_CREDENTIAL_BINDINGS binding "${name}" must carry a { reference: { provider, key } }`,
        );
      }
      bindings[name] = { ...binding, source: 'local-bindings-config' };
    }
  }
  return {
    requirementsByProfile,
    bindings,
    sources: {
      requirements: 'profile-requirements-config',
      bindings: 'local-bindings-config',
    },
  };
}

export type CredentialEnforcement = 'off' | 'watch' | 'enforce';

/**
 * Resolve the credential-governance enforcement mode, mirroring the runtime
 * tool-policy `off | watch | enforce` ladder. Unset defaults to `watch` when
 * requirement/binding sources are configured, `off` otherwise. `enforce` is
 * rejected until the enforcement flip (skip-before-claim) is implemented —
 * accepting it as a silent watch would misrepresent the deployment.
 */
export function resolveCredentialEnforcement(
  raw: string,
  sources: RuntimeCredentialConfigSources,
): CredentialEnforcement {
  const configured =
    sources.profileRequirements.trim() !== '' || sources.bindings.trim() !== '';
  const value = raw.trim();
  if (value === '') return configured ? 'watch' : 'off';
  if (value === 'off' || value === 'watch') return value;
  if (value === 'enforce') {
    throw new Error(
      'MOLTNET_CREDENTIAL_ENFORCEMENT=enforce is not implemented yet: the ' +
        'skip-before-claim flip is a separate change. Use watch (audit only).',
    );
  }
  throw new Error(
    `MOLTNET_CREDENTIAL_ENFORCEMENT must be off, watch or enforce; got "${value}"`,
  );
}

export interface GovernancePlanLogger {
  info(obj: object, msg?: string): void;
  warn?(obj: object, msg?: string): void;
}

export interface ObserveGovernancePlanInput {
  config: RuntimeCredentialConfig;
  profile: ResolvedRuntimeProfile;
  /** Portable offer supplied by the selected runtime integration. */
  offer?: ExecutionCapabilityOffer;
  /** Canonical host-only provider registry used by the local broker. */
  registry: SecretProviderRegistry;
  /** Fingerprint of the exact prepared executor manifest. */
  executorFingerprint: string;
  claimAuthority: ClaimAuthority;
  taskId: string;
  attemptN: number;
  logger: GovernancePlanLogger;
}

export type ObservedGovernancePlan =
  | { status: 'observed'; snapshot: ExecutionPlanSnapshot }
  | {
      status: 'unavailable';
      snapshot: null;
      reason:
        | 'claim_authority_unpinned'
        | 'runtime_profile_mismatch'
        | 'executor_fingerprint_mismatch'
        | 'execution_offer_unavailable';
    };

export async function observeGovernancePlan(
  input: ObserveGovernancePlanInput,
): Promise<ObservedGovernancePlan> {
  const unavailableReason = authorityUnavailableReason(input);
  if (unavailableReason !== null) {
    (input.logger.warn ?? input.logger.info).call(
      input.logger,
      {
        mode: 'observe',
        taskId: input.taskId,
        attemptN: input.attemptN,
        profileId: input.profile.id,
        reason: unavailableReason,
      },
      'agent-daemon.governance_plan_unavailable',
    );
    return { status: 'unavailable', snapshot: null, reason: unavailableReason };
  }
  const { runtimeProfileRevision, policySnapshotHash } = input.claimAuthority;
  if (
    runtimeProfileRevision === undefined ||
    policySnapshotHash === undefined
  ) {
    throw new Error('validated claim authority is missing immutable pins');
  }
  if (input.offer === undefined) {
    throw new Error('validated execution offer is missing');
  }
  const requirements =
    input.config.requirementsByProfile[input.profile.id] ?? [];
  const credentialReadiness = await checkCredentialReadiness(
    requirements,
    input.config.bindings,
    input.registry,
  );
  const intent = executionIntentFromRuntimeProfile({
    mode: 'watch',
    profile: input.profile,
    profileRevision: runtimeProfileRevision,
    policy: {
      hash: policySnapshotHash,
      snapshot: {
        version: CURRENT_EFFECTIVE_POLICY_SNAPSHOT_VERSION,
        runtimeKind: input.profile.runtimeKind,
      },
      // Production Credential:<name> authority does not exist yet. Undefined
      // is an explicit default-deny result, never inferred from local config.
      authorizedControls: undefined,
    },
    credentialRequirements: requirements,
    requiredCapabilities: [],
    requirementsProvenance: input.config.sources.requirements,
  });
  const plan = compileExecutionPlan({
    intent,
    offer: input.offer,
    credentialReadiness,
  });
  const snapshot = await createExecutionPlanSnapshot({
    intent,
    offer: input.offer,
    credentialReadiness,
    plan,
  });
  const logObject = {
    mode: 'observe',
    taskId: input.taskId,
    attemptN: input.attemptN,
    profileId: input.profile.id,
    sources: input.config.sources,
    snapshotCid: snapshot.cid,
    profileRevision: snapshot.intent.profile.revision,
    policySnapshotHash: snapshot.intent.authority.policySnapshotHash,
    launchable: plan.launchable,
    decisions: plan.decisions,
    credentialReadiness,
  };
  if (plan.launchable) {
    input.logger.info(logObject, 'agent-daemon.governance_plan');
  } else {
    (input.logger.warn ?? input.logger.info).call(
      input.logger,
      logObject,
      'agent-daemon.governance_plan_would_block',
    );
  }
  return { status: 'observed', snapshot };
}

/**
 * Observe without allowing a stuck keyring/provider to delay task execution.
 * The observer is intentionally non-gating: failures and deadlines are logged
 * with claim correlation and converted to `null`.
 */
export async function observeGovernancePlanSafely(
  input: ObserveGovernancePlanInput,
  timeoutMs = DEFAULT_GOVERNANCE_OBSERVE_TIMEOUT_MS,
): Promise<ObservedGovernancePlan | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      observeGovernancePlan(input),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('governance observation timed out')),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    (input.logger.warn ?? input.logger.info).call(
      input.logger,
      {
        mode: 'observe',
        taskId: input.taskId,
        attemptN: input.attemptN,
        err: error instanceof Error ? error.message : String(error),
      },
      'agent-daemon.governance_plan_observe_failed',
    );
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function authorityUnavailableReason(
  input: ObserveGovernancePlanInput,
): Exclude<ObservedGovernancePlan, { status: 'observed' }>['reason'] | null {
  const authority = input.claimAuthority;
  if (
    authority.runtimeProfileId === undefined ||
    authority.runtimeProfileRevision === undefined ||
    authority.policySnapshotHash === undefined ||
    authority.executorFingerprint === undefined
  ) {
    return 'claim_authority_unpinned';
  }
  if (authority.runtimeProfileId !== input.profile.id) {
    return 'runtime_profile_mismatch';
  }
  if (authority.executorFingerprint !== input.executorFingerprint) {
    return 'executor_fingerprint_mismatch';
  }
  if (input.offer === undefined) return 'execution_offer_unavailable';
  if (input.offer.executor.fingerprint !== input.executorFingerprint) {
    return 'executor_fingerprint_mismatch';
  }
  return null;
}
