import { describe, expect, it } from 'vitest';

import { resolveAgentDirectory } from './api.js';

describe('resolveAgentDirectory', () => {
  it('uses the activated identity directory exported by the daemon action', () => {
    expect(
      resolveAgentDirectory('/repo', 'legreffier', '/runner/identities/agent'),
    ).toBe('/runner/identities/agent');
  });

  it('falls back to the repository-local identity directory', () => {
    expect(resolveAgentDirectory('/repo', 'legreffier', '')).toBe(
      '/repo/.moltnet/legreffier',
    );
  });
});
