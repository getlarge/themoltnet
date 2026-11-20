/** Real artifact storage and task binding; no worker or model inference. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withPinnedReviewDiff } from '@moltnet/adaptive-review';
import { pinnedReviewDiffTool } from '@themoltnet/pi-runtime';
import { connect } from '@themoltnet/sdk';
import { expect, it } from 'vitest';

import { createDaemonTestHarness } from './setup.js';

it('reads the exact pinned diff through a bound task artifact without inference', async () => {
  const harness = await createDaemonTestHarness();
  const root = mkdtempSync(join(tmpdir(), 'pinned-diff-e2e-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    const commit = () => {
      git('add', '.');
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'fixture',
      );
      return git('rev-parse', 'HEAD').trim();
    };
    writeFileSync(join(root, 'example.ts'), 'export const value = 1;\n');
    const base = commit();
    writeFileSync(join(root, 'example.ts'), 'export const value = 2;\n');
    const head = commit();
    const credentials = await harness.createAgent('pinned-diff');
    const agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
    const tasks = withPinnedReviewDiff(
      {
        stageArtifact: agent.tasks.artifacts.stage.bind(agent.tasks.artifacts),
        createTask: ({ teamId, ...body }, options) =>
          agent.tasks.create(body, { teamId, ...options }),
        getTask: (id) => agent.tasks.get(id),
        listAttempts: (id) => agent.tasks.listAttempts(id),
      },
      { git: (args) => git(...args), base, head },
    );
    const task = await tasks.createTask({
      taskType: 'freeform',
      title: 'Pinned diff transport',
      teamId: credentials.personalTeamId,
      diaryId: credentials.privateDiaryId,
      maxAttempts: 1,
      tags: [`revision:${head}`],
      input: {
        brief: 'Inspect the pinned diff',
        execution: { workspace: 'dedicated_worktree', revision: head },
      },
    });
    const tool = await pinnedReviewDiffTool.create({
      agent,
      claimedTask: { task },
    } as never);
    const page = await tool.execute(
      'read',
      { path: 'example.ts' },
      undefined,
      undefined,
      {} as never,
    );
    expect(JSON.stringify(page.content)).toContain(
      '[old:1] -export const value = 1;',
    );
    expect(JSON.stringify(page.content)).toContain(
      '[new:1] +export const value = 2;',
    );
    expect(page.details).toMatchObject({
      kind: 'pinned-review-diff',
      base,
      head,
      action: 'read',
    });
    expect(await agent.tasks.listAttempts(task.id)).toEqual([]);
    await agent.tasks.cancel(
      task.id,
      {
        reason:
          'Deterministic artifact integration test completed without inference',
      },
      { teamId: credentials.personalTeamId },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    await harness.teardown();
  }
});
