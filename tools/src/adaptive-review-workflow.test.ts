import { execFileSync, spawnSync } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  if?: string;
  env?: Record<string, string>;
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
}

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const workflow = parse(
  read('../../.github/workflows/adaptive-review-reusable.yml'),
) as { jobs: Record<string, Job> };
const caller = parse(read('../../.github/workflows/adaptive-review.yml')) as {
  jobs: Record<string, Job & { with: Record<string, string> }>;
};
const action = parse(
  read('../../packages/adaptive-review-action/action.yml'),
) as {
  outputs: Record<string, { value: string }>;
  runs: { steps: Step[] };
};
const focusedPolicy = JSON.parse(
  read(
    '../../.github/runtime-policies/legreffier-adaptive-focused-readonly-v1.json',
  ),
) as { shellCommands: unknown[]; tools: string[] };
const fetchScriptPath = fileURLToPath(
  new URL('../fetch-adaptive-review-head.sh', import.meta.url),
);
const fetchScript = readFileSync(fetchScriptPath, 'utf8');

const RUNTIME_ACTION =
  './.adaptive-review-runtime/packages/adaptive-review-action';
const FETCH_STEP = 'Fetch reviewed head as inert Git data';
const WORKERS = ['classifier-worker', 'specialist-workers'];

function job(name: string): Job {
  const value = workflow.jobs[name];
  if (!value) throw new Error(`Job ${name} is missing`);
  return value;
}

function stepIndex(name: string, predicate: (step: Step) => boolean): number {
  const index = job(name).steps.findIndex(predicate);
  if (index < 0) throw new Error(`Step is missing in ${name}`);
  return index;
}

function step(name: string, predicate: (step: Step) => boolean): Step {
  return job(name).steps[stepIndex(name, predicate)];
}

function workerAction(name: string): Step {
  return step(name, (item) =>
    Boolean(item.uses?.includes('/packages/agent-daemon-action@')),
  );
}

describe('adaptive review workflow trust gates', () => {
  it('gates every downstream job that can reach credentials', () => {
    expect(job('prepare').if).toBe('github.event.pull_request.draft == false');
    expect(job('route').if).toContain("needs.prepare.outputs.skip == 'false'");
    expect(job('review').if).toBe("needs.route.result == 'success'");
    expect(job('classifier-worker').if).toBe(
      "needs.prepare.outputs.classifier-needed == 'true'",
    );
    expect(job('specialist-workers').if).toBe(
      "needs.route.outputs.has-specialists == 'true'",
    );
    expect(job('route').needs).toBe('prepare');
    expect(job('classifier-worker').needs).toBe('prepare');
    expect(job('review').needs).toEqual(['prepare', 'route']);
    expect(job('specialist-workers').needs).toEqual(['prepare', 'route']);
  });

  it('skips unless the pin step explicitly admits the pull request', () => {
    // Fail closed: a pin that never ran (pre-screened, or failed) skips.
    expect(job('prepare').outputs?.skip).toBe(
      "${{ steps.pin.outputs.skip != 'false' || steps.plan.outputs.review-enabled != 'true' }}",
    );
  });

  it('screens fork and Dependabot pull requests before installing', () => {
    const screen = stepIndex('prepare', (item) => item.id === 'screen');
    const setup = stepIndex('prepare', (item) =>
      Boolean(item.uses?.endsWith('/adaptive-review-action/setup')),
    );
    const pin = stepIndex('prepare', (item) => item.id === 'pin');
    expect(screen).toBeLessThan(setup);
    for (const index of [setup, pin]) {
      expect(job('prepare').steps[index].if).toBe(
        "steps.screen.outputs.eligible == 'true'",
      );
    }
  });

  it('checks eligibility in the pinned runtime before fetching head data', () => {
    const pin = step('prepare', (item) => item.id === 'pin');
    expect(pin.uses).toBe(RUNTIME_ACTION);
    expect(pin.with).toEqual({ step: 'prepare' });
    expect(pin.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      PROTECTED_PATHS: '${{ inputs.protected-paths }}',
    });
    const pinAt = stepIndex('prepare', (item) => item.id === 'pin');
    const gated = job('prepare').steps.slice(pinAt + 1);
    expect(gated.map((item) => item.name ?? item.id)).toEqual([
      FETCH_STEP,
      'Write pinned planner input',
      'Check classifier work budget',
    ]);
    for (const item of gated)
      expect(item.if).toBe("steps.pin.outputs.skip == 'false'");
    expect(
      step(
        'prepare',
        (item) => item.uses?.startsWith('actions/checkout@') ?? false,
      ).with?.ref,
    ).toBe('${{ github.event.pull_request.base.sha }}');
  });

  it('exposes the stage outputs the jobs consume', () => {
    const stepOutput = (id: string, key: string) =>
      `\${{ steps.${id}.outputs.${key} }}`;
    for (const key of ['skip', 'prepared', 'base', 'head', 'correlation'])
      expect(action.outputs[key].value).toBe(stepOutput('prepare', key));
    for (const key of ['review-enabled', 'classifier-needed'])
      expect(action.outputs[key].value).toBe(stepOutput('plan', key));
    for (const key of ['specialists', 'has-specialists'])
      expect(action.outputs[key].value).toBe(stepOutput('route', key));
    expect(job('prepare').outputs?.['review-enabled']).toBe(
      stepOutput('plan', 'review-enabled'),
    );
    expect(job('route').outputs).toEqual({
      specialists: stepOutput('route', 'specialists'),
      'has-specialists': stepOutput('route', 'has-specialists'),
    });
    expect(
      action.runs.steps
        .filter((item) => item.id)
        .map((item) => [item.id, item.if]),
    ).toEqual([
      ['prepare', "inputs.step == 'prepare'"],
      ['plan', "inputs.step == 'plan'"],
      ['route', "inputs.step == 'route'"],
    ]);
  });

  it('builds the action from the pinned runtime in every stage job', () => {
    for (const name of ['prepare', 'route', 'review']) {
      const runtime = stepIndex(
        name,
        (item) => item.with?.path === '.adaptive-review-runtime',
      );
      const setup = stepIndex(
        name,
        (item) => item.uses === `${RUNTIME_ACTION}/setup`,
      );
      const firstStage = stepIndex(
        name,
        (item) => item.uses === RUNTIME_ACTION,
      );
      expect(runtime).toBeLessThan(setup);
      expect(setup).toBeLessThan(firstStage);
    }
    for (const name of ['route', 'review'])
      expect(
        step(name, (item) => item.with?.path === '.adaptive-review-runtime')
          .with?.ref,
      ).toBe('${{ needs.prepare.outputs.runtime-sha }}');
  });

  it('lets the stage jobs read worker liveness', () => {
    for (const name of ['route', 'review'])
      expect(job(name).permissions).toEqual({
        actions: 'read',
        contents: 'read',
        'pull-requests': 'read',
      });
    expect(caller.jobs.review.permissions).toMatchObject({ actions: 'read' });
  });

  it('keeps the focused runtime on bounded read tools', () => {
    expect(focusedPolicy.shellCommands).toEqual([]);
    expect(focusedPolicy.tools).toEqual(['find', 'grep', 'ls', 'read']);
  });

  it('passes every declared provider secret to both worker jobs', () => {
    for (const name of WORKERS) {
      const env = workerAction(name).env ?? {};
      for (const provider of [
        'OLLAMA',
        'OPENAI',
        'ANTHROPIC',
        'OPENROUTER',
        'GEMINI',
      ]) {
        expect(env[`${provider}_API_KEY`]).toBe(
          `\${{ secrets.${provider}_API_KEY }}`,
        );
      }
    }
  });

  it('passes the producer project scope to both worker types', () => {
    for (const name of WORKERS)
      expect(workerAction(name).with?.['project-id']).toBe(
        '${{ inputs.project-id }}',
      );
  });

  it('keeps route artifacts distinct across rerun attempts', () => {
    const name =
      'adaptive-route-${{ github.repository_id }}-${{ github.event.pull_request.number }}-${{ github.run_attempt }}';
    expect(
      step('route', (item) => item.name === 'Upload routing decision').with
        ?.name,
    ).toBe(name);
    expect(
      step('review', (item) => item.name === 'Download routing decision').with
        ?.name,
    ).toBe(name);
    expect(
      step('review', (item) => item.name === 'Upload review report').with?.name,
    ).toBe(
      'adaptive-review-${{ github.repository_id }}-${{ github.event.pull_request.number }}-${{ github.run_attempt }}',
    );
  });

  it('runs one pinned authenticated fetch script in every job', () => {
    for (const name of Object.keys(workflow.jobs)) {
      const fetch = step(name, (item) => item.name === FETCH_STEP);
      expect(fetch.run).toBe(
        'bash .adaptive-review-runtime/tools/fetch-adaptive-review-head.sh',
      );
      expect(fetch.env?.GH_TOKEN).toBe('${{ github.token }}');
      expect(fetch.env?.BASE_SHA).toMatch(/^\$\{\{ .+\.base \}\}$/);
      expect(fetch.env?.HEAD_SHA).toMatch(/^\$\{\{ .+\.head \}\}$/);
      const base = step(
        name,
        (item) =>
          Boolean(item.uses?.startsWith('actions/checkout@')) &&
          item.with?.path === undefined,
      );
      expect(base.with?.['fetch-depth']).toBe(1);
      expect(base.with?.ref).not.toContain('head');
    }
    for (const name of WORKERS) {
      expect(
        step(name, (item) => item.with?.path === '.adaptive-review-runtime')
          .with,
      ).toMatchObject({
        repository: '${{ job.workflow_repository }}',
        ref: '${{ needs.prepare.outputs.runtime-sha }}',
      });
    }
    const temp = mkdtempSync(join(tmpdir(), 'adaptive-fetch-'));
    try {
      const capture = join(temp, 'capture');
      const fakeGit = join(temp, 'git');
      writeFileSync(
        fakeGit,
        '#!/bin/sh\ncase "$1" in\n  fetch) printf "%s\\n" "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" "$@" > "$TEST_CAPTURE";;\n  merge-base) exit 0;;\nesac\n',
      );
      chmodSync(fakeGit, 0o755);
      const base = 'a'.repeat(40);
      const head = 'b'.repeat(40);
      const env = {
        ...process.env,
        PATH: `${temp}:${process.env.PATH ?? ''}`,
        BASE_SHA: base,
        HEAD_SHA: head,
        GH_TOKEN: 'fixture-token',
        GITHUB_SERVER_URL: 'https://github.com',
        TEST_CAPTURE: capture,
      };
      const valid = spawnSync('bash', [fetchScriptPath], {
        env,
        encoding: 'utf8',
      });
      expect(valid.status, valid.stderr).toBe(0);
      expect(readFileSync(capture, 'utf8').trim().split('\n')).toEqual([
        '1',
        'http.https://github.com/.extraheader',
        `AUTHORIZATION: basic ${Buffer.from('x-access-token:fixture-token').toString('base64')}`,
        'fetch',
        '--no-tags',
        '--depth=1',
        'origin',
        head,
      ]);
      const invalid = spawnSync('bash', [fetchScriptPath], {
        env: { ...env, HEAD_SHA: '--upload-pack=evil' },
        encoding: 'utf8',
      });
      expect(invalid.status).toBe(2);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('finds a merge base and reads complete blobs for production three-dot diffs', () => {
    const temp = mkdtempSync(join(tmpdir(), 'adaptive-shallow-'));
    const source = join(temp, 'source');
    const remote = join(temp, 'remote.git');
    const checkout = join(temp, 'checkout');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    try {
      mkdirSync(source);
      git(temp, 'init', '--bare', remote);
      git(source, 'init', '-b', 'main');
      git(source, 'config', 'user.name', 'Test');
      git(source, 'config', 'user.email', 'test@example.invalid');
      writeFileSync(join(source, 'review.txt'), 'common content\n');
      git(source, 'add', 'review.txt');
      git(source, 'commit', '-m', 'common');
      const common = git(source, 'rev-parse', 'HEAD');
      git(source, 'branch', 'feature');
      writeFileSync(join(source, 'main-only.txt'), 'main content\n');
      git(source, 'add', 'main-only.txt');
      git(source, 'commit', '-m', 'base advanced');
      const base = git(source, 'rev-parse', 'HEAD');
      git(source, 'remote', 'add', 'origin', remote);
      git(source, 'push', 'origin', 'main');
      git(source, 'checkout', 'feature');
      writeFileSync(join(source, 'review.txt'), 'head content\n');
      git(source, 'commit', '-am', 'head');
      const head = git(source, 'rev-parse', 'HEAD');
      git(source, 'push', 'origin', 'feature');

      git(
        temp,
        'clone',
        '--depth=1',
        '--branch',
        'main',
        `file://${remote}`,
        checkout,
      );
      expect(git(checkout, 'rev-parse', '--is-shallow-repository')).toBe(
        'true',
      );
      const fetched = spawnSync('bash', [fetchScriptPath], {
        cwd: checkout,
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: head,
          GH_TOKEN: 'fixture-token',
          GITHUB_SERVER_URL: 'https://github.com',
        },
        encoding: 'utf8',
      });
      expect(fetched.status, fetched.stderr).toBe(0);
      expect(git(checkout, 'merge-base', base, head)).toBe(common);
      expect(git(checkout, 'show', `${base}:main-only.txt`)).toBe(
        'main content',
      );
      expect(git(checkout, 'show', `${head}:review.txt`)).toBe('head content');
      expect(git(checkout, 'diff', '--name-only', `${base}...${head}`)).toBe(
        'review.txt',
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('pins runtime code separately from caller policy and head data', () => {
    const runtime = step('prepare', (item) => item.id === 'runtime');
    expect(runtime.env).toMatchObject({
      WORKFLOW_REPOSITORY: '${{ job.workflow_repository }}',
      WORKFLOW_SHA: '${{ job.workflow_sha }}',
    });
    for (const name of ['route', 'review'])
      expect(job(name).env?.ADAPTIVE_RUNTIME_SHA).toBe(
        '${{ needs.prepare.outputs.runtime-sha }}',
      );
    expect(fetchScript).toContain(
      'authenticated_fetch --depth=1 origin "$HEAD_SHA"',
    );
    expect(fetchScript).toContain('GIT_CONFIG_COUNT=1');
    expect(caller.jobs.review.with['classifier-profile']).toBe(
      'legreffier-issue-classifier-v2',
    );
    expect(caller.jobs.review.with['runtime-ref']).toBe(
      '${{ github.event.pull_request.base.sha }}',
    );
  });
});
