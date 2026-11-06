import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  if: string;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  environment: string;
  steps: Step[];
}

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const source = read(
  '../../.github/workflows/adaptive-review-verdicts-reusable.yml',
);
const workflow = parse(source) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const job = workflow.jobs.record;
const action = parse(
  read('../../packages/adaptive-review-action/action.yml'),
) as { runs: { steps: Step[] } };
const actionPackage = JSON.parse(
  read('../../packages/adaptive-review-action/package.json'),
) as { nx: { targets: Record<string, { options: { command: string } }> } };

const RUNTIME_ACTION =
  './.adaptive-review-runtime/packages/adaptive-review-action';

function step(predicate: (item: Step) => boolean): Step {
  const found = job.steps.find(predicate);
  if (!found) throw new Error('step not found');
  return found;
}

function runStep(run: string | undefined, env: Record<string, string>) {
  const temp = mkdtempSync(join(tmpdir(), 'verdicts-step-'));
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
    return {
      status: result.status,
      stderr: result.stderr,
      output: readFileSync(output, 'utf8'),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe('adaptive review verdicts workflow trust gates', () => {
  it('is reusable only and grants nothing by default', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_call']);
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('accepts commands from trusted people on same-repository pull requests only', () => {
    for (const guard of [
      "github.event_name == 'pull_request_review_comment'",
      "github.event.action == 'created'",
      'github.event.pull_request.head.repo.full_name == github.repository',
      "github.event.comment.user.type == 'User'",
      'contains(fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association)',
      "startsWith(github.event.comment.body, '/review-verdict ')",
      "startsWith(github.event.comment.body, '/review-missed ')",
    ])
      expect(job.if).toContain(guard);
  });

  it('runs one job per comment without cancelling a redelivery', () => {
    expect(job.concurrency).toEqual({
      group:
        'adaptive-review-verdicts-${{ github.repository }}-${{ github.event.comment.id }}',
      'cancel-in-progress': false,
    });
    expect(job.environment).toBe('${{ inputs.environment }}');
  });

  it('never reads the comment body or head code into a step', () => {
    // The body reaches the runtime only through the event file.
    const steps = job.steps.map((item) => JSON.stringify(item)).join('\n');
    expect(steps).not.toContain('comment.body');
    expect(steps).not.toContain('pull_request.head');
    expect(steps).not.toContain('github.head_ref');
    const checkouts = job.steps.filter((item) =>
      item.uses?.startsWith('actions/checkout@'),
    );
    expect(checkouts.map((item) => item.with)).toEqual([
      {
        ref: '${{ github.event.pull_request.base.sha }}',
        path: '.adaptive-review-base',
        'fetch-depth': 1,
        'persist-credentials': false,
      },
      {
        repository: '${{ steps.runtime.outputs.repository }}',
        ref: '${{ steps.runtime.outputs.ref }}',
        path: '.adaptive-review-runtime',
        'persist-credentials': false,
      },
    ]);
  });

  it('mints an App token limited to pull request comments', () => {
    const token = step((item) => item.id === 'app-token');
    expect(token.uses).toMatch(
      /^actions\/create-github-app-token@[0-9a-f]{40}$/,
    );
    expect(
      Object.keys(token.with ?? {}).filter((key) =>
        key.startsWith('permission-'),
      ),
    ).toEqual(['permission-pull-requests']);
    expect(token.with?.['permission-pull-requests']).toBe('write');
  });

  it('records with the pinned runtime action', () => {
    const record = step((item) => item.uses === RUNTIME_ACTION);
    expect(record.with).toEqual({ step: 'verdicts' });
    expect(record.env).toMatchObject({
      GH_TOKEN: '${{ steps.app-token.outputs.token }}',
      ADAPTIVE_APP_LOGIN: '${{ steps.app-token.outputs.app-slug }}[bot]',
      ADAPTIVE_BASE_CHECKOUT: '${{ github.workspace }}/.adaptive-review-base',
    });
  });

  it.each([
    [{ WORKFLOW_REPOSITORY: '' }, 'job.workflow_repository is required'],
    [{ RUNTIME_REF: 'main' }, 'must be a full commit SHA'],
  ])('refuses runtime input %j', (env, message) => {
    const runtime = step((item) => item.id === 'runtime');
    const result = runStep(runtime.run, {
      WORKFLOW_REPOSITORY: 'getlarge/themoltnet',
      WORKFLOW_SHA: 'c'.repeat(40),
      RUNTIME_REF: '',
      ...env,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});

describe('adaptive review action verdicts entry', () => {
  it('runs the bundled verdicts entry', () => {
    const entry = action.runs.steps.find(
      (item) => item.if === "inputs.step == 'verdicts'",
    );
    expect(entry?.run).toBe('node "$DIST/verdicts.js"');
  });

  it('ships the entry in the released bundle', () => {
    expect(
      actionPackage.nx.targets['publish-action'].options.command,
    ).toContain('--entries review.js,publish.js,outcomes.js,verdicts.js,');
    expect(
      read('../../packages/adaptive-review-action/vite.config.ts'),
    ).toContain("verdicts: 'src/verdicts.ts'");
    expect(
      read('../../packages/adaptive-review-action/setup/action.yml'),
    ).toContain('packages/adaptive-review-action/dist/verdicts.js');
  });
});
