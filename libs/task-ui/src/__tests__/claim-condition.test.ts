import { describe, expect, it } from 'vitest';

import {
  buildClaimCondition,
  type DependsRow,
  MAX_DEPENDS_DEPTH,
} from '../claim-condition.js';

describe('buildClaimCondition', () => {
  it('returns undefined for no rows (no dependency)', () => {
    expect(buildClaimCondition([])).toBeUndefined();
  });

  it('ignores rows with a blank taskId', () => {
    expect(buildClaimCondition([{ taskId: '  ', mode: 'accepted' }])).toBe(
      undefined,
    );
  });

  it('wraps a single task_status leaf in an all-group', () => {
    const rows: DependsRow[] = [
      { taskId: 't1', mode: 'status', statuses: ['completed'] },
    ];
    expect(buildClaimCondition(rows)).toEqual({
      op: 'all',
      conditions: [
        { op: 'task_status', taskId: 't1', statuses: ['completed'] },
      ],
    });
  });

  it('defaults to completed when a status row has no statuses', () => {
    const rows: DependsRow[] = [{ taskId: 't1', mode: 'status' }];
    expect(buildClaimCondition(rows)).toEqual({
      op: 'all',
      conditions: [
        { op: 'task_status', taskId: 't1', statuses: ['completed'] },
      ],
    });
  });

  it('maps an accepted row to task_accepted', () => {
    const rows: DependsRow[] = [{ taskId: 't2', mode: 'accepted' }];
    expect(buildClaimCondition(rows)).toEqual({
      op: 'all',
      conditions: [{ op: 'task_accepted', taskId: 't2' }],
    });
  });

  it('all-joins multiple leaves', () => {
    const rows: DependsRow[] = [
      { taskId: 'a', mode: 'status', statuses: ['completed'] },
      { taskId: 'b', mode: 'accepted' },
    ];
    const result = buildClaimCondition(rows);
    expect(result?.op).toBe('all');
    expect(result && 'conditions' in result && result.conditions).toHaveLength(
      2,
    );
  });

  it('caps depth at 2', () => {
    expect(MAX_DEPENDS_DEPTH).toBe(2);
  });
});
