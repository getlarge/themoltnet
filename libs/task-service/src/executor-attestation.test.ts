import { describe, expect, it } from 'vitest';

import { assertExecutorContinuity } from './executor-attestation.js';

describe('assertExecutorContinuity', () => {
  it('accepts the executor claimed by the attempt', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: 'bafkrei-claimed',
        completedFingerprint: 'bafkrei-claimed',
      }),
    ).not.toThrow();
  });

  it('rejects executor drift after claim', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: 'bafkrei-claimed',
        completedFingerprint: 'bafkrei-other',
      }),
    ).toThrow(/changed between claim and completion/);
  });

  it('allows unattested self-declared attempts', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: null,
        completedFingerprint: null,
      }),
    ).not.toThrow();
  });
});
