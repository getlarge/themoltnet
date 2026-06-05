import { describe, expect, it } from 'vitest';

import { canContinueAttempt } from '../continue-eligibility.js';
import type { TaskAttemptSummary, TaskSummary } from '../types.js';

const NOW = new Date('2026-06-05T10:00:00.000Z');
const FUTURE = '2026-06-05T10:10:00.000Z';
const PAST = '2026-06-05T09:50:00.000Z';

function task(taskType: string): Pick<TaskSummary, 'taskType'> {
  return { taskType };
}

function attempt(
  status: TaskAttemptSummary['status'],
  slotResumableUntil: string | null = FUTURE,
  daemonStatePresent = true,
): Pick<TaskAttemptSummary, 'status' | 'daemonState'> {
  return {
    status,
    daemonState: daemonStatePresent
      ? { reportedAt: NOW.toISOString(), slotResumableUntil }
      : null,
  };
}

describe('canContinueAttempt', () => {
  it('eligible when freeform + completed + future slotResumableUntil', () => {
    const result = canContinueAttempt(
      task('freeform'),
      attempt('completed'),
      NOW,
    );

    expect(result.eligible).toBe(true);
    expect(result.resumableUntil?.toISOString()).toBe(FUTURE);
  });

  it('ineligible when task type is not freeform', () => {
    const result = canContinueAttempt(
      task('fulfill_brief'),
      attempt('completed'),
      NOW,
    );

    expect(result.eligible).toBe(false);
  });

  it('ineligible when attempt is not completed', () => {
    const result = canContinueAttempt(
      task('freeform'),
      attempt('running'),
      NOW,
    );

    expect(result.eligible).toBe(false);
  });

  it('ineligible when daemonState is missing', () => {
    const result = canContinueAttempt(
      task('freeform'),
      attempt('completed', null, false),
      NOW,
    );

    expect(result.eligible).toBe(false);
    expect(result.resumableUntil).toBeNull();
  });

  it('ineligible when slotResumableUntil is null', () => {
    const result = canContinueAttempt(
      task('freeform'),
      attempt('completed', null),
      NOW,
    );

    expect(result.eligible).toBe(false);
    expect(result.resumableUntil).toBeNull();
  });

  it('ineligible when slotResumableUntil is in the past', () => {
    const result = canContinueAttempt(
      task('freeform'),
      attempt('completed', PAST),
      NOW,
    );

    expect(result.eligible).toBe(false);
    expect(result.resumableUntil?.toISOString()).toBe(PAST);
  });
});
