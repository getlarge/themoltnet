import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
} from '@themoltnet/tasks-orchestrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseRoutingMap } from './routing.js';
import type { CreateBody } from './stages.js';
import { createTestRepo, type TestRepo } from './test-repo.js';
import {
  createSleepingContext,
  type DocsImpactInput,
  runDocsImpactReview,
} from './workflow.js';

type StageOutput = { summary: string } | Error;

/** Scripted task client: each created task completes with the next output. */
function fakeTasks(
  outputs: StageOutput[],
  options: { failedGets?: number } = {},
) {
  let failedGets = options.failedGets ?? 0;
  const created: CreateBody[] = [];
  const tasks = new Map<string, { task: SdkTask; attempt: SdkTaskAttempt }>();
  const client: TaskClient = {
    createTask(body) {
      const id = `task-${created.length + 1}`;
      const output = outputs[created.length];
      created.push(body);
      const failed = output instanceof Error;
      tasks.set(id, {
        task: {
          id,
          status: failed ? 'failed' : 'completed',
          acceptedAttemptN: failed ? null : 1,
          queuedAt: '2026-09-24T10:00:00.000Z',
        } as unknown as SdkTask,
        attempt: {
          attemptN: 1,
          status: failed ? 'failed' : 'completed',
          claimedAt: '2026-09-24T10:00:01.000Z',
          startedAt: '2026-09-24T10:00:11.000Z',
          completedAt: '2026-09-24T10:00:31.000Z',
          output: failed ? null : output,
          outputCid: null,
          usage: { inputTokens: 1_000, outputTokens: 200, model: 'glm' },
        } as unknown as SdkTaskAttempt,
      });
      return Promise.resolve(tasks.get(id)!.task);
    },
    getTask(id) {
      if (failedGets > 0) {
        failedGets -= 1;
        return Promise.reject(
          Object.assign(new Error('Not authorized to view this task'), {
            statusCode: 403,
          }),
        );
      }
      return Promise.resolve(tasks.get(id)!.task);
    },
    listAttempts(id) {
      return Promise.resolve([tasks.get(id)!.attempt]);
    },
  };
  return { client, created };
}

function json(value: unknown): { summary: string } {
  return { summary: JSON.stringify(value) };
}

const routingMap = parseRoutingMap({
  version: 1,
  rules: [
    {
      id: 'cli',
      paths: ['apps/cli/src/**'],
      docs: ['docs/reference/cli.md'],
    },
  ],
});

const cliChange = {
  id: 'dry-run-flag',
  kind: 'cli',
  summary: 'Adds --dry-run.',
  evidence: [{ path: 'apps/cli/src/flags.ts', detail: 'registers --dry-run' }],
  searchTerms: ['--dry-run'],
};

describe('runDocsImpactReview', () => {
  let repo: TestRepo;
  let base: string;

  beforeEach(() => {
    repo = createTestRepo();
    base = repo.commit({
      'apps/cli/src/flags.ts': 'export const flags = [];\n',
      'apps/cli/README.md': '# cli\n\n## Flags\n\nNone yet.\n',
      'docs/reference/cli.md': '# CLI reference\n\n## Commands\n\n`run`\n',
    });
  });

  afterEach(() => {
    repo.cleanup();
  });

  function input(head: string): DocsImpactInput {
    return {
      repo: 'getlarge/themoltnet',
      pr: 7,
      prTitle: 'change',
      baseRevision: base,
      headRevision: head,
      teamId: '00000000-0000-4000-8000-000000000001',
      diaryId: '00000000-0000-4000-8000-000000000002',
      correlationId: '00000000-0000-4000-8000-000000000003',
      profileId: '00000000-0000-4000-8000-000000000004',
      tags: ['review:docs-impact'],
      pollIntervalSec: 0,
    };
  }

  function run(
    head: string,
    outputs: StageOutput[],
    overrides = {},
    failedGets = 0,
  ) {
    const tasks = fakeTasks(outputs, { failedGets });
    const report = runDocsImpactReview(
      {
        git: repo.git,
        tasks: tasks.client,
        ctx: createSleepingContext(),
        routingMap,
      },
      { ...input(head), ...overrides },
    );
    return { report, created: tasks.created };
  }

  it('returns not-needed for a test-only change without creating tasks', async () => {
    // Arrange
    const head = repo.commit({ 'apps/cli/src/flags.test.ts': 'test\n' });

    // Act
    const { report, created } = run(head, []);

    // Assert
    await expect(report).resolves.toMatchObject({
      status: 'completed',
      outcome: 'not-needed',
      findings: [],
    });
    expect(created).toHaveLength(0);
  });

  it('stops after extraction when a refactor changes no public contract', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': 'export const flags: string[] = [];\n',
    });

    // Act
    const { report, created } = run(head, [json({ version: 1, changes: [] })]);

    // Assert
    const result = await report;
    expect(result).toMatchObject({
      status: 'completed',
      outcome: 'not-needed',
    });
    expect(created).toHaveLength(1);
    expect(result.timings.stages.extract).toMatchObject({
      queueMs: 1_000,
      openMs: 10_000,
      executionMs: 20_000,
      inputTokens: 1_000,
    });
  });

  it('reports a missing-docs finding for a public CLI change', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': "export const flags = ['--dry-run'];\n",
    });
    const finding = {
      changeId: 'dry-run-flag',
      evidence: {
        path: 'apps/cli/src/flags.ts',
        detail: 'registers --dry-run',
      },
      docsPath: 'docs/reference/cli.md',
      section: '## Commands',
      update: 'Document --dry-run.',
    };

    // Act
    const { report, created } = run(head, [
      json({ version: 1, changes: [cliChange] }),
      json({ version: 1, outcome: 'updates-needed', findings: [finding] }),
    ]);

    // Assert
    const result = await report;
    expect(result).toMatchObject({
      status: 'completed',
      outcome: 'updates-needed',
      findings: [finding],
    });
    expect(result.selectedDocs.map((doc) => doc.path)).toEqual([
      'docs/reference/cli.md',
      'apps/cli/README.md',
    ]);
    expect((created[1].input as { brief: string }).brief).toContain(
      '# CLI reference',
    );
  });

  it('checks a docs-only change without running extraction', async () => {
    // Arrange
    const head = repo.commit({
      'docs/reference/cli.md':
        '# CLI reference\n\n## Commands\n\n`run --fast`\n',
    });

    // Act
    const { report, created } = run(head, [
      json({ version: 1, outcome: 'covered', findings: [] }),
    ]);

    // Assert
    await expect(report).resolves.toMatchObject({ outcome: 'covered' });
    expect(created).toHaveLength(1);
    expect(created[0].tags).toContain('stage:coverage');
  });

  it('fails without an outcome when a stage returns invalid output', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': "export const flags = ['--dry-run'];\n",
    });

    // Act
    const { report } = run(head, [{ summary: 'looks fine to me' }]);

    // Assert
    const result = await report;
    expect(result.status).toBe('failed');
    expect(result.outcome).toBeUndefined();
    expect(result.error).toMatch(/strict JSON/);
  });

  it('fails without an outcome when the runtime is unavailable', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': "export const flags = ['--dry-run'];\n",
    });

    // Act
    const { report } = run(head, [new Error('no daemon')]);

    // Assert
    const result = await report;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/status failed/);
  });

  it('keeps polling through transient read failures', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': 'export const flags: string[] = [];\n',
    });

    // Act
    const { report } = run(head, [json({ version: 1, changes: [] })], {}, 3);

    // Assert
    await expect(report).resolves.toMatchObject({
      status: 'completed',
      outcome: 'not-needed',
    });
  });

  it('fails when reads keep failing past the retry limit', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': 'export const flags: string[] = [];\n',
    });

    // Act
    const { report } = run(head, [json({ version: 1, changes: [] })], {}, 50);

    // Assert
    const result = await report;
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Not authorized/);
  });

  it('downgrades a clean result to incomplete when the diff budget dropped files', async () => {
    // Arrange
    const head = repo.commit({
      'apps/cli/src/flags.ts': 'export const a = 1;\n'.repeat(200),
      'apps/cli/src/other.ts': 'export const b = 1;\n'.repeat(200),
    });

    // Act
    const { report } = run(
      head,
      [
        json({ version: 1, changes: [cliChange] }),
        json({ version: 1, outcome: 'covered', findings: [] }),
      ],
      { budgets: { diffTotalBytes: 5_000, diffPerFileBytes: 4_500 } },
    );

    // Assert
    const result = await report;
    expect(result.outcome).toBe('incomplete');
    expect(result.gaps).toEqual([
      {
        scope: 'apps/cli/src/other.ts',
        reason: 'omitted from model context by the diff budget',
      },
    ]);
  });
});
