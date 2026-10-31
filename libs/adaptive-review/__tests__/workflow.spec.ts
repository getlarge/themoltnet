import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ReviewEvidence } from '@moltnet/complexity-review/evidence';
import type { Candidate } from '@moltnet/security-review/review';
import type { ClassifyOutput } from '@moltnet/tasks';
import type {
  TaskClient,
  TaskOutcomeError,
} from '@themoltnet/tasks-orchestrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseReviewTaskBudgets } from '../src/config.js';
import { LANES, type ReviewIdentity } from '../src/core.js';
import type { PriorFindingOutcome } from '../src/prior-findings.js';
import { hasIncompleteCoverage, renderAdaptiveComment } from '../src/report.js';
import {
  classifierTaskPossible,
  prepareAdaptiveReview,
  runAdaptiveReview,
  runRoutedAdaptiveReview,
} from '../src/workflow.js';

const taskBudgets = parseReviewTaskBudgets(`
focused:
  timeout: 601s
  dispatch-timeout: 251s
  expires-after: 1800s
security:
  timeout: 701s
  dispatch-timeout: 301s
  expires-after: 1900s
`);

const mocks = vi.hoisted(() => ({
  buildEvidence: vi.fn(),
  createGit: vi.fn(() => vi.fn()),
  collectChangeSet: vi.fn(),
  docsGlobs: vi.fn(() => ({})),
  loadReviewConfig: vi.fn(() => ({ config: {}, source: 'base' })),
  runDocsImpactReview: vi.fn(),
  runComplexityReview: vi.fn(),
  waitForTaskOutcome: vi.fn(),
}));

vi.mock('@moltnet/complexity-review/evidence', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildEvidence: mocks.buildEvidence,
}));
vi.mock('@moltnet/docs-impact-review', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createGit: mocks.createGit,
  collectChangeSet: mocks.collectChangeSet,
  docsGlobs: mocks.docsGlobs,
  loadReviewConfig: mocks.loadReviewConfig,
  runDocsImpactReview: mocks.runDocsImpactReview,
}));
vi.mock('@moltnet/complexity-review/workflow', () => ({
  runComplexityReview: mocks.runComplexityReview,
}));
vi.mock('@themoltnet/tasks-orchestrator', async (importOriginal) => {
  const original = await importOriginal<{
    TaskOutcomeError: typeof TaskOutcomeError;
  }>();
  return {
    ...original,
    waitForTaskOutcome: mocks.waitForTaskOutcome,
    waitForValidatedTask: (task: { id: string }, opts: unknown) =>
      mocks.waitForTaskOutcome(task.id, opts) as Promise<unknown>,
    // The real helper calls the unmocked module-internal poll; mirror it.
    waitForAcceptedTask: async (id: string, opts: unknown) => {
      const outcome = (await mocks.waitForTaskOutcome(id, opts)) as {
        kind: string;
        result: unknown;
      };
      if (outcome.kind === 'accepted') return outcome.result;
      throw new original.TaskOutcomeError(id, outcome as never);
    },
  };
});

const cwd = resolve(import.meta.dirname, '../../..');
const identity: ReviewIdentity = {
  repo: 'getlarge/themoltnet',
  pr: 42,
  title: 'Change API behavior',
  body: 'Adds a route',
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  teamId: 'team',
  diaryId: 'diary',
  correlationId: 'correlation',
  classifierProfileId: 'classifier-profile',
};
const sourcePath = 'apps/rest-api/src/routes/foo.ts';
const patch = [
  `diff --git a/${sourcePath} b/${sourcePath}`,
  `--- a/${sourcePath}`,
  `+++ b/${sourcePath}`,
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');
const evidence: ReviewEvidence = {
  manifest: sourcePath,
  files: [{ path: sourcePath, patch, bytes: Buffer.byteLength(patch) }],
  bytes: Buffer.byteLength(patch),
  generatedPaths: [],
};
let policyOverride: string | undefined;
let guidanceEnabled = false;
const gitCalls: string[][] = [];

function answers(selected?: string): ClassifyOutput['answers'] {
  const result: ClassifyOutput['answers'] = {};
  for (const lane of LANES) {
    result[lane] = {
      type: 'bool',
      probability: lane === selected ? 0.9 : 0.01,
    };
  }
  result['code-complexity'] = { type: 'score', score: 1, confidence: 1 };
  result['review-effort'] = { type: 'score', score: 2, confidence: 1 };
  return result;
}

function harness(
  options: {
    classifierFails?: boolean;
    selected?: string;
    securityCoverage?: string;
    securityUnassessed?: string[];
    securityCandidateCount?: number;
    securityFindingStatus?: 'confirmed' | 'unclear' | 'refuted';
    invalidFocusedOutput?: boolean;
    focusedResult?: {
      priorFindingOutcomes?: PriorFindingOutcome[];
      summary: string;
      findings: Array<{
        path: string;
        side: 'old' | 'new';
        line: number;
        concern: string;
        action: string;
        existingFindingKey?: string;
      }>;
      unclear: string[];
    };
  } = {},
) {
  let nextId = 0;
  const created = new Map<
    string,
    {
      taskType: string;
      title?: string;
      tags?: string[];
      input: { brief?: string };
    }
  >();
  const createTask = vi.fn((body: Parameters<TaskClient['createTask']>[0]) => {
    const id = `task-${++nextId}`;
    created.set(id, body);
    return Promise.resolve({ id });
  });
  mocks.waitForTaskOutcome.mockImplementation(
    (id: string, { parse }: { parse: (output: unknown) => unknown }) => {
      const task = created.get(id);
      if (!task) throw new Error(`unknown task ${id}`);
      if (task.taskType === 'classify' && options.classifierFails) {
        throw new Error('classifier unavailable');
      }
      let raw: unknown;
      if (task.taskType === 'classify') {
        raw = { answers: answers(options.selected) };
      } else if (task.title?.includes('security hunt')) {
        const findings: Candidate[] = [];
        if (options.securityFindingStatus) {
          findings.push({
            id: 'changed-route',
            path: sourcePath,
            side: 'new',
            line: 1,
            title: 'Changed route behavior',
            hypothesis: 'The new route might skip a guard.',
          });
        }
        const candidates = options.securityCandidateCount
          ? Array.from({ length: options.securityCandidateCount }, (_, i) => ({
              ...findings[0],
              id: `candidate-${i}`,
            }))
          : findings;
        raw = {
          result: {
            summary: 'Security hunt complete',
            coverage: options.securityCoverage ?? 'complete',
            unassessed:
              options.securityUnassessed ??
              (options.securityCoverage === 'partial'
                ? ['Caller of the changed route in src/server.ts not checked.']
                : []),
            findings: candidates,
          },
        };
      } else if (task.title?.includes('security verify')) {
        raw = {
          result: {
            summary: 'Security verification complete',
            findings: [
              {
                id: 'changed-route',
                status: options.securityFindingStatus,
                severity: 'medium',
                path: sourcePath,
                side: 'new',
                line: 1,
                title: 'Changed route behavior',
                evidence: 'The changed route was inspected.',
                reachability: 'The route has a caller.',
                remediation: 'Restore the guard if needed.',
              },
            ],
          },
        };
      } else if (options.invalidFocusedOutput) {
        raw = {
          result: {
            summary: 'Malformed focused result',
            findings: 'not an array',
            unclear: [],
          },
        };
      } else {
        raw = {
          result: options.focusedResult ?? {
            summary: 'No concern',
            findings: [],
            unclear: [],
          },
        };
      }
      return Promise.resolve({
        kind: 'accepted',
        result: { state: parse(raw) },
      });
    },
  );
  const tasks = { createTask } as unknown as TaskClient;
  return { tasks, createTask, created };
}

function reviewOptions(tasks: TaskClient) {
  return {
    identity,
    mode: 'active' as const,
    tasks,
    cwd,
    runtimeSha: 'c'.repeat(40),
    taskBudgets,
    profiles: {
      docs: 'docs-profile',
      complexity: 'complexity-profile',
      security: 'security-profile',
      focused: 'focused-profile',
    },
  };
}

async function review(tasks: TaskClient) {
  return runAdaptiveReview(reviewOptions(tasks));
}

describe('adaptive review orchestration', () => {
  beforeEach(() => {
    policyOverride = undefined;
    guidanceEnabled = false;
    gitCalls.length = 0;
    mocks.createGit.mockImplementation(() =>
      vi.fn((args: string[]) => {
        gitCalls.push(args);
        if (args[0] === 'ls-tree' && args.includes('-r'))
          return guidanceEnabled
            ? `100644 blob ${createHash('sha1').update('blob 37\0Require route compatibility evidence.').digest('hex')} 37\tREVIEW.md\0`
            : '';
        if (args[0] === 'ls-tree') return String(args.at(-1));
        if (args[0] === 'cat-file')
          return 'Require route compatibility evidence.';
        if (args[0] === 'show') {
          const path = args[1].slice(args[1].indexOf(':') + 1);
          if (path === 'REVIEW.md')
            return 'Require route compatibility evidence.';
          if (path === '.github/adaptive-review.json' && policyOverride)
            return policyOverride;
          return readFileSync(resolve(cwd, path), 'utf8');
        }
        if (args[0] === 'diff' && args.includes('--name-status'))
          return `M\0${sourcePath}\0`;
        if (args[0] === 'log')
          return 'feat: first\n\nBody\n\0\nfix: second\n\0\n';
        return '';
      }),
    );
    mocks.buildEvidence.mockReturnValue(evidence);
    mocks.collectChangeSet.mockReturnValue({
      files: [{ path: sourcePath, category: 'source' }],
    });
    mocks.runDocsImpactReview.mockResolvedValue({
      status: 'completed',
      outcome: 'not-needed',
      findings: [],
      timings: { stages: {} },
    });
    mocks.runComplexityReview.mockResolvedValue({
      taskIds: ['complexity-task'],
      output: { verdict: 'Low complexity', scores: [] },
    });
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('runs only an unrelated repository’s opted-in tests lane', async () => {
    policyOverride = JSON.stringify({
      version: 1,
      lanes: ['tests'],
      rules: [],
      checks: [],
    });
    const { tasks, createTask } = harness({ selected: 'tests' });
    const report = await review(tasks);

    expect(report.routing.routes.map((route) => route.lane)).toEqual(['tests']);
    expect(report.results.map((result) => result.lane)).toEqual(['tests']);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(mocks.runDocsImpactReview).not.toHaveBeenCalled();
    expect(mocks.runComplexityReview).not.toHaveBeenCalled();
    expect(gitCalls.flat().join(' ')).not.toContain('rubrics/pr-complexity');
    expect(gitCalls.flat().join(' ')).not.toContain('docs-impact-review.json');
  });

  it('rejects a changed base policy between routing and review', async () => {
    const { tasks } = harness({ selected: 'tests' });
    const options = reviewOptions(tasks);
    const preparation = await prepareAdaptiveReview(options);
    policyOverride = JSON.stringify({
      version: 1,
      lanes: ['tests'],
      rules: [],
      checks: [],
    });
    await expect(runRoutedAdaptiveReview(options, preparation)).rejects.toThrow(
      'pinned review',
    );
  });

  it('classifies once, runs a selected focused lane, and screens the others', async () => {
    expect(classifierTaskPossible(cwd, identity.base, identity.head)).toBe(
      true,
    );
    const { tasks, createTask, created } = harness({ selected: 'tests' });
    const report = await review(tasks);

    expect(report.packetCount).toBe(1);
    expect(report.routing.classifierFailed).toBe(false);
    expect(report.routing.scores).toEqual({
      'code-complexity': 1,
      'review-effort': 2,
    });
    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'clear',
      taskIds: ['task-2'],
    });
    expect(
      report.results.filter((result) => result.status === 'screened'),
    ).toHaveLength(6);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(created.get('task-2')?.input.brief).toContain(sourcePath);
    expect(created.get('task-2')).toMatchObject({
      ...taskBudgets.focused,
    });
    expect(report.taskIds).toEqual(['task-1', 'task-2']);
  });

  it('passes classifier and per-lane overrides to task creation', async () => {
    const { tasks, created } = harness({ selected: 'tests' });
    const budgets = parseReviewTaskBudgets(
      'classifier: {timeout: 45s}\nfocused: {timeout: 10m}\ntests: {timeout: 8m}',
    );
    await runAdaptiveReview({ ...reviewOptions(tasks), taskBudgets: budgets });
    expect(created.get('task-1')).toMatchObject(budgets.classifier);
    expect(created.get('task-2')).toMatchObject(budgets.tests);
  });

  it.each(['docs', 'complexity'] as const)(
    'passes %s budgets to its specialist workflow',
    async (lane) => {
      const { tasks } = harness({ selected: lane });
      const budgets = parseReviewTaskBudgets(
        `${lane}: {timeout: 5m, dispatch-timeout: 2m, expires-after: 2h}`,
      );
      await runAdaptiveReview({
        ...reviewOptions(tasks),
        taskBudgets: budgets,
      });
      const call =
        lane === 'docs' ? mocks.runDocsImpactReview : mocks.runComplexityReview;
      expect(call.mock.calls[0][1]).toMatchObject({
        taskBudget: budgets[lane],
      });
    },
  );

  it.each([
    {
      name: 'introduced N+1 I/O',
      result: {
        summary: 'The list endpoint now performs a query per item.',
        findings: [
          {
            path: sourcePath,
            side: 'new' as const,
            line: 1,
            concern:
              'The list route replaces one batch lookup with an awaited query for every item. A page of 100 items now performs 100 sequential queries.',
            action: 'Retain the batch lookup for the page.',
          },
        ],
        unclear: [],
      },
      status: 'concern',
    },
    {
      name: 'bounded work with no established regression',
      result: {
        summary:
          'The caller enforces a three-item bound; no material regression established.',
        findings: [],
        unclear: [],
      },
      status: 'clear',
    },
    {
      name: 'missing workload evidence',
      result: {
        summary: 'The new allocation needs workload evidence.',
        findings: [],
        unclear: [
          'Maximum input size and allocation measurements are unavailable.',
        ],
      },
      status: 'unclear',
    },
  ])(
    'preserves the performance result for $name using the focused worker',
    async ({ result, status }) => {
      // Controlled specialist outputs test orchestration, not model judgment.
      const { tasks, createTask } = harness({
        selected: 'performance',
        focusedResult: result,
      });
      const report = await review(tasks);
      const task = createTask.mock.calls
        .map(([body]) => body)
        .find((body) => body.taskType === 'freeform');
      expect(task).toMatchObject({
        allowedProfiles: [{ profileId: 'focused-profile' }],
        ...taskBudgets.performance,
        input: {
          execution: {
            revision: identity.head,
            workspace: 'dedicated_worktree',
          },
        },
      });
      expect(JSON.stringify(task?.input)).toContain(
        'Inspect existing limits, batching',
      );
      expect(JSON.stringify(task?.input)).toContain(
        'Do not execute benchmarks or code from the PR',
      );
      expect(
        report.results.find((item) => item.lane === 'performance'),
      ).toMatchObject({ ...result, status });
      const comment = renderAdaptiveComment(report, 'https://example.test/run');
      expect(comment).toContain(
        '| performance | 90% (selected) | ' + status + ' |',
      );
      if (status === 'unclear') expect(comment).toContain('Maximum input size');
      if (status === 'concern')
        expect(comment).toContain('100 sequential queries');
      expect(createTask).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    'tests',
    'conventions',
    'blast-radius',
    'performance',
    'security',
  ] as const)(
    'delivers base guidance to the classifier and %s tasks',
    async (lane) => {
      guidanceEnabled = true;
      const { tasks, createTask } = harness({
        selected: lane,
        ...(lane === 'security'
          ? { securityFindingStatus: 'refuted' as const }
          : {}),
      });
      const report = await review(tasks);
      const bodies = createTask.mock.calls.map(([body]) => body);
      const classifier = bodies.find((body) => body.taskType === 'classify');
      expect(classifier?.input).toMatchObject({
        state: {
          trustedReviewGuidance: [
            {
              path: 'REVIEW.md',
              content: 'Require route compatibility evidence.',
            },
          ],
        },
      });
      const specialists = bodies.filter((body) => body.taskType === 'freeform');
      expect(specialists.length).toBe(lane === 'security' ? 2 : 1);
      for (const body of specialists)
        expect(JSON.stringify(body.input)).toContain(
          'Require route compatibility evidence.',
        );
      expect(report.referenceDigests['REVIEW.md']).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it.each(['docs', 'complexity'] as const)(
    'delivers guidance through the %s downstream task client',
    async (lane) => {
      guidanceEnabled = true;
      const { tasks, createTask } = harness({ selected: lane });
      await review(tasks);
      const delegated =
        lane === 'docs'
          ? (
              mocks.runDocsImpactReview.mock.calls[0][0] as {
                tasks: TaskClient;
              }
            ).tasks
          : (mocks.runComplexityReview.mock.calls[0][0] as TaskClient);
      for (const stage of lane === 'docs'
        ? ['extract', 'coverage', 'docs-check']
        : ['map', 'domain', 'synthesis']) {
        await delegated.createTask({
          taskType: 'freeform',
          title: stage,
          diaryId: 'diary',
          teamId: 'team',
          input: { brief: `Review ${stage}` },
        } as Parameters<TaskClient['createTask']>[0]);
        const body = createTask.mock.calls.at(-1)?.[0];
        expect(JSON.stringify(body?.input)).toContain(
          'Require route compatibility evidence.',
        );
      }
    },
  );

  it('publishes a focused concern with a changed-line citation', async () => {
    const { tasks } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'A changed behavior needs a test.',
        findings: [
          {
            path: sourcePath,
            side: 'new',
            line: 1,
            concern: 'The new route is untested.',
            action: 'Add a route test.',
          },
        ],
        unclear: [],
      },
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'concern',
      findings: [
        {
          path: sourcePath,
          side: 'new',
          line: 1,
          concern: 'The new route is untested.',
        },
      ],
    });
  });

  it('passes previous findings into the focused task and retains their validated reference', async () => {
    const key = `tests:new:2:${encodeURIComponent(sourcePath)}`;
    const { tasks, createTask } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'Continuing concern',
        priorFindingOutcomes: [
          {
            key,
            status: 'still_present',
            explanation: 'Current route still lacks coverage.',
          },
        ],
        unclear: [],
        findings: [
          {
            path: sourcePath,
            side: 'new',
            line: 1,
            concern: 'The new route is untested.',
            action: 'Add a route test.',
            existingFindingKey: key,
          },
        ],
      },
    });
    const report = await runAdaptiveReview({
      ...reviewOptions(tasks),
      previousFindings: [
        {
          key,
          lane: 'tests',
          path: sourcePath,
          line: 2,
          side: 'new',
          threadId: 'prior',
          url: 'https://github.com/example/repo/pull/1#discussion_r1',
          head: 'd'.repeat(40),
          isResolved: false,
          isOutdated: false,
          body: 'Earlier route coverage concern',
          replies: [],
        },
      ],
    });
    expect(
      createTask.mock.calls.some(
        ([body]) =>
          typeof body.input.brief === 'string' &&
          body.input.brief.includes('Earlier route coverage concern'),
      ),
    ).toBe(true);
    expect(
      report.results.find((result) => result.lane === 'tests')?.findings[0],
    ).toMatchObject({ line: 1, existingFindingKey: key });
  });

  it.each(['screened', 'failed', 'disabled'] as const)(
    'reports an earlier concern as not checked when its lane is %s',
    async (state) => {
      const { tasks } = harness({
        selected: state === 'failed' ? 'tests' : 'performance',
        invalidFocusedOutput: state === 'failed',
      });
      if (state === 'disabled')
        policyOverride = JSON.stringify({
          version: 1,
          lanes: ['performance'],
          rules: [],
          checks: [],
        });
      const report = await runAdaptiveReview({
        ...reviewOptions(tasks),
        previousFindings: [
          {
            key: 'tests:new:1:old.ts',
            lane: 'tests',
            path: 'old.ts',
            line: 1,
            side: 'new',
            threadId: 'old',
            url: 'https://github.com/example/repo/pull/1#discussion_r1',
            head: 'd'.repeat(40),
            isResolved: false,
            isOutdated: true,
            body: 'Earlier guard concern',
            replies: [],
          },
        ],
      });
      expect(report.priorFindingOutcomes).toEqual([
        expect.objectContaining({
          key: 'tests:new:1:old.ts',
          status: 'not_checked',
        }),
      ]);
      expect(hasIncompleteCoverage(report)).toBe(true);
      expect(
        renderAdaptiveComment(report, 'https://example.com/run'),
      ).toContain('Not checked / uncertain');
      expect(
        renderAdaptiveComment(report, 'https://example.com/run'),
      ).not.toContain('Nothing needs fixing');
    },
  );

  it('preserves the old side for a finding on a deleted line', async () => {
    const { tasks } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'The removed guard needs a regression test.',
        findings: [
          {
            path: sourcePath,
            side: 'old',
            line: 1,
            concern: 'The old guard was removed without a test.',
            action: 'Add a regression test.',
          },
        ],
        unclear: [],
      },
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      findings: [
        {
          path: sourcePath,
          side: 'old',
          line: 1,
          concern: 'The old guard was removed without a test.',
          action: 'Add a regression test.',
        },
      ],
    });
  });

  it('accepts an old-side citation on the former path of a rename', async () => {
    const renamedPatch = [
      'diff --git a/src/old.ts b/src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    mocks.buildEvidence.mockReturnValue({
      ...evidence,
      files: [
        {
          path: 'src/new.ts',
          patch: renamedPatch,
          bytes: Buffer.byteLength(renamedPatch),
        },
      ],
    });
    const { tasks } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'The old behavior needs coverage.',
        findings: [
          {
            path: 'src/old.ts',
            side: 'old',
            line: 1,
            concern: 'The removed behavior needs a test.',
            action: 'Add a regression test.',
          },
        ],
        unclear: [],
      },
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'concern',
      findings: [{ path: 'src/old.ts', side: 'old', line: 1 }],
    });
  });

  it('marks a focused lane unclear when evidence is insufficient', async () => {
    const { tasks } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'The caller is outside the diff.',
        findings: [],
        unclear: ['Caller behavior could not be checked.'],
      },
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'unclear',
      findings: [],
      unclear: ['Caller behavior could not be checked.'],
    });
  });

  it('keeps the PR 2923 branching observation as an assessment, not a finding', async () => {
    mocks.runComplexityReview.mockResolvedValue({
      taskIds: ['complexity-task'],
      output: {
        verdict:
          'Overall acceptable, though reviewers must handle the added branching logic.',
        scores: [
          {
            criterionId: 'cognitive_load',
            status: 'fail',
            rationale:
              'New validation and abort branches introduce additional control flow.',
          },
        ],
      },
      unreviewedDomainWork: 0,
    });
    const { tasks } = harness({ selected: 'complexity' });

    const report = await review(tasks);
    const result = report.results.find((item) => item.lane === 'complexity');
    expect(result).toMatchObject({ status: 'concern', findings: [] });
    expect(result?.summary).toContain('cognitive_load: New validation');
    const comment = renderAdaptiveComment(report, 'https://example.com/run');
    expect(comment).toContain(
      'Findings: 0. No actionable findings were reported.',
    );
    expect(comment).toContain('### Complexity assessment');
    expect(comment).toContain('Overall acceptable');
    expect(comment).not.toContain('Investigated concerns:');
  });

  it('marks incomplete complexity coverage unclear even when reviewed scores pass', async () => {
    mocks.runComplexityReview.mockResolvedValue({
      taskIds: ['complexity-task'],
      output: { verdict: 'Low complexity', scores: [] },
      unreviewedDomainWork: 1,
    });
    const { tasks } = harness({ selected: 'complexity' });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'complexity'),
    ).toMatchObject({
      status: 'unclear',
      summary: 'Incomplete coverage: 1 domain segment was not reviewed.',
      unclear: [],
    });
  });

  it('names unassessed complexity criteria instead of the verdict', async () => {
    mocks.runComplexityReview.mockResolvedValue({
      taskIds: ['complexity-task'],
      output: {
        verdict: 'Pass',
        scores: [
          { criterionId: 'state', status: 'pass', rationale: 'Local state.' },
          {
            criterionId: 'coupling',
            status: 'unclear',
            rationale: 'Callers were not inspected.',
          },
        ],
      },
      unreviewedDomainWork: 0,
    });
    const { tasks } = harness({ selected: 'complexity' });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'complexity'),
    ).toMatchObject({
      status: 'unclear',
      summary: '1 rubric criterion could not be assessed.',
      unclear: ['coupling: Callers were not inspected.'],
    });
  });

  it('passes PR commit messages to the complexity review oldest first', async () => {
    mocks.runComplexityReview.mockResolvedValue({
      taskIds: ['complexity-task'],
      output: { verdict: 'Low complexity', scores: [] },
      unreviewedDomainWork: 0,
    });
    const { tasks } = harness({ selected: 'complexity' });

    await review(tasks);

    expect(gitCalls).toContainEqual([
      'log',
      '--reverse',
      '--max-count=100',
      '--format=%B%x00',
      `${identity.base}..${identity.head}`,
    ]);
    expect(mocks.runComplexityReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        commits: ['feat: first\n\nBody', 'fix: second'],
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects a focused finding cited outside changed lines', async () => {
    const { tasks } = harness({
      selected: 'tests',
      focusedResult: {
        summary: 'A citation needs checking.',
        findings: [
          {
            path: sourcePath,
            side: 'new',
            line: 2,
            concern: 'The route might be untested.',
            action: 'Add a route test.',
          },
        ],
        unclear: [],
      },
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'failed',
      taskIds: ['task-2'],
      summary:
        'tests review failed (invalid-finding-citation); inspect task task-2.',
      findings: [],
    });
  });

  it('reuses prepared routing and classifier task IDs without reclassifying', async () => {
    const { tasks, createTask } = harness({ selected: 'tests' });
    const options = reviewOptions(tasks);
    const preparation = await prepareAdaptiveReview(options);

    expect(preparation.classifierTaskIds).toEqual(['task-1']);
    expect(
      preparation.routing.routes.find((route) => route.lane === 'tests'),
    ).toMatchObject({ run: true });
    expect(createTask).toHaveBeenCalledTimes(1);

    const report = await runRoutedAdaptiveReview(options, preparation);

    expect(report.routing).toEqual(preparation.routing);
    expect(report.taskIds).toEqual(['task-1', 'task-2']);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(
      createTask.mock.calls.filter(([task]) => task.taskType === 'classify'),
    ).toHaveLength(1);
  });

  it('does not request a docs worker when the docs lane has no relevant files', async () => {
    const { tasks } = harness({ selected: 'docs' });
    mocks.collectChangeSet.mockReturnValueOnce({ files: [] });

    const preparation = await prepareAdaptiveReview(reviewOptions(tasks));

    expect(
      preparation.routing.routes.find((route) => route.lane === 'docs')?.run,
    ).toBe(true);
    expect(preparation.docsTaskPossible).toBe(false);
  });

  it('rejects prepared routing for another pinned head or mode', async () => {
    const { tasks, createTask } = harness({ selected: 'tests' });
    const options = reviewOptions(tasks);
    const preparation = await prepareAdaptiveReview(options);

    await expect(
      runRoutedAdaptiveReview(
        { ...options, identity: { ...identity, head: 'c'.repeat(40) } },
        preparation,
      ),
    ).rejects.toThrow('routing does not match the pinned review');
    await expect(
      runRoutedAdaptiveReview({ ...options, mode: 'shadow' }, preparation),
    ).rejects.toThrow('routing does not match the pinned review');
    await expect(
      runRoutedAdaptiveReview(
        {
          ...options,
          taskBudgets: {
            ...options.taskBudgets,
            security: {
              ...taskBudgets.security,
              runningTimeoutSec: 702,
            },
          },
        },
        preparation,
      ),
    ).rejects.toThrow('routing does not match the pinned review');
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('waits for one classifier outcome before creating the next packet task', async () => {
    const largePatch = `${patch}\n+${'x'.repeat(25_000)}`;
    mocks.buildEvidence.mockReturnValue({
      ...evidence,
      files: [
        {
          path: sourcePath,
          patch: largePatch,
          bytes: Buffer.byteLength(largePatch),
        },
      ],
      bytes: Buffer.byteLength(largePatch),
    });
    const { tasks, createTask } = harness();
    let releaseFirst: () => void = () => {
      throw new Error('first classifier was not awaited');
    };
    const firstOutcome = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.waitForTaskOutcome.mockImplementation(
      async (
        id: string,
        { parse }: { parse: (output: unknown) => unknown },
      ) => {
        if (id === 'task-1') await firstOutcome;
        return {
          kind: 'accepted',
          result: { state: parse({ answers: answers() }) },
        };
      },
    );

    const pending = review(tasks);
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(mocks.waitForTaskOutcome).toHaveBeenCalledTimes(1);
    releaseFirst();

    const report = await pending;
    expect(report.packetCount).toBe(2);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(report.taskIds).toEqual(['task-1', 'task-2']);
  });

  it('bounds classifier tasks and deep-reviews every lane when packets exceed the budget', async () => {
    const files = Array.from({ length: 5 }, (_, index) => {
      const path = `apps/rest-api/src/routes/large-${index}.ts`;
      const filePatch = [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        '@@ -1 +1 @@',
        '-old',
        `+${'x'.repeat(18_000)}`,
      ].join('\n');
      return {
        path,
        patch: filePatch,
        bytes: Buffer.byteLength(filePatch),
      };
    });
    mocks.buildEvidence.mockReturnValue({
      manifest: files.map((file) => file.path).join('\n'),
      files,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      generatedPaths: [],
    });
    const { tasks, createTask } = harness();

    const preparation = await prepareAdaptiveReview(reviewOptions(tasks));

    expect(preparation.packetCount).toBe(5);
    expect(classifierTaskPossible(cwd, identity.base, identity.head)).toBe(
      false,
    );
    expect(preparation.classifierTaskIds).toEqual([]);
    expect(createTask).not.toHaveBeenCalled();
    expect(preparation.routing.classifierFailed).toBe(false);
    expect(
      preparation.routing.routes.every(
        (route) => route.run && route.reason === 'classifier-skipped',
      ),
    ).toBe(true);
    expect(preparation.gaps).toContain(
      'Classifier packet budget exceeded: 5 > 4; all lanes routed for review.',
    );
  });

  it('runs every deep lane and records a gap when classification fails', async () => {
    const { tasks, createTask, created } = harness({ classifierFails: true });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const report = await review(tasks);

    expect(log).toHaveBeenCalledWith(
      'Adaptive classifier failure: packet=1 stage=task-outcome code=unexpected-error taskId=task-1\n',
    );
    expect(log.mock.calls.flat().join('')).not.toContain(
      'classifier unavailable',
    );

    expect(report.routing.classifierFailed).toBe(true);
    expect(report.routing.routes.every((route) => route.run)).toBe(true);
    expect(report.gaps).toEqual([
      'Classifier failed for packet 1 (unexpected-error); inspect its task outcome.',
    ]);
    expect(report.results.every((result) => result.status === 'clear')).toBe(
      true,
    );
    expect(mocks.runDocsImpactReview).toHaveBeenCalledOnce();
    expect(mocks.runDocsImpactReview.mock.calls[0][1]).toMatchObject({
      tags: [
        'review:adaptive',
        'lane:docs',
        'repo:getlarge/themoltnet',
        'pr:42',
        `revision:${identity.head}`,
      ],
    });
    expect(mocks.runDocsImpactReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { serialTaskDispatch: true },
    );
    expect(mocks.runComplexityReview).toHaveBeenCalledOnce();
    expect(mocks.runComplexityReview.mock.calls[0][1]).toMatchObject({
      tags: ['review:adaptive', 'lane:complexity'],
    });
    expect(mocks.runComplexityReview).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { serialDomainDispatch: true },
    );
    expect(
      [...created.values()].some((task) =>
        task.title?.includes('security hunt'),
      ),
    ).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(6);
    for (const task of created.values()) {
      expect(task.tags).toEqual(
        expect.arrayContaining([
          'review:adaptive',
          'repo:getlarge/themoltnet',
          'pr:42',
          `revision:${identity.head}`,
        ]),
      );
    }
  });

  it('scopes classifier and specialist tasks to the worker project', async () => {
    const { tasks, createTask } = harness({ classifierFails: true });
    const projectId = '00000000-0000-4000-8000-000000000005';
    const options = { ...reviewOptions(tasks), projectId };

    const preparation = await prepareAdaptiveReview(options);
    await runRoutedAdaptiveReview(options, preparation);

    expect(createTask).toHaveBeenCalledTimes(6);
    for (const [body] of createTask.mock.calls) {
      expect(body.projectId).toBe(projectId);
    }
    expect(mocks.runDocsImpactReview.mock.calls[0][1]).toMatchObject({
      projectId,
    });
    const complexityTasks = mocks.runComplexityReview.mock
      .calls[0][0] as TaskClient;
    await complexityTasks.createTask(createTask.mock.calls[0][0]);
    expect(createTask.mock.calls.at(-1)?.[0].projectId).toBe(projectId);
  });

  it('logs the task attempt code for failed lane tasks', async () => {
    policyOverride = JSON.stringify({
      version: 1,
      lanes: ['tests', 'complexity'],
      rules: [],
      checks: [],
    });
    const { tasks, created } = harness({ selected: 'tests' });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const accept = mocks.waitForTaskOutcome.getMockImplementation();
    mocks.waitForTaskOutcome.mockImplementation((id: string, opts: never) =>
      created.get(id)?.title?.includes('tests review')
        ? Promise.resolve({
            kind: 'failed',
            task: {},
            attempts: [
              { attemptN: 1, error: { code: 'executor_threw' } },
              { attemptN: 2, error: { code: 'max_turns_exceeded' } },
            ],
            reason: `task ${id} ended with status failed`,
          })
        : (accept?.(id, opts) as Promise<unknown>),
    );
    mocks.runComplexityReview.mockRejectedValueOnce(
      Object.assign(new Error('Internal Server Error'), {
        name: 'MoltNetError',
        statusCode: 500,
      }),
    );

    const report = await runAdaptiveReview({
      ...reviewOptions(tasks),
      mode: 'shadow',
    });

    expect(report.results.map((result) => result.status)).toEqual([
      'failed',
      'failed',
    ]);
    const lines = log.mock.calls.flat().join('');
    expect(lines).toMatch(/lane=tests .*code=task-max-turns-exceeded /);
    expect(lines).toMatch(/lane=complexity .*code=http-500 /);
  });

  it('distinguishes network errors from rejected task output', async () => {
    policyOverride = JSON.stringify({
      version: 1,
      lanes: ['tests', 'complexity'],
      rules: [],
      checks: [],
    });
    const { tasks } = harness({
      selected: 'tests',
      invalidFocusedOutput: true,
    });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.runComplexityReview.mockRejectedValueOnce(
      Object.assign(new Error('Heartbeat request timed out'), {
        name: 'NetworkError',
      }),
    );

    await runAdaptiveReview({
      ...reviewOptions(tasks),
      mode: 'shadow',
    });

    const lines = log.mock.calls.flat().join('');
    expect(lines).toMatch(/lane=tests .*code=invalid-focused-result /);
    expect(lines).toMatch(/lane=complexity .*code=network-error /);
  });

  it('retains successful lanes and task IDs when another deep lane fails', async () => {
    const { tasks } = harness({ classifierFails: true });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.runDocsImpactReview.mockRejectedValueOnce(
      new Error('docs reviewer unavailable: private token'),
    );

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'docs'),
    ).toMatchObject({
      status: 'failed',
      summary:
        'docs review failed before a task was created (unexpected-error); inspect workflow logs.',
    });
    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({ status: 'clear', taskIds: [expect.any(String)] });
    expect(report.taskIds).toContain('task-1');
    expect(report.taskIds).toContain(
      report.results.find((result) => result.lane === 'tests')?.taskIds[0],
    );
    expect(report.gaps).toEqual([
      'Classifier failed for packet 1 (unexpected-error); inspect its task outcome.',
    ]);
    expect(log).toHaveBeenCalledWith(
      'Adaptive lane failure: lane=docs stage=before-task code=unexpected-error taskIds=none\n',
    );
    expect(log.mock.calls.flat().join('')).not.toContain('private token');
  });

  it('fails waiting work with worker-unavailable once its workers stopped', async () => {
    const { tasks, createTask } = harness({ selected: 'security' });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stopped = new Set(['classifier', 'security']);

    const report = await runAdaptiveReview({
      ...reviewOptions(tasks),
      workers: { stopped: (pool) => Promise.resolve(stopped.has(pool)) },
    });

    expect(report.gaps).toEqual([
      'Classifier failed for packet 1 (worker-unavailable); inspect workflow logs.',
    ]);
    expect(
      report.results.find((result) => result.lane === 'security'),
    ).toMatchObject({
      status: 'failed',
      summary:
        'security review failed before a task was created (worker-unavailable); inspect workflow logs.',
      taskIds: [],
    });
    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({ status: 'clear' });
    expect(createTask.mock.calls.map(([body]) => body.taskType)).not.toContain(
      'classify',
    );
    expect(log).toHaveBeenCalledWith(
      'Adaptive classifier failure: packet=1 stage=before-task code=worker-unavailable taskId=none\n',
    );
    expect(log).toHaveBeenCalledWith(
      'Adaptive lane failure: lane=security stage=before-task code=worker-unavailable taskIds=none\n',
    );
  });

  it('retains a docs task when polling fails before stage timing is recorded', async () => {
    const { tasks } = harness({ selected: 'docs' });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.runDocsImpactReview.mockImplementationOnce(
      async (deps: { tasks: TaskClient }) => {
        await deps.tasks.createTask({
          taskType: 'freeform',
          title: 'Docs extract',
          teamId: identity.teamId,
          diaryId: identity.diaryId,
          tags: ['stage:extract'],
          input: { brief: 'Inspect changed source contracts' },
        } as Parameters<TaskClient['createTask']>[0]);
        return {
          status: 'failed',
          error: 'polling failed: private token',
          findings: [],
          timings: { stages: {} },
        };
      },
    );

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'docs'),
    ).toMatchObject({
      status: 'failed',
      summary:
        'Docs review failed during extract (polling-error); inspect its task outcome.',
      taskIds: ['task-2'],
    });
    expect(report.taskIds).toContain('task-2');
    expect(log).toHaveBeenCalledWith(
      'Adaptive lane failure: lane=docs stage=extract code=polling-error taskIds=task-2\n',
    );
    expect(log.mock.calls.flat().join('')).not.toContain('private token');
  });

  it('does not blame a later docs task for an earlier polling failure', async () => {
    const { tasks } = harness({ selected: 'docs' });
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mocks.runDocsImpactReview.mockImplementationOnce(
      async (deps: { tasks: TaskClient }) => {
        for (const stage of ['coverage', 'docs-check']) {
          await deps.tasks.createTask({
            taskType: 'freeform',
            title: `Docs ${stage}`,
            teamId: identity.teamId,
            diaryId: identity.diaryId,
            tags: [`stage:${stage}`],
            input: { brief: 'Review docs' },
          } as Parameters<TaskClient['createTask']>[0]);
        }
        return {
          status: 'failed',
          error: 'polling failed: private token',
          findings: [],
          timings: { stages: {} },
        };
      },
    );

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'docs'),
    ).toMatchObject({
      status: 'failed',
      summary:
        'Docs review failed during task-outcome (polling-error); inspect its task outcome.',
      taskIds: ['task-2', 'task-3'],
    });
    expect(log).toHaveBeenCalledWith(
      'Adaptive lane failure: lane=docs stage=task-outcome code=polling-error taskIds=task-2,task-3\n',
    );
    expect(log.mock.calls.flat().join('')).not.toContain('private token');
  });

  it.each([
    [
      'updates-needed',
      'concern',
      [{ path: 'docs/use/entries.md', concern: 'Explain the changed route.' }],
      [
        'docs/use/entries.md: patch truncated at the per-file budget (budgets.diffPerFileBytes)',
        'docs-check stage: timed out',
      ],
    ],
    [
      'incomplete',
      'unclear',
      [],
      [
        'docs/use/entries.md: patch truncated at the per-file budget (budgets.diffPerFileBytes)',
        'docs-check stage: timed out',
      ],
    ],
  ] as const)(
    'maps docs outcome %s to %s',
    async (outcome, status, findings, unclear) => {
      const { tasks } = harness({ selected: 'docs' });
      mocks.runDocsImpactReview.mockResolvedValueOnce({
        status: 'completed',
        outcome,
        findings: findings.map((finding) => ({
          docsPath: finding.path,
          update: finding.concern,
        })),
        gaps: [
          {
            scope: 'docs/use/entries.md',
            reason:
              'patch truncated at the per-file budget (budgets.diffPerFileBytes)',
          },
          { scope: 'docs-check stage', reason: 'timed out' },
        ],
        timings: { stages: { inspect: { taskId: 'docs-task' } } },
      });

      const report = await review(tasks);

      expect(
        report.results.find((result) => result.lane === 'docs'),
      ).toMatchObject({
        status,
        taskIds: ['docs-task'],
        findings,
        ...(unclear ? { unclear } : {}),
      });
      expect(hasIncompleteCoverage(report)).toBe(true);
      const comment = renderAdaptiveComment(report, 'https://example.test/run');
      expect(comment).toContain('incomplete coverage');
      expect(comment).toContain('Not fully assessed:');
      for (const gap of unclear) expect(comment).toContain(gap);
      for (const finding of findings)
        expect(comment).toContain(finding.concern);
    },
  );

  it('keeps the created task ID when a focused result is rejected', async () => {
    const { tasks } = harness({
      selected: 'tests',
      invalidFocusedOutput: true,
    });

    const report = await review(tasks);

    expect(
      report.results.find((result) => result.lane === 'tests'),
    ).toMatchObject({
      status: 'failed',
      summary:
        'tests review failed (invalid-focused-result); inspect task task-2.',
      taskIds: ['task-2'],
    });
    expect(report.taskIds).toContain('task-2');
  });

  it('reviews retained source and marks generated paths as unassessed', async () => {
    const generatedPath = 'libs/sdk/src/generated.ts';
    const generatedContent = 'GENERATED_ONLY_SECRET_BOUNDARY_SENTINEL';
    const generatedPatch = [
      `diff --git a/${generatedPath} b/${generatedPath}`,
      `--- a/${generatedPath}`,
      `+++ b/${generatedPath}`,
      '@@ -0,0 +1 @@',
      `+${generatedContent}`,
    ].join('\n');
    mocks.buildEvidence.mockReturnValue({
      ...evidence,
      manifest: `${sourcePath}\n${generatedPath}`,
      files: [
        ...evidence.files,
        {
          path: generatedPath,
          patch: generatedPatch,
          bytes: Buffer.byteLength(generatedPatch),
        },
      ],
      bytes: evidence.bytes + Buffer.byteLength(generatedPatch),
      generatedPaths: [generatedPath],
    });
    const { tasks, created } = harness({ selected: 'security' });
    const report = await review(tasks);

    // Generated paths are excluded by policy; they do not make routing
    // incomplete, but the report still lists them.
    expect(
      report.routing.routes.some((route) => route.reason === 'incomplete'),
    ).toBe(false);
    expect(report.gaps).toContain(
      `Generated path not classified: ${generatedPath}`,
    );
    expect(
      report.results.find((result) => result.lane === 'security'),
    ).toMatchObject({
      status: 'unclear',
      taskIds: [expect.any(String)],
    });
    const securityHunt = [...created.values()].find((task) =>
      task.title?.includes('security hunt'),
    );
    expect(securityHunt?.input.brief).toContain(patch);
    expect(securityHunt?.input.brief).not.toContain(generatedContent);
  });

  it.each([undefined, 'refuted', 'confirmed'] as const)(
    'preserves partial hunt coverage with %s candidates',
    async (securityFindingStatus) => {
      const { tasks } = harness({
        selected: 'security',
        securityCoverage: 'partial',
        securityFindingStatus,
      });
      const report = await review(tasks);
      const result = report.results.find((item) => item.lane === 'security');
      expect(result?.status).toBe(
        securityFindingStatus === 'confirmed' ? 'concern' : 'unclear',
      );
      expect(result?.unclear).toContain(
        'Not assessed: Caller of the changed route in src/server.ts not checked.',
      );
    },
  );

  it.each([
    { securityCoverage: 'missing' },
    { securityCoverage: 'partial', securityUnassessed: [] },
    { securityCandidateCount: 6, securityFindingStatus: 'refuted' as const },
  ])('fails closed on an invalid hunt contract: %j', async (options) => {
    const { tasks, created } = harness({ selected: 'security', ...options });
    const report = await review(tasks);
    expect(
      report.results.find((item) => item.lane === 'security')?.status,
    ).toBe('failed');
    expect(
      [...created.values()].some((task) =>
        task.title?.includes('security verify'),
      ),
    ).toBe(false);
  });

  it('marks binary contents as unassessed after a candidate-free security hunt', async () => {
    const binaryPath = 'apps/rest-api/src/assets/keyring.bin';
    const binaryPatch = `Binary files a/${binaryPath} and b/${binaryPath} differ`;
    mocks.buildEvidence.mockReturnValue({
      manifest: binaryPath,
      files: [
        {
          path: binaryPath,
          patch: binaryPatch,
          bytes: Buffer.byteLength(binaryPatch),
        },
      ],
      bytes: Buffer.byteLength(binaryPatch),
      generatedPaths: [],
    });
    const { tasks } = harness({ selected: 'security' });

    const report = await review(tasks);

    expect(report.gaps).toContain(
      `Binary contents not reviewed: ${binaryPath}`,
    );
    expect(
      report.results.find((result) => result.lane === 'security'),
    ).toMatchObject({
      status: 'unclear',
      taskIds: [expect.any(String)],
    });
  });

  it.each([
    ['confirmed', 'concern'],
    ['unclear', 'unclear'],
    ['refuted', 'clear'],
  ] as const)(
    'verifies a security candidate and maps %s to %s',
    async (securityFindingStatus, status) => {
      const { tasks, created, createTask } = harness({
        selected: 'security',
        securityFindingStatus,
      });
      const report = await review(tasks);

      expect(createTask).toHaveBeenCalledTimes(3);
      expect(created.get('task-2')?.title).toContain('security hunt');
      expect(created.get('task-2')?.input.brief).toContain(patch);
      expect(created.get('task-3')?.title).toContain('security verify');
      for (const taskId of ['task-2', 'task-3']) {
        expect(created.get(taskId)).toMatchObject({
          ...taskBudgets.security,
        });
      }
      expect(created.get('task-3')?.input.brief).toContain(
        '"id":"changed-route"',
      );
      const result = report.results.find((item) => item.lane === 'security');
      expect(result).toMatchObject({ status, taskIds: ['task-2', 'task-3'] });
      expect(result?.summary).toBe(
        {
          confirmed:
            'Security candidates: 1 confirmed (highest severity: medium), 0 unresolved, 0 refuted.',
          unclear: 'Security candidates: 0 confirmed, 1 unresolved, 0 refuted.',
          refuted: 'Security candidates: 0 confirmed, 0 unresolved, 1 refuted.',
        }[securityFindingStatus],
      );
      expect(result?.findings).toEqual(
        securityFindingStatus === 'confirmed'
          ? [
              {
                path: sourcePath,
                side: 'new',
                line: 1,
                concern:
                  'Medium severity: Changed route behavior. The route has a caller.',
                action: 'Restore the guard if needed.',
              },
            ]
          : [],
      );
      expect(result?.unclear).toEqual(
        securityFindingStatus === 'unclear'
          ? [
              `Unresolved at ${sourcePath}:1: Changed route behavior. The changed route was inspected.`,
            ]
          : [],
      );
      expect(report.taskIds).toEqual(['task-1', 'task-2', 'task-3']);
    },
  );

  it('marks summarized source as unassessed after a candidate-free security hunt', async () => {
    mocks.buildEvidence.mockReturnValue({
      ...evidence,
      files: [{ ...evidence.files[0], summarized: true }],
    });
    const { tasks, created } = harness({ selected: 'security' });
    const report = await review(tasks);

    expect(report.gaps).toEqual([expect.stringContaining(sourcePath)]);
    expect(
      report.results.find((result) => result.lane === 'security'),
    ).toMatchObject({ status: 'unclear', taskIds: [expect.any(String)] });
    expect(
      [...created.values()].some((task) =>
        task.title?.includes('security verify'),
      ),
    ).toBe(false);
  });
});
