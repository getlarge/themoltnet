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
  on: Record<string, unknown>;
  jobs: Record<string, Job & { uses: string; with: Record<string, string> }>;
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
const digestScriptPath = fileURLToPath(
  new URL('../adaptive-review-action-digest.sh', import.meta.url),
);
const BUNDLE = '.adaptive-review-runtime/packages/adaptive-review-action/dist';

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

/** Runs a step's inline script the way Actions does, returning its outputs. */
function runStep(
  run: string | undefined,
  env: Record<string, string>,
): { status: number | null; stderr: string; outputs: Record<string, string> } {
  const temp = mkdtempSync(join(tmpdir(), 'adaptive-step-'));
  try {
    const script = join(temp, 'step.sh');
    const output = join(temp, 'output');
    writeFileSync(script, run ?? '');
    writeFileSync(output, '');
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-eo', 'pipefail', script],
      {
        env: { PATH: process.env.PATH ?? '', ...env, GITHUB_OUTPUT: output },
        encoding: 'utf8',
      },
    );
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => [
          line.slice(0, line.indexOf('=')),
          line.slice(line.indexOf('=') + 1),
        ]),
    );
    return { status: result.status, stderr: result.stderr, outputs };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function workerAction(name: string): Step {
  return step(name, (item) =>
    Boolean(item.uses?.includes('/packages/agent-daemon-action@')),
  );
}

describe('adaptive review workflow trust gates', () => {
  it('gates every downstream job that can reach credentials', () => {
    expect(job('prepare').if).toBe(
      "github.event_name == 'issue_comment' || github.event.pull_request.draft == false",
    );
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

  it('protects only the callers that run from the pull request revision', () => {
    // The reusable workflow is pinned to a released bundle commit and the
    // runtime defaults to that commit, so review code changed by the PR
    // never executes.
    expect(caller.jobs.review.uses).toMatch(
      /adaptive-review-reusable\.yml@[0-9a-f]{40}$/,
    );
    expect(caller.jobs.review.with['runtime-ref']).toBeUndefined();
    expect(
      caller.jobs.review.with['protected-paths'].trim().split('\n'),
    ).toEqual([
      '.github/workflows/adaptive-review.yml',
      '.github/workflows/adaptive-review-outcomes.yml',
    ]);
  });

  it('reruns on a review request from a trusted commenter only', () => {
    const condition = caller.jobs.review.if;
    expect(caller.on).toHaveProperty('issue_comment.types', ['created']);
    for (const guard of [
      'github.event.issue.pull_request != null',
      "github.event.issue.state == 'open'",
      "github.event.comment.body == '/review'",
      "github.event.comment.user.type == 'User'",
      'contains(fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association)',
    ])
      expect(condition).toContain(guard);
    expect(caller.jobs.review.with.mode).toBe(
      "${{ github.event_name == 'issue_comment' && 'shadow' || vars.MOLTNET_ADAPTIVE_REVIEW_MODE || 'active' }}",
    );
    const resolve = step('prepare', (item) => item.id === 'pr');
    expect(resolve.if).toBe("github.event_name == 'issue_comment'");
    expect(stepIndex('prepare', (item) => item.id === 'pr')).toBeLessThan(
      stepIndex('prepare', (item) => item.id === 'screen'),
    );
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
    const planAt = stepIndex('prepare', (item) => item.id === 'plan');
    const gated = job('prepare').steps.slice(pinAt + 1, planAt + 1);
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
    ).toBe(
      '${{ github.event.pull_request.base.sha || steps.pr.outputs.base }}',
    );
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
      'route-artifact-id': '${{ steps.route-artifact.outputs.artifact-id }}',
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

  it('builds the action from the pinned runtime in prepare', () => {
    const runtime = stepIndex(
      'prepare',
      (item) => item.with?.path === '.adaptive-review-runtime',
    );
    const setup = stepIndex(
      'prepare',
      (item) => item.uses === `${RUNTIME_ACTION}/setup`,
    );
    const firstStage = stepIndex(
      'prepare',
      (item) => item.uses === RUNTIME_ACTION,
    );
    expect(runtime).toBeLessThan(setup);
    expect(setup).toBeLessThan(firstStage);
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

  it('consumes the producer artifact when only a failed downstream job is rerun', () => {
    const name =
      'adaptive-route-${{ github.repository_id }}-${{ github.event.pull_request.number || github.event.issue.number }}-${{ github.run_attempt }}';
    expect(
      step('route', (item) => item.name === 'Upload routing decision').with
        ?.name,
    ).toBe(name);
    expect(job('route').outputs?.['route-artifact-id']).toBe(
      '${{ steps.route-artifact.outputs.artifact-id }}',
    );
    expect(
      step('route', (item) => item.name === 'Upload routing decision').id,
    ).toBe('route-artifact');
    expect(
      step('review', (item) => item.name === 'Download routing decision').with,
    ).toMatchObject({
      'artifact-ids': '${{ needs.route.outputs.route-artifact-id }}',
      'merge-multiple': true,
    });
    expect(
      step('review', (item) => item.name === 'Download routing decision').with
        ?.name,
    ).toBeUndefined();
    expect(
      step('review', (item) => item.name === 'Upload review report').with?.name,
    ).toBe(
      'adaptive-review-${{ github.repository_id }}-${{ github.event.pull_request.number || github.event.issue.number }}-${{ github.run_attempt }}',
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
  });

  it('installs and builds the standalone action without an Nx Cloud lifecycle', () => {
    const setup = parse(
      read('../../packages/adaptive-review-action/setup/action.yml'),
    ) as { runs: { steps: Step[] } };
    const build = setup.runs.steps.find(
      (item) => item.name === 'Install and build the trusted action',
    )!;
    expect(build.env).toMatchObject({
      NX_NO_CLOUD: 'true',
      NX_DAEMON: 'false',
    });
    expect(build.run).toContain('pnpm install --frozen-lockfile');
    expect(build.run).toContain(
      'pnpm exec nx run @themoltnet/adaptive-review-action:build',
    );
  });

  it('builds the review action once and verifies it before later jobs run it', () => {
    const prepare = job('prepare');
    const plan = stepIndex('prepare', (item) => item.id === 'plan');
    const bundle = stepIndex('prepare', (item) => item.id === 'bundle');
    const upload = stepIndex(
      'prepare',
      (item) =>
        Boolean(item.uses?.startsWith('actions/upload-artifact@')) &&
        item.with?.path === BUNDLE,
    );
    expect(plan).toBeLessThan(bundle);
    expect(bundle).toBeLessThan(upload);
    expect(prepare.outputs?.['action-digest']).toBe(
      '${{ steps.bundle.outputs.digest }}',
    );
    expect(prepare.steps[upload].id).toBe('action-artifact');
    expect(prepare.outputs?.['action-artifact-id']).toBe(
      '${{ steps.action-artifact.outputs.artifact-id }}',
    );
    expect(prepare.steps[upload].with?.['retention-days']).toBe(14);
    for (const name of ['route', 'review']) {
      const steps = job(name).steps;
      expect(
        steps.some((item) =>
          item.uses?.endsWith('/adaptive-review-action/setup'),
        ),
      ).toBe(false);
      const download = stepIndex(
        name,
        (item) =>
          Boolean(item.uses?.startsWith('actions/download-artifact@')) &&
          item.with?.path === BUNDLE,
      );
      expect(steps[download].with).toMatchObject({
        'artifact-ids': '${{ needs.prepare.outputs.action-artifact-id }}',
        'merge-multiple': true,
      });
      expect(steps[download].with?.name).toBeUndefined();
      const verify = stepIndex(name, (item) =>
        Boolean(
          item.run?.includes('adaptive-review-action-digest.sh --verify'),
        ),
      );
      expect(steps[verify].env?.EXPECTED_DIGEST).toBe(
        '${{ needs.prepare.outputs.action-digest }}',
      );
      const firstAction = stepIndex(
        name,
        (item) => item.uses === RUNTIME_ACTION,
      );
      expect(download).toBeLessThan(verify);
      expect(verify).toBeLessThan(firstAction);
    }
  });
});

describe('review action bundle digest', () => {
  function bundle(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'adaptive-bundle-'));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  function digest(dir: string): string {
    return execFileSync('bash', [digestScriptPath, dir], { encoding: 'utf8' })
      .trim()
      .replace(/^digest=/, '');
  }

  function verify(expected: string, dir: string) {
    return spawnSync('bash', [digestScriptPath, '--verify', expected, dir], {
      encoding: 'utf8',
    });
  }

  it('verifies an identical bundle and rejects any change', () => {
    const original = bundle({ 'review.js': 'ab', 'chunks/c.js': '' });
    const variants = [
      bundle({ 'review.js': 'ab', 'chunks/c.js': '' }),
      bundle({ 'review.js': 'a', 'chunks/c.js': 'b' }),
      bundle({ 'renamed.js': 'ab', 'chunks/c.js': '' }),
      bundle({ 'review.js': 'ab', 'chunks/c.js': '', 'extra.js': '' }),
    ];
    try {
      const expected = digest(original);
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
      expect(variants.map((dir) => verify(expected, dir).status)).toEqual([
        0, 1, 1, 1,
      ]);
      expect(verify('not-a-digest', original).status).toBe(1);
      expect(verify(expected, join(original, 'missing')).status).toBe(1);
    } finally {
      for (const dir of [original, ...variants])
        rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('adaptive review inline step scripts', () => {
  const runtimeStep = () => step('prepare', (item) => item.id === 'runtime');
  const sha = 'c'.repeat(40);
  const runtimeEnv = {
    WORKFLOW_REPOSITORY: 'getlarge/themoltnet',
    WORKFLOW_SHA: sha,
    RUNTIME_REF: '',
    PROVIDERS: 'id=ollama-cloud base-url=https://ollama.com/v1',
  };

  it('resolves the runtime from the workflow commit or an explicit ref', () => {
    expect(runStep(runtimeStep().run, runtimeEnv).outputs).toEqual({
      repository: 'getlarge/themoltnet',
      ref: sha,
    });
    const ref = 'd'.repeat(40);
    expect(
      runStep(runtimeStep().run, { ...runtimeEnv, RUNTIME_REF: ref }).outputs
        .ref,
    ).toBe(ref);
  });

  it.each([
    [{ PROVIDERS: '  # only a comment' }, 'providers needs at least one'],
    [{ WORKFLOW_REPOSITORY: '' }, 'job.workflow_repository is required'],
    [{ RUNTIME_REF: 'main' }, 'must be a full commit SHA'],
    [{ WORKFLOW_SHA: 'C'.repeat(40) }, 'must be a full commit SHA'],
  ])('refuses runtime input %j', (env, message) => {
    const result = runStep(runtimeStep().run, { ...runtimeEnv, ...env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.outputs).toEqual({});
  });

  it.each([
    ['getlarge/themoltnet', 'someone', 'true'],
    ['someone/themoltnet', 'someone', 'false'],
    ['', 'someone', 'false'],
    ['getlarge/themoltnet', 'dependabot[bot]', 'false'],
  ])('screens head %j by %j as eligible=%s', (head, author, eligible) => {
    const screen = step('prepare', (item) => item.id === 'screen');
    expect(
      runStep(screen.run, {
        GITHUB_REPOSITORY: 'getlarge/themoltnet',
        HEAD_REPOSITORY: head,
        AUTHOR: author,
      }).outputs,
    ).toEqual({ eligible });
  });

  it('detects only a nonempty review report', () => {
    const detect = step('review', (item) => item.id === 'report-file');
    const temp = mkdtempSync(join(tmpdir(), 'adaptive-report-'));
    try {
      const report = join(temp, 'report.json');
      expect(runStep(detect.run, { ADAPTIVE_REPORT: report }).outputs).toEqual(
        {},
      );
      writeFileSync(report, '');
      expect(runStep(detect.run, { ADAPTIVE_REPORT: report }).outputs).toEqual(
        {},
      );
      writeFileSync(report, '{}');
      expect(runStep(detect.run, { ADAPTIVE_REPORT: report }).outputs).toEqual({
        exists: 'true',
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

it('resolves the reviewer identity read-only before review and mints publication access later', () => {
  const steps = job('review').steps;
  const identity = steps.findIndex((step) => step.id === 'reviewer-app');
  const review = steps.findIndex((step) => step.id === 'review');
  const publishToken = steps.findIndex((step) => step.id === 'app-token');
  expect(identity).toBeGreaterThan(-1);
  expect(identity).toBeLessThan(review);
  expect(publishToken).toBeGreaterThan(review);
  expect(steps[identity].with?.['permission-pull-requests']).toBe('read');
  expect(steps[review].env).toMatchObject({
    GH_TOKEN: '${{ github.token }}',
    ADAPTIVE_APP_LOGIN: '${{ steps.reviewer-app.outputs.app-slug }}[bot]',
  });
});
