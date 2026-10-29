import type { WorkItemRef } from './contracts.js';

/** GitHub adapters normalize labels/timeline events into these observations. */
export interface AdmissionObservation {
  workItem: WorkItemRef;
  briefDigest: string;
  open: boolean;
  eligible: boolean;
  paused: boolean;
  cancelled: boolean;
  approval?: {
    /** Adapter verifies actor permissions, rather than trusting comment text. */
    authorized: boolean;
    eventId: string;
    briefDigest: string;
  };
}

export interface Admission {
  workItem: WorkItemRef;
  briefDigest: string;
  approvalEventId: string;
}

export function admit(
  observation: AdmissionObservation,
): Admission | undefined {
  const approval = observation.approval;
  if (
    !observation.open ||
    !observation.eligible ||
    observation.paused ||
    observation.cancelled ||
    !approval?.authorized ||
    !approval.eventId ||
    !observation.briefDigest ||
    approval.briefDigest !== observation.briefDigest
  )
    return undefined;
  return {
    workItem: observation.workItem,
    briefDigest: observation.briefDigest,
    approvalEventId: approval.eventId,
  };
}

export interface LabelProjection {
  /** Only these labels are owned by the adapter. Other labels are untouched. */
  stages: Record<string, string>;
}

/** Compute granular mutations, never replace the issue's complete label set. */
export function reconcileStageLabels(
  existing: readonly string[],
  stage: string,
  policy: LabelProjection,
): { add: string[]; remove: string[] } {
  const labels = Object.values(policy.stages);
  if (
    labels.some((label) => !label.trim()) ||
    new Set(labels).size !== labels.length
  )
    throw new Error('Stage labels must be nonempty and unique');
  const desired = Object.hasOwn(policy.stages, stage)
    ? policy.stages[stage]
    : undefined;
  if (!desired) throw new Error(`Unconfigured stage: ${stage}`);
  return {
    add: existing.includes(desired) ? [] : [desired],
    remove: [
      ...new Set(
        existing.filter((label) => labels.includes(label) && label !== desired),
      ),
    ],
  };
}
