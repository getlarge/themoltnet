/**
 * Runs the shell blocks of action.yml, and the committed bundle, the way the
 * runner does: with plain `bash` and plain `node`, against fake review and
 * comment commands.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function writeFacts(facts: Record<string, unknown>): string {
  const path = resolve(root, 'facts.json');
  writeFileSync(
    path,
    JSON.stringify({
      headRepo: 'o/r',
      baseRepo: 'o/r',
      author: 'someone',
      files: [{ filename: 'src/a.ts' }],
      ...facts,
    }),
  );
  return path;
}

/** A stand-in for the review CLI: logs its arguments and exits with $CODE. */
function fakeReview(stdout: string, code = 0): string {
  const path = resolve(root, 'review');
  writeFileSync(
    path,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${root}/review-args"\nprintf '%s' '${stdout}'\nexit ${code}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

const prepared = {
  skip: 'false',
  'pr-number': '7',
  'base-sha': 'a'.repeat(40),
  'head-sha': 'b'.repeat(40),
  'correlation-id': '00000000-0000-4000-8000-000000000001',
  profile: 'docs-review',
  'coverage-profile': 'coverage-model',
  'docs-check-profile': 'docs-review',
  'worker-profiles': '["docs-review","coverage-model"]',
};

const reviewInputs = {
  PREPARED: JSON.stringify(prepared),
  TEAM_ID: 'team',
  DIARY_ID: 'diary',
  APP_ID: '',
  APP_KEY: '',
};

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), 'docs-impact-action-'));
  output = resolve(root, 'github-output');
  writeFileSync(output, '');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('committed eligibility bundle', () => {
  it('runs with plain node and reports why a pull request is skipped', () => {
    // Arrange
    const facts = writeFacts({ author: 'dependabot[bot]' });

    // Act
    const result = spawnSync(
      process.execPath,
      [resolve(packageRoot, 'dist/eligibility.js'), facts],
      { encoding: 'utf8' },
    );

    // Assert
    expect(result.stdout).toBe(
      'skip=true\nreason=Dependabot pull requests are not reviewed\n',
    );
  });
});

describe('prepare: gate', () => {
  it('skips a pull request that changes a protected path', () => {
    // Arrange
    const facts = writeFacts({
      files: [{ filename: '.github/workflows/docs.yml' }],
      protectedPaths: ['.github/workflows/docs.yml'],
    });

    // Act
    const result = runStep('gate', { FACTS: facts, ACTION_PATH: packageRoot });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({ skip: 'true' });
    expect(outputs().reason).toContain('.github/workflows/docs.yml');
    expect(result.stdout).toContain('::notice::Docs impact review skipped');
  });

  it('lets an eligible pull request through', () => {
    // Act
    const result = runStep('gate', {
      FACTS: writeFacts({}),
      ACTION_PATH: packageRoot,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({ skip: 'false', reason: '' });
  });
});

describe('review: prepared input', () => {
  beforeEach(() => {
    spawnSync('git', ['init', '-q'], { cwd: root });
  });

  it('reads the pinned revisions, profiles, and correlation id', () => {
    // Act
    const result = runStep('check-review', reviewInputs);

    // Assert
    expect(result.stderr).not.toContain('::error::');
    expect(result.status).toBe(0);
    expect(outputs()).toMatchObject({
      'pr-number': '7',
      'base-sha': 'a'.repeat(40),
      'head-sha': 'b'.repeat(40),
      'correlation-id': prepared['correlation-id'],
      profile: 'docs-review',
      'coverage-profile': 'coverage-model',
    });
  });

  it('requires the prepare outputs', () => {
    // Act
    const result = runStep('check-review', { ...reviewInputs, PREPARED: '' });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('toJSON(needs.prepare.outputs)');
  });

  it('refuses a pull request that prepare skipped', () => {
    // Act
    const result = runStep('check-review', {
      ...reviewInputs,
      PREPARED: JSON.stringify({ ...prepared, skip: 'true' }),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not eligible');
  });

  it('names every invalid prepared field', () => {
    // Act
    const result = runStep('check-review', {
      ...reviewInputs,
      PREPARED: JSON.stringify({
        ...prepared,
        'head-sha': 'b'.repeat(7),
        'correlation-id': 'chosen-by-hand',
      }),
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'missing or invalid: head-sha correlation-id',
    );
  });

  it('names missing team and diary inputs', () => {
    // Act
    const result = runStep('check-review', {
      ...reviewInputs,
      TEAM_ID: '',
      DIARY_ID: '',
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing inputs: TEAM_ID DIARY_ID');
  });

  it.each([
    ['an App id without its key', { APP_ID: '1', APP_KEY: '' }],
    ['an App key without its id', { APP_ID: '', APP_KEY: 'k' }],
  ])('rejects %s', (_label, app) => {
    // Act
    const result = runStep('check-review', { ...reviewInputs, ...app });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('set app-id and app-private-key together');
  });

  it('requires a checkout of the repository', () => {
    // Arrange: a directory that is not a git work tree.
    const outside = mkdtempSync(resolve(tmpdir(), 'docs-impact-outside-'));

    try {
      // Act
      const result = runStep('check-review', reviewInputs, outside);

      // Assert
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('check out the repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
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
      REVIEW: fakeReview('{}'),
      COVERAGE_PROFILE: 'coverage-model',
      DOCS_CHECK_PROFILE: '',
      PROJECT_ID: '',
    });

    // Assert
    expect(result.status).toBe(0);
    const args = readFileSync(resolve(root, 'review-args'), 'utf8');
    expect(args).toContain('--profile-coverage\ncoverage-model');
    expect(args).not.toContain('--profile-docs-check');
    expect(args).not.toContain('--project');
    expect(outputs()['exit-code']).toBe('0');
  });

  it('records a failing review instead of stopping before the comment', () => {
    // Act
    const result = runStep('review', {
      ...env,
      REVIEW: fakeReview('{"reports":[]}', 3),
    });

    // Assert
    expect(result.status).toBe(0);
    expect(outputs()['exit-code']).toBe('3');
    expect(readFileSync(outputs().summary, 'utf8')).toBe('{"reports":[]}');
  });
});

describe('review: fail', () => {
  function summary(value: unknown): string {
    const path = resolve(root, 'docs-impact-summary.json');
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  it('fails the run when the review exited non-zero', () => {
    // Act
    const result = runStep('fail', {
      EXIT_CODE: '1',
      SUMMARY: summary({ reports: [] }),
    });

    // Assert
    expect(result.status).toBe(1);
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
