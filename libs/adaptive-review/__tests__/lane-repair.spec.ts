import { validateCandidates } from '@moltnet/security-review/review';
import { FakeTasks } from '@themoltnet/tasks-orchestrator/testing';
import { describe, expect, it } from 'vitest';

import { acceptedReview, unwrap } from '../src/lane.js';
import { runSecurityLane } from '../src/security-lane.js';

const body = {
  taskType: 'freeform',
  teamId: 'team',
  diaryId: 'diary',
  projectId: 'project',
  correlationId: 'review',
  allowedProfiles: [{ profileId: 'reviewer' }],
  runningTimeoutSec: 300,
  maxAttempts: 1,
  tags: ['lane:security', 'stage:hunt'],
  input: {
    brief: 'Review the pinned diff read-only.',
    constraints: ['Do not publish comments.'],
    outputContract: { version: 1, schema: { type: 'object' } },
    execution: { workspace: 'dedicated_worktree', revision: 'a'.repeat(40) },
  },
};
const diff =
  'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
const candidate = {
  id: 'example',
  path: 'src/example.ts',
  side: 'new',
  line: 1,
  title: 'Example candidate',
  hypothesis: 'Check the changed behavior.',
};
const output = (line: number) => ({
  result: {
    summary: 'Review result',
    findings: [{ ...candidate, line }],
  },
});
const parse = (raw: unknown) => validateCandidates(unwrap(raw), diff);

describe('review semantic correction', () => {
  it('runs verification after correcting the hunt and retains partial coverage', async () => {
    const tasks = new FakeTasks([
      {
        result: {
          ...output(99).result,
          coverage: 'partial',
          unassessed: ['Callers outside src/example.ts were not read.'],
        },
      },
      {
        result: {
          ...output(1).result,
          coverage: 'partial',
          unassessed: ['Callers outside src/example.ts were not read.'],
        },
      },
      {
        result: {
          summary: 'Checked candidate',
          findings: [
            {
              ...candidate,
              status: 'refuted',
              severity: 'info',
              evidence: 'An existing guard covers this branch.',
              reachability: 'The caller uses the guard.',
              remediation: 'None.',
            },
          ],
        },
      },
    ]);
    const result = await runSecurityLane({
      identity: {
        repo: 'example/repo',
        pr: 1,
        title: 'Example',
        body: '',
        base: 'a'.repeat(40),
        head: 'b'.repeat(40),
        teamId: 'team',
        diaryId: 'diary',
        correlationId: 'review',
        classifierProfileId: 'classifier',
      },
      git: () => {
        throw new Error('unexpected git call');
      },
      evidence: {
        manifest: 'src/example.ts',
        generatedPaths: [],
        bytes: diff.length,
        files: [{ path: 'src/example.ts', patch: diff, bytes: diff.length }],
      },
      changes: [{ path: 'src/example.ts', status: 'modified' }],
      policy: { version: 1, lanes: ['security'], rules: [], checks: [] },
      tasks,
      profileId: 'reviewer',
      budget: {
        runningTimeoutSec: 300,
        dispatchTimeoutSec: 60,
        expiresInSec: 900,
      },
    });

    expect(result.status).toBe('unclear');
    expect(result.unclear).toEqual([
      'Not assessed: Callers outside src/example.ts were not read.',
    ]);
    expect(result.taskIds).toHaveLength(3);
    expect(result.findings).toEqual([]);
    expect(tasks.created[1].input.continueFrom).toEqual({
      taskId: result.taskIds[0],
      attemptN: 1,
    });
    expect(tasks.created[2].tags).toContain('stage:verify');
    expect(tasks.created[0].input.brief).toContain(
      '{"path":"src/example.ts","old":"1","new":"1"}',
    );
    expect(tasks.created[2].input.brief).toContain(
      'Retain each candidate id, path, side, and line exactly',
    );
    expect(tasks.created[2].input.brief).toContain(
      'Check the changed behavior.',
    );
  });

  it('continues a bad citation once, preserving scope and recording both tasks', async () => {
    const tasks = new FakeTasks([output(99), output(1)]);
    const initial = await tasks.createTask(body);
    const taskIds: string[] = [];

    expect(await acceptedReview(tasks, initial, body, taskIds, parse)).toEqual([
      candidate,
    ]);
    expect(taskIds).toHaveLength(2);
    const repair = tasks.created[1];
    expect(repair).toMatchObject({
      ...body,
      runningTimeoutSec: 120,
      input: {
        constraints: body.input.constraints,
        outputContract: body.input.outputContract,
        continueFrom: { taskId: initial.id, attemptN: 1 },
      },
    });
    expect(repair.input).not.toHaveProperty('execution');
    expect(repair.input.brief).toContain('cite a changed diff line');
    expect(tasks.creationOptions[1]?.idempotencyKey).toBeTruthy();
  });

  it('gives the single repair all citation errors across files', async () => {
    // Same failure pattern as PR 2943: context cited in the first file,
    // then an unchanged push trigger cited instead of the changed cron.
    const patch = [
      'diff --git a/renovate.json b/renovate.json',
      '--- a/renovate.json',
      '+++ b/renovate.json',
      '@@ -33,2 +33,3 @@',
      ' "osvVulnerabilityAlerts": true,',
      ' "packageRules": [',
      '+{"automerge": true}',
      'diff --git a/.github/workflows/renovate.yml b/.github/workflows/renovate.yml',
      '--- a/.github/workflows/renovate.yml',
      '+++ b/.github/workflows/renovate.yml',
      '@@ -12,3 +12,3 @@',
      '   schedule:',
      "-    - cron: '0 3 * * *'",
      "+    - cron: '23 * * * *'",
      '   push:',
    ].join('\n');
    const first = { ...candidate, id: 'rule', path: 'renovate.json', line: 33 };
    const second = {
      ...candidate,
      id: 'schedule',
      path: '.github/workflows/renovate.yml',
      line: 14,
    };
    const corrected = [
      { ...first, line: 35 },
      { ...second, line: 13 },
    ];
    const tasks = new FakeTasks([
      { result: { summary: 'Hunt', findings: [first, second] } },
      { result: { summary: 'Hunt', findings: corrected } },
    ]);
    const initial = await tasks.createTask(body);

    expect(
      await acceptedReview(tasks, initial, body, [], (raw) =>
        validateCandidates(unwrap(raw), patch),
      ),
    ).toEqual(corrected);
    const feedback = tasks.created[1].input.brief as string;
    // Feedback is JSON-encoded in the continuation brief.
    expect(feedback).toContain('findings[0]');
    expect(feedback).toContain('findings[1]');
    expect(feedback).toContain('changed new lines: 35');
    expect(feedback).toContain('changed new lines: 13');
    expect(tasks.created).toHaveLength(2);
  });

  it('uses the same correction keys when the original review is rerun', async () => {
    const tasks = new FakeTasks([
      output(99),
      output(98),
      output(1),
      output(98),
      output(1),
    ]);
    const initial = await tasks.createTask(body);
    await acceptedReview(tasks, initial, body, [], parse);
    await acceptedReview(tasks, initial, body, [], parse);
    expect(tasks.creationOptions[1]?.idempotencyKey).toBe(
      tasks.creationOptions[3]?.idempotencyKey,
    );
    expect(tasks.creationOptions[2]?.idempotencyKey).toBe(
      tasks.creationOptions[4]?.idempotencyKey,
    );
  });

  it('does not create a correction for valid output', async () => {
    const tasks = new FakeTasks([output(1)]);
    const initial = await tasks.createTask(body);
    await acceptedReview(tasks, initial, body, [], parse);
    expect(tasks.created).toHaveLength(1);
  });

  it('continues the latest correction once more with bounded budgets and fresh feedback', async () => {
    const tasks = new FakeTasks([output(99), output(98), output(1)]);
    const initial = await tasks.createTask(body);
    const taskIds: string[] = [];

    expect(await acceptedReview(tasks, initial, body, taskIds, parse)).toEqual([
      candidate,
    ]);
    expect(taskIds).toHaveLength(3);
    expect(tasks.created[2].input.continueFrom).toEqual({
      taskId: taskIds[1],
      attemptN: 1,
    });
    for (const repair of tasks.created.slice(1)) {
      expect(repair).toMatchObject({
        runningTimeoutSec: 120,
        dispatchTimeoutSec: 30,
        expiresInSec: 150,
        maxAttempts: 1,
        allowedProfiles: body.allowedProfiles,
        projectId: body.projectId,
        input: { outputContract: body.input.outputContract },
      });
    }
    expect(tasks.created[2].input.brief).toContain('\\"line\\":98');
    expect(tasks.creationOptions[2]?.idempotencyKey).toBeTruthy();
    expect(tasks.creationOptions[2]?.idempotencyKey).not.toBe(
      tasks.creationOptions[1]?.idempotencyKey,
    );
  });

  it('preserves tighter caller limits for corrections', async () => {
    const tasks = new FakeTasks([output(99), output(1)]);
    const limited = {
      ...body,
      runningTimeoutSec: 60,
      dispatchTimeoutSec: 10,
      expiresInSec: 70,
    };
    const initial = await tasks.createTask(limited);
    await acceptedReview(tasks, initial, limited, [], parse);
    expect(tasks.created[1]).toMatchObject({
      runningTimeoutSec: 60,
      dispatchTimeoutSec: 10,
      expiresInSec: 70,
    });
  });

  it('fails closed after both corrections are still invalid', async () => {
    const tasks = new FakeTasks([output(99), output(98), output(97)]);
    const initial = await tasks.createTask(body);
    await expect(
      acceptedReview(tasks, initial, body, [], parse),
    ).rejects.toMatchObject({
      kind: 'invalid_output',
    });
    expect(tasks.created).toHaveLength(3);
  });

  it.each([false, true])(
    'does not retry an execution budget failure (during correction: %s)',
    async (duringCorrection) => {
      const tasks = new FakeTasks([
        ...(duringCorrection ? [output(99)] : []),
        {
          __taskStatus: 'failed',
          error: {
            code: 'max_turns_exceeded',
            message: 'turn budget reached',
          },
        },
      ]);
      const initial = await tasks.createTask(body);
      await expect(
        acceptedReview(tasks, initial, body, [], parse),
      ).rejects.toMatchObject({
        kind: 'failed',
        attemptErrorCode: 'max_turns_exceeded',
      });
      expect(tasks.created).toHaveLength(duringCorrection ? 2 : 1);
    },
  );
});
