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

  // The canonical agent label is `agent:pack-to-docs-v1` (colon), per
  // docs/use/context-packs.md. `agent-refined*` appears only in older test
  // fixtures, and libs/pi-runtime defaults to `pi:pack-to-docs-v1`.
  it.each([
    'agent:pack-to-docs-v1',
    'pi:pack-to-docs-v1',
    'agent-refined',
    'agent-refined-v2',
  ])(
    'classifies unjudged caller-authored render %s as agent-refined',
    (renderMethod) => {
      expect(deriveTrustTier({ renderMethod, verifiedTaskId: null })).toBe(
        'agent-refined',
      );
    },
  );

  it.each(['agent:pack-to-docs-v1', 'pi:pack-to-docs-v1', 'agent-refined-v2'])(
    'classifies judged caller-authored render %s as agent-refined-verified',
    (renderMethod) => {
      expect(
        deriveTrustTier({
          renderMethod,
          verifiedTaskId: '2b0a1f4e-0000-4000-8000-000000000000',
        }),
      ).toBe('agent-refined-verified');
    },
  );

  it.each(['homegrown', 'pack-to-docs-v1', ''])(
    'returns unknown for render method %s, matching no convention',
    (renderMethod) => {
      expect(deriveTrustTier({ renderMethod, verifiedTaskId: null })).toBe(
        'unknown',
      );
    },
  );

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
