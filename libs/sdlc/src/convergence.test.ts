import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import type { ConvergenceInput, Revision } from './contracts.js';
import {
  type ConvergencePort,
  type RepairReceipt,
  runConvergence,
} from './convergence.js';

const policy = {
  maxRepairRounds: 2,
  pollIntervalSec: 1,
  evidenceTimeoutSec: 5,
  repairTimeoutSec: 5,
};
function fixture() {
  const revision: Revision = {
    base: 'base',
    head: 'head',
    policyDigest: 'policy',
    briefDigest: 'brief',
  };
  const observation: Omit<
    ConvergenceInput,
    'repairRounds' | 'maxRepairRounds'
  > = {
    current: revision,
    control: 'active',
    assessment: { revision, status: 'passed' },
    checks: {},
    requiredChecks: [],
    requiredLanes: ['correctness'],
    auditLanes: [],
    unresolvedHumanThreads: 0,
    reviews: {
      correctness: {
        revision,
        status: 'passed',
        findings: [{ id: 'defect', origin: 'introduced', disposition: 'open' }],
      },
    },
  };
  const receipts = new Map<string, RepairReceipt>();
  const publications = new Map<
    string,
    Parameters<ConvergencePort['publish']>[0]
  >();
  const cancelled: string[] = [];
  const port: ConvergencePort = {
    observe: () => Promise.resolve(structuredClone(observation)),
    startRepair: (args) => {
      const existing = receipts.get(args.key);
      if (existing) return Promise.resolve(existing);
      const receipt = { taskId: `repair-${receipts.size + 1}` };
      receipts.set(args.key, receipt);
      return Promise.resolve(receipt);
    },
    repairState: () => {
      observation.reviews['correctness'].findings = [
        {
          id: 'defect',
          origin: 'introduced',
          disposition: 'fixed',
          verification: {
            revision: observation.current,
            evidence: 'independent-verification',
          },
        },
      ];
      return Promise.resolve('accepted');
    },
    cancelRepair: (receipt) => {
      cancelled.push(receipt.taskId);
      return Promise.resolve();
    },
    publish: (args) => {
      publications.set(args.key, args);
      return Promise.resolve(true);
    },
  };
  return { port, observation, receipts, publications, cancelled };
}

describe('durable convergence', () => {
  it('repairs then independently observes readiness and replays without new effects', async () => {
    const { port, receipts, publications } = fixture();
    const ctx = replayContext('case-1');
    const result = await runConvergence(policy, port, ctx);
    expect(result.verdict.status).toBe('ready');
    expect(result.repairs).toEqual([{ taskId: 'repair-1' }]);
    expect(result.findings).toEqual([
      {
        id: 'defect',
        origin: 'introduced',
        disposition: 'fixed',
        verification: {
          revision: result.revision,
          evidence: 'independent-verification',
        },
      },
    ]);
    expect([...publications.values()][0]).not.toHaveProperty('findings');
    ctx.resetForReplay();
    expect(await runConvergence(policy, port, ctx)).toEqual(result);
    expect(receipts.size).toBe(1);
    expect(publications.size).toBe(1);
  });
  it('retains unresolved findings that vanish after repair and across replay', async () => {
    const { port, observation, receipts } = fixture();
    port.repairState = () => {
      observation.reviews.correctness.findings = [];
      return Promise.resolve('accepted');
    };
    const ctx = replayContext('omitted-finding');
    const result = await runConvergence(policy, port, ctx);
    expect(result.verdict).toEqual({
      status: 'needs-human',
      reasons: ['finding:defect'],
    });
    expect(result.findings).toEqual([
      { id: 'defect', origin: 'introduced', disposition: 'open' },
    ]);
    expect(receipts.size).toBe(2);
    ctx.resetForReplay();
    expect(await runConvergence(policy, port, ctx)).toEqual(result);
  });
  it('recovers a task created before the creation checkpoint was persisted', async () => {
    const { port, receipts } = fixture();
    const create = port.startRepair.bind(port);
    let lost = false;
    port.startRepair = async (args) => {
      const receipt = await create(args);
      if (!lost) {
        lost = true;
        throw new Error('lost acknowledgement');
      }
      return receipt;
    };
    const ctx = replayContext('case-2');
    await expect(runConvergence(policy, port, ctx)).rejects.toThrow(
      'lost acknowledgement',
    );
    ctx.resetForReplay();
    expect((await runConvergence(policy, port, ctx)).verdict.status).toBe(
      'ready',
    );
    expect(receipts.size).toBe(1);
  });
  it('does not reset the persisted repair budget when resumed with different settings', async () => {
    const { port, receipts } = fixture();
    port.repairState = () => Promise.resolve('accepted');
    const publish = port.publish.bind(port);
    port.publish = () => Promise.reject(new Error('publisher unavailable'));
    const ctx = replayContext('case-3');
    await expect(runConvergence(policy, port, ctx)).rejects.toThrow(
      'publisher unavailable',
    );
    expect(receipts.size).toBe(2);
    port.publish = publish;
    ctx.resetForReplay();
    const result = await runConvergence(
      { ...policy, maxRepairRounds: 20 },
      port,
      ctx,
    );
    expect(result.verdict.status).toBe('needs-human');
    expect(result.findings).toEqual([
      { id: 'defect', origin: 'introduced', disposition: 'open' },
    ]);
    expect(receipts.size).toBe(2);
  });
  it('preserves the evidence deadline across a worker interruption', async () => {
    const { port, observation, receipts } = fixture();
    observation.assessment = undefined;
    let time = 0;
    const ctx = replayContext('case-4');
    ctx.sleepFor = () => Promise.reject(new Error('worker interrupted'));
    await expect(runConvergence(policy, port, ctx, () => time)).rejects.toThrow(
      'worker interrupted',
    );
    time = 6000;
    ctx.resetForReplay();
    const result = await runConvergence(policy, port, ctx, () => time);
    expect(result.verdict.status).toBe('needs-human');
    expect(result.verdict.reasons).toContain('evidence:timeout');
    expect(receipts.size).toBe(0);
  });
  it('retains findings observed while waiting across a worker restart', async () => {
    const { port, observation } = fixture();
    observation.assessment = undefined;
    const ctx = replayContext('pending-finding');
    ctx.sleepFor = () => Promise.reject(new Error('worker interrupted'));
    await expect(runConvergence(policy, port, ctx)).rejects.toThrow(
      'worker interrupted',
    );
    observation.assessment = {
      revision: observation.current,
      status: 'passed',
    };
    observation.reviews.correctness.findings = [];
    ctx.resetForReplay();
    const result = await runConvergence(
      { ...policy, maxRepairRounds: 0 },
      port,
      ctx,
    );
    // The original persisted repair budget still applies; seeing a repair here
    // proves the pre-restart finding survived despite its omission from the report.
    expect(result.repairs).toHaveLength(1);
    expect(result.verdict.status).toBe('ready');
  });
  it('cancels pending repair on pause before publishing the stopped state', async () => {
    const { port, observation, cancelled } = fixture();
    const create = port.startRepair.bind(port);
    port.startRepair = async (args) => {
      const receipt = await create(args);
      observation.control = 'paused';
      return receipt;
    };
    port.repairState = () => Promise.resolve('pending');
    const result = await runConvergence(policy, port, replayContext('case-5'));
    expect(result.verdict.status).toBe('paused');
    expect(cancelled).toEqual(['repair-1']);
  });
  it('exposes a superseded publication instead of claiming the verdict is current', async () => {
    const { port, observation } = fixture();
    observation.reviews['correctness'].findings = [];
    port.publish = () => Promise.resolve(false);
    expect(
      (await runConvergence(policy, port, replayContext('case-6'))).published,
    ).toBe(false);
  });
  it('does not blindly retry semantic repair failures', async () => {
    const { port, receipts } = fixture();
    port.repairState = () => Promise.resolve('failed');
    const result = await runConvergence(policy, port, replayContext('case-7'));
    expect(result.verdict).toEqual({
      status: 'needs-human',
      reasons: ['repair:failed'],
    });
    expect(receipts.size).toBe(1);
  });
});

it('cancels repair when the approved brief changes while work is running', async () => {
  const { port, observation, cancelled } = fixture();
  const create = port.startRepair.bind(port);
  port.startRepair = async (args) => {
    const receipt = await create(args);
    observation.current = { ...observation.current, briefDigest: 'edited' };
    return receipt;
  };
  port.repairState = () => Promise.resolve('pending');
  const result = await runConvergence(
    policy,
    port,
    replayContext('changed-brief'),
  );
  expect(result.verdict).toEqual({
    status: 'needs-human',
    reasons: ['repair:superseded'],
  });
  expect(cancelled).toEqual(['repair-1']);
});
