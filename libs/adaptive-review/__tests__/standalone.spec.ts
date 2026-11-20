import { MoltNetError, NetworkError } from '@themoltnet/sdk';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { replayContext } from '@themoltnet/tasks-orchestrator/testing';
import { SuspendTask } from 'absurd-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMPLEXITY_RUBRIC } from '../src/review-assets.js';
import { scopedReviewTasks } from '../src/review-tasks.js';
import {
  conductAdaptiveReview,
  type StandaloneReviewInput,
  type StandaloneReviewServices,
} from '../src/standalone.js';
import { standaloneCommand } from '../src/standalone-host.js';
import { reviewWorkerArgs, reviewWorkerSpecs } from '../src/supervisor.js';
import {
  IdempotentReviewTasks,
  reviewFixture,
  reviewOutput,
} from './recovery-fixture.js';

const fixtures: ReturnType<typeof reviewFixture>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});

function fixture(tasks = new IdempotentReviewTasks(), lanes?: string[]) {
  const repo = reviewFixture(undefined, lanes);
  fixtures.push(repo);
  const options = repo.options(tasks);
  const input: StandaloneReviewInput = {
    repo: options.identity.repo,
    pr: 7,
    correlationId: 'a1234567-1234-4123-8123-123456789012',
    teamId: 'team',
    diaryId: 'diary',
    runtimeSha: repo.base,
    mode: 'shadow',
    profiles: { classifier: 'classifier', focused: 'reviewer' },
    taskBudgets: options.taskBudgets,
    protectedPaths: [],
    appLogin: 'reviewer[bot]',
    publication: 'github',
    runUrl: 'https://example.com/review/7',
    inlineFindings: true,
  };
  const services: StandaloneReviewServices = {
    cwd: repo.cwd,
    github: {
      pullRequest: vi.fn(async () => ({
        number: 7,
        title: 'Change value',
        body: '',
        changed_files: 1,
        user: { login: 'contributor' },
        head: { sha: repo.head, repo: { full_name: input.repo } },
        base: { sha: repo.base },
      })),
      files: async () => [{ filename: 'example.ts' }],
      revisions: async () => ({ base: repo.base, head: repo.head }),
      reviewThreads: async () => [],
    },
    connect: async () => ({
      profiles: async () =>
        ['classifier', 'reviewer'].map((id) => ({ id, name: id, revision: 1 })),
      tasks,
    }),
    ensureGit: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
  };
  return { repo, tasks, input, services };
}

describe('complete adaptive review workflow', () => {
  it('uses the classifier decision to skip unneeded specialist branches in active mode', async () => {
    const tasks = new IdempotentReviewTasks(() => ({
      answers: {
        tests: { type: 'bool', probability: 0 },
        conventions: { type: 'bool', probability: 0 },
      },
    }));
    const { input, services } = fixture(tasks);
    services.ensureCapacity = vi.fn(async () => {});
    const result = await conductAdaptiveReview(
      { ...input, mode: 'active', publication: 'report-only' },
      replayContext(),
      services,
    );
    expect(
      result.status === 'completed' &&
        result.report.results.every((lane) => lane.status === 'screened'),
    ).toBe(true);
    expect(tasks.created).toHaveLength(1);
    expect(services.ensureCapacity).toHaveBeenCalledExactlyOnceWith([
      { pool: 'classifier', profile: 'classifier', count: 1 },
    ]);
    expect(services.publish).not.toHaveBeenCalled();
  });
  it('conducts the entire review without Actions inputs or intermediate files', async () => {
    const { tasks, input, services } = fixture();
    const ctx = replayContext(input.correlationId);
    const result = await conductAdaptiveReview(input, ctx, services);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a report');
    expect(result.report.results.map((lane) => lane.status)).toEqual([
      'clear',
      'clear',
    ]);
    expect(tasks.created).toHaveLength(3);
    expect(
      tasks.created.every((body) => body.correlationId === input.correlationId),
    ).toBe(true);
    expect(services.publish).toHaveBeenCalledOnce();
    ctx.resetForReplay();
    expect(await conductAdaptiveReview(input, ctx, services)).toEqual(result);
    expect(tasks.created).toHaveLength(3);
    expect(services.github.pullRequest).toHaveBeenCalledOnce();
    expect(services.publish).toHaveBeenCalledOnce();
    // A finished investigation replays without reconstructing host-local Git.
    expect(services.ensureGit).toHaveBeenCalledOnce();
  });

  it('recovers across classification and lane dispatch without resubmission', async () => {
    const { tasks, input, services } = fixture();
    const ctx = replayContext(input.correlationId);
    const complete = ctx.completeStep.bind(ctx);
    let interrupted = false;
    ctx.completeStep = (handle, value) => {
      if (!interrupted && handle.name === 'routing') {
        interrupted = true;
        throw new SuspendTask();
      }
      return complete(handle, value);
    };
    await expect(
      conductAdaptiveReview(input, ctx, services),
    ).rejects.toBeInstanceOf(SuspendTask);
    expect(tasks.created).toHaveLength(1);
    ctx.resetForReplay();
    expect((await conductAdaptiveReview(input, ctx, services)).status).toBe(
      'completed',
    );
    expect(tasks.created).toHaveLength(3);
    expect(services.publish).toHaveBeenCalledOnce();
  });

  it('does not freeze a coordinator creation error into classifier fallback or a failed lane', async () => {
    const { tasks, input, services } = fixture();
    const ctx = replayContext(input.correlationId);
    const get = vi.spyOn(tasks, 'createTask');
    get.mockRejectedValueOnce(new NetworkError('transport unavailable'));
    await expect(
      conductAdaptiveReview(input, ctx, services),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(tasks.created).toHaveLength(0);
    ctx.resetForReplay();
    const result = await conductAdaptiveReview(input, ctx, services);
    expect(result.status).toBe('completed');
    expect(tasks.created).toHaveLength(3);
    expect(ctx.checkpointNames).toContain('routing');
  });

  it('recovers aggregated complexity domain creation interruptions with the original map and key', async () => {
    const tasks = new IdempotentReviewTasks((body) => {
      if (body.taskType === 'classify') return reviewOutput(body);
      if (body.tags?.includes('stage:map'))
        return {
          result: { groups: [{ nature: 'small change', fileIndexes: [0] }] },
        };
      if (body.tags?.some((tag) => tag.startsWith('stage:domain:')))
        return {
          result: {
            summary: 'Checked change',
            signals: [
              {
                criterionId: DEFAULT_COMPLEXITY_RUBRIC.criteria[0].id,
                evidence: 'one isolated change',
                impact: 'neutral',
              },
            ],
          },
        };
      return {
        result: {
          scores: DEFAULT_COMPLEXITY_RUBRIC.criteria.map((criterion) => ({
            criterionId: criterion.id,
            status: 'pass',
            rationale: 'small isolated change',
          })),
          verdict: 'Low',
        },
      };
    });
    const { input, services } = fixture(tasks, ['complexity']);
    input.profiles.complexity = 'reviewer';
    const create = tasks.createTask.bind(tasks);
    const domainKeys: Array<string | undefined> = [];
    let interrupted = false;
    tasks.createTask = async (body, options) => {
      if (body.tags?.some((tag) => tag.startsWith('stage:domain:'))) {
        domainKeys.push(options?.idempotencyKey);
        if (!interrupted) {
          interrupted = true;
          throw new NetworkError('domain creation interrupted');
        }
      }
      return create(body, options);
    };
    const ctx = replayContext(input.correlationId);
    await expect(
      conductAdaptiveReview(input, ctx, services),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(ctx.checkpointNames).not.toContain('report');
    const mapIds = tasks.created.filter((task) =>
      task.tags?.includes('stage:map'),
    );
    expect(mapIds).toHaveLength(1);
    ctx.resetForReplay();
    const result = await conductAdaptiveReview(input, ctx, services);
    expect(
      result.status === 'completed' && result.report.results[0].status,
    ).toBe('clear');
    expect(
      tasks.created.filter((task) => task.tags?.includes('stage:map')),
    ).toHaveLength(1);
    expect(domainKeys).toHaveLength(2);
    expect(domainKeys[1]).toBe(domainKeys[0]);
  });

  it('records a permanent rejection for its lane while preserving other completed lanes', async () => {
    const { tasks, input, services } = fixture();
    const create = tasks.createTask.bind(tasks);
    const rejected = vi.fn();
    tasks.createTask = (body, options) => {
      if (body.tags?.includes('lane:tests')) {
        rejected();
        return Promise.reject(
          new MoltNetError('not permitted', {
            statusCode: 403,
            code: 'FORBIDDEN',
          }),
        );
      }
      return create(body, options);
    };
    const ctx = replayContext(input.correlationId);
    const result = await conductAdaptiveReview(input, ctx, services);
    expect(
      result.status === 'completed' &&
        result.report.results.map((lane) => lane.status),
    ).toEqual(['failed', 'clear']);
    ctx.resetForReplay();
    await conductAdaptiveReview(input, ctx, services);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('retains terminal task failure without manufacturing a new execution budget', async () => {
    const tasks = new IdempotentReviewTasks((body) =>
      body.taskType === 'classify'
        ? reviewOutput(body)
        : {
            __taskStatus: 'failed',
            error: { code: 'attempts_exhausted', retryable: false },
          },
    );
    const { input, services } = fixture(tasks);
    const ctx = replayContext(input.correlationId);
    const result = await conductAdaptiveReview(input, ctx, services);
    expect(
      result.status === 'completed' &&
        result.report.results.every((lane) => lane.status === 'failed'),
    ).toBe(true);
    ctx.resetForReplay();
    await conductAdaptiveReview(input, ctx, services);
    expect(tasks.created).toHaveLength(3);
  });

  it('retries publication without repeating classification or successful review work', async () => {
    const { input, tasks, services } = fixture();
    vi.mocked(services.publish).mockRejectedValueOnce(
      new Error('publish unavailable'),
    );
    const ctx = replayContext(input.correlationId);
    await expect(conductAdaptiveReview(input, ctx, services)).rejects.toThrow(
      'publish unavailable',
    );
    ctx.resetForReplay();
    services.connect = () =>
      Promise.reject(new Error('Task API unavailable during publication'));
    vi.mocked(services.ensureGit).mockRejectedValue(
      new Error('Git data unavailable during publication'),
    );
    await conductAdaptiveReview(input, ctx, services);
    expect(tasks.created).toHaveLength(3);
    expect(services.publish).toHaveBeenCalledTimes(2);
  });

  it('skips ineligible requests before fetching Git data or dispatching tasks', async () => {
    const { input, tasks, services } = fixture();
    services.ensureCapacity = vi.fn(async () => {});
    const original = await services.github.pullRequest(input.repo, input.pr);
    vi.mocked(services.github.pullRequest).mockResolvedValue({
      ...original,
      user: { login: 'dependabot[bot]' },
    });
    expect(
      (await conductAdaptiveReview(input, replayContext(), services)).status,
    ).toBe('skipped');
    expect(tasks.created).toHaveLength(0);
    expect(services.ensureGit).not.toHaveBeenCalled();
    expect(services.ensureCapacity).not.toHaveBeenCalled();
  });
});

describe('review-scoped worker host', () => {
  it('passes the same correlation to every worker and scopes project claims through a binding', () => {
    const { input } = fixture();
    const specs = reviewWorkerSpecs(input);
    expect(specs).toHaveLength(5);
    for (const spec of specs) {
      const args = reviewWorkerArgs(input, spec, 'agent');
      expect(args[args.indexOf('--correlation-id') + 1]).toBe(
        input.correlationId,
      );
      expect(args).toContain('--team');
      expect(args).toContain('--general');
      const projectArgs = reviewWorkerArgs(
        input,
        spec,
        'agent',
        '/private/projects.json',
      );
      expect(projectArgs).not.toContain('--team');
      expect(projectArgs[projectArgs.indexOf('--binding') + 1]).toBe(
        `adaptive-review-${spec.strategy}`,
      );
    }
  });

  it('provides separate project capacity for headless and revision-pinned tasks', () => {
    const { input } = fixture();
    const specs = reviewWorkerSpecs({
      ...input,
      projectId: 'project',
      profiles: {
        classifier: 'classifier',
        focused: 'focused',
        docs: 'docs',
        complexity: 'complexity',
        security: 'security',
      },
    });
    expect(
      specs
        .filter((worker) => worker.strategy === 'none')
        .map((worker) => worker.profile),
    ).toEqual(['classifier', 'docs', 'complexity']);
    expect(
      specs
        .filter((worker) => worker.strategy === 'git-worktree')
        .map((worker) => worker.profile),
    ).toEqual(['focused', 'focused', 'focused', 'focused', 'docs', 'security']);
  });

  it('forces correlation propagation and rejects child scope changes', async () => {
    const tasks = new IdempotentReviewTasks();
    const { input } = fixture(tasks);
    const scoped = scopedReviewTasks(tasks, input);
    const body = {
      teamId: 'team',
      diaryId: 'diary',
      taskType: 'classify',
      input: {},
    } as Parameters<TaskClient['createTask']>[0];
    await scoped.createTask(body, { idempotencyKey: 'one' });
    expect(tasks.created[0].correlationId).toBe(input.correlationId);
    expect(() =>
      scoped.createTask({ ...body, correlationId: 'another-review' }),
    ).toThrow('scope differs');
    expect(() =>
      scoped.createTask({ ...body, teamId: 'another-team' }),
    ).toThrow('scope differs');
  });

  it('requires explicit stable intent and accepts ordinary CLI arguments without Actions variables', () => {
    const { input } = fixture();
    const env = {
      ADAPTIVE_RUNTIME_SHA: input.runtimeSha,
      ADAPTIVE_CLASSIFIER_PROFILE: 'classifier',
      ADAPTIVE_FOCUSED_PROFILE: 'reviewer',
      MOLTNET_TEAM_ID: 'team',
      MOLTNET_DIARY_ID: 'diary',
      ADAPTIVE_APP_LOGIN: 'reviewer[bot]',
    };
    const command = standaloneCommand(
      [
        '--repo',
        input.repo,
        '--pr',
        '7',
        '--execution-id',
        input.correlationId,
      ],
      env,
    );
    expect(command.input.correlationId).toBe(input.correlationId);
    expect(command.input.publication).toBe('report-only');
    expect(command.workers).toBe('local');
  });
});
