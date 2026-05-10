import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetTaskWorkflowsForTesting,
  initTaskWorkflows,
  setTaskWorkflowDeps,
  type TaskAttemptFinalEvent,
  type TaskProgressEvent,
  type TaskWorkflowDeps,
  taskWorkflows,
} from '../src/workflows/task-workflows.js';

vi.mock('@dbos-inc/dbos-sdk', () => {
  const events: Record<string, unknown> = {};
  return {
    DBOS: {
      registerStep: vi.fn(
        (fn: (...args: unknown[]) => unknown, _config: { name: string }) => fn,
      ),
      registerWorkflow: vi.fn(
        (fn: (...args: unknown[]) => unknown, _config: { name: string }) => fn,
      ),
      setEvent: vi.fn(async (key: string, value: unknown) => {
        events[key] = value;
      }),
      recv: vi.fn(),
      _events: events,
    },
  };
});

import { DBOS } from '@dbos-inc/dbos-sdk';

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const WORKFLOW_ID = `task:${TASK_ID}:1`;
const ATTEMPT_N = 1;
const LEASE_TTL_SEC = 300;

function makeDeps(overrides: Partial<TaskWorkflowDeps> = {}): TaskWorkflowDeps {
  // Minimal stub — the recv-loop test path only needs these to resolve.
  const runTransaction = vi.fn(async (fn: () => Promise<unknown>) => fn());
  return {
    dataSource: { runTransaction } as unknown as TaskWorkflowDeps['dataSource'],
    createAttempt: vi.fn().mockResolvedValue({ taskId: TASK_ID, attemptN: 1 }),
    updateAttempt: vi.fn().mockResolvedValue(null),
    updateTaskStatus: vi.fn().mockResolvedValue(null),
    updateTaskStatusIfNotIn: vi.fn().mockResolvedValue(null),
    removeClaimantTuple: vi.fn().mockResolvedValue(undefined),
    countAttempts: vi.fn().mockResolvedValue(1),
    getMaxAttempts: vi.fn().mockResolvedValue(1),
    findTaskById: vi
      .fn()
      .mockResolvedValue({ id: TASK_ID, status: 'running' } as never),
    ...overrides,
  };
}

describe('startAttemptWorkflow — timeout paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetTaskWorkflowsForTesting();
  });

  it('returns lease_expired when no progress event arrives after the first heartbeat', async () => {
    const deps = makeDeps();
    setTaskWorkflowDeps(deps);
    initTaskWorkflows();

    // First recv (dispatch phase) → 'started'.
    // Second recv (running phase) → null (timed out, lease window).
    const recvMock = vi.mocked(DBOS.recv);
    recvMock.mockReset();
    recvMock
      .mockResolvedValueOnce({
        kind: 'started',
        leaseTtlSec: LEASE_TTL_SEC,
      } as TaskProgressEvent)
      .mockResolvedValueOnce(null);

    const result: TaskAttemptFinalEvent =
      await taskWorkflows.startAttemptWorkflow(
        TASK_ID,
        ATTEMPT_N,
        AGENT_ID,
        WORKFLOW_ID,
        LEASE_TTL_SEC,
        null,
        null,
        // runningTimeoutSec well above the test's wall-clock — we want to
        // assert lease_expired, not running_total_exceeded.
        3600,
      );

    expect(result.status).toBe('timed_out');
    expect(result.timeoutReason).toBe('lease_expired');
    expect(result.taskId).toBe(TASK_ID);
    expect(result.attemptN).toBe(ATTEMPT_N);

    // Attempt was marked timed_out with the right error code.
    const updateAttempt = vi.mocked(deps.updateAttempt);
    const timedOutCall = updateAttempt.mock.calls.find(
      ([, , fields]) => fields.status === 'timed_out',
    );
    expect(timedOutCall).toBeDefined();
    const errorField = timedOutCall![2].error as { code: string } | null;
    expect(errorField?.code).toBe('lease_expired');

    // Claimant tuple removed.
    expect(deps.removeClaimantTuple).toHaveBeenCalledWith(TASK_ID, AGENT_ID);

    // Final event published.
    expect(DBOS.setEvent).toHaveBeenCalledWith(
      'result',
      expect.objectContaining({
        status: 'timed_out',
        timeoutReason: 'lease_expired',
      }),
    );
  });

  it('returns running_total_exceeded when total budget elapses before any further event', async () => {
    const deps = makeDeps();
    setTaskWorkflowDeps(deps);
    initTaskWorkflows();

    const baseTime = new Date('2026-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    try {
      const recvMock = vi.mocked(DBOS.recv);
      recvMock.mockReset();
      recvMock
        // Dispatch phase: 'started' arrives immediately at baseTime.
        // After this returns, the workflow records startedAtMs via
        // nowMsStep — also baseTime.
        .mockResolvedValueOnce({
          kind: 'started',
          leaseTtlSec: LEASE_TTL_SEC,
        } as TaskProgressEvent)
        // Running phase: jump the clock past startedAt + runningTimeoutSec
        // (10s) BEFORE returning null. The workflow's recv-null branch
        // then computes Date.now() >= totalDeadlineMs and must pick
        // running_total_exceeded over lease_expired.
        .mockImplementationOnce(async () => {
          vi.setSystemTime(new Date(baseTime.getTime() + 11_000));
          return null;
        });

      const result = await taskWorkflows.startAttemptWorkflow(
        TASK_ID,
        ATTEMPT_N,
        AGENT_ID,
        WORKFLOW_ID,
        LEASE_TTL_SEC,
        null,
        null,
        // runningTimeoutSec = 10s. totalDeadline = baseTime + 10s.
        // We advance to baseTime + 11s before recv returns null, so
        // the deadline check fires running_total_exceeded.
        10,
      );

      expect(result.status).toBe('timed_out');
      expect(result.timeoutReason).toBe('running_total_exceeded');

      const updateAttempt = vi.mocked(deps.updateAttempt);
      const timedOutCall = updateAttempt.mock.calls.find(
        ([, , fields]) => fields.status === 'timed_out',
      );
      expect(timedOutCall).toBeDefined();
      const errorField = timedOutCall![2].error as { code: string } | null;
      expect(errorField?.code).toBe('running_total_exceeded');
    } finally {
      vi.useRealTimers();
    }
  });
});
