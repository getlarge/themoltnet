/**
 * The reusable workflow wires the action's outputs between jobs by name. A
 * drifted name evaluates to an empty string, and an empty `skip` skips the
 * review without an error, so every reference is checked against what the
 * action and the `prepare` job actually declare.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GitHubApi } from '@moltnet/docs-impact-review/github-api';
import { preparePullRequestReview } from '@moltnet/docs-impact-review/prepare';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = resolve(
  packageRoot,
  '../../.github/workflows/docs-impact-review-reusable.yml',
);
const workflowText = readFileSync(workflowPath, 'utf8');

interface Step {
  id?: string;
  uses?: string;
  if?: string;
  with?: Record<string, string>;
}
interface Job {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(workflowText) as {
  on: {
    workflow_call: { outputs: Record<string, { value: string }> };
  };
  jobs: Record<string, Job>;
};
const action = parse(
  readFileSync(resolve(packageRoot, 'action.yml'), 'utf8'),
) as {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
};

const ACTION = './.docs-impact-runtime/packages/docs-impact-review-action';

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

async function preparedKeys(): Promise<string[]> {
  const fetchImpl = ((url: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          new URL(url).pathname.endsWith('/files')
            ? []
            : {
                number: 1,
                user: { login: 'a' },
                changed_files: 0,
                base: { sha: 'a'.repeat(40) },
                head: { sha: 'b'.repeat(40), repo: { full_name: 'o/r' } },
              },
        ),
      ),
    )) as typeof fetch;
  const { prepared } = await preparePullRequestReview({
    api: new GitHubApi({ token: 't', fetchImpl }),
    repo: 'o/r',
    pullNumber: 1,
    runId: '1',
    runAttempt: '1',
    profile: 'p',
    protectedPaths: [],
  });
  return Object.keys(prepared);
}

describe('reusable workflow wiring', () => {
  it('reads only prepare job outputs that exist', () => {
    // Arrange
    const declared = Object.keys(workflow.jobs.prepare.outputs ?? {});

    // Act
    const used = matches(workflowText, /needs\.prepare\.outputs\.([\w-]+)/g);

    // Assert
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('reads only prepared fields that prepare writes', async () => {
    // Arrange
    const keys = await preparedKeys();

    // Act
    const used = matches(
      workflowText,
      /fromJSON\(needs\.prepare\.outputs\.prepared\)\.(\w+)/g,
    );

    // Assert
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((field) => !keys.includes(field))).toEqual([]);
  });

  it('maps prepare job outputs to steps and action outputs that exist', () => {
    // Arrange
    const steps = workflow.jobs.prepare.steps;
    const ids = steps.map((step) => step.id).filter(Boolean);

    // Act
    const references = Object.values(workflow.jobs.prepare.outputs ?? {})
      .flatMap((value) => [
        ...value.matchAll(/steps\.([\w-]+)\.outputs\.([\w-]+)/g),
      ])
      .map(([, step, output]) => ({ step, output }));

    // Assert
    expect(references.filter(({ step }) => !ids.includes(step))).toEqual([]);
    const fromAction = references.filter(({ step }) => step === 'prepare');
    expect(fromAction.length).toBeGreaterThan(0);
    expect(
      fromAction.filter(({ output }) => !(output in action.outputs)),
    ).toEqual([]);
  });

  it('exposes caller outputs that the prepare job declares', () => {
    // Act
    const values = Object.values(workflow.on.workflow_call.outputs).map(
      (output) => output.value,
    );

    // Assert
    for (const value of values) {
      const [, name] = /jobs\.prepare\.outputs\.([\w-]+)/.exec(value) ?? [];
      expect(Object.keys(workflow.jobs.prepare.outputs ?? {})).toContain(name);
    }
  });

  it('gates the credentialed jobs on an explicit false skip', () => {
    // Act / Assert
    for (const name of ['review', 'workers']) {
      expect(workflow.jobs[name].needs).toBe('prepare');
      expect(workflow.jobs[name].if).toBe(
        "needs.prepare.outputs.skip == 'false'",
      );
    }
  });

  it('passes the action only inputs it declares', () => {
    // Act
    const unknown = Object.values(workflow.jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses === ACTION)
      .flatMap((step) => Object.keys(step.with ?? {}))
      .filter((input) => !(input in action.inputs));

    // Assert
    expect(unknown).toEqual([]);
  });

  it('checks out the runtime pinned by prepare in every later job', () => {
    // Act
    const runtimeCheckouts = ['review', 'workers'].flatMap((name) =>
      workflow.jobs[name].steps.filter(
        (step) => step.with?.path === '.docs-impact-runtime',
      ),
    );

    // Assert
    expect(runtimeCheckouts).toHaveLength(2);
    for (const step of runtimeCheckouts) {
      expect(step.with).toMatchObject({
        repository: '${{ needs.prepare.outputs.runtime-repository }}',
        ref: '${{ needs.prepare.outputs.runtime-sha }}',
      });
    }
  });
});
