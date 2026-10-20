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
      '../../../rubrics/pr-complexity-tristate-v3.json',
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
  it('carries parent review tags into each stage', () => {
    const task = buildChangeMapTask(
      { ...input, tags: ['review:adaptive', 'lane:complexity'] },
      evidence,
    );
    expect(task.tags).toEqual([
      'review:complexity',
      'review:adaptive',
      'lane:complexity',
      'stage:map',
      'repo:getlarge/themoltnet',
      'pr:2545',
      `revision:${head}`,
    ]);
  });

  it('keeps cross-domain test paths visible without presenting unassigned patches as inspected evidence', () => {
    // Regression shape from #2790: source and direct tests can be assigned to
    // different packets. The source reviewer must know its view is partial;
    // synthesis needs both observations before claiming the feature lacks tests.
    const splitEvidence: ReviewEvidence = {
      manifest: '2 files changed',
      files: [
        {
          path: 'src/spend-report.ts',
          patch: '+export function collectSpend() { return totalAttempts(); }',
          bytes: 70,
        },
        {
          path: '__tests__/spend-report.test.ts',
          patch: '+expect(report.totals.combined.usage.attempts).toBe(5);',
          bytes: 65,
        },
      ],
      bytes: 135,
      generatedPaths: [],
    };
    const work = buildDomainWork(
      [
        { id: 'source', nature: 'collection', paths: ['src/spend-report.ts'] },
        {
          id: 'tests',
          nature: 'verification',
          paths: ['__tests__/spend-report.test.ts'],
        },
      ],
      splitEvidence,
    );
    const source = buildDomainTask(input, splitEvidence, work[0]);
    expect(source.input.brief).toContain('__tests__/spend-report.test.ts');
    expect(source.input.brief).not.toContain('toBe(5)');
    expect(source.input.brief).toContain(
      'Do not infer missing PR-wide tests from their absence in this packet',
    );
    const domains = [
      parseDomainResult(
        stageOutput({
          summary: 'Collection; tests are in another packet',
          signals: [
            {
              criterionId: 'test_coverage_delta',
              evidence:
                'src/spend-report.ts adds attempt aggregation; assertions are outside this packet',
              impact: 'neutral',
            },
          ],
        }),
        work[0],
        rubric,
      ),
      parseDomainResult(
        stageOutput({
          summary: 'Direct aggregation test',
          signals: [
            {
              criterionId: 'test_coverage_delta',
              evidence:
                '__tests__/spend-report.test.ts asserts combined attempt count toBe(5)',
              impact: 'reduces',
            },
          ],
        }),
        work[1],
        rubric,
      ),
    ];
    const synthesis = buildSynthesisTask(input, splitEvidence, domains);
    expect(synthesis.input.brief).toContain('toBe(5)');
    expect(synthesis.input.brief).toContain(
      'assertions are outside this packet',
    );
    expect(synthesis.input.brief).toContain(
      'Reconcile test-coverage observations across ALL domains before scoring',
    );
    expect(synthesis.input.brief).toContain(
      'Distinguish absent integration coverage from absent unit coverage',
    );
    expect(synthesis.input.brief).toContain(
      'Do not automatically pass because test files exist',
    );
  });

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

  it('assigns each changed path once despite duplicate, invalid, or omitted indexes', () => {
    const map = {
      groups: [{ nature: 'application behavior', fileIndexes: [0, 1] }],
    };
    const groups = parseChangeMap(stageOutput(map), evidence);
    expect(groups[0].paths).toEqual(['apps/a.ts', 'apps/a.test.ts']);
    const incomplete = parseChangeMap(
      stageOutput({ groups: [{ ...map.groups[0], fileIndexes: [0] }] }),
      evidence,
    );
    expect(incomplete.map((group) => group.paths)).toEqual([
      ['apps/a.ts'],
      ['apps/a.test.ts'],
    ]);
    expect(
      buildDomainWork(incomplete, evidence).map((item) => item.files[0].path),
    ).toEqual(['apps/a.ts', 'apps/a.test.ts']);
    expect(incomplete.map((group) => group.id)).toEqual([
      'domain-1',
      'remaining-changes',
    ]);
    expect(
      parseChangeMap(
        stageOutput({
          groups: [
            { nature: 'app', fileIndexes: [0, 0, 37] },
            { nature: 'tests', fileIndexes: [0, 1] },
          ],
        }),
        evidence,
      ).map((group) => group.paths),
    ).toEqual([['apps/a.ts'], ['apps/a.test.ts']]);
    expect(
      parseChangeMap(stageOutput({ groups: [] }), evidence).map(
        (group) => group.paths,
      ),
    ).toEqual([['apps/a.ts', 'apps/a.test.ts']]);
    const work = buildDomainWork(groups, evidence);
    expect(work).toHaveLength(2);
    expect(work.map((item) => item.files.map((file) => file.path))).toEqual([
      ['apps/a.ts'],
      ['apps/a.test.ts'],
    ]);
  });

  it('keeps omitted files covered when the map already uses eight groups', () => {
    const manyFiles: ReviewEvidence = {
      manifest: '9 files changed',
      files: Array.from({ length: 9 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        patch: `+export const value${index} = ${index}`,
        bytes: 30,
      })),
      bytes: 270,
      generatedPaths: [],
    };
    const groups = parseChangeMap(
      stageOutput({
        groups: Array.from({ length: 8 }, (_, index) => ({
          nature: 'source',
          fileIndexes: [index],
        })),
      }),
      manyFiles,
    );
    expect(groups).toHaveLength(9);
    expect(groups[8].paths).toEqual(['src/file-8.ts']);
  });

  it('uses separate map, domain and synthesis briefs with trusted file coverage', () => {
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
    expect(domain.input.brief).toContain(
      'Check each suspected impact against the assigned diff',
    );
    expect(domain.input.outputContract?.schema).toMatchObject({
      type: 'object',
      required: ['summary', 'signals'],
    });
    expect(domain.input.outputContract?.schema).not.toHaveProperty(
      'properties.paths',
    );
    expect(domain.input.brief).toContain('<untrusted-assigned-paths');
    expect(domain.input.brief).not.toContain('<untrusted-manifest');
    const result = {
      summary: 'Small app behavior update',
      signals: [
        {
          criterionId: 'cognitive_load',
          evidence: 'One export changed',
          impact: 'reduces' as const,
        },
      ],
    };
    expect(
      parseDomainResult(
        {
          summary: 'Review completed',
          result: { ...result, paths: ['unassigned.ts'], workId: 'task-uuid' },
        },
        work,
        rubric,
      ),
    ).toEqual({
      ...result,
      paths: ['apps/a.ts'],
      workId: work.id,
    });
    expect(
      parseDomainResult(
        { summary: 'Concise prose summary', result },
        work,
        rubric,
      ),
    ).toEqual({ ...result, paths: ['apps/a.ts'], workId: work.id });
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
    const synthesis = buildSynthesisTask(input, evidence, [
      { ...result, paths: ['apps/a.ts'], workId: work.id },
    ]);
    expect(synthesis.input.brief).toContain('<untrusted-domain-observations');
    expect(synthesis.input.brief).toContain('Trusted code calculates');
    expect(synthesis.input.outputContract?.schema).toMatchObject({
      type: 'object',
      required: ['scores', 'verdict'],
    });
    expect(synthesis.input.outputContract?.schema).not.toHaveProperty(
      'properties.composite',
    );
  });

  it('computes the composite while rejecting incomplete final judgments', () => {
    const scores = rubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      status: 'pass' as const,
      rationale: 'reviewable',
    }));
    expect(
      parseReviewOutput({ scores, verdict: 'Low burden' }, rubric).composite,
    ).toBe(1);
    expect(
      parseFreeformReviewOutput(
        {
          result: {
            scores,
            verdict: 'Low burden',
          },
          summary: 'Review completed',
        },
        rubric,
      ).composite,
    ).toBe(1);
    expect(() =>
      parseReviewOutput(
        { scores: scores.slice(1), verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow('scores length');
    expect(() =>
      parseReviewOutput(
        { scores, composite: 0, verdict: 'Low burden' },
        rubric,
      ),
    ).toThrow('ComplexityReviewDecision');
  });

  it('excludes unclear criteria from the trusted composite', () => {
    const scores = rubric.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      status: index === 0 ? ('unclear' as const) : ('pass' as const),
      rationale:
        index === 0
          ? 'The evidence does not settle scope.'
          : 'Observed in diff.',
    }));
    expect(
      parseReviewOutput({ scores, verdict: 'Assessed criteria pass.' }, rubric)
        .composite,
    ).toBe(1);
    const allUnclear = scores.map((score) => ({
      ...score,
      status: 'unclear' as const,
    }));
    expect(
      parseReviewOutput(
        { scores: allUnclear, verdict: 'Undetermined.' },
        rubric,
      ).composite,
    ).toBeUndefined();
    const mixed = scores.map((score, index) => ({
      ...score,
      status: index === 1 ? ('fail' as const) : score.status,
    }));
    expect(
      parseReviewOutput({ scores: mixed, verdict: 'Mixed burden.' }, rubric)
        .composite,
    ).toBeCloseTo(2 / 3);
  });

  const reviewCases = [
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
  ] satisfies ReviewEvidence[];

  it.each(
    reviewCases.flatMap((evidence) => [
      { evidence, serialDomainDispatch: false },
      { evidence, serialDomainDispatch: true },
    ]),
  )(
    'maps, reviews each packet, and synthesizes with explicit coverage (%s)',
    async ({ evidence, serialDomainDispatch }) => {
      const work = buildDomainWork(
        [
          {
            id: 'domain-1',
            nature: 'app change',
            paths: evidence.files.map((file) => file.path),
          },
        ],
        evidence,
      );
      const created: Array<{ id: string; stage: string; key: string }> = [];
      let completedDomains = 0;
      const scores = rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'pass' as const,
        rationale: 'Reviewable change',
      }));
      const outputs = new Map<string, unknown>();
      const tasks: TaskClient = {
        createTask: (body, options) => {
          const stage =
            body.tags?.find((tag) => tag.startsWith('stage:'))?.slice(6) ?? '';
          const id = 'task-' + created.length;
          created.push({ id, stage, key: options?.idempotencyKey ?? '' });
          if (serialDomainDispatch && stage.startsWith('domain:')) {
            expect(
              created.filter((item) => item.stage.startsWith('domain:')),
            ).toHaveLength(completedDomains + 1);
          }
          if (stage === 'map') {
            outputs.set(
              id,
              stageOutput({
                groups: [
                  {
                    nature: 'app change',
                    fileIndexes: evidence.files.map((_, index) => index),
                  },
                ],
              }),
            );
          } else if (stage.startsWith('domain:')) {
            outputs.set(
              id,
              stageOutput({
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
            outputs.set(id, stageOutput({ scores, verdict: 'Low burden' }));
          }
          return Promise.resolve({ id } as Awaited<
            ReturnType<TaskClient['createTask']>
          >);
        },
        getTask: (id) => {
          if (
            !serialDomainDispatch &&
            id.startsWith('task-') &&
            created.find((item) => item.id === id)?.stage.startsWith('domain:')
          ) {
            expect(
              created.filter((item) => item.stage.startsWith('domain:')).length,
            ).toBeLessThanOrEqual(completedDomains + 2);
          }
          return Promise.resolve({
            id,
            status: 'completed',
            acceptedAttemptN: 1,
          } as Awaited<ReturnType<TaskClient['getTask']>>);
        },
        listAttempts: (id) => {
          if (
            created.find((item) => item.id === id)?.stage.startsWith('domain:')
          )
            completedDomains++;
          return Promise.resolve([
            {
              taskId: id,
              attemptN: 1,
              status: 'completed',
              output: outputs.get(id),
            } as Awaited<ReturnType<TaskClient['listAttempts']>>[number],
          ]);
        },
      };
      const result = await runComplexityReview(tasks, input, evidence, {
        serialDomainDispatch,
      });
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

  it.each([
    { serialDomainDispatch: true, reviewed: 4, omitted: 5 },
    { serialDomainDispatch: false, reviewed: 6, omitted: 3 },
  ])(
    'caps domain work and tells synthesis about omitted segments ($serialDomainDispatch)',
    async ({ serialDomainDispatch, reviewed, omitted }) => {
      const files = Array.from({ length: 9 }, (_, index) => ({
        path: `apps/domain-${index}.ts`,
        patch: `+${'x'.repeat(MAX_PATCH_BYTES - 10)}`,
        bytes: MAX_PATCH_BYTES - 9,
      }));
      const evidence: ReviewEvidence = {
        manifest: files.map((file) => file.path).join('\n'),
        files,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        generatedPaths: [],
      };
      const scores = rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        status: 'pass' as const,
        rationale: 'Reviewed change',
      }));
      const created: Array<{ id: string; stage: string; brief: string }> = [];
      const outputs = new Map<string, unknown>();
      const tasks = {
        createTask: (body: Parameters<TaskClient['createTask']>[0]) => {
          const id = `task-${created.length}`;
          const stage =
            body.tags?.find((tag) => tag.startsWith('stage:'))?.slice(6) ?? '';
          created.push({ id, stage, brief: String(body.input.brief) });
          outputs.set(
            id,
            stageOutput(
              stage === 'map'
                ? {
                    groups: files.slice(0, 8).map((_, index) => ({
                      nature: 'app change',
                      fileIndexes: [index],
                    })),
                  }
                : stage.startsWith('domain:')
                  ? {
                      summary: 'Reviewed change',
                      signals: [
                        {
                          criterionId: 'cognitive_load',
                          evidence: 'One change',
                          impact: 'neutral',
                        },
                      ],
                    }
                  : { scores, verdict: 'Low burden' },
            ),
          );
          return Promise.resolve({ id });
        },
        getTask: (id: string) =>
          Promise.resolve({
            id,
            status: 'completed',
            acceptedAttemptN: 1,
          }),
        listAttempts: (id: string) =>
          Promise.resolve([
            {
              taskId: id,
              attemptN: 1,
              status: 'completed',
              output: outputs.get(id),
            },
          ]),
      } as TaskClient;

      const result = await runComplexityReview(tasks, input, evidence, {
        serialDomainDispatch,
      });

      expect(result.unreviewedDomainWork).toBe(omitted);
      expect(
        created.filter((item) => item.stage.startsWith('domain:')),
      ).toHaveLength(reviewed);
      expect(created.at(-1)?.brief).toContain(
        `${omitted} segments were not reviewed`,
      );
    },
  );
});
