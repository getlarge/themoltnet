import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TaskClient } from '@themoltnet/tasks-orchestrator';
import {
  type FakeTaskOutputSource,
  FakeTasks,
} from '@themoltnet/tasks-orchestrator/testing';

import { parseReviewTaskBudgets } from '../src/config.js';
import { canonicalInput } from '../src/execution.js';
import type { RunOptions } from '../src/workflow.js';

export function reviewFixture(change = 'export const value = 2;\n') {
  const cwd = mkdtempSync(join(tmpdir(), 'adaptive-replay-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q');
  mkdirSync(join(cwd, '.github'));
  writeFileSync(
    join(cwd, '.github/adaptive-review.json'),
    JSON.stringify({
      version: 1,
      lanes: ['tests', 'conventions'],
      rules: [],
      checks: [],
    }),
  );
  writeFileSync(join(cwd, 'example.ts'), 'export const value = 1;\n');
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    );
    return git('rev-parse', 'HEAD');
  };
  const base = commit();
  writeFileSync(join(cwd, 'example.ts'), change);
  const head = commit();
  return {
    cwd,
    base,
    head,
    options(tasks: TaskClient): RunOptions {
      return {
        cwd,
        tasks,
        identity: {
          repo: 'another/project',
          pr: 7,
          title: 'Change value',
          body: '',
          base,
          head,
          correlationId: 'review-one',
          teamId: 'team',
          diaryId: 'diary',
          classifierProfileId: 'classifier',
        },
        runtimeSha: base,
        mode: 'shadow',
        profiles: { focused: 'reviewer' },
        taskBudgets: parseReviewTaskBudgets('', ['tests', 'conventions']),
      };
    },
    close: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

export function reviewOutput(body: Parameters<TaskClient['createTask']>[0]) {
  return body.taskType === 'classify'
    ? {
        answers: {
          tests: { type: 'bool', probability: 1 },
          conventions: { type: 'bool', probability: 1 },
        },
      }
    : {
        result: {
          summary: 'Checked the pinned change',
          findings: [],
          unclear: [],
        },
      };
}

/** Models the API's idempotency contract, including incompatible request rejection. */
export class IdempotentReviewTasks extends FakeTasks {
  readonly requests: Array<{ key: string; body: string; id: string }> = [];
  private readonly keys = new Map<
    string,
    { body: string; task: Awaited<ReturnType<TaskClient['createTask']>> }
  >();

  constructor(output: FakeTaskOutputSource = reviewOutput) {
    super(output);
  }

  override async createTask(
    body: Parameters<TaskClient['createTask']>[0],
    options?: Parameters<TaskClient['createTask']>[1],
  ) {
    const key = options?.idempotencyKey;
    if (!key) throw new Error('review creation requires an idempotency key');
    const canonical = canonicalInput(body);
    const previous = this.keys.get(key);
    if (previous && previous.body !== canonical)
      throw new Error('idempotency conflict');
    const task = previous?.task ?? (await super.createTask(body, options));
    this.keys.set(key, { body: canonical, task });
    this.requests.push({ key, body: canonical, id: task.id });
    return task;
  }
}
