import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Rubric } from '@moltnet/tasks';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

import {
  buildDomainWork,
  buildEvidence,
  MAX_PATCH_BYTES,
  type ReviewEvidence,
} from './evidence.js';
import {
  buildChangeMapTask,
  buildDomainTask,
  buildSynthesisTask,
  parseChangeMap,
  parseDomainResult,
  parseFreeformReviewOutput,
  parseReviewOutput,
  type ReviewInput,
  runComplexityReview,
} from './workflow.js';

const rubric = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../rubrics/pr-complexity-binary-v1.json',
    ),
    'utf8',
  ),
) as Rubric;
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const input: ReviewInput = {
  repo: 'getlarge/themoltnet',
  pr: 2545,
  title: 'Update actions',
  body: 'A dependency update',
  commits: ['Update setup-node'],
  base,
  head,
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'correlation',
  profileId: 'profile',
  rubric,
};
const evidence: ReviewEvidence = {
  manifest: '2 files changed',
  files: [
    { path: 'apps/a.ts', patch: '+export const a = 1', bytes: 50_000 },
    { path: 'apps/a.test.ts', patch: '+expect(a).toBe(1)', bytes: 50_000 },
  ],
  bytes: 100_000,
  generatedPaths: [],
};
const stageOutput = (value: unknown) => ({
  summary: 'Review completed',
  result: value,
});

describe('staged complexity review', () => {
  it('reads the complete pinned diff by changed path without rejecting oversized patches', () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      if (args.includes('--name-only')) return 'apps/a.ts\0apps/a.test.ts\0';
      if (args.includes('--stat')) return '2 files changed';
      return (
        'diff --git a/apps/a.ts b/apps/a.ts\n+one line\n' +
        'diff --git a/apps/a.test.ts b/apps/a.test.ts\n+one test\n'
      );
    };
    const result = buildEvidence(git, base, head);
    expect(result.files.map((file) => file.path)).toEqual([
      'apps/a.ts',
      'apps/a.test.ts',
    ]);
    expect(calls).toContainEqual([
      'diff',
      '--no-ext-diff',
      '--unified=2',
      base + '...' + head,
    ]);
    const large = buildEvidence(
      (args) =>
        args.includes('--name-only')
          ? 'huge.ts\0'
          : args.includes('--stat')
            ? ''
            : 'diff --git a/huge.ts b/huge.ts\n' +
              'x'.repeat(MAX_PATCH_BYTES + 1),
      base,
      head,
    );
    expect(large.files[0].bytes).toBeGreaterThan(MAX_PATCH_BYTES);
    const packets = buildDomainWork(
      [{ id: 'large', nature: 'large source change', paths: ['huge.ts'] }],
      large,
    );
    expect(packets).toHaveLength(2);
    expect(
      packets
        .flatMap((work) => work.files)
        .map((file) => file.patch)
        .join(''),
    ).toBe(large.files[0].patch);
  });

  it('checks that the map covers each changed path exactly once before focused reviews', () => {
    const map = {
      groups: [
        { id: 'app', nature: 'application behavior', fileIndexes: [0, 1] },
      ],
    };
    const groups = parseChangeMap(stageOutput(map), evidence);
    expect(groups[0].paths).toEqual(['apps/a.ts', 'apps/a.test.ts']);
    expect(() =>
      parseChangeMap(
        stageOutput({ groups: [{ ...map.groups[0], fileIndexes: [0] }] }),
        evidence,
      ),
    ).toThrow('omitted changed paths');
    expect(() =>
      parseChangeMap(
        stageOutput({
          groups: [
            { ...map.groups[0], fileIndexes: [0] },
            { id: 'tests', nature: 'tests', fileIndexes: [0, 1] },
          ],
        }),
        evidence,
      ),
    ).toThrow('duplicate changed file index');
    const work = buildDomainWork(groups, evidence);
    expect(work).toHaveLength(2);
    expect(work.map((item) => item.files.map((file) => file.path))).toEqual([
      ['apps/a.ts'],
      ['apps/a.test.ts'],
    ]);
  });

  it('uses separate map, domain and synthesis briefs with strict domain coverage', () => {
    const map = buildChangeMapTask(input, evidence);
    expect(map.input.brief).toContain('do not score the rubric yet');
    expect(map.input).not.toHaveProperty('successCriteria');
    expect(map.input.outputContract?.schema).toMatchObject({
      type: 'object',
      required: ['groups'],
    });
    const work = buildDomainWork(
      [
        {
          id: 'app',
          nature: 'application behavior',
          paths: ['apps/a.ts', 'apps/a.test.ts'],
        },
      ],
      evidence,
    )[0];
    const domain = buildDomainTask(input, evidence, work);
    expect(domain.input.brief).toContain('<untrusted-file-diff');
    expect(domain.input.outputContract?.schema).toMatchObject({
      type: 'object',
      required: ['paths', 'summary', 'signals'],
    });
    expect(domain.input.brief).toContain('<untrusted-assigned-paths');
    expect(domain.input.brief).not.toContain('<untrusted-manifest');
    const result = {
      paths: ['apps/a.ts'],
      summary: 'Small app behavior update',
      signals: [
        {
          criterionId: 'cognitive_load',
          evidence: 'One export changed',
          impact: 'reduces',
        },
      ],
    };
    expect(
      parseDomainResult(
        {
          summary: 'Review completed',
          result: { ...result, workId: 'task-uuid' },
        },
        work,
        rubric,
      ),
    ).toEqual({
      ...result,
      workId: work.id,
    });
    expect(
      parseDomainResult(
        { summary: 'Concise prose summary', result },
        work,
        rubric,
      ),
    ).toEqual({ ...result, workId: work.id });
    expect(() =>
      parseDomainResult(
        {
          summary: JSON.stringify(result),
          artifacts: [{ kind: 'note', body: JSON.stringify(result) }],
        },
        work,
        rubric,
      ),
    ).toThrow('invalid domain result');
    expect(() =>
      parseDomainResult(
        { summary: 'Review completed', result: { ...result, paths: [] } },
        work,
        rubric,
      ),
    ).toThrow('omitted or added paths');
    const synthesis = buildSynthesisTask(input, evidence, [
      result as ReturnType<typeof parseDomainResult>,
    ]);
    expect(synthesis.input.brief).toContain('<untrusted-domain-observations');
    expect(synthesis.input.outputContract?.schema).toMatchObject({
      type: 'object',
      required: ['scores', 'composite', 'verdict'],
    });
  });

  it('rejects incomplete or arithmetically inconsistent final judgments', () => {
    const scores = rubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: 1 as const,
      rationale: 'reviewable',
    }));
    expect(
      parseReviewOutput({ scores, composite: 1, verdict: 'Low burden' }, rubric)
        .composite,
    ).toBe(1);
    expect(
      parseFreeformReviewOutput(
        {
          result: {
            scores,
            composite: 1,
            verdict: 'Low burden',
          },
          summary: 'Review completed',
        },
        rubric,
      ).composite,
    ).toBe(1);
    expect(() =>
      parseReviewOutput(
        { scores: scores.slice(1), composite: 1, verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow('scores length');
    expect(() =>
      parseReviewOutput(
        { scores, composite: 0, verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow();
  });

  it.each([
    evidence,
    {
      manifest: 'large source',
      files: [
        {
          path: 'src/large.ts',
          patch: 'x'.repeat(MAX_PATCH_BYTES * 2 + 1),
          bytes: MAX_PATCH_BYTES * 2 + 1,
        },
      ],
      bytes: MAX_PATCH_BYTES * 2 + 1,
      generatedPaths: [],
    },
    {
      manifest: 'lockfile deletion',
      files: [
        {
          path: 'example/pnpm-lock.yaml',
          patch: 'Generated lockfile deletion summarized',
          bytes: 36,
          summarized: true,
        },
      ],
      bytes: 36,
      generatedPaths: [],
    },
  ] satisfies ReviewEvidence[])(
    'maps, reviews each packet, and synthesizes with explicit coverage',
    async (evidence) => {
      const work = buildDomainWork(
        [
          {
            id: 'app',
            nature: 'app change',
            paths: evidence.files.map((file) => file.path),
          },
        ],
        evidence,
      );
      const created: Array<{ id: string; stage: string; key: string }> = [];
      const scores = rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        score: 1 as const,
        rationale: 'Reviewable change',
      }));
      const outputs = new Map<string, unknown>();
      const tasks: TaskClient = {
        createTask: (body, options) => {
          const stage =
            body.tags?.find((tag) => tag.startsWith('stage:'))?.slice(6) ?? '';
          const id = 'task-' + created.length;
          created.push({ id, stage, key: options?.idempotencyKey ?? '' });
          if (stage === 'map') {
            outputs.set(
              id,
              stageOutput({
                groups: [
                  {
                    id: 'app',
                    nature: 'app change',
                    fileIndexes: evidence.files.map((_, index) => index),
                  },
                ],
              }),
            );
          } else if (stage.startsWith('domain:')) {
            const assigned = work.find(
              (item) => 'domain:' + item.id === stage,
            )!;
            outputs.set(
              id,
              stageOutput({
                workId: stage.slice(7),
                paths: assigned.files.map((file) => file.path),
                summary: 'Reviewed the full patch',
                signals: [
                  {
                    criterionId: 'cognitive_load',
                    evidence: 'One small change',
                    impact: 'reduces',
                  },
                ],
              }),
            );
          } else {
            outputs.set(
              id,
              stageOutput({ scores, composite: 1, verdict: 'Low burden' }),
            );
          }
          return Promise.resolve({ id } as Awaited<
            ReturnType<TaskClient['createTask']>
          >);
        },
        getTask: (id) => {
          if (
            id.startsWith('task-') &&
            created.find((item) => item.id === id)?.stage.startsWith('domain:')
          ) {
            expect(
              created.filter((item) => item.stage.startsWith('domain:')),
            ).toHaveLength(work.length);
          }
          return Promise.resolve({
            id,
            status: 'completed',
            acceptedAttemptN: 1,
          } as Awaited<ReturnType<TaskClient['getTask']>>);
        },
        listAttempts: (id) =>
          Promise.resolve([
            {
              taskId: id,
              attemptN: 1,
              status: 'completed',
              output: outputs.get(id),
            } as Awaited<ReturnType<TaskClient['listAttempts']>>[number],
          ]),
      };
      const result = await runComplexityReview(tasks, input, evidence);
      expect(created.map((item) => item.stage)).toEqual([
        'map',
        ...work.map((item) => 'domain:' + item.id),
        'synthesis',
      ]);
      expect(created.every((item) => item.key.startsWith('complexity:'))).toBe(
        true,
      );
      expect(result.taskIds).toHaveLength(work.length + 2);
      expect(result.summarizedPaths).toEqual(
        evidence.files
          .filter((file) => file.summarized)
          .map((file) => file.path),
      );
      expect(result.output.composite).toBe(1);
      expect(
        Object.values(result.stageDurationsMs).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ).toBe(result.durationMs);
    },
  );
});
