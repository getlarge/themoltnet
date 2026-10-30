import { describe, expect, it, vi } from 'vitest';

import { createEvidenceObserver, type EvidenceSources } from './evidence.js';
import { evaluateConvergence } from './verdict.js';

function fixture() {
  const revision = {
    base: 'base',
    head: 'head',
    policyDigest: 'policy',
    briefDigest: 'brief',
  };
  const sources: EvidenceSources = {
    current: vi.fn().mockResolvedValue({ revision, control: 'active' }),
    assessment: vi.fn().mockResolvedValue({ revision, status: 'passed' }),
    checks: vi.fn().mockResolvedValue({ ci: { revision, status: 'passed' } }),
    reviews: vi.fn().mockResolvedValue({
      tests: { revision, status: 'passed', findings: [] },
    }),
    humanThreads: vi.fn().mockResolvedValue(0),
  };
  const observe = createEvidenceObserver(
    { requiredChecks: ['ci'], requiredLanes: ['tests'], auditLanes: [] },
    sources,
  );
  return { revision, sources, observe };
}
describe('convergence evidence observation', () => {
  it('feeds complete current provider evidence to the gate', async () => {
    const { observe } = fixture();
    expect(
      evaluateConvergence({
        ...(await observe()),
        repairRounds: 0,
        maxRepairRounds: 2,
      }).status,
    ).toBe('ready');
  });
  it('drops a mixed snapshot when the revision moves during reads', async () => {
    const { revision, sources, observe } = fixture();
    vi.mocked(sources.current)
      .mockResolvedValueOnce({ revision, control: 'active' })
      .mockResolvedValue({
        revision: { ...revision, head: 'new' },
        control: 'active',
      });
    const result = await observe();
    expect(result.current.head).toBe('new');
    expect(result.assessment).toBeUndefined();
    expect(result.checks).toEqual({});
  });
  it('does not interpret unavailable human-thread coverage as zero', async () => {
    const { sources, observe } = fixture();
    vi.mocked(sources.humanThreads).mockResolvedValue(undefined);
    expect(
      evaluateConvergence({
        ...(await observe()),
        repairRounds: 0,
        maxRepairRounds: 2,
      }),
    ).toMatchObject({
      status: 'needs-human',
      reasons: ['human-threads:incomplete'],
    });
  });
  it('lets a pause take precedence over collected evidence', async () => {
    const { revision, sources, observe } = fixture();
    vi.mocked(sources.current)
      .mockResolvedValueOnce({ revision, control: 'active' })
      .mockResolvedValue({ revision, control: 'paused' });
    expect((await observe()).control).toBe('paused');
  });
  it('fails on provider errors instead of silently dropping that provider', async () => {
    const { sources, observe } = fixture();
    vi.mocked(sources.checks).mockRejectedValue(
      new Error('provider unavailable'),
    );
    await expect(observe()).rejects.toThrow('evidence read failed');
    expect(sources.reviews).toHaveBeenCalled();
  });
});
