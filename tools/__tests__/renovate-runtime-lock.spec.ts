import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { expect, it } from 'vitest';
import { parse } from 'yaml';

const repo = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(join(repo, 'renovate.json'), 'utf8'));
const workflow = parse(
  readFileSync(join(repo, '.github/workflows/renovate.yml'), 'utf8'),
);

it('refreshes the runtime lock before committing grouped GitHub Actions updates', () => {
  const rule = config.packageRules.find(
    (rule: { groupName?: string }) => rule.groupName === 'GitHub Actions',
  );
  const tasks = rule.postUpgradeTasks;
  expect(rule.matchManagers).toEqual(['github-actions']);
  expect(rule.matchDepTypes).toEqual(['action', 'workflow']);
  expect(rule.semanticCommitType).toBe('fix');
  expect(tasks.executionMode).toBe('branch');
  expect(tasks.fileFilters).toEqual(['packages/*/runtime.lock']);
  const [command] = tasks.commands;
  const allowed = JSON.parse(
    workflow.jobs.renovate.steps.find(
      (step: { env?: Record<string, string> }) =>
        step.env?.RENOVATE_ALLOWED_COMMANDS,
    ).env.RENOVATE_ALLOWED_COMMANDS,
  ).map((pattern: string) => new RegExp(pattern));
  expect(allowed.some((pattern: RegExp) => pattern.test(command))).toBe(true);
  expect(
    allowed.some((pattern: RegExp) => pattern.test(`${command} --unexpected`)),
  ).toBe(false);

  const root = mkdtempSync(join(tmpdir(), 'renovate-runtime-lock-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const script = 'tools/src/release/action-runtime-lock.ts';
    const lock = 'packages/adaptive-review-action/runtime.lock';
    const inputs = [
      '.github/workflows/adaptive-review-reusable.yml',
      '.github/workflows/adaptive-review-outcomes-reusable.yml',
    ];
    for (const path of [script, lock, ...inputs]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
    }
    copyFileSync(join(repo, script), join(root, script));
    for (const file of inputs) {
      writeFileSync(
        join(root, file),
        'uses: actions/create-github-app-token@old\n',
      );
    }
    execFileSync('git', ['add', '--', ...inputs], { cwd: root });
    const [executable, ...args] = command.split(' ');
    execFileSync(executable, args, { cwd: root });
    const before = readFileSync(join(root, lock), 'utf8');

    // Like Renovate, change tracked working-tree files before staging a commit.
    for (const file of inputs) {
      writeFileSync(
        join(root, file),
        'uses: actions/create-github-app-token@new\n',
      );
    }
    expect(spawnSync('node', [script, '--check'], { cwd: root }).status).toBe(
      1,
    );
    execFileSync(executable, args, { cwd: root });
    expect(readFileSync(join(root, lock), 'utf8')).not.toBe(before);
    expect(spawnSync('node', [script, '--check'], { cwd: root }).status).toBe(
      0,
    );
    const after = readFileSync(join(root, lock), 'utf8');
    execFileSync(executable, args, { cwd: root });
    expect(readFileSync(join(root, lock), 'utf8')).toBe(after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
