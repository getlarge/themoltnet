import type { ClaimCondition, TaskStatus } from '@moltnet/api-client';

/**
 * UI-enforced max nesting depth for the "Depends on" builder. Depth 1 = a flat
 * list of leaves; depth 2 = one `any` group inside the top-level `all`. NOTE:
 * this is the ONLY guard on claimCondition nesting — the server schema caps
 * branch width/status count but not recursion depth. Keep this honest: it is a
 * UX bound, not a security control.
 */
export const MAX_DEPENDS_DEPTH = 2;

/** A single prerequisite row in the builder UI. */
export interface DependsRow {
  taskId: string;
  /** 'status' → task_status with chosen statuses; 'accepted' → task_accepted. */
  mode: 'status' | 'accepted';
  statuses?: TaskStatus[];
}

function rowToLeaf(row: DependsRow): ClaimCondition {
  if (row.mode === 'accepted') {
    return { op: 'task_accepted', taskId: row.taskId };
  }
  return {
    op: 'task_status',
    taskId: row.taskId,
    statuses: row.statuses?.length ? row.statuses : ['completed'],
  };
}

/**
 * Build a claimCondition from builder rows. Returns undefined when there are no
 * prerequisites (the common case). One or more leaves are wrapped in a single
 * top-level `all` group (depth 1) — every listed prerequisite must hold.
 */
export function buildClaimCondition(
  rows: DependsRow[],
): ClaimCondition | undefined {
  const valid = rows.filter((r) => r.taskId.trim().length > 0);
  if (valid.length === 0) return undefined;
  return { op: 'all', conditions: valid.map(rowToLeaf) };
}
