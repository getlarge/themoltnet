import type { ClaimCondition, TaskStatus } from './types.js';

/**
 * UI-enforced max nesting depth for the "Depends on" builder. Depth 1 = a flat
 * list of leaves; depth 2 = one `any` group inside the top-level `all`. NOTE:
 * this is the ONLY guard on claimCondition nesting in the UI — the server caps
 * branch width/status count and its own recursion depth
 * (MAX_CLAIM_CONDITION_DEPTH in @moltnet/task-service). Keep this honest: it is
 * a UX bound, not a security control.
 */
export const MAX_DEPENDS_DEPTH = 2;

/** A single prerequisite row in the "Depends on" builder UI. */
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
  const valid = rows.filter((row) => row.taskId.trim().length > 0);
  if (valid.length === 0) return undefined;
  return { op: 'all', conditions: valid.map(rowToLeaf) };
}
