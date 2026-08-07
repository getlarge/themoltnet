export type UsefulTaskEventKind = 'text_delta' | 'tool_call_start';

export const TASK_READINESS_COLD_CATEGORIES = [
  'cell-provisioning',
  'daemon-start',
  'snapshot-build',
  'vm-resume',
  'warm-continuation',
] as const;
export type TaskReadinessColdCategory =
  (typeof TASK_READINESS_COLD_CATEGORIES)[number];

export const TASK_READINESS_TOPOLOGIES = [
  'compact',
  'split',
  'unclassified',
] as const;
export type TaskReadinessTopology = (typeof TASK_READINESS_TOPOLOGIES)[number];

export const TASK_READINESS_AUTH_MODES = ['agent-key', 'oauth2'] as const;
export type TaskReadinessAuthMode = (typeof TASK_READINESS_AUTH_MODES)[number];

export const TASK_READINESS_ORY_PLACEMENTS = [
  'managed',
  'local-postgres',
  'local-sqlite',
  'unclassified',
] as const;
export type TaskReadinessOryPlacement =
  (typeof TASK_READINESS_ORY_PLACEMENTS)[number];

export const TASK_READINESS_VIRTUALIZATION_MODES = [
  'kvm',
  'tcg',
  'unclassified',
] as const;
export type TaskReadinessVirtualizationMode =
  (typeof TASK_READINESS_VIRTUALIZATION_MODES)[number];

export interface TaskEventCandidate {
  kind: string;
  payload: Record<string, unknown>;
}

/** Select the first event that proves the model has done useful work. */
export function firstUsefulTaskEvent(
  events: readonly TaskEventCandidate[],
): { index: number; kind: UsefulTaskEventKind } | null {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind === 'tool_call_start') {
      return { index, kind: event.kind };
    }
    if (
      event.kind === 'text_delta' &&
      typeof event.payload['delta'] === 'string' &&
      event.payload['delta'].trim().length > 0
    ) {
      return { index, kind: event.kind };
    }
  }
  return null;
}
