import type { TaskAttempt as DbTaskAttempt } from '@moltnet/database';
import { describe, expect, it } from 'vitest';

import { dbAttemptToWire } from './wire-mappers.js';

/**
 * Round-trip coverage for `daemonState` (#1287).
 *
 * The /complete handler threads `daemonState` through:
 *   REST body → service.complete() → DBOS.send progress event →
 *   workflow persistTerminalResult → repository.updateAttempt →
 *   task_attempts.daemon_state JSONB column.
 *
 * The read path then maps back to the wire shape via `dbAttemptToWire`.
 * These tests pin the read-side of that round-trip — the write-side is
 * enforced statically by the `TaskAttempt['daemonState']` field appearing
 * in the workflow `updateAttempt` Deps type and the repository's
 * `updateAttempt` accepted-fields union.
 */

function baseRow(): DbTaskAttempt & {
  claimedExecutorManifest?: unknown;
  completedExecutorManifest?: unknown;
  daemonState?: unknown;
} {
  return {
    taskId: '11111111-1111-1111-1111-111111111111',
    attemptN: 1,
    claimedByAgentId: 'a0000000-0000-0000-0000-000000000001',
    runtimeId: null,
    workflowId: 'wf-1',
    claimedAt: new Date('2026-05-11T00:00:00Z'),
    startedAt: new Date('2026-05-11T00:00:30Z'),
    completedAt: new Date('2026-05-11T00:01:00Z'),
    status: 'completed',
    output: { foo: 'bar' },
    outputCid: 'bafy-out',
    claimedExecutorFingerprint: null,
    completedExecutorFingerprint: null,
    error: null,
    usage: null,
    contentSignature: null,
    signedAt: null,
    daemonState: null,
  } as unknown as DbTaskAttempt;
}

describe('dbAttemptToWire — daemonState round-trip (#1287)', () => {
  it('passes a populated daemonState payload through to the wire shape', () => {
    const daemonState = {
      slotResumableUntil: '2026-05-11T01:00:00Z',
      reportedAt: '2026-05-11T00:01:00Z',
    };
    const row = { ...baseRow(), daemonState };

    const wire = dbAttemptToWire(row);

    expect(wire.daemonState).toEqual(daemonState);
  });

  it('coerces a null daemonState column into wire null (older daemons)', () => {
    const row = { ...baseRow(), daemonState: null };

    const wire = dbAttemptToWire(row);

    expect(wire.daemonState).toBeNull();
  });

  it('coerces an undefined daemonState property into wire null', () => {
    const row = baseRow();
    delete (row as { daemonState?: unknown }).daemonState;

    const wire = dbAttemptToWire(row);

    expect(wire.daemonState).toBeNull();
  });
});
