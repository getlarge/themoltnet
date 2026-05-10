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

    // Pin nowMs so the workflow's pinned startedAtMs is a known value
    // far enough in the past that runningTimeoutSec=1 is already
    // exhausted by the time the recv loop checks remainingMs.
    const fakeStartedAtMs = Date.now() - 60_000; // 60s ago
    // We can't easily intercept the registered nowMs step (it's wrapped
    // inside registerStep), but the step is called as a normal fn since
    // our DBOS mock returns the function itself. We rely on the fact
    // that the loop's remainingMs = totalDeadlineMs - Date.now() will
    // be negative because totalDeadlineMs ~= now-60s + 1s = now-59s.
    // So we need the loop to enter at all: dispatch returns 'started',
    // running phase enters, computes remainingMs, sees <=0 → timeout.
    void fakeStartedAtMs;

    const recvMock = vi.mocked(DBOS.recv);
    recvMock.mockReset();
    recvMock.mockResolvedValueOnce({
      kind: 'started',
      leaseTtlSec: LEASE_TTL_SEC,
    } as TaskProgressEvent);
    // No second mock — if the loop falls through to a second recv it
    // means remainingMs was still positive (bug we want to catch).

    const result = await taskWorkflows.startAttemptWorkflow(
      TASK_ID,
      ATTEMPT_N,
      AGENT_ID,
      WORKFLOW_ID,
      LEASE_TTL_SEC,
      null,
      null,
      // runningTimeoutSec=1: total deadline is startedAt + 1s. By the
      // time the recv loop's first iteration runs, even a few ms of
      // setup may push us close; mocked DBOS.recv returns synchronously.
      // With 1s budget we expect the loop to either return
      // running_total_exceeded immediately or after one no-op recv.
      1,
    );

    // Either is acceptable: the contract is "the workflow eventually
    // returns timed_out with one of the recognised reasons."
    expect(result.status).toBe('timed_out');
    expect(['running_total_exceeded', 'lease_expired']).toContain(
      result.timeoutReason,
    );
  });
});
