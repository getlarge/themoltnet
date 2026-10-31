import { buildRubricSuccessCriteria } from '@themoltnet/sdk';
import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it, vi } from 'vitest';

import { prepareBrief } from './brief.js';
import { type DeliveryPort, runDelivery } from './delivery.js';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const executor = {
    profileId: id,
    maxAttempts: 1,
    dispatchTimeoutSec: 60,
    runningTimeoutSec: 600,
  };
  const brief = prepareBrief({
    workItem: { provider: 'example', repository: 'repo', key: '42' },
    policyDigest: 'policy',
    teamId: id,
    diaryId: id,
    correlationId: id,
    delivery: executor,
    assessment: executor,
    brief: {
      brief: 'Fix docs',
      successCriteria: buildRubricSuccessCriteria({
        rubricId: 'docs',
        criteria: [
          { id: 'example', description: 'Correct example', weight: 1 },
        ],
      }),
    },
  });
  const work = { taskId: 'task', attempt: 1, outputCid: 'cid' };
  const port: DeliveryPort = {
    admission: vi.fn().mockResolvedValue({
      workItem: brief.workItem,
      briefDigest: brief.digest,
      approvalEventId: 'approval',
    }),
    control: vi.fn().mockResolvedValue('active'),
    start: vi.fn().mockResolvedValue({ taskId: 'task' }),
    inspect: vi.fn().mockResolvedValue({ status: 'accepted', work }),
    cancel: vi.fn().mockResolvedValue(undefined),
    verifyChange: vi.fn().mockResolvedValue({
      base: 'base',
      head: 'delivered',
      briefDigest: brief.digest,
      policyDigest: brief.policyDigest,
    }),
    publish: vi.fn().mockResolvedValue(true),
  };
  return { input: { brief, timeoutSec: 5, pollIntervalSec: 1 }, port };
}
describe('independent durable delivery', () => {
  it('hands off accepted work and does not dispatch or publish again on replay', async () => {
    const { input, port } = fixture();
    const ctx = replayContext();
    const result = await runDelivery(input, port, ctx);
    expect(result.status).toBe('delivered');
    ctx.resetForReplay();
    expect(await runDelivery(input, port, ctx)).toEqual(result);
    expect(port.start).toHaveBeenCalledTimes(1);
    expect(port.publish).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch without approval for the prepared brief', async () => {
    const { input, port } = fixture();
    vi.mocked(port.admission).mockResolvedValue(undefined);
    expect(await runDelivery(input, port, replayContext())).toEqual({
      status: 'needs-human',
      reason: 'admission:required',
    });
    expect(port.start).not.toHaveBeenCalled();
  });
  it('cancels after pause even if a task reports completion', async () => {
    const { input, port } = fixture();
    vi.mocked(port.control).mockResolvedValue('paused');
    expect(await runDelivery(input, port, replayContext())).toMatchObject({
      status: 'paused',
    });
    expect(port.cancel).toHaveBeenCalledTimes(1);
    expect(port.verifyChange).not.toHaveBeenCalled();
  });
  it('stops on a failed task without a hidden semantic retry', async () => {
    const { input, port } = fixture();
    vi.mocked(port.inspect).mockResolvedValue({ status: 'failed' });
    expect(await runDelivery(input, port, replayContext())).toMatchObject({
      reason: 'delivery:failed',
    });
    expect(port.start).toHaveBeenCalledTimes(1);
  });
  it('does not hand off a draft that fails scope or revision verification', async () => {
    const { input, port } = fixture();
    vi.mocked(port.verifyChange).mockResolvedValue(undefined);
    expect(await runDelivery(input, port, replayContext())).toMatchObject({
      reason: 'delivery:invalid-change',
    });
    expect(port.publish).not.toHaveBeenCalled();
  });
  it('retains the original timeout when a pending gate is resumed', async () => {
    const { input, port } = fixture();
    vi.mocked(port.inspect).mockResolvedValue({ status: 'pending' });
    const ctx = replayContext();
    ctx.sleepFor = () => Promise.reject(new Error('worker interrupted'));
    await expect(runDelivery(input, port, ctx, () => 1000)).rejects.toThrow(
      'interrupted',
    );
    ctx.resetForReplay();
    expect(
      await runDelivery({ ...input, timeoutSec: 999 }, port, ctx, () => 7000),
    ).toMatchObject({ reason: 'delivery:timeout' });
    expect(port.cancel).toHaveBeenCalledTimes(1);
  });
});
