import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PullRequestFile } from '@moltnet/docs-impact-review/eligibility';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CliDeps,
  jsonLines,
  type Prepared,
  pullRequestFiles,
  reportStageFailure,
  runAdaptiveStage,
  specialistMatrix,
} from './cli.js';
import type { LaneRoute } from './core.js';
import type { AdaptivePreparation, AdaptiveReport } from './workflow.js';

const mocks = vi.hoisted(() => ({
  loadAdaptivePolicy: vi.fn(),
  classifierTaskPossible: vi.fn(),
  prepareAdaptiveReview: vi.fn(),
  runRoutedAdaptiveReview: vi.fn(),
}));

vi.mock('./snapshot.js', () => ({
  loadAdaptivePolicy: mocks.loadAdaptivePolicy,
}));
vi.mock('./workflow.js', () => ({
  classifierTaskPossible: mocks.classifierTaskPossible,
  prepareAdaptiveReview: mocks.prepareAdaptiveReview,
  runRoutedAdaptiveReview: mocks.runRoutedAdaptiveReview,
}));

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const RUNTIME = 'c'.repeat(40);
const REPO = 'getlarge/themoltnet';
const LANES = ['docs', 'tests', 'security'] as const;

let dir: string;

function file(name: string): string {
  return join(dir, name);
}

function outputs(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(file('github-output'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

function deps(overrides: Partial<CliDeps> = {}) {
  const tasks = {} as TaskClient;
  const stdout = vi.fn();
  const files = vi.fn(() =>
    Promise.resolve<PullRequestFile[]>([
      { filename: 'apps/rest-api/src/app.ts' },
    ]),
  );
  const value: CliDeps = {
    env: {
      GITHUB_REPOSITORY: REPO,
      GITHUB_EVENT_PATH: file('event.json'),
      GITHUB_OUTPUT: file('github-output'),
      PROTECTED_PATHS:
        '.github/workflows/adaptive-review.yml\nlibs/adaptive-review/',
      ADAPTIVE_PREPARED: file('prepared.json'),
      ADAPTIVE_ROUTE: file('route.json'),
      ADAPTIVE_REPORT: file('report.json'),
      ADAPTIVE_MODE: 'shadow',
      ADAPTIVE_RUNTIME_SHA: RUNTIME,
      ADAPTIVE_CLASSIFIER_PROFILE: 'classifier-v2',
      ADAPTIVE_DOCS_PROFILE: 'docs-v1',
      ADAPTIVE_SECURITY_PROFILE: 'security-v2',
      ADAPTIVE_FOCUSED_PROFILE: 'focused-v1',
      MOLTNET_TEAM_ID: 'team',
      MOLTNET_DIARY_ID: 'diary',
    },
    cwd: dir,
    github: {
      revisions: vi.fn(() => Promise.resolve({ head: HEAD, base: BASE })),
      files,
    },
    connect: vi.fn(() =>
      Promise.resolve({
        profiles: () =>
          Promise.resolve(
            ['classifier-v2', 'docs-v1', 'security-v2', 'focused-v1'].map(
              (name) => ({ id: `${name}-id`, name }),
            ),
          ),
        tasks,
      }),
    ),
    workers: () => undefined,
    stdout,
    ...overrides,
  };
  return { deps: value, tasks, stdout, files };
}

function writeEvent(
  overrides: Partial<{
    author: string;
    headRepo: string;
    changedFiles: number;
    title: string;
    body: string;
  }> = {},
) {
  writeFileSync(
    file('event.json'),
    JSON.stringify({
      pull_request: {
        number: 42,
        title: overrides.title ?? 'Change the API',
        body: overrides.body ?? null,
        changed_files: overrides.changedFiles ?? 1,
        user: { login: overrides.author ?? 'contributor' },
        base: { sha: BASE },
        head: { sha: HEAD, repo: { full_name: overrides.headRepo ?? REPO } },
      },
    }),
  );
}

const prepared: Prepared = {
  repo: REPO,
  pr: 42,
  title: 'Change the API',
  body: '',
  base: BASE,
  head: HEAD,
  correlationId: 'correlation',
};

function routes(run: Partial<Record<string, boolean>>): LaneRoute[] {
  return LANES.map((lane) => ({
    lane,
    probability: 0.5,
    run: run[lane] ?? true,
    reason: 'selected' as const,
  }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adaptive-cli-'));
  writeFileSync(file('github-output'), '');
  mocks.loadAdaptivePolicy.mockReturnValue({ policy: { lanes: [...LANES] } });
  mocks.classifierTaskPossible.mockReturnValue(true);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('prepare stage', () => {
  it('pins an eligible pull request for later stages', async () => {
    writeEvent({ title: 'x'.repeat(600) });
    const { deps: cli, files } = deps();

    await expect(runAdaptiveStage('prepare', cli)).resolves.toBe(0);

    const out = outputs();
    expect(out.skip).toBe('false');
    expect(out.base).toBe(BASE);
    expect(out.head).toBe(HEAD);
    expect(JSON.parse(out.prepared)).toEqual({
      repo: REPO,
      pr: 42,
      title: 'x'.repeat(500),
      body: '',
      base: BASE,
      head: HEAD,
      correlationId: out.correlation,
    });
    expect(files).toHaveBeenCalledWith(REPO, 42);
  });

  it.each([
    ['a fork', { headRepo: 'someone/themoltnet' }, []],
    ['Dependabot', { author: 'dependabot[bot]' }, []],
    ['a truncated file list', { changedFiles: 2 }, []],
    [
      'a protected path',
      {},
      [{ filename: 'libs/adaptive-review/src/core.ts' }],
    ],
    [
      'a rename out of a protected path',
      {},
      [
        {
          filename: 'docs/workflow.md',
          previous_filename: '.github/workflows/adaptive-review.yml',
        },
      ],
    ],
  ])('skips %s without pinning a review', async (_case, event, files) => {
    writeEvent(event);
    const { deps: cli, stdout, files: listFiles } = deps();
    if (files.length) listFiles.mockResolvedValue(files);

    await runAdaptiveStage('prepare', cli);

    expect(outputs()).toEqual({ skip: 'true' });
    expect(stdout).toHaveBeenCalledWith(
      expect.stringMatching(/^::notice::Adaptive review skipped: /),
    );
  });
});

describe('prepare stage edges', () => {
  it('truncates a long body', async () => {
    writeEvent({ body: 'b'.repeat(5000) });
    const { deps: cli } = deps();

    await runAdaptiveStage('prepare', cli);

    expect((JSON.parse(outputs().prepared) as Prepared).body).toBe(
      'b'.repeat(4000),
    );
  });

  it('escapes workflow commands in a skip reason', async () => {
    writeEvent();
    const { deps: cli, stdout, files } = deps();
    files.mockResolvedValue([
      { filename: 'libs/adaptive-review/x\n::error::forged' },
    ]);

    await runAdaptiveStage('prepare', cli);

    const [notice] = stdout.mock.calls[0] as [string];
    expect(notice).not.toContain('\n::error::');
    expect(notice).toContain('%0A::error::forged');
  });
});

describe('plan stage', () => {
  beforeEach(() => {
    writeFileSync(file('prepared.json'), JSON.stringify(prepared));
  });

  it.each([
    [true, true, { 'review-enabled': 'true', 'classifier-needed': 'true' }],
    [true, false, { 'review-enabled': 'true', 'classifier-needed': 'false' }],
    [false, true, { 'review-enabled': 'false', 'classifier-needed': 'false' }],
  ])(
    'with policy %s and classifier work %s writes %j',
    async (policy, classifier, expected) => {
      if (!policy) mocks.loadAdaptivePolicy.mockReturnValue(null);
      mocks.classifierTaskPossible.mockReturnValue(classifier);
      const { deps: cli } = deps();

      await runAdaptiveStage('plan', cli);

      expect(outputs()).toEqual(expected);
      expect(mocks.loadAdaptivePolicy).toHaveBeenCalledWith(
        expect.any(Function),
        BASE,
      );
    },
  );

  it('says why the review is disabled', async () => {
    mocks.loadAdaptivePolicy.mockReturnValue(null);
    const { deps: cli, stdout } = deps();

    await runAdaptiveStage('plan', cli);

    expect(stdout).toHaveBeenCalledWith(
      `::notice::Adaptive review skipped: no adaptive review policy on base ${BASE}\n`,
    );
  });

  it.each([
    ['head', { head: 'd'.repeat(40), base: BASE }],
    ['base', { head: HEAD, base: 'e'.repeat(40) }],
  ])(
    'refuses a pull request whose %s moved after preparation',
    async (_moved, current) => {
      const { deps: cli } = deps({
        github: {
          revisions: () => Promise.resolve(current),
          files: () => Promise.resolve([]),
        },
      });

      await expect(runAdaptiveStage('plan', cli)).rejects.toThrow(
        `head ${HEAD} -> ${current.head}, base ${BASE} -> ${current.base}`,
      );
    },
  );
});

describe('route to review handoff', () => {
  it('passes the pinned identity and routing file from route to review', async () => {
    writeFileSync(file('prepared.json'), JSON.stringify(prepared));
    const preparation = {
      version: 1,
      routing: { routes: routes({ security: false }) },
      docsTaskPossible: true,
      packetCount: 1,
    } as unknown as AdaptivePreparation;
    const report = {
      gaps: [],
      routing: preparation.routing,
      results: [
        { lane: 'docs', status: 'clear' },
        { lane: 'tests', status: 'failed' },
      ],
    } as unknown as AdaptiveReport;
    mocks.prepareAdaptiveReview.mockResolvedValue(preparation);
    mocks.runRoutedAdaptiveReview.mockResolvedValue(report);
    const { deps: route, tasks } = deps();

    await expect(runAdaptiveStage('route', route)).resolves.toBe(0);

    const options = {
      identity: {
        ...prepared,
        teamId: 'team',
        diaryId: 'diary',
        classifierProfileId: 'classifier-v2-id',
      },
      mode: 'shadow',
      tasks,
      cwd: dir,
      runtimeSha: RUNTIME,
      profiles: {
        docs: 'docs-v1-id',
        security: 'security-v2-id',
        focused: 'focused-v1-id',
      },
    };
    expect(mocks.prepareAdaptiveReview).toHaveBeenCalledWith(
      expect.objectContaining(options),
    );
    expect(statSync(file('route.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(outputs().specialists)).toEqual({
      include: [
        { profile: 'docs-v1', worker: 1 },
        { profile: 'focused-v1', worker: 1 },
      ],
    });
    expect(outputs()['has-specialists']).toBe('true');

    const { deps: review } = deps();
    await expect(runAdaptiveStage('review', review)).resolves.toBe(1);

    expect(mocks.runRoutedAdaptiveReview).toHaveBeenCalledWith(
      expect.objectContaining(options),
      preparation,
    );
    expect(statSync(file('report.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file('report.json'), 'utf8'))).toEqual(
      report,
    );
  });

  it('refuses to route without a base policy', async () => {
    writeFileSync(file('prepared.json'), JSON.stringify(prepared));
    mocks.loadAdaptivePolicy.mockReturnValue(null);
    const { deps: cli } = deps();

    await expect(runAdaptiveStage('route', cli)).rejects.toThrow(
      'adaptive review policy is absent on the base',
    );
    expect(mocks.prepareAdaptiveReview).not.toHaveBeenCalled();
  });
});

describe('route and review failures', () => {
  beforeEach(() => {
    writeFileSync(file('prepared.json'), JSON.stringify(prepared));
  });

  it.each([
    [{ ADAPTIVE_MODE: 'loud' }, 'ADAPTIVE_MODE must be shadow or active'],
    [{ ADAPTIVE_DOCS_PROFILE: 'missing' }, 'runtime profile missing not found'],
    [{ ADAPTIVE_FOCUSED_PROFILE: '' }, 'ADAPTIVE_FOCUSED_PROFILE is required'],
  ])('rejects %j', async (env, message) => {
    const { deps: cli } = deps();

    await expect(
      runAdaptiveStage('route', { ...cli, env: { ...cli.env, ...env } }),
    ).rejects.toThrow(message);
  });

  it('resolves profiles only for enabled lanes', async () => {
    mocks.prepareAdaptiveReview.mockResolvedValue({
      routing: { routes: [] },
      docsTaskPossible: false,
    });
    const { deps: cli } = deps();

    await runAdaptiveStage('route', cli);

    const [options] = mocks.prepareAdaptiveReview.mock.calls[0] as [
      { profiles: Record<string, string> },
    ];
    expect(Object.keys(options.profiles).sort()).toEqual([
      'docs',
      'focused',
      'security',
    ]);
  });

  it('exits 0 and records task budgets when no lane failed', async () => {
    writeFileSync(file('route.json'), JSON.stringify({ routing: {} }));
    writeFileSync(file('summary'), '');
    mocks.runRoutedAdaptiveReview.mockResolvedValue({
      results: [{ lane: 'docs', status: 'concern' }],
      gaps: [],
      routing: { routes: [] },
    });
    const { deps: cli } = deps();

    await expect(
      runAdaptiveStage('review', {
        ...cli,
        env: { ...cli.env, GITHUB_STEP_SUMMARY: file('summary') },
      }),
    ).resolves.toBe(0);
    expect(readFileSync(file('summary'), 'utf8')).toContain('| docs |');
  });

  it('records classifier and failed-lane spend in the report and CI summary', async () => {
    writeFileSync(file('route.json'), JSON.stringify({ routing: {} }));
    mocks.runRoutedAdaptiveReview.mockResolvedValue({
      taskIds: ['classifier', 'hunt', 'hunt'],
      gaps: [],
      routing: { routes: [] },
      results: [{ lane: 'security', status: 'failed', taskIds: ['hunt'] }],
    });
    const { deps: cli, tasks } = deps();
    const listAttempts = vi.fn().mockResolvedValue([
      {
        claimedAt: '2026-01-01',
        startedAt: null,
        completedAt: '2026-01-02',
        usage: {
          inputTokens: 10,
          outputTokens: 1,
          model: 'model',
          provider: 'provider',
          cost: {
            currency: 'USD',
            total: 0.01,
            input: 0.01,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            complete: true,
          },
        },
        output: 'private task evidence',
      },
    ]);
    tasks.listAttempts = listAttempts;
    expect(
      await runAdaptiveStage('review', {
        ...cli,
        env: { ...cli.env, GITHUB_STEP_SUMMARY: file('summary') },
      }),
    ).toBe(1);
    expect(listAttempts).toHaveBeenCalledTimes(2);
    const saved = readFileSync(file('report.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({
      spend: {
        records: [
          { taskId: 'classifier', stage: 'classifier' },
          { taskId: 'hunt', stage: 'security' },
        ],
      },
    });
    expect(saved).not.toContain('private task evidence');
    expect(readFileSync(file('summary'), 'utf8')).toContain('$0.0200');
  });
  it('saves the review when its separate accounting connection times out', async () => {
    writeFileSync(file('route.json'), JSON.stringify({ routing: {} }));
    mocks.runRoutedAdaptiveReview.mockResolvedValue({
      taskIds: ['classifier'],
      results: [],
      gaps: [],
      routing: { routes: [] },
    });
    const { deps: cli } = deps();
    const primaryConnect = cli.connect.bind(cli);
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const accountingConnect = vi.fn<CliDeps['connect']>((teamId, signal) => {
      if (!signal) return primaryConnect(teamId);
      return new Promise<Awaited<ReturnType<CliDeps['connect']>>>(
        (_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('accounting timeout')),
            { once: true },
          );
          queueMicrotask(() => controller.abort());
        },
      );
    });
    cli.connect = accountingConnect;
    try {
      expect(await runAdaptiveStage('review', cli)).toBe(0);
      expect(accountingConnect).toHaveBeenNthCalledWith(1, 'team');
      expect(accountingConnect).toHaveBeenNthCalledWith(
        2,
        'team',
        controller.signal,
      );
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(
        JSON.parse(readFileSync(file('report.json'), 'utf8')),
      ).toMatchObject({
        results: [],
        spend: { records: [{ taskId: 'classifier', missing: true }] },
      });
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['unclear', 'failed'] as const)(
    'warns about %s coverage without publishing private evidence',
    async (status) => {
      writeFileSync(file('route.json'), JSON.stringify({ routing: {} }));
      mocks.runRoutedAdaptiveReview.mockResolvedValue({
        results: [{ lane: 'security', status, summary: 'private evidence' }],
        gaps: [],
        routing: { routes: [] },
      });
      const { deps: cli, stdout } = deps();
      const code = await runAdaptiveStage('review', {
        ...cli,
        env: { ...cli.env, GITHUB_STEP_SUMMARY: file('summary') },
      });
      expect(code).toBe(status === 'failed' ? 1 : 0);
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining('::warning title=Incomplete adaptive review::'),
      );
      expect(readFileSync(file('summary'), 'utf8')).toContain(
        'incomplete coverage',
      );
      expect(JSON.stringify(stdout.mock.calls)).not.toContain(
        'private evidence',
      );
      expect(readFileSync(file('summary'), 'utf8')).not.toContain(
        'private evidence',
      );
    },
  );

  it('refuses an output value spanning lines', async () => {
    writeEvent();
    const event = JSON.parse(readFileSync(file('event.json'), 'utf8')) as {
      pull_request: { base: { sha: string } };
    };
    event.pull_request.base.sha = `${BASE}\nskip=false`;
    writeFileSync(file('event.json'), JSON.stringify(event));
    const { deps: cli } = deps();

    await expect(runAdaptiveStage('prepare', cli)).rejects.toThrow(
      'output base must be a single line',
    );
    expect(readFileSync(file('github-output'), 'utf8')).toBe('');
  });
});

describe('stage dispatch', () => {
  it.each(['', 'publish', 'Plan'])('rejects stage %j', async (stage) => {
    const { deps: cli } = deps();

    await expect(runAdaptiveStage(stage, cli)).rejects.toThrow(
      'ADAPTIVE_STAGE must be prepare, plan, route, or review',
    );
  });

  it('scopes worker tasks to the configured project', async () => {
    writeFileSync(file('prepared.json'), JSON.stringify(prepared));
    mocks.prepareAdaptiveReview.mockResolvedValue({
      routing: { routes: [] },
      docsTaskPossible: false,
    });
    const { deps: cli } = deps();

    await runAdaptiveStage('route', {
      ...cli,
      env: { ...cli.env, MOLTNET_PROJECT_ID: 'project-1' },
    });

    expect(mocks.prepareAdaptiveReview).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
    );
  });

  it('annotates a failed stage with an escaped message and keeps the stack', () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const error = new Error('bad\n::error::forged');

    expect(reportStageFailure(undefined, error, { stdout, stderr })).toBe(1);

    expect(stdout).toHaveBeenCalledWith(
      '::error::Adaptive unknown stage failed: bad%0A::error::forged\n',
    );
    expect(stderr).toHaveBeenCalledWith(`${error.stack}\n`);
  });
});

describe('pullRequestFiles', () => {
  it('keeps the old path of a rename across pages', () => {
    expect(
      pullRequestFiles([
        [{ filename: 'a', status: 'modified', patch: '@@' }],
        [{ filename: 'b', previous_filename: 'c', status: 'renamed' }],
      ]),
    ).toEqual([{ filename: 'a' }, { filename: 'b', previous_filename: 'c' }]);
  });

  it.each([[{}], [[{ status: 'added' }]]])(
    'rejects a malformed response %j',
    (pages) => {
      expect(() => pullRequestFiles(pages)).toThrow();
    },
  );
});

describe('jsonLines', () => {
  it('parses one JSON value per line and ignores blank lines', () => {
    expect(
      jsonLines<PullRequestFile>(
        '{"filename":"a"}\n\n{"filename":"b","previous_filename":"c"}\n',
      ),
    ).toEqual([{ filename: 'a' }, { filename: 'b', previous_filename: 'c' }]);
  });
});

describe('specialistMatrix', () => {
  const env = {
    ADAPTIVE_DOCS_PROFILE: 'docs',
    ADAPTIVE_FOCUSED_PROFILE: 'focused',
    ADAPTIVE_SECURITY_PROFILE: 'security',
    ADAPTIVE_COMPLEXITY_PROFILE: 'complexity',
  };

  it('allocates one worker per runnable task, including shared focused profiles', () => {
    expect(
      specialistMatrix(
        {
          docsTaskPossible: false,
          routing: {
            routes: [
              { lane: 'docs', run: true },
              { lane: 'tests', run: true },
              { lane: 'conventions', run: true },
              { lane: 'security', run: false },
              { lane: 'blast-radius', run: true },
            ],
          } as AdaptivePreparation['routing'],
        },
        env,
      ),
    ).toEqual({
      include: [
        { profile: 'focused', worker: 1 },
        { profile: 'focused', worker: 2 },
        { profile: 'focused', worker: 3 },
      ],
    });
  });

  it('names an unknown lane', () => {
    expect(() =>
      specialistMatrix(
        {
          docsTaskPossible: true,
          routing: {
            routes: [{ lane: 'style', run: true }],
          } as unknown as AdaptivePreparation['routing'],
        },
        env,
      ),
    ).toThrow('Unknown review lane: style');
  });

  it('requires a profile for every runnable lane', () => {
    expect(() =>
      specialistMatrix(
        {
          docsTaskPossible: true,
          routing: {
            routes: [{ lane: 'complexity', run: true }],
          } as AdaptivePreparation['routing'],
        },
        { ...env, ADAPTIVE_COMPLEXITY_PROFILE: '' },
      ),
    ).toThrow('ADAPTIVE_COMPLEXITY_PROFILE is required');
  });
});
