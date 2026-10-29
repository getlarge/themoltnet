import { readFileSync } from 'node:fs';

import { buildRubricSuccessCriteria } from '@themoltnet/sdk';
import { describe, expect, it } from 'vitest';

import { planGithubPreparation } from './dispatch-plan.js';
import {
  parseRepositoryPolicy,
  type RepositoryPolicy,
} from './repository-policy.js';

function fixture(): RepositoryPolicy {
  return JSON.parse(
    readFileSync(
      new URL('../examples/pilot-policy.json', import.meta.url),
      'utf8',
    ),
  ) as RepositoryPolicy;
}
function request() {
  return {
    issueNumber: 42,
    issueDigest: 'a'.repeat(64),
    correlationId: '55555555-5555-4555-8555-555555555555',
    brief: {
      brief: 'Document the approved behavior.',
      successCriteria: buildRubricSuccessCriteria({
        rubricId: 'pilot',
        criteria: [
          {
            id: 'accuracy',
            description: 'The example matches the tested behavior.',
            weight: 1,
          },
        ],
      }),
    },
  };
}
describe('repository policy and preparation dispatch', () => {
  it('normalizes key order without changing the policy digest', () => {
    const policy = fixture();
    const reordered = {
      ...policy,
      github: {
        ...policy.github,
        labels: {
          stages: Object.fromEntries(
            Object.entries(policy.github.labels.stages).reverse(),
          ),
        },
      },
    };
    expect(parseRepositoryPolicy(reordered)).toEqual(
      parseRepositoryPolicy(policy),
    );
  });
  it.each([
    (p: RepositoryPolicy) => {
      p.github.pauseLabel = p.github.labels.stages.paused.toUpperCase();
    },
    (p: RepositoryPolicy) => {
      p.github.allowedPermissions = ['read'];
    },
    (p: RepositoryPolicy) => {
      p.github.allowedPaths = ['docs/**'];
    },
    (p: RepositoryPolicy) => {
      p.github.allowedPaths = ['docs/../libs/'];
    },
    (p: RepositoryPolicy) => {
      p.limits.maxActiveCases = 3;
    },
    (p: RepositoryPolicy) => {
      p.limits.convergence.maxRepairRounds = 3;
    },
    (p: RepositoryPolicy) => {
      p.evidence.auditLanes = [];
    },
  ])('rejects unsafe or ambiguous policy before dispatch', (mutate) => {
    const policy = fixture();
    mutate(policy);
    expect(() => parseRepositoryPolicy(policy)).toThrow();
  });
  it('rejects unknown fields rather than silently ignoring a misspelled control', () => {
    expect(() =>
      parseRepositoryPolicy({ ...fixture(), maxActiveCase: 1 }),
    ).toThrow();
  });
  it('derives stable replay identity and exact approved criteria', () => {
    const policy = fixture();
    const input = request();
    const first = planGithubPreparation(policy, input);
    expect(planGithubPreparation(policy, input)).toEqual(first);
    expect(first.params.authoring.policyDigest).toBe(first.policyDigest);
    expect(first.params.authoring.brief.successCriteria).toEqual(
      input.brief.successCriteria,
    );
    expect(first.params.github.stopLabels).toEqual([
      'agent:pause',
      'agent:cancel',
    ]);
    policy.github.allowedPaths.push('README.md');
    expect(planGithubPreparation(policy, input).idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    expect(first.policy.github.allowedPaths).toEqual(['docs/']);
  });
  it('binds content and rubric changes to a fresh presentation', () => {
    const policy = fixture();
    const input = request();
    const first = planGithubPreparation(policy, input);
    input.issueDigest = 'b'.repeat(64);
    expect(planGithubPreparation(policy, input).idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    input.brief.brief = 'Document different behavior.';
    expect(planGithubPreparation(policy, input).briefDigest).not.toBe(
      first.briefDigest,
    );
  });
});
