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
  jobs: Record<
    string,
    { steps: Step[]; needs?: string | string[]; env?: Record<string, string> }
  >;
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
    expect(
      named('Commit bundles, tag them, and promote the stable major tag').env,
    ).toMatchObject({
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
      steps.filter((step) => step.uses?.startsWith('actions/checkout@'))[1]
        ?.with,
    ).toMatchObject({ ref: '${{ matrix.tag }}', 'persist-credentials': false });
  });

  it('rejects a source package whose version disagrees with the requested tag', () => {
    const root = mkdtempSync(join(tmpdir(), 'action-source-'));
    try {
      mkdirSync(join(root, 'packages/agent-daemon-action'), {
        recursive: true,
      });
      writeFileSync(
        join(root, 'packages/agent-daemon-action/package.json'),
        JSON.stringify({
          name: '@themoltnet/agent-daemon-action',
          version: '0.8.0',
        }),
      );
      const run = (tag: string) =>
        execFileSync(
          'bash',
          ['-e', '-c', named('Verify release source identity').run!],
          {
            cwd: root,
            env: { ...process.env, COMPONENT: 'agent-daemon-action', TAG: tag },
            stdio: 'pipe',
          },
        );
      expect(() => run('agent-daemon-action-v0.8.0')).not.toThrow();
      expect(() => run('agent-daemon-action-v0.9.0')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects stale release source before dependency installation and building', () => {
    const check = named('Check component release source runtime locks');
    expect(check.run).toBe(
      'node "$RUNNER_TEMP/action-release-control/action-runtime-lock.ts" --check --project-root "packages/$COMPONENT"',
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

  it('never republishes a published npm version', () => {
    const outputs = resolveTargets('sdk', [
      { tagName: 'sdk-v1.4.0', isDraft: false },
    ]);
    expect(outputs.sdk).toBe('false');
    expect(outputs['actions-matrix']).toBeUndefined();
  });
});

describe('action publication transaction', () => {
  it('publishes the release only after its remote bundle and notes exist', () => {
    const push = steps.indexOf(
      named('Commit bundles, tag them, and promote the stable major tag'),
    );
    const record = steps.indexOf(
      named('Record the exact action pin in release notes'),
    );
    const finalize = steps.indexOf(named('Publish the release'));
    expect(push).toBeLessThan(record);
    expect(record).toBeLessThan(finalize);
    expect(named('Publish the release').if).toBeUndefined();
  });

  it('uses current recovery code when building historical release sources', () => {
    const preserve = steps.indexOf(
      named('Preserve current release controller'),
    );
    const checkouts = steps.flatMap((step, i) =>
      step.uses?.startsWith('actions/checkout@') ? [i] : [],
    );
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0]).toBeLessThan(preserve);
    expect(preserve).toBeLessThan(checkouts[1]);
    expect(named('Verify the built bundles').run).toContain(
      '$RUNNER_TEMP/action-release-control/',
    );
    expect(
      named('Commit bundles, tag them, and promote the stable major tag').run,
    ).toContain('$RUNNER_TEMP/action-release-control/');
  });

  it('isolates action reconciliation from npm and Docker target resolution', () => {
    const jobs = workflow('release').jobs;
    expect(jobs['publish-actions'].needs).toBe('reconcile-actions');
    expect(jobs['resolve-publish'].needs).toBe('release-please');
    expect(jobs['reconcile-actions'].needs).toBe('release-please');
  });

  it('keeps pin maintenance out of Release Please and reports isolated failures', () => {
    const jobs = workflow('release').jobs;
    expect(
      jobs['release-please'].steps.some((s) =>
        s.run?.includes('sync-daemon-consumer-pins'),
      ),
    ).toBe(false);
    const sync = jobs['sync-consumer-pins'].steps;
    expect(
      sync.find((s) => s.name === 'Commit consumer pins to release PR')?.run,
    ).toContain('fix(adaptive-review-action): sync published runtime pins');
    expect(
      sync.find((s) => s.name === 'Report independent sync failures')?.if,
    ).toContain("steps.daemon.outcome == 'failure'");
    expect(
      sync.find(
        (s) => s.name === 'Refresh runtime locks and stage consumer pins',
      )?.run,
    ).toContain('action-runtime-lock.ts');
  });
});
