/**
 * Synthetic experiment: execute the hand-authored reference plan against
 * FAKES (in-memory task service, decision store) on the tasks-orchestrator
 * `replayContext`, which simulates Absurd's checkpoint store including
 * repeat-name suffixes and replay after an interruption.
 */
import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import { citationsResolve } from '../testing/domain-checks.js';
import { FakeDecisionStore } from '../testing/fake-decision-store.js';
import {
  FakeTaskService,
  type SimulatedAgent,
} from '../testing/fake-task-service.js';
import { referencePlan } from '../testing/reference-plan.js';
import { executePlan, PlanMismatchError } from './execute-plan.js';
import type { PlanExecutorDeps } from './types.js';

const FINDINGS_A = {
  set: 'A',
  findings: [{ claim: 'Afternoon rise', cites: ['A1'] }],
};
const FINDINGS_B = {
  set: 'B',
  findings: [{ claim: 'Warm-up after restart', cites: ['B1', 'B2'] }],
};
const SYNTHESIS = {
  statements: [{ text: 'Rise is not restart-related', cites: ['A1', 'B3'] }],
};
const SUMMARY = { summary: 'ok', basedOnSynthesisRevision: 1 };

function nodeOf(brief: string): string {
  const m = brief.match(
    /^(Read evidence set A|Read evidence set B|Merge both|Write a short summary|Repair the prior)/,
  );
  if (!m) return 'unknown';
  return {
    'Read evidence set A': 'process-a',
    'Read evidence set B': 'process-b',
    'Merge both': 'synthesize',
    'Write a short summary': 'final-summary',
    'Repair the prior': 'repair',
  }[m[1]] as string;
}

const happyAgent: SimulatedAgent = (_task, { brief }) => {
  switch (nodeOf(brief)) {
    case 'process-a':
      return { kind: 'complete', output: FINDINGS_A };
    case 'process-b':
      return { kind: 'complete', output: FINDINGS_B };
    case 'synthesize':
      return { kind: 'complete', output: SYNTHESIS };
    case 'final-summary':
      return { kind: 'complete', output: SUMMARY };
    default:
      return { kind: 'fail', error: `unexpected brief: ${brief.slice(0, 40)}` };
  }
};

function makeDeps(
  agent: SimulatedAgent,
  extra: Partial<PlanExecutorDeps> = {},
) {
  const tasks = new FakeTaskService(agent);
  const decisions = new FakeDecisionStore();
  const deps: PlanExecutorDeps = {
    tasks,
    decisions,
    domainChecks: { 'citations-resolve': citationsResolve },
    pollIntervalSec: 1,
    ...extra,
  };
  return { tasks, decisions, deps };
}

describe('executePlan on the reference plan (fakes + replayContext)', () => {
  it('runs independent tasks concurrently, binds both outputs into the join, gates on approval and completes', async () => {
    // Arrange
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'approve');
    const ctx = replayContext('exec-happy');
    // Act
    const result = await executePlan(referencePlan(), ctx, deps);
    // Assert — outcome
    expect(result.status).toBe('completed');
    expect(result.tasksCreated).toBe(4);
    expect(
      Object.values(result.nodes).map((n) => `${n.node}:${n.status}`),
    ).toEqual([
      'process-a:accepted',
      'process-b:accepted',
      'synthesize:accepted',
      'owner-decision:decided',
      'final-summary:accepted',
    ]);
    // Independent progress: process-b was created and claimed before process-a completed.
    const seqOf = (kind: string, title: string) =>
      tasks.events.find((e) => e.kind === kind && e.title === title)?.seq ??
      Infinity;
    expect(seqOf('created', 'Process evidence set B')).toBeLessThan(
      seqOf('completed', 'Process evidence set A'),
    );
    expect(seqOf('claimed', 'Process evidence set B')).toBeLessThan(
      seqOf('completed', 'Process evidence set A'),
    );
    // Join received the exact accepted output revisions of both predecessors.
    const synthTask = tasks.tasks.find(
      (t) => t.title === 'Synthesize findings from both sets',
    );
    const a = result.nodes['process-a'].accepted;
    const b = result.nodes['process-b'].accepted;
    expect(synthTask?.references).toEqual(
      expect.arrayContaining([
        { taskId: a?.taskId, outputCid: a?.outputCid, role: 'context' },
        { taskId: b?.taskId, outputCid: b?.outputCid, role: 'context' },
      ]),
    );
    expect(a?.outputCid).toMatch(/^bafy-/);
    // The decision was recorded against the exact synthesis revision.
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].reviewed).toEqual({
      node: 'synthesize',
      runN: 1,
      taskId: result.nodes['synthesize'].accepted?.taskId,
      attemptN: 1,
      outputCid: result.nodes['synthesize'].accepted?.outputCid,
    });
    // Downstream was created only after the decision existed.
    const decidedAt = decisions.reads.findIndex((r) => r.found);
    expect(decidedAt).toBeGreaterThanOrEqual(0);
    const summaryCreated = tasks.events.find(
      (e) =>
        e.kind === 'created' && e.title?.startsWith('Write the final summary'),
    );
    const synthCompleted = tasks.events.find(
      (e) =>
        e.kind === 'completed' &&
        e.title === 'Synthesize findings from both sets',
    );
    expect(summaryCreated?.seq).toBeGreaterThan(
      synthCompleted?.seq ?? Infinity,
    );
    // Stable idempotency keys were forwarded to every create.
    expect(
      tasks.events
        .filter((e) => e.kind === 'created')
        .every((e) => e.detail?.startsWith('absurd:')),
    ).toBe(true);
    // Every create is a durable checkpoint.
    expect(ctx.checkpointNames).toEqual(
      expect.arrayContaining([
        'plan.accepted',
        'node.process-a.r1.create',
        'node.process-b.r1.create',
        'node.synthesize.r1.create',
        'node.final-summary.r1.create',
      ]),
    );
  });

  it('rejection blocks downstream execution: no summary task is ever created', async () => {
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'reject');
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-reject'),
      deps,
    );
    expect(result.status).toBe('rejected');
    expect(result.tasksCreated).toBe(3);
    expect(result.nodes['final-summary'].status).toBe('skipped_by_decision');
    expect(
      tasks.tasks.some((t) => t.title?.startsWith('Write the final summary')),
    ).toBe(false);
  });

  it('a revision request re-runs only the reviewed node and its descendants; the summary binds the new revision', async () => {
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', (reviewed) =>
      reviewed.runN === 1 ? 'request_revision' : 'approve',
    );
    const ctx = replayContext('exec-revise');
    const result = await executePlan(referencePlan(), ctx, deps);
    expect(result.status).toBe('completed');
    // The revision checkpoint names are distinct per run, so replay cannot confuse them.
    expect(ctx.checkpointNames).toEqual(
      expect.arrayContaining([
        'node.synthesize.r1.create',
        'node.synthesize.r2.create',
      ]),
    );
    // 2 evidence tasks + 2 synthesis runs + 1 summary
    expect(result.tasksCreated).toBe(5);
    expect(result.nodes['process-a'].taskIds).toHaveLength(1);
    expect(result.nodes['process-b'].taskIds).toHaveLength(1);
    expect(result.nodes['synthesize'].taskIds).toHaveLength(2);
    expect(result.nodes['synthesize'].runN).toBe(2);
    expect(result.decisions.map((d) => [d.option, d.reviewed.runN])).toEqual([
      ['request_revision', 1],
      ['approve', 2],
    ]);
    const summaryTask = tasks.tasks.find((t) =>
      t.title?.startsWith('Write the final summary'),
    );
    const secondSynthesis = result.nodes['synthesize'].accepted;
    expect(summaryTask?.references).toEqual([
      {
        taskId: secondSynthesis?.taskId,
        outputCid: secondSynthesis?.outputCid,
        role: 'context',
      },
    ]);
    expect(secondSynthesis?.taskId).toBe(result.nodes['synthesize'].taskIds[1]);
  });

  it('exhausts the revision budget into a visible blocked state', async () => {
    const { decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'request_revision');
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-revise-exhaust'),
      deps,
    );
    expect(result.status).toBe('blocked');
    expect(result.nodes['owner-decision'].status).toBe('blocked');
    expect(result.nodes['owner-decision'].reason).toContain('maxRevisions');
    expect(result.nodes['synthesize'].taskIds).toHaveLength(3); // run 1 + 2 revisions
    expect(result.nodes['final-summary'].status).toBe('blocked');
  });

  it('repairs an accepted-but-invalid output through a bounded continuation chain', async () => {
    let aCalls = 0;
    const agent: SimulatedAgent = (task, info) => {
      if (nodeOf(info.brief) === 'process-a') {
        aCalls += 1;
        // First attempt cites an unknown evidence id; structurally valid.
        return {
          kind: 'complete',
          output: { set: 'A', findings: [{ claim: 'bad', cites: ['A9'] }] },
        };
      }
      if (nodeOf(info.brief) === 'repair') {
        expect(info.brief).toContain("references unknown evidence id 'A9'");
        return { kind: 'complete', output: FINDINGS_A };
      }
      return happyAgent(task, info);
    };
    const { tasks, decisions, deps } = makeDeps(agent);
    decisions.script('owner-decision', () => 'approve');
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-repair'),
      deps,
    );
    expect(result.status).toBe('completed');
    expect(aCalls).toBe(1);
    expect(result.tasksCreated).toBe(5);
    expect(result.nodes['process-a'].taskIds).toHaveLength(2);
    const repair = tasks.tasks.find((t) =>
      t.title?.startsWith('Repair: Process evidence set A'),
    );
    const original = result.nodes['process-a'].taskIds[0];
    expect((repair?.input as { continueFrom: unknown }).continueFrom).toEqual({
      taskId: original,
      attemptN: 1,
      mode: 'extend',
    });
    // The original task keeps its completed status (semantic invalidity is not a task failure).
    expect(tasks.tasks.find((t) => t.id === original)?.status).toBe(
      'completed',
    );
    // The join bound the repaired revision, not the invalid one.
    const synth = tasks.tasks.find(
      (t) => t.title === 'Synthesize findings from both sets',
    );
    expect(synth?.references).toEqual(
      expect.arrayContaining([
        {
          taskId: repair?.id,
          outputCid: result.nodes['process-a'].accepted?.outputCid,
          role: 'context',
        },
      ]),
    );
  });

  it('stops in a visible blocked state when the repair budget is exhausted', async () => {
    const agent: SimulatedAgent = (task, info) =>
      nodeOf(info.brief) === 'process-a' || nodeOf(info.brief) === 'repair'
        ? {
            kind: 'complete',
            output: { set: 'A', findings: [{ claim: 'bad', cites: ['A9'] }] },
          }
        : happyAgent(task, info);
    const { deps } = makeDeps(agent);
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-repair-exhaust'),
      deps,
    );
    expect(result.status).toBe('blocked');
    expect(result.nodes['process-a'].status).toBe('invalid_output');
    expect(result.nodes['process-a'].taskIds).toHaveLength(3); // original + 2 repairs
    expect(result.nodes['synthesize'].status).toBe('blocked');
    expect(result.nodes['final-summary'].status).toBe('blocked');
    expect(result.reason).toContain('repair budget exhausted');
  });

  it('surfaces an execution failure with its reason and blocks dependants', async () => {
    const agent: SimulatedAgent = (task, info) =>
      nodeOf(info.brief) === 'process-b'
        ? { kind: 'fail', error: 'sandbox exploded' }
        : happyAgent(task, info);
    const { deps } = makeDeps(agent);
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-fail'),
      deps,
    );
    expect(result.status).toBe('blocked');
    expect(result.nodes['process-b'].status).toBe('failed');
    expect(result.nodes['process-b'].reason).toContain('failed');
    expect(result.nodes['synthesize'].status).toBe('blocked');
  });
});

class SimulatedCrash extends Error {
  constructor(readonly where: string) {
    super(`simulated crash at ${where}`);
  }
}

describe('interruption and recovery (replayContext simulating Absurd checkpoints)', () => {
  it('crash after task creation: restart creates no duplicate tasks and completes', async () => {
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'approve');
    let crashed = false;
    deps.hooks = {
      afterTaskCreate: ({ node }) => {
        if (node === 'process-b' && !crashed) {
          crashed = true;
          throw new SimulatedCrash('after process-b create');
        }
      },
    };
    const ctx = replayContext('exec-crash-create');
    await expect(executePlan(referencePlan(), ctx, deps)).rejects.toThrow(
      'simulated crash',
    );
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(2);
    // Restart the orchestrator against the same durable checkpoints and the same task service.
    ctx.resetForReplay();
    const result = await executePlan(referencePlan(), ctx, deps);
    expect(result.status).toBe('completed');
    const created = tasks.events.filter((e) => e.kind === 'created');
    expect(created).toHaveLength(4);
    expect(tasks.events.filter((e) => e.kind === 'conflict')).toHaveLength(0);
    // The two pre-crash tasks were reused from checkpoints, not recreated.
    expect(result.nodes['process-a'].taskIds).toEqual([created[0].taskId]);
    expect(result.nodes['process-b'].taskIds).toEqual([created[1].taskId]);
  });

  it('crash in the create gap (task created, checkpoint not persisted): idempotency key returns the same task', async () => {
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'approve');
    const ctx = replayContext('exec-crash-gap');
    // Wrap completeStep to drop the checkpoint for the first create exactly once.
    const originalComplete = ctx.completeStep.bind(ctx);
    let dropped = false;
    ctx.completeStep = (handle, value) => {
      if (handle.name === 'node.process-a.r1.create' && !dropped) {
        dropped = true;
        throw new SimulatedCrash('create gap');
      }
      return originalComplete(handle, value);
    };
    await expect(executePlan(referencePlan(), ctx, deps)).rejects.toThrow(
      'create gap',
    );
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(1);
    ctx.resetForReplay();
    const result = await executePlan(referencePlan(), ctx, deps);
    expect(result.status).toBe('completed');
    expect(
      tasks.events.filter((e) => e.kind === 'idempotent_hit'),
    ).toHaveLength(1);
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(4);
  });

  it('crash while waiting for the human decision: the decision is not lost and nothing reruns', async () => {
    const { tasks, decisions, deps } = makeDeps(happyAgent);
    let polls = 0;
    deps.hooks = {
      beforeGatePoll: () => {
        polls += 1;
        if (polls === 2) throw new SimulatedCrash('during gate wait');
      },
    };
    const ctx = replayContext('exec-crash-wait');
    await expect(executePlan(referencePlan(), ctx, deps)).rejects.toThrow(
      'during gate wait',
    );
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(3);
    expect(
      tasks.tasks.some((t) => t.title?.startsWith('Write the final summary')),
    ).toBe(false);
    // While the orchestrator is down, the reviewer records a decision against the exact revision.
    const reviewed = decisions.reads[0].reviewed;
    decisions.record({
      planId: 'evidence-synthesis-reference',
      planRevision: 1,
      gate: 'owner-decision',
      reviewed,
      option: 'approve',
      decidedBy: 'human:process-owner',
      decidedAt: new Date().toISOString(),
    });
    ctx.resetForReplay();
    const result = await executePlan(referencePlan(), ctx, deps);
    expect(result.status).toBe('completed');
    expect(result.decisions[0].decidedBy).toBe('human:process-owner');
    expect(result.decisions[0].reviewed).toEqual(reviewed);
    // No rerun of any upstream node, exactly one new task (the summary).
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(4);
    expect(result.nodes['synthesize'].taskIds).toHaveLength(1);
    // Replay after recovery reuses the decision checkpoint instead of re-reading the store.
    const readsAfter = decisions.reads.length;
    ctx.resetForReplay();
    const replayed = await executePlan(referencePlan(), ctx, deps);
    expect(replayed.status).toBe('completed');
    expect(decisions.reads.length).toBe(readsAfter);
    expect(tasks.events.filter((e) => e.kind === 'created')).toHaveLength(4);
  });

  it('a stale decision for an older output revision is ignored', async () => {
    const { decisions, deps } = makeDeps(happyAgent);
    let asks = 0;
    decisions.script('owner-decision', (reviewed) => {
      asks += 1;
      if (asks === 1) return 'request_revision';
      // Approve only the second revision; a lingering approval for run 1 must not count.
      return reviewed.runN === 2 ? 'approve' : null;
    });
    decisions.record({
      planId: 'evidence-synthesis-reference',
      planRevision: 1,
      gate: 'owner-decision',
      reviewed: {
        node: 'synthesize',
        runN: 1,
        taskId: 'stale-task',
        attemptN: 1,
        outputCid: 'stale',
      },
      option: 'approve',
      decidedBy: 'human:stale',
      decidedAt: new Date().toISOString(),
    });
    const result = await executePlan(
      referencePlan(),
      replayContext('exec-stale'),
      deps,
    );
    expect(result.status).toBe('completed');
    expect(result.decisions.map((d) => d.decidedBy)).toEqual([
      'scripted-reviewer',
      'scripted-reviewer',
    ]);
  });

  it('recovery with a different plan fails closed instead of silently regenerating the workflow', async () => {
    const { decisions, deps } = makeDeps(happyAgent);
    decisions.script('owner-decision', () => 'approve');
    const ctx = replayContext('exec-mismatch');
    deps.hooks = {
      afterTaskCreate: ({ node }) => {
        if (node === 'process-a' && ctx.checkpointNames.length < 4)
          throw new SimulatedCrash('early');
      },
    };
    await expect(executePlan(referencePlan(), ctx, deps)).rejects.toThrow(
      'early',
    );
    deps.hooks = {};
    ctx.resetForReplay();
    const changed = referencePlan();
    changed.title = 'A different plan';
    await expect(executePlan(changed, ctx, deps)).rejects.toThrow(
      PlanMismatchError,
    );
  });
});
