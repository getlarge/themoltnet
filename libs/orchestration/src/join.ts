import {
  type ClaimCondition,
  MAX_CLAIM_CONDITION_BRANCHES,
  MAX_CLAIM_CONDITION_DEPTH,
  type TaskStatus,
} from '@moltnet/tasks';

// Re-export the canonical claim-condition bounds (owned by @moltnet/tasks) so
// consumers of this lib get a single source of truth that cannot drift from the
// server-enforced limits.
export {
  MAX_CLAIM_CONDITION_BRANCHES,
  MAX_CLAIM_CONDITION_DEPTH,
} from '@moltnet/tasks';

/**
 * Largest flat fan-in a balanced tree can express within the depth ceiling:
 * leaves live at depth {@link MAX_CLAIM_CONDITION_DEPTH}, so with 3 group levels
 * that is 8^3 = 512.
 */
export const MAX_JOIN_TASKS =
  MAX_CLAIM_CONDITION_BRANCHES ** (MAX_CLAIM_CONDITION_DEPTH - 1);

export interface JoinConditionOptions {
  /** `all` = every task must match (AND, the default); `any` = one suffices (OR). */
  op?: 'all' | 'any';
  /** Task statuses that satisfy each leaf. Default `['completed']`. */
  statuses?: TaskStatus[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Build a MoltNet `claimCondition` gating a downstream task on many upstream
 * tasks — the server-enforced join for a parallel fan-out. For >8 tasks it
 * auto-nests balanced `all`/`any` groups (each ≤8 branches) so the tree stays
 * within the depth-4 ceiling; a single task returns a bare `task_status` leaf.
 *
 * @throws if `taskIds` is empty or exceeds {@link MAX_JOIN_TASKS} (512).
 */
export function joinCondition(
  taskIds: readonly string[],
  options: JoinConditionOptions = {},
): ClaimCondition {
  const op = options.op ?? 'all';
  const statuses = options.statuses ?? ['completed'];
  const uniqueIds = [...new Set(taskIds)];
  if (uniqueIds.length === 0) {
    throw new Error('joinCondition requires at least one taskId');
  }

  let level: ClaimCondition[] = uniqueIds.map((taskId) => ({
    op: 'task_status',
    taskId,
    statuses,
  }));
  if (level.length === 1) return level[0];

  // Chunk bottom-up into groups of ≤8. Each pass adds one group level.
  let groupLevels = 0;
  while (level.length > MAX_CLAIM_CONDITION_BRANCHES) {
    level = chunk(level, MAX_CLAIM_CONDITION_BRANCHES).map((conditions) => ({
      op,
      conditions,
    }));
    groupLevels += 1;
  }
  groupLevels += 1; // the root group wrapping the remaining ≤8 nodes

  // Root is depth 1; each group level pushes leaves one level deeper.
  const leafDepth = groupLevels + 1;
  if (leafDepth > MAX_CLAIM_CONDITION_DEPTH) {
    throw new Error(
      `joinCondition cannot express ${uniqueIds.length} tasks within claim-condition depth ${MAX_CLAIM_CONDITION_DEPTH} (max ${MAX_JOIN_TASKS} tasks)`,
    );
  }
  return { op, conditions: level };
}
