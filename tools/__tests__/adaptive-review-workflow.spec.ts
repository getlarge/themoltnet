import { execFileSync, spawnSync } from 'node:child_process';
import {
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
  with?: Record<string, string | boolean>;
}

interface Job {
  if?: string;
  env?: Record<string, string>;
  needs?: string | string[];
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  services?: Record<string, { image: string; ports: Array<string | number> }>;
  steps: Step[];
}

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const workflow = parse(
  read('../../.github/workflows/adaptive-review-reusable.yml'),
) as {
  jobs: Record<string, Job>;
  on: {
    workflow_call: {
      inputs: Record<string, { default?: string }>;
      secrets: Record<string, { required: boolean }>;
    };
  };
};
const caller = parse(read('../../.github/workflows/adaptive-review.yml')) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job & { uses: string; with: Record<string, string> }>;
};

const fetchScriptPath = fileURLToPath(
  new URL('../fetch-adaptive-review-head.sh', import.meta.url),
);
const digestScriptPath = fileURLToPath(
  new URL('../adaptive-review-action-digest.sh', import.meta.url),
);
function job(name: string): Job {
  const found = workflow.jobs[name];
  if (!found) throw new Error(`Missing job ${name}`);
  return found;
}
/** Runs a step's inline script the way Actions does, returning its outputs. */
function runStep(
  run: string | undefined,
  env: Record<string, string>,
  cwd?: string,
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
        cwd,
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

describe('adaptive review consumer', () => {
  it('delegates the entire review graph to one supervisor invocation', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['review']);
    const run = job('review').steps.filter(
      (step) => step.with?.['supervisor-entry'],
    );
    expect(run).toHaveLength(1);
    expect(run[0].with?.['supervisor-entry']).toMatch(/dist\/run\.js$/);
    expect(
      job('review').steps.some((step) =>
        ['prepare', 'route', 'review', 'publish'].includes(
          String(step.with?.step ?? ''),
        ),
      ),
    ).toBe(false);
    expect(
      job('review').steps.some((step) =>
        step.uses?.startsWith('actions/download-artifact'),
      ),
    ).toBe(false);
  });
  it('preserves trusted comment authorization in both consumer and reusable host', () => {
    for (const guard of [
      'github.event.issue.pull_request != null',
      "github.event.issue.state == 'open'",
      "github.event.comment.body == '/review'",
      "github.event.comment.user.type == 'User'",
      'github.event.comment.author_association',
    ]) {
      expect(caller.jobs.review.if).toContain(guard);
      expect(job('review').if).toContain(guard);
    }
  });
  it('keeps review runtime separate from inert head data and pins its release explicitly', () => {
    expect(caller.jobs.review.uses).toMatch(
      /adaptive-review-reusable\.yml@[a-f0-9]{40}$/,
    );
    expect(caller.jobs.review.with['runtime-ref']).toBe(
      caller.jobs.review.uses.split('@')[1],
    );
    const checkouts = job('review').steps.filter((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].with?.ref).toContain('pull_request.base.sha');
    expect(checkouts[1].with?.path).toBe('.adaptive-review-runtime');
    expect(
      checkouts.every((step) => step.with?.['persist-credentials'] === false),
    ).toBe(true);
  });
  it('has one disposable database lifetime for the complete execution and defaults to persistent state', () => {
    expect(workflow.on.workflow_call.inputs['execution-mode'].default).toBe(
      'durable',
    );
    expect(job('review').services?.absurd.image).toContain(
      "inputs.execution-mode == 'ephemeral'",
    );
    expect(job('review').env?.ADAPTIVE_DATABASE_URL).toContain(
      "inputs.execution-mode == 'durable'",
    );
  });
  it('keeps provider credentials on the review host and supplies the exact paired daemon', () => {
    for (const secret of [
      'OLLAMA_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
    ])
      expect(job('review').env?.[secret]).toContain(`secrets.${secret}`);
    const run = job('review').steps.find(
      (step) => step.with?.['supervisor-entry'],
    );
    expect(run?.with?.['daemon-version']).toContain(
      'steps.worker.outputs.version',
    );
    expect(run?.env?.ADAPTIVE_FOCUSED_RUNTIME).toContain(
      'steps.diary-runtime.outputs.module',
    );
  });
  it('accepts an explicit runtime pin without job workflow identity context', () => {
    const step = job('review').steps.find((step) => step.id === 'intent')!;
    const dir = mkdtempSync(join(tmpdir(), 'review-intent-'));
    try {
      const envFile = join(dir, 'env');
      writeFileSync(envFile, '');
      const result = runStep(step.run, {
        RUNTIME_REF: 'a'.repeat(40),
        WORKFLOW_SHA: '',
        WORKFLOW_REPOSITORY: 'getlarge/themoltnet',
        ADAPTIVE_EXECUTION_MODE: 'durable',
        ADAPTIVE_REPOSITORY: 'another/repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_ENV: envFile,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.outputs.ref).toBe('a'.repeat(40));
      expect(result.outputs.correlation).toMatch(/^[a-f0-9-]{36}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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

  it('takes the released fast path only when both review and worker entries are tracked', () => {
    const setup = parse(
      read('../../packages/adaptive-review-action/setup/action.yml'),
    ) as { runs: { steps: Step[] } };
    const detect = setup.runs.steps.find((s) => s.id === 'bundle')!;
    const root = mkdtempSync(join(tmpdir(), 'packaged-worker-setup-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
    try {
      git('init', '-q');
      const files = [
        'run.js',
        'review.js',
        'publish.js',
        'outcomes.js',
        'diary-runtime.js',
        'release-dependencies.json',
        'worker-action/main.js',
      ];
      const dir = join(root, 'packages/adaptive-review-action/dist');
      mkdirSync(join(dir, 'worker-action'), { recursive: true });
      for (const file of files) writeFileSync(join(dir, file), '{}');
      expect(runStep(detect.run, {}, root).outputs.released).toBe('false');
      git('add', 'packages');
      expect(runStep(detect.run, {}, root).outputs.released).toBe('true');
      git(
        'rm',
        '--cached',
        'packages/adaptive-review-action/dist/worker-action/main.js',
      );
      expect(runStep(detect.run, {}, root).outputs.released).toBe('false');
    } finally {
      rmSync(root, { recursive: true, force: true });
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
