import {
  DECISION_STATES,
  type DecisionState,
  type EvaluationPhase,
  type ExecutionPlanSnapshot,
  verifyExecutionPlanSnapshot,
} from '@moltnet/execution-plan';

export interface RuntimeExecution {
  readonly executionId: string;
  readonly snapshotCid: string;
  readonly snapshot: ExecutionPlanSnapshot;
  readonly lease: {
    readonly startsAt: string;
    readonly expiresAt: string;
  };
}

export interface CredentialBindingReceipt {
  name: string;
  bindingDigest: string;
  source?: string;
}

/**
 * Trusted-host port. The credential value exists only inside `use`; callers
 * receive a value-free binding receipt after the callback settles.
 */
export interface CredentialDeliveryPort {
  withCredential(
    name: string,
    use: (value: string) => void | Promise<void>,
  ): Promise<CredentialBindingReceipt>;
}

export interface AdapterLaunchRequest {
  snapshot: ExecutionPlanSnapshot;
  deliverCredential(
    name: string,
    sink: (value: string) => void | Promise<void>,
  ): Promise<CredentialBindingReceipt>;
}

export interface AdapterLaunchReport {
  controls: readonly {
    control: string;
    state: DecisionState;
    basis?: 'applied' | 'verified';
    phase?: EvaluationPhase;
    locus?: string;
    reason?: string;
  }[];
}

export interface ExecutionAdapter {
  readonly name: string;
  readonly identity: { id: string; fingerprint: string };
  launch(request: AdapterLaunchRequest): Promise<AdapterLaunchReport>;
}

export interface ExecutionEvidenceRecord {
  control: string;
  adapter: string;
  state: DecisionState;
  basis: 'applied' | 'verified';
  reportedBy: 'host' | 'adapter';
  mode: 'enforce';
  phase: EvaluationPhase;
  executionId: string;
  snapshotCid: string;
  locus?: string;
  bindingDigest?: string;
  bindingSource?: string;
  reason?: string;
}

export async function createRuntimeExecution(
  snapshot: ExecutionPlanSnapshot,
  options: {
    executionId: string;
    startsAt?: Date;
  },
): Promise<RuntimeExecution> {
  if (snapshot.plan.mode !== 'enforce') {
    throw new Error(
      `snapshot ${snapshot.cid} is watch-only; refusing authoritative execution`,
    );
  }
  if (!snapshot.plan.launchable) {
    throw new Error(
      `snapshot ${snapshot.cid} is not launchable; refusing execution`,
    );
  }
  if (!(await verifyExecutionPlanSnapshot(snapshot))) {
    throw new Error(`snapshot content does not match CID ${snapshot.cid}`);
  }
  const startsAt = options.startsAt ?? new Date();
  const expiresAt = new Date(
    startsAt.getTime() + snapshot.intent.lease.ttlSec * 1_000,
  );
  return Object.freeze({
    executionId: options.executionId,
    snapshotCid: snapshot.cid,
    snapshot,
    lease: Object.freeze({
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
  });
}

export async function bindExecution(
  execution: RuntimeExecution,
  adapter: ExecutionAdapter,
  credentials: CredentialDeliveryPort,
  options: { now?: Date } = {},
): Promise<ExecutionEvidenceRecord[]> {
  const expected = execution.snapshot.plan.executor;
  if (
    adapter.identity.id !== expected.id ||
    adapter.identity.fingerprint !== expected.fingerprint
  ) {
    throw new Error(
      `adapter "${adapter.name}" does not match the snapshot executor identity`,
    );
  }
  if (
    (options.now ?? new Date()).getTime() >=
    Date.parse(execution.lease.expiresAt)
  ) {
    throw new Error(`execution ${execution.executionId} lease has expired`);
  }

  const authorized = new Set(
    execution.snapshot.plan.deliverables.map((deliverable) => deliverable.name),
  );
  const evidence: ExecutionEvidenceRecord[] = [];
  const report = await adapter.launch({
    snapshot: execution.snapshot,
    async deliverCredential(name, sink) {
      if (!authorized.has(name)) {
        throw new Error(
          `credential "${name}" is not authorized by snapshot ${execution.snapshotCid}`,
        );
      }
      const receipt = await credentials.withCredential(name, sink);
      validateReceipt(name, receipt);
      evidence.push({
        control: `credential:${name}`,
        adapter: adapter.name,
        state: 'enforced',
        basis: 'applied',
        reportedBy: 'host',
        mode: 'enforce',
        phase: 'launch',
        locus: 'credential-delivery-port',
        bindingDigest: receipt.bindingDigest,
        ...(receipt.source !== undefined && {
          bindingSource: receipt.source,
        }),
        executionId: execution.executionId,
        snapshotCid: execution.snapshotCid,
      });
      return receipt;
    },
  });
  validateAdapterReport(adapter.name, report, execution);
  for (const control of report.controls) {
    evidence.push({
      control: control.control,
      adapter: adapter.name,
      state: control.state,
      basis: control.basis ?? 'applied',
      reportedBy: 'adapter',
      mode: 'enforce',
      phase: control.phase ?? 'launch',
      executionId: execution.executionId,
      snapshotCid: execution.snapshotCid,
      ...(control.locus !== undefined && { locus: control.locus }),
      ...(control.reason !== undefined && { reason: control.reason }),
    });
  }
  return evidence;
}

function validateReceipt(
  expectedName: string,
  receipt: CredentialBindingReceipt,
): void {
  if (receipt.name !== expectedName) {
    throw new Error(
      `credential receipt identity mismatch for "${expectedName}"`,
    );
  }
  if (!/^sha256:[0-9a-f]{16,64}$/.test(receipt.bindingDigest)) {
    throw new Error(
      `credential receipt digest is invalid for "${expectedName}"`,
    );
  }
  if (receipt.source !== undefined && !IDENTIFIER_RE.test(receipt.source)) {
    throw new Error(
      `credential receipt source is invalid for "${expectedName}"`,
    );
  }
}

const IDENTIFIER_RE = /^[a-z0-9][a-z0-9_.:/-]{0,159}$/;
const ADAPTER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const REASON_RE = /^[a-z0-9_.:-]{1,120}$/;
const REPORTABLE_FAMILIES = new Set([
  'network-egress',
  'lifecycle',
  'filesystem-scope',
]);

function validateAdapterReport(
  adapterName: string,
  report: AdapterLaunchReport,
  execution: RuntimeExecution,
): void {
  if (!ADAPTER_NAME_RE.test(adapterName)) {
    throw new Error('adapter name is not a valid identifier');
  }
  const known = new Set(
    execution.snapshot.plan.decisions.map((decision) => decision.control),
  );
  for (const control of report.controls) {
    const family = control.control.split(':')[0];
    if (
      !IDENTIFIER_RE.test(control.control) ||
      (!known.has(control.control) && !REPORTABLE_FAMILIES.has(family))
    ) {
      throw new Error(
        `adapter reported an unknown or malformed control "${control.control}"`,
      );
    }
    if (!(DECISION_STATES as readonly string[]).includes(control.state)) {
      throw new Error(
        `adapter reported an invalid state for ${control.control}`,
      );
    }
    if (
      control.basis !== undefined &&
      control.basis !== 'applied' &&
      control.basis !== 'verified'
    ) {
      throw new Error(
        `adapter reported an invalid basis for ${control.control}`,
      );
    }
    if (control.reason !== undefined && !REASON_RE.test(control.reason)) {
      throw new Error(
        `adapter reported an invalid reason for ${control.control}`,
      );
    }
    if (control.locus !== undefined && !IDENTIFIER_RE.test(control.locus)) {
      throw new Error(
        `adapter reported an invalid locus for ${control.control}`,
      );
    }
  }
}
