/**
 * Runs the shell blocks of action.yml, and the committed bundle, the way the
 * runner does: with plain `bash` and plain `node`, against fake review and
 * comment commands.
 */
import { execFile, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = parse(
  readFileSync(resolve(packageRoot, 'action.yml'), 'utf8'),
) as {
  inputs: Record<string, { required?: boolean; default?: string }>;
  runs: { steps: { id?: string; run?: string }[] };
};

function stepRun(id: string): string {
  const step = action.runs.steps.find((candidate) => candidate.id === id);
  if (!step?.run) throw new Error(`Missing action step id: ${id}`);
  return step.run;
}

let root: string;
let output: string;

function runStep(id: string, env: Record<string, string>, cwd = root) {
  return spawnSync('bash', ['-c', stepRun(id)], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: root,
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: resolve(root, 'summary.md'),
      GITHUB_REPOSITORY: 'o/r',
      ...env,
    },
  });
}

function outputs(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

/**
 * A stand-in for the bundled commands: `review.js` and `comment.js` log their
 * arguments to `<root>/<name>-args`; `review.js` prints $FAKE_STDOUT, writes
 * $FAKE_STDERR, and exits with $FAKE_CODE.
 */
function fakeDist(): string {
  const dist = resolve(root, 'fake-dist');
  mkdirSync(dist, { recursive: true });
  for (const name of ['review', 'comment']) {
    writeFileSync(
      resolve(dist, `${name}.js`),
      [
        "const { appendFileSync } = require('node:fs');",
        `appendFileSync(${JSON.stringify(resolve(root, `${name}-args`))}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
        "process.stdout.write(process.env.FAKE_STDOUT ?? '');",
        "process.stderr.write(process.env.FAKE_STDERR ?? '');",
        'process.exitCode = Number(process.env.FAKE_CODE ?? 0);',
      ].join('\n'),
    );
  }
  writeFileSync(resolve(dist, 'package.json'), '{"type":"commonjs"}');
  return dist;
}

function calls(name: string): string[][] {
  return readFileSync(resolve(root, `${name}-args`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
}

const prepared = {
  v: 1,
  eligible: true,
  pr: 7,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  correlationId: '00000000-0000-4000-8000-000000000001',
  runAttempt: 1,
  profiles: {
    default: 'docs-review',
    coverage: 'coverage-model',
    docsCheck: 'docs-review',
  },
  workerProfiles: ['docs-review', 'coverage-model'],
};

const reviewInputs = {
  PREPARED: JSON.stringify(prepared),
  TEAM_ID: 'team',
  DIARY_ID: 'diary',
  APP_ID: '',
  APP_KEY: '',
  GITHUB_RUN_ATTEMPT: '1',
};

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'docs-impact-action-'));
  output = resolve(root, 'github-output');
  writeFileSync(output, '');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('prepare: committed bundle', () => {
  let server: Server;
  let apiUrl: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      const body = request.url?.startsWith('/repos/o/r/pulls/7/files')
        ? [{ filename: '.github/workflows/docs.yml' }]
        : {
            number: 7,
            user: { login: 'someone' },
            base: { sha: 'a'.repeat(40) },
            head: { sha: 'b'.repeat(40), repo: { full_name: 'o/r' } },
          };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    });
    await new Promise<void>((done) => {
      server.listen(0, '127.0.0.1', done);
    });
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => {
      server.close(() => done());
    });
  });

  it('runs with plain node and skips a pull request that changes a protected path', async () => {
    // Arrange
    const event = resolve(root, 'event.json');
    writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }));

    // Act
    const stdout = await new Promise<string>((done, fail) => {
      execFile(
        process.execPath,
        [resolve(packageRoot, 'dist/prepare.js')],
        {
          env: {
            PATH: process.env.PATH ?? '',
            GITHUB_API_URL: apiUrl,
            GITHUB_TOKEN: 't',
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_EVENT_PATH: event,
            GITHUB_RUN_ID: '100',
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: resolve(root, 'summary.md'),
            PROFILE: 'docs-review',
            PROTECTED_PATHS: '.github/workflows/docs.yml',
          },
        },
        (error, out) => (error ? fail(error) : done(out)),
      );
    });

    // Assert
    expect(outputs()).toMatchObject({ skip: 'true' });
    expect(JSON.parse(outputs().prepared)).toMatchObject({
      v: 1,
      eligible: false,
      pr: 7,
      headSha: 'b'.repeat(40),
    });
    expect(outputs().reason).toContain('.github/workflows/docs.yml');
    expect(outputs()['correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(stdout).toContain('::notice::Docs impact review skipped');
  });
});

// The checks themselves are tested in the library (prepared.test.ts); these
// run the committed bundle the way the step does.
describe('review: prepared input', () => {
  const dist = resolve(packageRoot, 'dist');

  beforeEach(() => {
    spawnSync('git', ['init', '-q'], { cwd: root });
  });

  it('reads the pinned revisions, profiles, and correlation id', () => {
    // Act
    const result = runStep('check-review', { ...reviewInputs, DIST: dist });

    // Assert
    expect(result.stderr).not.toContain('::error::');
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({
      'pr-number': '7',
      'base-sha': 'a'.repeat(40),
      'head-sha': 'b'.repeat(40),
      'correlation-id': prepared.correlationId,
      profile: 'docs-review',
      'coverage-profile': 'coverage-model',
    });
  });

  it('turns a wiring problem into one encoded annotation', () => {
    // Act
    const result = runStep('check-review', {
      ...reviewInputs,
      DIST: dist,
      GITHUB_RUN_ATTEMPT: '2',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n')).toEqual([
      expect.stringMatching(
        /^::error::this is run attempt 2, .*re-run all jobs/,
      ),
    ]);
  });
});

describe('review: comment identity', () => {
  it.each([
    ['my-app', 'my-app[bot]'],
    ['', 'github-actions[bot]'],
  ])('App slug %j comments as %s', (slug, author) => {
    // Act
    const result = runStep('setup', {
      APP_SLUG: slug,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '100',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({
      author,
      'run-url': 'https://github.com/o/r/actions/runs/100',
    });
  });
});

describe('review: comments', () => {
  const env = {
    AUTHOR: 'my-app[bot]',
    RUN_URL: 'https://github.com/o/r/actions/runs/100',
    PR_NUMBER: '7',
    HEAD_SHA: 'b'.repeat(40),
  };

  it('posts the placeholder, and a failure there does not fail the step', () => {
    // Act
    const result = runStep('mark', {
      ...env,
      DIST: fakeDist(),
      CORRELATION_ID: 'c-1',
      FAKE_CODE: '1',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('could not post the in-progress comment');
    expect(calls('comment')).toEqual([
      [
        '--mode',
        'start',
        '--repo',
        'o/r',
        '--pr',
        '7',
        '--revision',
        'b'.repeat(40),
        '--run-url',
        env.RUN_URL,
        '--author',
        'my-app[bot]',
        '--correlation-id',
        'c-1',
      ],
    ]);
  });

  it('publishes the report with the correlation id', () => {
    // Act
    const result = runStep('publish', {
      ...env,
      DIST: fakeDist(),
      SUMMARY: resolve(root, 'summary.json'),
      CORRELATION_ID: 'c-1',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(calls('comment')[0]).toEqual([
      '--mode',
      'publish',
      '--repo',
      'o/r',
      '--pr',
      '7',
      '--revision',
      'b'.repeat(40),
      '--run-url',
      env.RUN_URL,
      '--author',
      'my-app[bot]',
      '--report',
      resolve(root, 'summary.json'),
      '--correlation-id',
      'c-1',
    ]);
  });

  it('marks its placeholder not completed when cancelled, best effort', () => {
    // Arrange
    const step = action.runs.steps.find(
      (candidate) => candidate.id === 'cancelled',
    ) as { if?: string };

    // Act
    const result = runStep('cancelled', {
      ...env,
      DIST: fakeDist(),
      CORRELATION_ID: 'c-1',
      FAKE_CODE: '1',
    });

    // Assert
    expect(step.if).toContain('cancelled()');
    // A publish that failed leaves the placeholder too.
    expect(step.if).toContain(
      "failure() && steps.publish.outcome == 'failure'",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('could not mark the review not completed');
    expect(calls('comment')[0]).toEqual([
      '--mode',
      'cancelled',
      '--repo',
      'o/r',
      '--pr',
      '7',
      '--revision',
      'b'.repeat(40),
      '--run-url',
      env.RUN_URL,
      '--author',
      'my-app[bot]',
      '--correlation-id',
      'c-1',
    ]);
  });

  it('never publishes after cancellation', () => {
    // Assert: a cancelled run must not overwrite a newer run's comment.
    for (const id of ['publish', 'timings', 'fail']) {
      const step = action.runs.steps.find(
        (candidate) => candidate.id === id,
      ) as {
        if?: string;
      };
      expect(step.if).toContain('!cancelled()');
    }
  });
});

describe('review: run', () => {
  const env = {
    PR_NUMBER: '7',
    BASE_SHA: 'a'.repeat(40),
    HEAD_SHA: 'b'.repeat(40),
    CORRELATION_ID: 'c',
    PROFILE: 'docs-review',
    TEAM_ID: 'team',
    DIARY_ID: 'diary',
  };

  it('passes stage profiles and the project only when set', () => {
    // Act
    const result = runStep('review', {
      ...env,
      DIST: fakeDist(),
      FAKE_STDOUT: '{}',
      COVERAGE_PROFILE: 'coverage-model',
      DOCS_CHECK_PROFILE: '',
      PROJECT_ID: '',
    });

    // Assert
    expect(result.status).toBe(0);
    const [args] = calls('review');
    expect(args).toEqual(
      expect.arrayContaining(['--profile-coverage', 'coverage-model']),
    );
    expect(args).not.toContain('--profile-docs-check');
    expect(args).not.toContain('--project');
    expect(outputs()['exit-code']).toBe('0');
  });

  it('records a failing review and its stderr instead of stopping before the comment', () => {
    // Act
    const result = runStep('review', {
      ...env,
      DIST: fakeDist(),
      FAKE_STDOUT: '{"reports":[]}',
      FAKE_STDERR: 'loading\n[fatal] runtime profile "x" not found in team\n',
      FAKE_CODE: '3',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()['exit-code']).toBe('3');
    expect(readFileSync(outputs().summary, 'utf8')).toBe('{"reports":[]}');
    expect(readFileSync(outputs().stderr, 'utf8')).toContain('[fatal]');
  });

  it('survives an action path with a space', () => {
    // Arrange
    const spaced = resolve(root, 'with space');
    mkdirSync(spaced);
    const dist = fakeDist();
    const target = resolve(spaced, 'dist');
    spawnSync('cp', ['-R', dist, target]);

    // Act
    const result = runStep('review', {
      ...env,
      DIST: target,
      FAKE_STDOUT: '{}',
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()['exit-code']).toBe('0');
  });
});

describe('review: fail', () => {
  function summary(value: unknown): string {
    const path = resolve(root, 'docs-impact-summary.json');
    writeFileSync(
      path,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    return path;
  }

  it('names the report error, encoded, before the stderr tail', () => {
    // Arrange: a failed report makes the review exit 1, and its stderr ends
    // with the rendered comment, not the cause.
    const stderr = resolve(root, 'stderr.log');
    writeFileSync(stderr, '_Configuration: `x`._\n');

    // Act
    const result = runStep('fail', {
      EXIT_CODE: '1',
      SUMMARY: summary({
        reports: [
          {
            status: 'failed',
            error: 'invalid config\n::warning::injected 100%',
          },
        ],
      }),
      STDERR: stderr,
      CORRELATION_ID: 'c-1',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n')).toEqual([
      '::error::docs impact review failed (correlation c-1): invalid config%0A::warning::injected 100%25',
    ]);
  });

  it('names the last error line and the correlation id when the review exited non-zero', () => {
    // Arrange
    const stderr = resolve(root, 'stderr.log');
    writeFileSync(
      stderr,
      'loading\n[fatal] runtime profile "x" not found in team\n\n',
    );

    // Act
    const result = runStep('fail', {
      EXIT_CODE: '1',
      SUMMARY: summary({ reports: [] }),
      STDERR: stderr,
      CORRELATION_ID: 'c-1',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'exited with 1 (correlation c-1): [fatal] runtime profile "x" not found in team',
    );
  });

  it('fails on a partial report instead of piling up jq errors', () => {
    // Act
    const result = runStep('fail', {
      EXIT_CODE: '0',
      SUMMARY: summary('{"reports":['),
      CORRELATION_ID: 'c-1',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('wrote no valid report (correlation c-1)');
  });

  it('fails the run when the report says the review failed', () => {
    // Act
    const result = runStep('fail', {
      EXIT_CODE: '0',
      SUMMARY: summary({ reports: [{ status: 'failed', error: 'no worker' }] }),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no worker');
  });

  it('passes a completed review', () => {
    // Act
    const result = runStep('fail', {
      EXIT_CODE: '0',
      SUMMARY: summary({ reports: [{ status: 'completed' }] }),
    });

    // Assert
    expect(result.status).toBe(0);
  });
});

describe('inputs', () => {
  it('requires the step', () => {
    // Assert
    expect(action.inputs.step.required).toBe(true);
  });

  it('never asks the caller for a correlation id', () => {
    // Assert
    expect(Object.keys(action.inputs)).not.toContain('correlation-id');
  });
});

describe('fetch-revisions.sh', () => {
  const script = resolve(packageRoot, 'scripts/fetch-revisions.sh');

  function run(args: string[]) {
    // A fake git records its arguments and the config it was given.
    const bin = resolve(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      resolve(bin, 'git'),
      [
        '#!/usr/bin/env bash',
        `printf '%s\\n' "$*" > "${root}/git-args"`,
        `printf '%s|%s\\n' "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" > "${root}/git-config"`,
      ].join('\n'),
      { mode: 0o755 },
    );
    return spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        GH_TOKEN: 'ghs_secret',
        GITHUB_SERVER_URL: 'https://github.com',
      },
    });
  }

  it('authenticates through git config in the environment, never argv', () => {
    // Act
    const result = run(['--depth', '1', 'b'.repeat(40)]);

    // Assert
    const header = Buffer.from('x-access-token:ghs_secret').toString('base64');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`::add-mask::${header}`);
    expect(readFileSync(resolve(root, 'git-args'), 'utf8').trim()).toBe(
      `fetch --no-tags --depth=1 origin ${'b'.repeat(40)}`,
    );
    expect(readFileSync(resolve(root, 'git-config'), 'utf8').trim()).toBe(
      `http.https://github.com/.extraheader|AUTHORIZATION: basic ${header}`,
    );
  });

  it('refuses anything but full commit ids', () => {
    // Act
    const result = run(['main']);

    // Assert
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a full commit id: main');
  });
});
