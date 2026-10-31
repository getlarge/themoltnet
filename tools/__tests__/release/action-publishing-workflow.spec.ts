import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  jobs: Record<string, { steps: Step[]; env?: Record<string, string> }>;
}
const workflow = (name: string): Workflow =>
  parse(
    readFileSync(
      new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
      'utf8',
    ),
  ) as Workflow;

const job = workflow('release').jobs['publish-actions'];
const steps = job.steps;
const named = (name: string): Step => {
  const step = steps.find((step) => step.name === name);
  if (!step) throw new Error(`Missing publishing step: ${name}`);
  return step;
};

describe('action publishing authorization and source validation', () => {
  it('uses a repository-scoped Release App token for workflow-bearing tags', () => {
    const token = named('Create action publishing token');
    expect(token.with).toMatchObject({
      'client-id': '${{ secrets.MOLTNET_RELEASE_APP_ID }}',
      'private-key': '${{ secrets.MOLTNET_RELEASE_APP_KEY }}',
      owner: 'getlarge',
      repositories: 'themoltnet',
      'permission-contents': 'write',
      'permission-workflows': 'write',
    });
    expect(token.uses).toMatch(/^actions\/create-github-app-token@/);
    expect(named('Commit bundles and move the stable major tag').env).toEqual({
      GITHUB_ACTION_RELEASE_TOKEN: `\${{ steps.${token.id}.outputs.token }}`,
    });
    expect(steps.indexOf(token)).toBeGreaterThan(
      steps.indexOf(named('Verify the built bundles')),
    );
    expect(steps.indexOf(token)).toBeLessThan(
      steps.indexOf(named('Publish the release')),
    );
    expect(job.env).toBeUndefined();
    expect(
      steps.find((step) => step.uses?.startsWith('actions/checkout@'))?.with,
    ).toMatchObject({ ref: '${{ matrix.tag }}', 'persist-credentials': false });
  });

  it('rejects stale release source before dependency installation and building', () => {
    const check = named('Check release source runtime locks');
    expect(check.run).toBe(
      'node tools/src/release/action-runtime-lock.ts --check',
    );
    expect(check.if).toBeUndefined();
    expect(steps.indexOf(check)).toBeLessThan(
      steps.indexOf(named('Install dependencies')),
    );
    expect(
      steps.find((step) => step.uses === './.github/actions/setup-workspace')
        ?.with,
    ).toMatchObject({ 'install-dependencies': 'false' });
  });

  it('checks merged trees as well as pull requests in CI', () => {
    const check = Object.values(workflow('ci').jobs)
      .flatMap((job) => job.steps ?? [])
      .find((step) => step.name === 'Action runtime locks are current');
    expect(check?.run).toBe(
      'node tools/src/release/action-runtime-lock.ts --check',
    );
    expect(check).not.toHaveProperty('if');
  });
});

describe('republish target resolution', () => {
  const resolveStep = workflow('release').jobs['resolve-publish'].steps.find(
    (step) => step.id === 'resolve',
  );
  if (!resolveStep?.run) throw new Error('Missing Resolve publish targets');
  const script = resolveStep.run;

  // Serves `releases` to the script's `gh release list --json ... --jq ...`
  // calls, honouring --exclude-drafts the way gh does.
  function resolveTargets(
    republish: string,
    releases: { tagName: string; isDraft: boolean }[],
  ): Record<string, string> {
    const root = mkdtempSync(join(tmpdir(), 'moltnet-resolve-publish-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      writeFileSync(join(root, 'releases.json'), JSON.stringify(releases));
      writeFileSync(
        join(bin, 'gh'),
        `#!/usr/bin/env bash
filter='.'
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) expr="$2"; shift ;;
    --exclude-drafts) filter='[.[] | select(.isDraft | not)]' ;;
  esac
  shift
done
jq -r "$filter | $expr" "${join(root, 'releases.json')}"
`,
      );
      chmodSync(join(bin, 'gh'), 0o755);
      const output = join(root, 'output');
      writeFileSync(output, '');
      execFileSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'getlarge/themoltnet',
          REPUBLISH: republish,
        },
        stdio: 'pipe',
      });
      return Object.fromEntries(
        readFileSync(output, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  it('republishes an already-published action by moving its major tag', () => {
    const outputs = resolveTargets('agent-daemon-action', [
      { tagName: 'sdk-v1.4.0', isDraft: false },
      { tagName: 'agent-daemon-action-v0.8.0', isDraft: false },
      { tagName: 'agent-daemon-action-v0.7.0', isDraft: false },
    ]);
    expect(outputs['agent-daemon-action']).toBe('true');
    expect(JSON.parse(outputs['actions-matrix'])).toEqual([
      {
        project: '@themoltnet/agent-daemon-action',
        tag: 'agent-daemon-action-v0.8.0',
      },
    ]);
  });

  it('prefers a pending draft over the latest published action release', () => {
    const outputs = resolveTargets('adaptive-review-action', [
      { tagName: 'adaptive-review-action-v0.2.0', isDraft: true },
      { tagName: 'adaptive-review-action-v0.1.2', isDraft: false },
    ]);
    expect(outputs['adaptive-review-action-tag']).toBe(
      'adaptive-review-action-v0.2.0',
    );
  });

  it('never republishes a published npm version', () => {
    const outputs = resolveTargets('sdk', [
      { tagName: 'sdk-v1.4.0', isDraft: false },
    ]);
    expect(outputs.sdk).toBe('false');
    expect(outputs['actions-matrix']).toBe('[]');
  });
});
