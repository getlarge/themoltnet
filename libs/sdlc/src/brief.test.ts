import { buildRubricSuccessCriteria } from '@themoltnet/sdk';
import type { SdkTask, SdkTaskAttempt } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

import { assessmentRequest, deliveryRequest, prepareBrief } from './brief.js';

const id = '11111111-1111-4111-8111-111111111111';
const policy = {
  profileId: id,
  maxAttempts: 1,
  dispatchTimeoutSec: 60,
  runningTimeoutSec: 600,
};
function fixture() {
  const input = {
    workItem: { provider: 'example', repository: 'portable/repo', key: '42' },
    policyDigest: 'policy',
    teamId: id,
    diaryId: id,
    correlationId: id,
    delivery: policy,
    assessment: policy,
    brief: {
      brief: 'Document the accepted behavior.',
      successCriteria: buildRubricSuccessCriteria({
        rubricId: 'sdlc-criteria',
        criteria: [
          {
            id: 'document-behavior',
            description: 'The documented example matches the tested behavior.',
            weight: 1,
          },
        ],
      }),
    },
  };
  const prepared = prepareBrief(input);
  const task = {
    id,
    teamId: id,
    diaryId: id,
    status: 'completed',
    taskType: 'fulfill_brief',
    input: prepared.delivery.body.input,
    acceptedAttemptN: 1,
  } as SdkTask;
  const attempt: SdkTaskAttempt = {
    taskId: id,
    attemptN: 1,
    status: 'completed',
    output: { summary: 'Documented' },
    outputCid: 'bafkreifakefixture',
    claimedAt: '2026-10-29T00:00:00Z',
    claimedByAgentId: id,
    claimedExecutorFingerprint: null,
    claimedExecutorManifest: null,
    completedAt: '2026-10-29T00:01:00Z',
    completedExecutorFingerprint: null,
    completedExecutorManifest: null,
    contentSignature: null,
    daemonState: null,
    error: null,
    leaseId: null,
    policySnapshotHash: null,
    runtimeId: null,
    runtimeProfileId: null,
    runtimeProfileRevision: null,
    signedAt: null,
    startedAt: null,
    usage: null,
  };
  return { input, prepared, task, attempt };
}

describe('approved brief handoff', () => {
  it('passes the exact approved rubric to the independent assessor', () => {
    const { input, prepared, task, attempt } = fixture();
    const request = assessmentRequest(prepared, task, attempt);
    expect(request.body.input).toEqual({
      targetTaskId: id,
      successCriteria: input.brief.successCriteria,
    });
    expect(request.body.references).toEqual([
      { taskId: id, role: 'judged_work', outputCid: attempt.outputCid },
    ]);
    expect(request.body.allowedProfiles).toEqual([{ profileId: id }]);
  });
  it('does not let mutations to source policy or returned requests change the prepared brief', () => {
    const { input, prepared } = fixture();
    input.brief.brief = 'Different work';
    const first = deliveryRequest(prepared);
    first.body.input['brief'] = 'Another task';
    expect(deliveryRequest(prepared).body.input['brief']).toBe(
      'Document the accepted behavior.',
    );
  });
  it('refuses edited criteria after approval', () => {
    const { prepared } = fixture();
    prepared.delivery.body.input['brief'] = 'Changed';
    expect(() => deliveryRequest(prepared)).toThrow('digest mismatch');
  });
  it('refuses accepted work produced against a different brief', () => {
    const { prepared, task, attempt } = fixture();
    task.input = { brief: 'Different work' };
    expect(() => assessmentRequest(prepared, task, attempt)).toThrow(
      'approved brief',
    );
  });
  it('refuses an unaccepted attempt even when it completed', () => {
    const { prepared, task, attempt } = fixture();
    task.acceptedAttemptN = 2;
    expect(() => assessmentRequest(prepared, task, attempt)).toThrow(
      'accepted work',
    );
  });
  it('requires explicit rubric criteria and bounded executor policies', () => {
    const { input } = fixture();
    expect(() =>
      prepareBrief({ ...input, brief: { brief: 'No criteria' } }),
    ).toThrow('explicit assessment rubric');
    expect(() =>
      prepareBrief({ ...input, delivery: { ...policy, maxAttempts: 0 } }),
    ).toThrow('executor limits');
  });
});
