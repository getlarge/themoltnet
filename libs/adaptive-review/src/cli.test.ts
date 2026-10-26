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
  type Prepared,
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
  }> = {},
) {
  writeFileSync(
    file('event.json'),
    JSON.stringify({
      pull_request: {
        number: 42,
        title: overrides.title ?? 'Change the API',
        body: null,
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

  it('refuses a pull request that moved after preparation', async () => {
    const { deps: cli } = deps({
      github: {
        revisions: () => Promise.resolve({ head: 'd'.repeat(40), base: BASE }),
        files: () => Promise.resolve([]),
      },
    });

    await expect(runAdaptiveStage('plan', cli)).rejects.toThrow(
      'PR revisions changed after preparation',
    );
  });
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
      results: [
        { lane: 'docs', status: 'clear' },
        { lane: 'tests', status: 'failed' },
      ],
    } as AdaptiveReport;
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
