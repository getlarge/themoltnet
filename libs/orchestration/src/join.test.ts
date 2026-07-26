import type { ClaimCondition } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  joinCondition,
  MAX_CLAIM_CONDITION_BRANCHES,
  MAX_CLAIM_CONDITION_DEPTH,
  MAX_JOIN_TASKS,
} from './join.js';

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `task-${i}`);
}

/** Deepest depth at which a leaf sits; root group is depth 1. */
function maxLeafDepth(condition: ClaimCondition, depth = 1): number {
  if (condition.op === 'all' || condition.op === 'any') {
    return Math.max(
      ...condition.conditions.map((child) => maxLeafDepth(child, depth + 1)),
    );
  }
  return depth;
}

function maxBranches(condition: ClaimCondition): number {
  if (condition.op === 'all' || condition.op === 'any') {
    return Math.max(
      condition.conditions.length,
      ...condition.conditions.map(maxBranches),
    );
  }
  return 0;
}

function collectLeafIds(
  condition: ClaimCondition,
  out: string[] = [],
): string[] {
  if (condition.op === 'all' || condition.op === 'any') {
    condition.conditions.forEach((child) => collectLeafIds(child, out));
  } else {
    out.push(condition.taskId);
  }
  return out;
}

describe('joinCondition', () => {
  it('returns a bare task_status leaf for a single task', () => {
    const condition = joinCondition(['only']);
    expect(condition).toEqual({
      op: 'task_status',
      taskId: 'only',
      statuses: ['completed'],
    });
  });

  it('builds a flat all-group for up to 8 tasks (leaves at depth 2)', () => {
    const condition = joinCondition(ids(8));
    expect(condition.op).toBe('all');
    expect(maxLeafDepth(condition)).toBe(2);
    expect(maxBranches(condition)).toBe(8);
    expect(collectLeafIds(condition)).toEqual(ids(8));
  });

  it('auto-nests when N > 8 while respecting branch and depth limits', () => {
    const condition = joinCondition(ids(9));
    expect(maxBranches(condition)).toBeLessThanOrEqual(
      MAX_CLAIM_CONDITION_BRANCHES,
    );
    expect(maxLeafDepth(condition)).toBe(3);
    // Every original id is still present exactly once.
    expect(new Set(collectLeafIds(condition))).toEqual(new Set(ids(9)));
    expect(collectLeafIds(condition)).toHaveLength(9);
  });

  it('handles the maximum expressible fan-in (512) within depth 4', () => {
    const condition = joinCondition(ids(MAX_JOIN_TASKS));
    expect(maxBranches(condition)).toBeLessThanOrEqual(
      MAX_CLAIM_CONDITION_BRANCHES,
    );
    expect(maxLeafDepth(condition)).toBeLessThanOrEqual(
      MAX_CLAIM_CONDITION_DEPTH,
    );
    expect(collectLeafIds(condition)).toHaveLength(MAX_JOIN_TASKS);
  });

  it('throws when the fan-in exceeds the depth ceiling', () => {
    expect(() => joinCondition(ids(MAX_JOIN_TASKS + 1))).toThrow(
      /within claim-condition depth/,
    );
  });

  it('throws on an empty task list', () => {
    expect(() => joinCondition([])).toThrow(/at least one taskId/);
  });

  it('deduplicates task ids', () => {
    const condition = joinCondition(['a', 'a', 'b']);
    expect(collectLeafIds(condition).sort()).toEqual(['a', 'b']);
  });

  it('honors op and statuses options', () => {
    const condition = joinCondition(ids(9), {
      op: 'any',
      statuses: ['completed', 'failed'],
    });
    expect(condition.op).toBe('any');
    const leaf = condition.op === 'any' ? condition.conditions[0] : condition;
    // Drill to a leaf and check its statuses.
    const anyLeaf = collectLeafStatuses(condition)[0];
    expect(anyLeaf).toEqual(['completed', 'failed']);
    expect(leaf).toBeDefined();
  });
});

function collectLeafStatuses(
  condition: ClaimCondition,
  out: string[][] = [],
): string[][] {
  if (condition.op === 'all' || condition.op === 'any') {
    condition.conditions.forEach((child) => collectLeafStatuses(child, out));
  } else if (condition.op === 'task_status') {
    out.push(condition.statuses);
  }
  return out;
}
