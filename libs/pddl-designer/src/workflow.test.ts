import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import {
  type FakeTaskOutput,
  FakeTasks,
} from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import type { Domain, Problem } from './ir.js';
import type { DesignInput } from './stages.js';
import {
  blocksActions,
  blocksPredicates,
  blocksProblemResult,
  blocksTypes,
} from './test-fixtures.js';
import { runPddlDesign } from './workflow.js';

const input: DesignInput = {
  description: 'Blocks can be stacked by a robotic arm.',
  problemDescription: 'Build a tower a on b on c.',
  domainName: 'blocks-world',
  problemName: 'tower-abc',
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'corr',
  profileId: 'profile',
};

const ok = (result: unknown): FakeTaskOutput => ({ summary: 'done', result });

const HAPPY: Record<string, FakeTaskOutput> = {
  types: ok(blocksTypes),
  predicates: ok(blocksPredicates),
  actions: ok({ actions: blocksActions }),
  refine: ok({ actions: blocksActions, changes: [] }),
  problem: ok(blocksProblemResult),
};

const stageOf = (tags: string[] | undefined) =>
  tags?.find((t) => t.startsWith('stage:'))?.slice(6) ?? '';

/** Serve outputs per stage; a list is consumed one attempt at a time. */
function fakeTasks(overrides: Record<string, FakeTaskOutput[]> = {}) {
  return new FakeTasks((body) => {
    const stage = stageOf(body.tags);
    const queue = overrides[stage];
    return queue?.length ? (queue.shift() as FakeTaskOutput) : HAPPY[stage];
  });
}

describe('runPddlDesign', () => {
  it('runs five stages, renders PDDL and finds a plan', async () => {
    // Arrange
    const tasks = fakeTasks();

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('planned');
    expect(run.stages.map((s) => s.stage)).toEqual([
      'types',
      'predicates',
      'actions',
      'refine',
      'problem',
    ]);
    expect(run.domainPddl).toContain('(define (domain blocks-world)');
    expect(run.problemPddl).toContain(
      '(:goal (and (on-block a b) (on-block b c)))',
    );
    expect(run.plan).toMatchObject({ status: 'found' });
    expect(run.plan?.status === 'found' && run.plan.steps).toHaveLength(4);
    expect(tasks.creationOptions.map((o) => o?.idempotencyKey)).toHaveLength(5);
    expect(
      new Set(tasks.creationOptions.map((o) => o?.idempotencyKey)).size,
    ).toBe(5);
  });

  it('sends a correction task when a stage result fails the checks', async () => {
    // Arrange: first types result references an undefined parent
    const tasks = fakeTasks({
      types: [
        ok({ types: [{ name: 'arm', parent: 'agent', description: 'x' }] }),
      ],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const typeAttempts = run.stages.filter((s) => s.stage === 'types');
    expect(typeAttempts.map((s) => s.attempt)).toEqual([1, 2]);
    expect(typeAttempts[0].issues).toEqual([
      {
        severity: 'error',
        path: 'types/arm',
        message: 'parent agent is not defined',
      },
    ]);
    expect(typeAttempts[1].brief).toContain(
      '- [error] types/arm: parent agent is not defined',
    );
    expect(run.status).toBe('planned');
  });

  it('passes draft findings to the refine stage', async () => {
    // Arrange: drop every delete effect so `clear` is never deleted
    const leaky = blocksActions.map((a) => ({ ...a, deleteEffects: [] }));
    const tasks = fakeTasks({ actions: [ok({ actions: leaky })] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const refine = run.stages.find((s) => s.stage === 'refine');
    expect(refine?.brief).toContain(
      '[warning] predicates/clear: no action deletes clear',
    );
  });

  it('keeps unlinked-parameter hints out of the refine brief but in the record', async () => {
    // Arrange: Blocks World draws unlinked hints (any arm may move any block)
    const tasks = fakeTasks();

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const actions = run.stages.find((s) => s.stage === 'actions');
    const refine = run.stages.find((s) => s.stage === 'refine');
    expect(actions?.issues.some((i) => i.code === 'unlinked-parameters')).toBe(
      true,
    );
    expect(refine?.brief).not.toContain('no precondition links');
    expect(refine?.brief).toContain('Use only the predicates listed below');
  });

  it('sends review findings back to refine for one round', async () => {
    // Arrange: the decision model says the skippable put-down is required
    const tasks = fakeTasks();
    const decisions = {
      yesNo: (state: unknown) =>
        Promise.resolve(
          (state as { step: string }).step === 'put-down' ? 0.95 : 0.1,
        ),
    };

    // Act
    const run = await runPddlDesign(tasks, input, {
      review: { decisions, rounds: 1 },
    });

    // Assert
    const refines = run.stages.filter((s) => s.stage === 'refine');
    expect(refines.map((s) => s.attempt)).toEqual([1, 2]);
    expect(refines[1].brief).toContain('the description requires put-down');
    expect(run.review?.map((r) => r.round)).toEqual([1, 2]);
    expect(run.reviewPassed).toBe(false);
    expect(run.stages.filter((s) => s.stage === 'problem')).toHaveLength(1);
  });

  it('sends badly named results back for correction', async () => {
    // Arrange
    const tasks = fakeTasks({
      types: [ok({ types: [{ name: 'Robot Arm', description: 'x' }] })],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    const typeAttempts = run.stages.filter((s) => s.stage === 'types');
    expect(typeAttempts.map((s) => s.attempt)).toEqual([1, 2]);
    expect(typeAttempts[1].brief).toContain('"Robot Arm" is not a valid name');
    expect(run.status).toBe('planned');
  });

  it('fails fast when no worker claims a task', async () => {
    // Arrange: every task stays queued
    const tasks: TaskClient = {
      createTask: () => Promise.resolve({ id: 'task-1' } as never),
      getTask: () =>
        Promise.resolve({ id: 'task-1', status: 'queued' } as never),
      listAttempts: () => Promise.resolve([]),
    };

    // Act
    const run = await runPddlDesign(tasks, input, {
      claimTimeoutSec: 0,
      pollIntervalSec: 0,
    });

    // Assert
    expect(run.status).toBe('failed');
    expect(run.failure?.reason).toMatch(
      /no worker claimed task task-1 within 0s; check that a poller is running/,
    );
  });

  it(
    'routes shared work back through predicates and actions',
    { timeout: 120_000 },
    async () => {
      // Arrange: a live-run domain where one issue's work serves the other
      const { domain, problem } = JSON.parse(
        readFileSync(
          resolve(
            dirname(fileURLToPath(import.meta.url)),
            'fixtures',
            'issue-explicit-run.json',
          ),
          'utf8',
        ),
      ) as { domain: Domain; problem: Problem };
      const outputs: Record<string, FakeTaskOutput> = {
        types: ok({ types: domain.types }),
        predicates: ok({ predicates: domain.predicates }),
        actions: ok({ actions: domain.actions }),
        refine: ok({ actions: domain.actions, changes: [] }),
        problem: ok({
          objects: problem.objects,
          init: problem.init,
          goal: problem.goal,
        }),
      };
      const tasks = new FakeTasks((body) => outputs[stageOf(body.tags)]);

      // Act
      const run = await runPddlDesign(tasks, input, { review: { rounds: 1 } });

      // Assert
      expect(run.stages.map((s) => `${s.stage}:${s.attempt}`)).toEqual([
        'types:1',
        'predicates:1',
        'actions:1',
        'refine:1',
        'problem:1',
        'predicates:2',
        'actions:2',
        'refine:2',
      ]);
      const predicates2 = run.stages.find(
        (s) => s.stage === 'predicates' && s.attempt === 2,
      );
      expect(predicates2?.brief).toContain('Add predicates that name the item');
      expect(run.review?.[0].findings.map((f) => f.code)).toContain(
        'shared-work',
      );
      expect(run.reviewPassed).toBe(false);
    },
  );

  it('stops as invalid when corrections do not fix a stage', async () => {
    // Arrange: the problem never declares an arm
    const noArm = ok({
      ...blocksProblemResult,
      objects: blocksProblemResult.objects.filter((o) => o.type === 'block'),
      init: [],
    });
    const tasks = fakeTasks({ problem: [noArm, noArm] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('invalid');
    expect(run.failure).toEqual({
      stage: 'problem',
      reason: 'still failing checks after 1 correction(s)',
    });
    expect(run.domainPddl).toBeDefined();
    expect(run.plan).toBeUndefined();
  });

  it('reports an unsolvable problem without failing the run', async () => {
    // Arrange: a goal no action can reach
    const tasks = fakeTasks({
      problem: [
        ok({
          ...blocksProblemResult,
          goal: [{ predicate: 'on-block', args: ['a', 'a'], negated: false }],
        }),
      ],
    });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('unsolvable');
    expect(run.grounding?.find((r) => r.action === 'stack')?.instances).toBe(9);
  });

  it('stops as failed when a stage task fails', async () => {
    // Arrange
    const tasks = fakeTasks({ predicates: [{ __taskStatus: 'failed' }] });

    // Act
    const run = await runPddlDesign(tasks, input);

    // Assert
    expect(run.status).toBe('failed');
    expect(run.failure?.stage).toBe('predicates');
    expect(run.stages.map((s) => s.stage)).toEqual(['types']);
  });
});
