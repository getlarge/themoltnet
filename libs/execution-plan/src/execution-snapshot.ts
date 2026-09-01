import { computeJsonCid } from '@moltnet/crypto-service';

import type {
  CompiledExecutionPlan,
  ExecutionCapabilityOffer,
} from './compile-execution-plan.js';
import type {
  CredentialReadinessRecord,
  ExecutionIntent,
} from './execution-intent.js';

export interface ExecutionPlanSnapshot {
  readonly cid: string;
  readonly intent: ExecutionIntent;
  readonly offer: ExecutionCapabilityOffer;
  readonly credentialReadiness: readonly CredentialReadinessRecord[];
  readonly plan: CompiledExecutionPlan;
}

/**
 * Create an immutable, content-addressed, value-free execution snapshot. The
 * existing policy snapshot hash is pinned inside intent; policy composition
 * has already happened before this boundary.
 */
export async function createExecutionPlanSnapshot(input: {
  intent: ExecutionIntent;
  offer: ExecutionCapabilityOffer;
  credentialReadiness: readonly CredentialReadinessRecord[];
  plan: CompiledExecutionPlan;
}): Promise<ExecutionPlanSnapshot> {
  const body = structuredClone(input);
  const cid = await computeJsonCid(snapshotBody(body));
  return deepFreeze({ cid, ...body });
}

export async function verifyExecutionPlanSnapshot(
  snapshot: ExecutionPlanSnapshot,
): Promise<boolean> {
  const cid = await computeJsonCid(
    snapshotBody({
      intent: snapshot.intent,
      offer: snapshot.offer,
      credentialReadiness: snapshot.credentialReadiness,
      plan: snapshot.plan,
    }),
  );
  return cid === snapshot.cid;
}

function snapshotBody(input: {
  intent: ExecutionIntent;
  offer: ExecutionCapabilityOffer;
  credentialReadiness: readonly CredentialReadinessRecord[];
  plan: CompiledExecutionPlan;
}) {
  return {
    v: 'moltnet:execution-plan-snapshot:v1',
    ...input,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
