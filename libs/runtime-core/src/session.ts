import { deepFreezeClone } from './digest.js';
import type { GovernanceIntentRef } from './intent.js';
import type { GovernancePlan } from './plan.js';
import type {
  EnforcementRecord,
  EvidenceBasis,
  SandboxAdapterIdentity,
  SandboxCleanupReport,
} from './sandbox-adapter.js';
import {
  type EnforcementState,
  type RequirementLevel,
  stateForUnavailableControl,
} from './states.js';

/**
 * One policy decision bound to the exact profile revision and policy snapshot
 * it was made under. The vocabulary is the one retained by the Checkpoint C
 * evidence: decision locus and enforcement locus stay separate, and
 * `enforcementObserved` is only true when an independent oracle confirmed it.
 */
export interface ActionDecisionRecord {
  runtimeProfileRevision: number;
  policySnapshotHash: string;
  /** Coding-agent provider or adapter that surfaced the action. */
  provider: string;
  toolName: string;
  /** Provider-native identifier (e.g. a tool-use id), when available. */
  nativeActionIdentifier?: string;
  decision: 'allow' | 'deny' | 'audit';
  reasonCode: string;
  decisionLocus: string;
  intendedEnforcementLocus: string;
  observedEnforcementLocus?: string;
  enforcementObserved: boolean;
  decidedAt: string;
}

/** Structural shape of `decideToolCall()`'s verdict; no import of the gate. */
export type GateVerdictLike =
  | { allow: true; reasonCode: string }
  | { allow: false; reasonCode: string; reason: string }
  | { reasonCode: string; audit: string };

export function decisionFromGateVerdict(verdict: GateVerdictLike): {
  decision: ActionDecisionRecord['decision'];
  reasonCode: string;
} {
  if ('audit' in verdict) {
    return { decision: 'audit', reasonCode: verdict.reasonCode };
  }
  return {
    decision: verdict.allow ? 'allow' : 'deny',
    reasonCode: verdict.reasonCode,
  };
}

export type GovernanceSessionOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'launch-refused';

/**
 * Governance session: enforcement evidence for one launch of a plan. Every
 * record carries its basis (`declared`, `applied`, `verified`); a session
 * that only contains declarations proves nothing and says so in its summary.
 * Unrelated to the stored `runtime_sessions` transcript objects.
 */
export interface GovernanceSession {
  readonly id: string;
  readonly profile: GovernanceIntentRef;
  readonly policySnapshotHash: string;
  readonly planDigest: string;
  readonly sandboxAdapter: SandboxAdapterIdentity;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: GovernanceSessionOutcome;
  readonly enforcement: readonly EnforcementRecord[];
  readonly decisions: readonly ActionDecisionRecord[];
  readonly cleanup?: SandboxCleanupReport;
}

export interface EnforcementSummary {
  /** Controls whose latest non-declared record is `enforced`. */
  enforced: string[];
  unsupported: string[];
  degraded: string[];
  failedOpen: string[];
  failed: string[];
  /** Controls for which only a declaration exists: no evidence either way. */
  declaredOnly: string[];
}

/**
 * Latest record per control wins; a bare declaration is reported separately
 * and never counted as enforced.
 */
export function summarizeEnforcement(
  records: readonly EnforcementRecord[],
): EnforcementSummary {
  const summary: EnforcementSummary = {
    enforced: [],
    unsupported: [],
    degraded: [],
    failedOpen: [],
    failed: [],
    declaredOnly: [],
  };
  const latest = new Map<string, EnforcementRecord>();
  for (const record of records) latest.set(record.control, record);
  for (const record of latest.values()) {
    const key = `${record.control}@${record.locus}`;
    if (record.basis === 'declared' && record.state === 'enforced') {
      summary.declaredOnly.push(key);
      continue;
    }
    switch (record.state) {
      case 'enforced':
        summary.enforced.push(key);
        break;
      case 'unsupported':
        summary.unsupported.push(key);
        break;
      case 'degraded':
        summary.degraded.push(key);
        break;
      case 'failed-open':
        summary.failedOpen.push(key);
        break;
      case 'failed':
        summary.failed.push(key);
        break;
    }
  }
  return summary;
}

export interface GovernanceSessionRecorder {
  readonly id: string;
  recordEnforcement(record: Omit<EnforcementRecord, 'recordedAt'>): void;
  /** Record that a previously active control disappeared mid-session. */
  recordControlLost(
    control: EnforcementRecord['control'],
    reason: string,
    basis?: Exclude<EvidenceBasis, 'declared'>,
  ): EnforcementState;
  recordDecision(
    decision: Omit<
      ActionDecisionRecord,
      'runtimeProfileRevision' | 'policySnapshotHash' | 'decidedAt'
    >,
  ): ActionDecisionRecord;
  recordCleanup(report: SandboxCleanupReport): void;
  finish(outcome: GovernanceSessionOutcome): GovernanceSession;
}

export interface CreateGovernanceSessionOptions {
  id?: string;
  now?: () => Date;
}

/**
 * Seed the session from the plan's capability verdicts with basis
 * `declared`. Adapters and oracles add `applied`/`verified` records; until
 * they do, the summary reports those controls as declared-only.
 */
export function createGovernanceSession(
  plan: GovernancePlan,
  options: CreateGovernanceSessionOptions = {},
): GovernanceSessionRecorder {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const id = options.id ?? `gs_${startedAt}_${plan.profile.revision}`;
  const enforcement: EnforcementRecord[] = plan.capabilities.map(
    (capability) => ({
      control: capability.capability,
      locus: capability.locus,
      intended: capability.requested,
      state: capability.declared,
      basis: 'declared',
      ...(capability.reason ? { reason: capability.reason } : {}),
      recordedAt: startedAt,
    }),
  );
  for (const power of plan.hostPowers) {
    enforcement.push({
      control: power.power,
      locus: power.locus,
      intended: 'none',
      state: power.locus === 'host-broker' ? 'enforced' : 'unsupported',
      basis: 'declared',
      reason:
        power.locus === 'host-broker'
          ? 'mediated by host broker'
          : 'outside guest containment; no enforcement claimed',
      recordedAt: startedAt,
    });
  }
  const decisions: ActionDecisionRecord[] = [];
  let cleanup: SandboxCleanupReport | undefined;
  let finished: GovernanceSession | undefined;

  const intendedFor = (control: string): RequirementLevel | 'none' =>
    plan.capabilities.find((c) => c.capability === control)?.requested ??
    'none';
  const latestRecord = (control: string): EnforcementRecord | undefined =>
    [...enforcement].reverse().find((r) => r.control === control);

  const assertOpen = () => {
    if (finished) throw new Error(`governance session ${id} already finished`);
  };

  return {
    id,
    recordEnforcement(record) {
      assertOpen();
      enforcement.push({ ...record, recordedAt: now().toISOString() });
    },
    recordControlLost(control, reason, basis = 'applied') {
      assertOpen();
      const previous = latestRecord(control);
      const state = stateForUnavailableControl(
        intendedFor(control),
        previous?.state ?? 'unsupported',
      );
      enforcement.push({
        control,
        locus: previous?.locus ?? 'outside-containment',
        intended: intendedFor(control),
        state,
        basis,
        reason,
        recordedAt: now().toISOString(),
      });
      return state;
    },
    recordDecision(decision) {
      assertOpen();
      const record: ActionDecisionRecord = {
        ...decision,
        runtimeProfileRevision: plan.profile.revision,
        policySnapshotHash: plan.policySnapshotHash,
        decidedAt: now().toISOString(),
      };
      decisions.push(record);
      return record;
    },
    recordCleanup(report) {
      assertOpen();
      cleanup = report;
    },
    finish(outcome) {
      assertOpen();
      finished = deepFreezeClone({
        id,
        profile: plan.profile,
        policySnapshotHash: plan.policySnapshotHash,
        planDigest: plan.planDigest,
        sandboxAdapter: plan.sandboxAdapter,
        startedAt,
        endedAt: now().toISOString(),
        outcome,
        enforcement,
        decisions,
        ...(cleanup ? { cleanup } : {}),
      });
      return finished;
    },
  };
}

/**
 * Assert that a secret value is absent from retained evidence. Redaction does
 * not convert a failed raw scan into a pass; callers scan the raw material.
 */
export function findValueLeaks(
  value: string,
  evidence: Readonly<Record<string, unknown>>,
): string[] {
  if (value.length === 0) return [];
  const leaks: string[] = [];
  for (const [label, material] of Object.entries(evidence)) {
    const text =
      typeof material === 'string' ? material : JSON.stringify(material);
    if (text !== undefined && text.includes(value)) leaks.push(label);
  }
  return leaks;
}
