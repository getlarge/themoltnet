import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FreeformInput } from '@moltnet/tasks';
import { Value } from 'typebox/value';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildScenarioFreeformInput } from '../src/build-inputs.js';
import { readScenario } from '../src/read-scenario.js';
import {
  GIT_SEED_HEAD_BRANCH,
  seedScenarioGitRepo,
} from '../src/scenario-fixtures.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

describe('gitSeed scenarios', () => {
  let root: string;
  let scenarioDir: string;
  let sandboxRoot: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-eval-git-seed-'));
    scenarioDir = join(root, 'review-pinned-head');
    sandboxRoot = join(root, 'sandbox');
    write(scenarioDir, {
      'prompt.md':
        'Review the change from {{gitSeed.base}} to {{gitSeed.head}}.\n',
      'eval.json': JSON.stringify({
        mode: 'vivo',
        workspace: 'dedicated_worktree',
        taskType: 'freeform',
        fixtures: { gitSeed: { base: 'repo/base', head: 'repo/head' } },
      }),
      'rubric.json': JSON.stringify({
        rubricId: 'review-pinned-head',
        version: 'v1',
        criteria: [
          {
            id: 'finds-bug',
            description: 'Names the regression.',
            weight: 1,
            scoring: 'llm_score',
          },
        ],
      }),
      'gates.json': JSON.stringify({ requireCleanSubmit: true }),
      'repo/base/src/limit.ts': 'export const limit = (n: number) => n;\n',
      'repo/head/src/limit.ts': 'export const limit = (n: number) => n - 1;\n',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds a base/head repository and a freeform input pinned at head', () => {
    // Arrange
    const scenario = readScenario(scenarioDir);

    // Act
    const revisions = seedScenarioGitRepo(scenario, sandboxRoot);
    const input = buildScenarioFreeformInput(scenario, {
      gitRevisions: revisions,
    });

    // Assert — repository shape mirrors a CI checkout of the PR base.
    expect(revisions).not.toBeNull();
    const { base, head } = revisions!;
    expect(git(sandboxRoot, ['rev-parse', 'HEAD'])).toBe(base);
    expect(git(sandboxRoot, ['rev-parse', GIT_SEED_HEAD_BRANCH])).toBe(head);
    expect(git(sandboxRoot, ['rev-parse', `${head}^`])).toBe(base);
    expect(git(sandboxRoot, ['show', `${head}:src/limit.ts`])).toContain(
      'n - 1',
    );
    // Hidden scenario files never enter the repository or its checkout.
    for (const revision of [base, head]) {
      expect(git(sandboxRoot, ['ls-tree', '-r', '--name-only', revision])).toBe(
        'src/limit.ts',
      );
    }
    expect(readdirSync(sandboxRoot).sort()).toEqual(['.git', 'src']);

    // Task input carries the revision the daemon detaches the worktree at.
    expect(Value.Check(FreeformInput, input)).toBe(true);
    expect(input.execution).toEqual({
      workspace: 'dedicated_worktree',
      revision: head,
    });
    expect(input.brief).toBe(`Review the change from ${base} to ${head}.`);
  });

  it('refuses to build a gitSeed input without seeded revisions', () => {
    const scenario = readScenario(scenarioDir);

    expect(() => buildScenarioFreeformInput(scenario)).toThrow(
      /declares a gitSeed/,
    );
  });

  it('refuses revisions for scenarios without a gitSeed', () => {
    // Arrange
    const scenario = {
      ...readScenario(scenarioDir),
      fixtures: { inputArtifacts: [] },
      prompt: 'Review.',
    };

    // Act / Assert
    expect(seedScenarioGitRepo(scenario, sandboxRoot)).toBeNull();
    expect(buildScenarioFreeformInput(scenario)).toEqual({
      brief: 'Review.',
      execution: { workspace: 'dedicated_worktree' },
    });
    expect(() =>
      buildScenarioFreeformInput(scenario, {
        gitRevisions: { base: 'a'.repeat(40), head: 'b'.repeat(40) },
      }),
    ).toThrow(/has no gitSeed/);
  });
});
