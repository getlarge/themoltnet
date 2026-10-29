import { describe, expect, it } from 'vitest';

import type { ConvergenceInput, Finding, Revision } from './contracts.js';
import { evaluateConvergence } from './verdict.js';

const revision: Revision = {
  base: 'base',
  head: 'head',
  policyDigest: 'policy',
  briefDigest: 'brief',
};
function ready(): ConvergenceInput {
  return {
    current: { ...revision },
    control: 'active',
    assessment: { revision, status: 'passed' },
    checks: { tests: { revision, status: 'passed' } },
    reviews: { correctness: { revision, status: 'passed', findings: [] } },
    requiredChecks: ['tests'],
    requiredLanes: ['correctness'],
    auditLanes: [],
    unresolvedHumanThreads: 0,
    repairRounds: 0,
    maxRepairRounds: 2,
  };
}
function withFinding(finding: Finding): ConvergenceInput {
  const input = ready();
  input.reviews['correctness'].findings.push(finding);
  return input;
}

describe('convergence verdict', () => {
  it('hands off a fully verified revision without deciding to merge', () => {
    expect(evaluateConvergence(ready())).toEqual({
      status: 'ready',
      reasons: [],
    });
  });
  it.each(['base', 'head', 'policyDigest', 'briefDigest'] as const)(
    'invalidates all evidence when %s changes',
    (field) => {
      const input = ready();
      input.current[field] = 'changed';
      expect(evaluateConvergence(input).status).toBe('waiting');
    },
  );
  it('does not count a screened audit lane as reviewed', () => {
    const input = ready();
    input.auditLanes = ['security'];
    expect(evaluateConvergence(input)).toEqual({
      status: 'waiting',
      reasons: ['review:security:missing-or-stale'],
    });
  });
  it('requires current verification even for a resolved finding', () => {
    const input = withFinding({
      id: 'missing-validation',
      origin: 'introduced',
      disposition: 'fixed',
      verification: {
        revision: { ...revision, head: 'old' },
        evidence: 'Earlier fix',
      },
    });
    expect(evaluateConvergence(input).status).toBe('repair');
  });
  it.each(['introduced', 'unknown'] as const)(
    'does not defer an %s finding to an issue',
    (origin) => {
      const input = withFinding({
        id: 'defect',
        origin,
        disposition: 'follow-up',
        verification: { revision, evidence: 'Tracked elsewhere' },
      });
      expect(evaluateConvergence(input).status).toBe('repair');
    },
  );
  it('allows a verified pre-existing finding to be recorded separately', () => {
    const input = withFinding({
      id: 'existing-defect',
      origin: 'pre-existing',
      disposition: 'follow-up',
      verification: { revision, evidence: 'Reproduced on base' },
    });
    expect(evaluateConvergence(input).status).toBe('ready');
  });
  it('counts an unanchored finding from an additional private review without publishing its text', () => {
    const input = ready();
    input.reviews['security'] = {
      revision,
      status: 'passed',
      findings: [
        { id: 'opaque-finding-id', origin: 'introduced', disposition: 'open' },
      ],
    };
    expect(evaluateConvergence(input)).toEqual({
      status: 'repair',
      reasons: ['finding:opaque-finding-id'],
    });
  });
  it('waits for all results before spending a repair round', () => {
    const input = withFinding({
      id: 'defect',
      origin: 'introduced',
      disposition: 'open',
    });
    input.checks['tests'].status = 'pending';
    expect(evaluateConvergence(input).status).toBe('waiting');
  });
  it('escalates after exactly two repair rounds', () => {
    const input = withFinding({
      id: 'defect',
      origin: 'introduced',
      disposition: 'open',
    });
    input.repairRounds = 2;
    expect(evaluateConvergence(input).status).toBe('needs-human');
  });
  it('never treats incomplete coverage as a clean review', () => {
    const input = ready();
    input.reviews['correctness'].status = 'incomplete';
    expect(evaluateConvergence(input).status).toBe('needs-human');
  });
  it('does not resolve human conversations by itself', () => {
    const input = ready();
    input.unresolvedHumanThreads = 1;
    expect(evaluateConvergence(input).status).toBe('needs-human');
  });
  it.each(['paused', 'cancelled'] as const)(
    'honors %s despite passing evidence',
    (control) => {
      expect(evaluateConvergence({ ...ready(), control }).status).toBe(control);
    },
  );
  it('rejects invalid budgets instead of silently granting repair attempts', () => {
    expect(() =>
      evaluateConvergence({ ...ready(), repairRounds: -1 }),
    ).toThrow();
  });
});
