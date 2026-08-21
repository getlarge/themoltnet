import type { RuntimeProfileRef } from './profile.js';
import type { ResolvedRuntimeProfile } from './resolved.js';
import type {
  EnforcementRecord,
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

export type RuntimeSessionOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'launch-refused';

/**
 * Runtime session: what was actually applied and observed for one launch of
 * a resolved profile. Distinct from MoltNet's stored `runtime_sessions`
 * transcript objects; this record carries enforcement evidence only.
 */
export interface RuntimeSession {
  readonly id: string;
  readonly profile: RuntimeProfileRef;
  readonly policySnapshotHash: string;
  readonly sandboxAdapter: SandboxAdapterIdentity;
  readonly launchPlanDigest: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: RuntimeSessionOutcome;
  readonly enforcement: readonly EnforcementRecord[];
  readonly decisions: readonly ActionDecisionRecord[];
  readonly cleanup?: SandboxCleanupReport;
}

export interface EnforcementSummary {
  enforced: string[];
  unsupported: string[];
  degraded: string[];
  failedOpen: string[];
  failed: string[];
}

export function summarizeEnforcement(
  records: readonly EnforcementRecord[],
): EnforcementSummary {
  const summary: EnforcementSummary = {
    enforced: [],
    unsupported: [],
    degraded: [],
    failedOpen: [],
    failed: [],
  };
  // Latest record per control wins.
  const latest = new Map<string, EnforcementRecord>();
  for (const record of records) latest.set(record.control, record);
  for (const record of latest.values()) {
    const key = `${record.control}@${record.locus}`;
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

export interface RuntimeSessionRecorder {
  readonly id: string;
  recordEnforcement(record: Omit<EnforcementRecord, 'observedAt'>): void;
  /** Record that a previously declared control disappeared mid-session. */
  recordControlLost(
    control: EnforcementRecord['control'],
    reason: string,
  ): EnforcementState;
  recordDecision(
    decision: Omit<
      ActionDecisionRecord,
      'runtimeProfileRevision' | 'policySnapshotHash' | 'decidedAt'
    >,
  ): ActionDecisionRecord;
  recordCleanup(report: SandboxCleanupReport): void;
  finish(outcome: RuntimeSessionOutcome): RuntimeSession;
}

export interface CreateRuntimeSessionOptions {
  id?: string;
  now?: () => Date;
}

/**
 * Seed the session from the resolved profile's capability verdicts: every
 * capability starts as the adapter declared it, so an `unsupported` or
 * `degraded` declaration is visible in the session even if the adapter never
 * reports again.
 */
export function createRuntimeSession(
  resolved: ResolvedRuntimeProfile,
  options: CreateRuntimeSessionOptions = {},
): RuntimeSessionRecorder {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const id = options.id ?? `rs_${startedAt}_${resolved.profile.revision}`;
  const enforcement: EnforcementRecord[] = resolved.capabilities.map(
    (capability) => ({
      control: capability.capability,
      locus: capability.locus,
      intended: capability.requested,
      state: capability.declared,
      ...(capability.reason ? { reason: capability.reason } : {}),
      observedAt: startedAt,
    }),
  );
  for (const power of resolved.hostPowers) {
    enforcement.push({
      control: power.power,
      locus: power.locus,
      intended: 'none',
      state: power.locus === 'host-broker' ? 'enforced' : 'unsupported',
      reason:
        power.locus === 'host-broker'
          ? 'mediated by host broker'
          : 'outside guest containment; no enforcement claimed',
      observedAt: startedAt,
    });
  }
  const decisions: ActionDecisionRecord[] = [];
  let cleanup: SandboxCleanupReport | undefined;
  let finished: RuntimeSession | undefined;

  const intendedFor = (control: string): RequirementLevel | 'none' =>
    resolved.capabilities.find((c) => c.capability === control)?.requested ??
    'none';
  const latestState = (control: string): EnforcementState =>
    [...enforcement].reverse().find((r) => r.control === control)?.state ??
    'unsupported';

  const assertOpen = () => {
    if (finished) throw new Error(`runtime session ${id} already finished`);
  };

  return {
    id,
    recordEnforcement(record) {
      assertOpen();
      enforcement.push({ ...record, observedAt: now().toISOString() });
    },
    recordControlLost(control, reason) {
      assertOpen();
      const state = stateForUnavailableControl(
        intendedFor(control),
        latestState(control),
      );
      const previous = [...enforcement]
        .reverse()
        .find((r) => r.control === control);
      enforcement.push({
        control,
        locus: previous?.locus ?? 'outside-containment',
        intended: intendedFor(control),
        state,
        reason,
        observedAt: now().toISOString(),
      });
      return state;
    },
    recordDecision(decision) {
      assertOpen();
      const record: ActionDecisionRecord = {
        ...decision,
        runtimeProfileRevision: resolved.profile.revision,
        policySnapshotHash: resolved.policySnapshotHash,
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
      finished = Object.freeze({
        id,
        profile: { ...resolved.profile },
        policySnapshotHash: resolved.policySnapshotHash,
        sandboxAdapter: { ...resolved.sandboxAdapter },
        launchPlanDigest: resolved.launchPlanDigest,
        startedAt,
        endedAt: now().toISOString(),
        outcome,
        enforcement: Object.freeze([...enforcement]),
        decisions: Object.freeze([...decisions]),
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
