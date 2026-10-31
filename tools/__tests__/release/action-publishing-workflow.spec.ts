import { readFileSync } from 'node:fs';

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
  jobs: Record<string, { steps: Step[]; env?: Record<string, string> }>;
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
    expect(named('Commit bundles and move the stable major tag').env).toEqual({
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
      steps.find((step) => step.uses?.startsWith('actions/checkout@'))?.with,
    ).toMatchObject({ ref: '${{ matrix.tag }}', 'persist-credentials': false });
  });

  it('rejects stale release source before dependency installation and building', () => {
    const check = named('Check release source runtime locks');
    expect(check.run).toBe(
      'node tools/src/release/action-runtime-lock.ts --check',
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
