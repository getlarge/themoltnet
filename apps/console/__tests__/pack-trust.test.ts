import { describe, expect, it } from 'vitest';

import { deriveTrustTier, TRUST_TIER_LABELS } from '../src/packs/trust.js';

describe('deriveTrustTier', () => {
  it('classifies a server render as server-rendered regardless of judgment', () => {
    expect(
      deriveTrustTier({
        renderMethod: 'server:pack-to-docs-v1',
        verifiedTaskId: null,
      }),
    ).toBe('server-rendered');
  });

  it('classifies an unjudged agent render as agent-refined', () => {
    expect(
      deriveTrustTier({ renderMethod: 'agent-refined', verifiedTaskId: null }),
    ).toBe('agent-refined');
  });

  it('classifies a judged agent render as agent-refined-verified', () => {
    expect(
      deriveTrustTier({
        renderMethod: 'agent-refined-v2',
        verifiedTaskId: '2b0a1f4e-0000-4000-8000-000000000000',
      }),
    ).toBe('agent-refined-verified');
  });

  it('returns unknown for a render method matching no convention', () => {
    expect(
      deriveTrustTier({ renderMethod: 'homegrown', verifiedTaskId: null }),
    ).toBe('unknown');
  });

  it('never promotes a server render to verified', () => {
    expect(
      deriveTrustTier({
        renderMethod: 'server:pack-to-docs-v1',
        verifiedTaskId: '2b0a1f4e-0000-4000-8000-000000000000',
      }),
    ).toBe('server-rendered');
  });

  it('describes judgment as having run, never as having passed', () => {
    const copy = Object.values(TRUST_TIER_LABELS)
      .map((entry) => `${entry.label} ${entry.description}`)
      .join(' ')
      .toLowerCase();
    expect(copy).not.toMatch(/passed|score|quality|good|better/);
  });
});
