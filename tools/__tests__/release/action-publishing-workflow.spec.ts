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
  on: Record<string, unknown>;
  jobs: Record<
    string,
    {
      steps: Step[];
      needs?: string | string[];
      if?: string;
      env?: Record<string, string>;
    }
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

  it('allows consumer maintenance to open a draft rollout PR', () => {
    const token = workflow('release').jobs['sync-consumer-pins'].steps.find(
      (step) => step.id === 'app-token',
    );
    expect(token?.with).toEqual({
      'client-id': '${{ secrets.MOLTNET_RELEASE_APP_ID }}',
      'private-key': '${{ secrets.MOLTNET_RELEASE_APP_KEY }}',
      owner: 'getlarge',
      repositories: 'themoltnet',
      'permission-contents': 'write',
      'permission-workflows': 'write',
      'permission-pull-requests': 'write',
    });
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
  it('runs legacy recovery only on pushes or explicit legacy dispatches', () => {
    const release = workflow('release');
    expect(Object.keys(release.on).sort()).toEqual([
      'push',
      'workflow_dispatch',
    ]);
    for (const id of [
      'resolve-publish',
      'reconcile-actions',
      'sync-consumer-pins',
    ]) {
      expect(release.jobs[id].if?.trim()).toBe(
        "always() && !cancelled() && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.engine == 'legacy'))",
      );
    }
  });

  it('waits for action bundles, CLI npm packages and finalized daemon assets before pin sync', () => {
    const jobs = workflow('release').jobs;
    expect(jobs['sync-consumer-pins'].needs).toEqual([
      'release-please',
      'publish-actions',
      'publish-cli-wrapper',
      'finalize-agent-daemon-release',
    ]);
    // Failure or a skipped producer must not suppress independent pin families.
    expect(jobs['sync-consumer-pins'].if).toContain('always()');
    expect(jobs['sync-consumer-pins'].if).not.toMatch(/!failure\(\)|\.result/);
  });

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
    expect(jobs['publish-actions'].needs).toEqual([
      'reconcile-actions',
      'finalize-agent-daemon-release',
    ]);
    expect(jobs['resolve-publish'].needs).toBe('release-please');
    expect(jobs['reconcile-actions'].needs).toBe('release-please');
  });

  it('passes manual republish and exact-version inputs to the action reconciler', () => {
    const reconcile = workflow('release').jobs['reconcile-actions'].steps.find(
      (step) => step.id === 'actions',
    );
    expect(reconcile?.env).toMatchObject({
      ACTION_TAG: "${{ inputs.action-tag || '' }}",
      REPUBLISH: "${{ inputs.republish || '' }}",
    });
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
      sync.find(
        (s) => s.name === 'Commit consumer pins and open a draft if needed',
      )?.run,
    ).toContain('fix(adaptive-review-action): sync published runtime pins');
    expect(
      sync.find((s) => s.name === 'Report independent sync failures')?.if,
    ).toContain("steps.review.outcome == 'failure'");
    expect(
      sync.find(
        (s) => s.name === 'Refresh runtime locks and stage consumer pins',
      )?.run,
    ).toContain('action-runtime-lock.ts');
  });
});

describe('same-run adaptive release and consumer adoption', () => {
  const release = workflow('release');
  const sync = release.jobs['sync-consumer-pins'].steps;
  const commit = sync.find(
    (s) => s.name === 'Commit consumer pins and open a draft if needed',
  )!;

  it('waits for daemon finalization and validates its exact source version before building or publishing', () => {
    expect(job.needs).toEqual([
      'reconcile-actions',
      'finalize-agent-daemon-release',
    ]);
    expect(job.if).toContain('always()');
    const gate = named('Verify exact review daemon is published');
    expect(gate.if).toBe("matrix.component == 'adaptive-review-action'");
    expect(steps.indexOf(gate)).toBeLessThan(
      steps.indexOf(named('Build the action')),
    );
    const built = named('Verify packaged review dependencies');
    expect(built.run).toContain('--check-bundle');
    expect(steps.indexOf(built)).toBeLessThan(
      steps.indexOf(named('Create action publishing token')),
    );
    expect(sync.some((s) => s.run?.includes('sync-daemon-consumer-pins'))).toBe(
      false,
    );
  });

  it('keeps the daemon and worker as explicit workspace release dependencies', () => {
    const read = (path: string) =>
      JSON.parse(
        readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
      );
    const pkg = read('packages/adaptive-review-action/package.json');
    expect(pkg.dependencies['@themoltnet/agent-daemon']).toBe('workspace:*');
    expect(pkg.devDependencies['@themoltnet/agent-daemon-action']).toBe(
      'workspace:*',
    );
    const config = read('release-please-config.json');
    expect(config.plugins).toContainEqual({ type: 'node-workspace' });
    for (const path of [
      'apps/agent-daemon',
      'packages/agent-daemon-action',
      'packages/adaptive-review-action',
    ]) {
      expect(config.packages[path]['release-type']).toBe('node');
    }
  });

  function consumerFixture() {
    const root = mkdtempSync(join(tmpdir(), 'consumer-rollout-'));
    const checkout = join(root, 'checkout');
    const remote = join(root, 'remote.git');
    const bin = join(root, 'bin');
    mkdirSync(checkout);
    mkdirSync(bin);
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: checkout,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    execFileSync('git', ['init', '--bare', '-q', remote]);
    git('init', '-q');
    git('config', 'user.name', 'test');
    git('config', 'user.email', 'test@example.com');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(checkout, 'pin'), 'old');
    git('add', 'pin');
    git('commit', '-qm', 'base');
    git('remote', 'add', 'origin', remote);
    const base = git('rev-parse', 'HEAD');
    const log = join(root, 'gh.log');
    writeFileSync(log, '');
    const shim = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\n');
if (args[0] === 'pr' && args[1] === 'view') console.log(process.env.PR_STATE);
if (args[0] === 'pr' && args[1] === 'list') console.log((args.includes('--head') ? process.env.RELEASE_PR : process.env.CONSUMER_PR) || '');
if (args[0] === 'api') console.log(process.env.BRANCH_REFS || '');
if (args[0] === 'pr' && args[1] === 'create' && process.env.FAIL_CREATE === 'true') process.exit(1);
`;
    writeFileSync(join(bin, 'gh'), shim, { mode: 0o755 });
    const branch = 'automation/published-consumer-pins-123';
    const run = (extra: Record<string, string> = {}) =>
      execFileSync('bash', ['-eo', 'pipefail', '-c', commit.run!], {
        cwd: checkout,
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GH_LOG: log,
          RUNNER_TEMP: root,
          GITHUB_REPOSITORY: 'example/repo',
          PR_NUMBER: '',
          PR_BRANCH: branch,
          PR_CHECKOUT: 'main',
          ...extra,
        },
      });
    const change = () => {
      writeFileSync(join(checkout, 'pin'), 'new');
      git('add', 'pin');
    };
    const calls = () =>
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    const select = (extra: Record<string, string> = {}) => {
      const output = join(root, 'selection');
      writeFileSync(output, '');
      execFileSync(
        'bash',
        ['-eo', 'pipefail', '-c', sync.find((s) => s.id === 'pr')!.run!],
        {
          cwd: checkout,
          stdio: 'pipe',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GH_LOG: log,
            GITHUB_REPOSITORY: 'example/repo',
            GITHUB_RUN_ID: '123',
            GITHUB_OUTPUT: output,
            ...extra,
          },
        },
      );
      return Object.fromEntries(
        readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      );
    };
    return { root, git, remote, base, branch, run, change, calls, select };
  }

  it('selects an existing PR or recovers a pushed branch before starting a new draft', () => {
    const f = consumerFixture();
    try {
      expect(f.select({ RELEASE_PR: '7' })).toEqual({
        number: '7',
        branch: 'release-please--branches--main',
        checkout: 'release-please--branches--main',
      });
      const branch = 'automation/published-consumer-pins-100';
      expect(
        f.select({
          CONSUMER_PR: JSON.stringify({ number: 8, headRefName: branch }),
        }),
      ).toEqual({ number: '8', branch, checkout: branch });
      expect(f.select()).toEqual({
        number: '',
        branch: f.branch,
        checkout: 'main',
      });
      expect(f.select({ BRANCH_REFS: `refs/heads/${f.branch}` })).toEqual({
        number: '',
        branch: f.branch,
        checkout: f.branch,
      });
      expect(
        f.select({ BRANCH_REFS: `refs/heads/${f.branch}-other` }).checkout,
      ).toBe('main');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('opens one draft after a real push and leaves an unchanged checkout alone', () => {
    const f = consumerFixture();
    try {
      f.run();
      expect(f.calls()).toEqual([]);
      f.change();
      f.run();
      const published = f
        .git('ls-remote', 'origin', `refs/heads/${f.branch}`)
        .split(/\s/)[0];
      expect(published).toBe(f.git('rev-parse', 'HEAD'));
      const creates = f
        .calls()
        .filter((args) => args[0] === 'pr' && args[1] === 'create');
      expect(creates).toHaveLength(1);
      expect(creates[0]).toContain('--draft');
      f.run({
        PR_NUMBER: '42',
        PR_CHECKOUT: f.branch,
        PR_STATE: JSON.stringify({
          state: 'OPEN',
          headRefName: f.branch,
          headRefOid: published,
        }),
      });
      expect(f.calls().filter((args) => args[1] === 'create')).toHaveLength(1);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('recovers PR creation after the push without another commit or release', () => {
    const f = consumerFixture();
    try {
      f.change();
      expect(() => f.run({ FAIL_CREATE: 'true' })).toThrow();
      const pushed = f.git('rev-parse', 'HEAD');
      f.run({ PR_CHECKOUT: f.branch });
      expect(f.git('rev-parse', 'HEAD')).toBe(pushed);
      expect(f.calls().filter((args) => args[1] === 'create')).toHaveLength(2);
      expect(f.git('rev-list', '--count', `${f.base}..HEAD`)).toBe('1');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('refuses stale PR state before committing or pushing', () => {
    const f = consumerFixture();
    try {
      f.change();
      expect(() =>
        f.run({
          PR_NUMBER: '42',
          PR_STATE: JSON.stringify({
            state: 'OPEN',
            headRefName: f.branch,
            headRefOid: 'a'.repeat(40),
          }),
        }),
      ).toThrow();
      expect(f.git('rev-parse', 'HEAD')).toBe(f.base);
      expect(f.git('ls-remote', 'origin')).toBe('');
      expect(f.calls().some((args) => args[1] === 'create')).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
