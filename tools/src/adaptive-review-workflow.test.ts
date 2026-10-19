import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  new URL(
    '../../.github/workflows/adaptive-review-reusable.yml',
    import.meta.url,
  ),
  'utf8',
);
const caller = readFileSync(
  new URL('../../.github/workflows/adaptive-review.yml', import.meta.url),
  'utf8',
);
const action = readFileSync(
  new URL('../../packages/adaptive-review-action/action.yml', import.meta.url),
  'utf8',
);
const main = readFileSync(
  new URL('../../libs/adaptive-review/src/main.ts', import.meta.url),
  'utf8',
);
const focusedPolicy = JSON.parse(
  readFileSync(
    new URL(
      '../../.github/runtime-policies/legreffier-adaptive-focused-readonly-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { shellCommands: unknown[]; tools: string[] };

function prepareScript(): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === '          script: |');
  if (start < 0) throw new Error('Prepare script is missing');
  const script: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith('            ')) break;
    script.push(line.slice(12));
  }
  return script.join('\n');
}

type ReviewFile = { filename: string; previous_filename?: string };

async function runPrepare(options: {
  files?: ReviewFile[];
  changedFiles?: number;
  author?: string;
  headRepo?: string;
  repo?: string;
  protectedPaths?: string;
}) {
  const files = options.files ?? [{ filename: 'apps/console/src/App.tsx' }];
  const repo = options.repo ?? 'getlarge/themoltnet';
  const [owner, name] = repo.split('/');
  const outputs = new Map<string, string>();
  const pullRequest = {
    number: 42,
    title: 'Review title',
    body: 'Review body',
    changed_files: options.changedFiles ?? files.length,
    base: { sha: 'base-sha' },
    head: {
      sha: 'head-sha',
      repo: { full_name: options.headRepo ?? repo },
    },
    user: { login: options.author ?? 'contributor' },
  };
  const execute = new Script(
    `(async (github, context, core, require, process) => {\n${prepareScript()}\n})`,
  ).runInNewContext() as (...args: unknown[]) => Promise<void>;
  await execute(
    {
      paginate: () => Promise.resolve(files),
      rest: { pulls: { listFiles: () => undefined } },
    },
    {
      repo: { owner, repo: name },
      payload: { pull_request: pullRequest },
      runId: 100,
    },
    { setOutput: (key: string, value: string) => outputs.set(key, value) },
    createRequire(import.meta.url),
    {
      env: {
        GITHUB_RUN_ATTEMPT: '1',
        PROTECTED_PATHS:
          options.protectedPaths ??
          '.github/workflows/adaptive-review.yml\nlibs/adaptive-review/\npackages/adaptive-review-action/',
      },
    },
  );
  return outputs;
}

function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`Job ${name} is missing`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z][a-z-]*:$/.test(line),
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

function workerActionInputs(name: string): string {
  const lines = job(name).split('\n');
  const action = lines.findIndex((line) =>
    line.includes('/packages/agent-daemon-action@'),
  );
  const withInputs = lines.findIndex(
    (line, index) => index > action && line === '        with:',
  );
  const nextStep = lines.findIndex(
    (line, index) => index > action && line.startsWith('      - '),
  );
  if (action < 0 || withInputs < 0 || (nextStep >= 0 && withInputs > nextStep))
    throw new Error(`Worker action inputs are missing in ${name}`);
  const end = lines.findIndex(
    (line, index) => index > withInputs && !line.startsWith('          '),
  );
  return lines.slice(withInputs + 1, end < 0 ? undefined : end).join('\n');
}

function fetchScripts(): string[] {
  const lines = workflow.split('\n');
  return lines.flatMap((line, index) => {
    if (line !== '      - name: Fetch reviewed head as inert Git data')
      return [];
    const run = lines.findIndex(
      (candidate, offset) =>
        offset > index &&
        (candidate === '        run: |' ||
          candidate.startsWith('      - name: ')),
    );
    if (run < 0 || lines[run] !== '        run: |')
      throw new Error('Authenticated head fetch script is missing');
    const end = lines.findIndex(
      (candidate, offset) =>
        offset > run && !candidate.startsWith('          '),
    );
    return [
      lines
        .slice(run + 1, end < 0 ? undefined : end)
        .map((command) => command.slice(10))
        .join('\n'),
    ];
  });
}

function specialistMatrix(
  routes: { lane: string; run: boolean }[],
  docsTaskPossible: boolean,
) {
  const lines = job('route').split('\n');
  const start = lines.findIndex((line) => line === "          node <<'NODE'");
  if (start < 0) throw new Error('Specialist selection script is missing');
  const end = lines.findIndex(
    (line, index) => index > start && line === '          NODE',
  );
  if (end < 0) throw new Error('Specialist selection script is unterminated');
  const script = lines
    .slice(start + 1, end)
    .map((line) => line.slice(10))
    .join('\n');
  let output = '';
  const fs = {
    readFileSync: () =>
      JSON.stringify({ routing: { routes }, docsTaskPossible }),
    appendFileSync: (_path: string, data: string) => {
      output += data;
    },
  };
  const select = new Script(
    `(require, process) => { ${script} }`,
  ).runInNewContext() as (
    require: (name: string) => typeof fs,
    process: { env: Record<string, string> },
  ) => void;
  select(() => fs, {
    env: {
      ADAPTIVE_ROUTE: 'route.json',
      GITHUB_OUTPUT: 'output.txt',
      ADAPTIVE_DOCS_PROFILE: 'docs',
      ADAPTIVE_FOCUSED_PROFILE: 'focused',
      ADAPTIVE_SECURITY_PROFILE: 'security',
      ADAPTIVE_COMPLEXITY_PROFILE: 'complexity',
    },
  });
  const matrix = output.match(/^matrix=(.*)$/m)?.[1];
  if (!matrix) throw new Error('Specialist matrix output is missing');
  return JSON.parse(matrix) as {
    include: { profile: string; worker: number }[];
  };
}

function planOutputs(policyPresent: boolean, classifierNeeded: boolean) {
  const start = main.indexOf("  if (stage === 'plan') {");
  const end = main.indexOf('  if (!snapshot)', start);
  if (start < 0 || end < 0) throw new Error('Plan branch is missing');
  const branch = main.slice(start, end);
  let output = '';
  const execute = new Script(
    `(snapshot, classifierTaskPossible, appendFileSync, required, process, prepared) => { const stage = 'plan'; ${branch} }`,
  ).runInNewContext() as (
    snapshot: object | null,
    classifierTaskPossible: () => boolean,
    appendFileSync: (path: string, data: string) => void,
    required: (name: string) => string,
    process: { cwd: () => string },
    prepared: { base: string; head: string },
  ) => void;
  execute(
    policyPresent ? {} : null,
    () => classifierNeeded,
    (_path, data) => {
      output += data;
    },
    () => 'github-output',
    { cwd: () => 'repo' },
    { base: 'a'.repeat(40), head: 'b'.repeat(40) },
  );
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  ) as Record<string, string>;
}

describe('adaptive review workflow trust gates', () => {
  it('pins an eligible PR before starting workers', async () => {
    const outputs = await runPrepare({});
    expect(outputs.get('skip')).toBe('false');
    expect(JSON.parse(outputs.get('prepared') ?? '{}')).toMatchObject({
      repo: 'getlarge/themoltnet',
      pr: 42,
      base: 'base-sha',
      head: 'head-sha',
    });
  });

  it('accepts a same-repository PR in a foreign caller and uses its protected paths', async () => {
    const outputs = await runPrepare({
      repo: 'other/example',
      files: [{ filename: 'src/service.ts' }],
      protectedPaths: '.github/workflows/review.yml\nreview-policy/',
    });
    expect(
      (JSON.parse(outputs.get('prepared') ?? '{}') as { repo?: string }).repo,
    ).toBe('other/example');
    const blocked = await runPrepare({
      repo: 'other/example',
      files: [{ filename: 'review-policy/config.json' }],
      protectedPaths: '.github/workflows/review.yml\nreview-policy/',
    });
    expect(blocked.get('skip')).toBe('true');
  });

  it.each([
    ['fork', { headRepo: 'other/themoltnet' }],
    ['Dependabot', { author: 'dependabot[bot]' }],
    ['incomplete file list', { changedFiles: 2 }],
    [
      'workflow edit',
      { files: [{ filename: '.github/workflows/adaptive-review.yml' }] },
    ],
    [
      'library edit',
      { files: [{ filename: 'libs/adaptive-review/src/core.ts' }] },
    ],
    [
      'action edit',
      { files: [{ filename: 'packages/adaptive-review-action/action.yml' }] },
    ],
    [
      'renamed protected file',
      {
        files: [
          {
            filename: 'docs/old-workflow.md',
            previous_filename: '.github/workflows/adaptive-review.yml',
          },
        ],
      },
    ],
  ])('skips %s before preparing a review', async (_case, options) => {
    const outputs = await runPrepare(options);
    expect(outputs.get('skip')).toBe('true');
    expect(outputs.has('prepared')).toBe(false);
  });

  it('gates every downstream job that can reach credentials', () => {
    expect(job('prepare')).toContain(
      'if: github.event.pull_request.draft == false',
    );
    expect(job('route')).toContain("if: needs.prepare.outputs.skip == 'false'");
    expect(job('review')).toContain("if: needs.route.result == 'success'");
    expect(job('classifier-worker')).toContain(
      "if: needs.prepare.outputs.classifier-needed == 'true'",
    );
    expect(job('specialist-workers')).toContain(
      "if: needs.route.outputs.has-specialists == 'true'",
    );
    for (const name of [
      'route',
      'review',
      'classifier-worker',
      'specialist-workers',
    ]) {
      expect(job(name)).toMatch(/needs: (prepare|\[prepare, route\])/);
    }
  });

  it('exposes the policy decision used to start routing', () => {
    expect(action).toContain('review-enabled:');
    expect(action).toContain('value: ${{ steps.plan.outputs.review-enabled }}');
    expect(job('prepare')).toContain(
      'review-enabled: ${{ steps.plan.outputs.review-enabled }}',
    );
  });

  it('runs the planner output branch for enabled, disabled, and no-work policies', () => {
    expect(planOutputs(true, true)).toEqual({
      'review-enabled': 'true',
      'classifier-needed': 'true',
    });
    expect(planOutputs(true, false)).toEqual({
      'review-enabled': 'true',
      'classifier-needed': 'false',
    });
    expect(planOutputs(false, true)).toEqual({
      'review-enabled': 'false',
      'classifier-needed': 'false',
    });
  });

  it('keeps the focused runtime on bounded read tools', () => {
    expect(focusedPolicy.shellCommands).toEqual([]);
    expect(focusedPolicy.tools).toEqual(['find', 'grep', 'ls', 'read']);
  });

  it('allocates one worker per runnable task, including shared focused profiles', () => {
    expect(
      specialistMatrix(
        [
          { lane: 'docs', run: true },
          { lane: 'tests', run: true },
          { lane: 'conventions', run: true },
          { lane: 'security', run: false },
          { lane: 'blast-radius', run: true },
        ],
        false,
      ),
    ).toEqual({
      include: [
        { profile: 'focused', worker: 1 },
        { profile: 'focused', worker: 2 },
        { profile: 'focused', worker: 3 },
      ],
    });
  });

  it('passes every declared provider secret to both worker jobs', () => {
    for (const name of ['classifier-worker', 'specialist-workers']) {
      for (const provider of [
        'OLLAMA',
        'OPENAI',
        'ANTHROPIC',
        'OPENROUTER',
        'GEMINI',
      ]) {
        expect(job(name)).toContain(
          `${provider}_API_KEY: ${'${{ secrets.'}${provider}_API_KEY }}`,
        );
      }
    }
  });

  it('passes the producer project scope to both worker types', () => {
    for (const name of ['classifier-worker', 'specialist-workers']) {
      expect(workerActionInputs(name)).toContain(
        'project-id: ${{ inputs.project-id }}',
      );
    }
  });

  it('keeps route artifacts distinct across rerun attempts', () => {
    const attempt = '${{ github.run_attempt }}';
    expect(workflow.match(/name: adaptive-route-/g)).toHaveLength(2);
    expect(
      workflow
        .match(/name: adaptive-route-[^\n]+/g)
        ?.every((name) => name.includes(attempt)),
    ).toBe(true);
    expect(workflow).toContain(
      `name: adaptive-review-${'${{ github.repository_id }}'}-${'${{ github.event.pull_request.number }}'}-${attempt}`,
    );
  });

  it('executes the same authenticated full-object fetch in every job', () => {
    const scripts = fetchScripts();
    expect(scripts).toHaveLength(5);
    expect(new Set(scripts).size).toBe(1);
    expect(workflow.match(/fetch-depth: 1/g)).toHaveLength(5);
    expect(workflow).not.toContain('filter: blob:none');
    const temp = mkdtempSync(join(tmpdir(), 'adaptive-fetch-'));
    try {
      const capture = join(temp, 'capture');
      const fakeGit = join(temp, 'git');
      writeFileSync(
        fakeGit,
        '#!/bin/sh\nprintf "%s\\n" "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" "$@" > "$TEST_CAPTURE"\n',
      );
      chmodSync(fakeGit, 0o755);
      const sha = 'b'.repeat(40);
      const env = {
        ...process.env,
        PATH: `${temp}:${process.env.PATH ?? ''}`,
        HEAD_SHA: sha,
        GH_TOKEN: 'fixture-token',
        GITHUB_SERVER_URL: 'https://github.com',
        TEST_CAPTURE: capture,
      };
      const valid = spawnSync('bash', ['-e'], {
        input: scripts[0],
        env,
        encoding: 'utf8',
      });
      expect(valid.status).toBe(0);
      expect(readFileSync(capture, 'utf8').trim().split('\n')).toEqual([
        '1',
        'http.https://github.com/.extraheader',
        `AUTHORIZATION: basic ${Buffer.from('x-access-token:fixture-token').toString('base64')}`,
        'fetch',
        '--no-tags',
        '--depth=1',
        'origin',
        sha,
      ]);
      const invalid = spawnSync('bash', ['-e'], {
        input: scripts[0],
        env: { ...env, HEAD_SHA: '--upload-pack=evil' },
        encoding: 'utf8',
      });
      expect(invalid.status).toBe(2);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('can diff complete base and head objects from shallow fetches', () => {
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
      writeFileSync(join(source, 'review.txt'), 'base content\n');
      git(source, 'add', 'review.txt');
      git(source, 'commit', '-m', 'base');
      const base = git(source, 'rev-parse', 'HEAD');
      git(source, 'remote', 'add', 'origin', remote);
      git(source, 'push', 'origin', 'main');
      git(source, 'checkout', '-b', 'feature');
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
      const fetched = spawnSync('bash', ['-e'], {
        cwd: checkout,
        input: fetchScripts()[0],
        env: {
          ...process.env,
          HEAD_SHA: head,
          GH_TOKEN: 'fixture-token',
          GITHUB_SERVER_URL: 'https://github.com',
        },
        encoding: 'utf8',
      });
      expect(fetched.status, fetched.stderr).toBe(0);
      expect(git(checkout, 'rev-parse', '--is-shallow-repository')).toBe(
        'true',
      );
      expect(git(checkout, 'show', `${base}:review.txt`)).toBe('base content');
      expect(git(checkout, 'show', `${head}:review.txt`)).toBe('head content');
      expect(git(checkout, 'diff', '--name-only', base, head)).toBe(
        'review.txt',
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('pins runtime code separately from caller policy and head data', () => {
    expect(workflow).toContain(
      'WORKFLOW_REPOSITORY: ${{ job.workflow_repository }}',
    );
    expect(workflow).toContain('WORKFLOW_SHA: ${{ job.workflow_sha }}');
    expect(workflow).toContain(
      'ADAPTIVE_RUNTIME_SHA: ${{ needs.prepare.outputs.runtime-sha }}',
    );
    expect(workflow).toContain('path: .adaptive-review-runtime');
    expect(workflow).toContain('ref: ${{ needs.prepare.outputs.base }}');
    expect(
      workflow.match(/git fetch --no-tags --depth=1 origin "\$HEAD_SHA"/g),
    ).toHaveLength(5);
    expect(workflow.match(/GIT_CONFIG_COUNT=1/g)).toHaveLength(5);
    expect(
      workflow.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(workflow).not.toContain('ref: ${{ needs.prepare.outputs.head }}');
    expect(caller).toContain(
      'classifier-profile: legreffier-issue-classifier-v2',
    );
    expect(caller).toContain(
      'runtime-ref: ${{ github.event.pull_request.base.sha }}',
    );
  });
});
