import { describe, expect, it } from 'vitest';

import { credentialLabel, expiryLabel } from './credential-health.js';
import type { AgentServerCatalogueTeam } from './types.js';

const now = Date.parse('2026-09-18T00:00:00Z');
const team: AgentServerCatalogueTeam = {
  teamId: 'team',
  teamName: 'Research',
  available: true,
  blockers: [],
  diaries: [],
  defaultDiaryId: null,
  credential: {
    keyId: 'key',
    verifiedAt: new Date(now).toISOString(),
    scopes: [],
  },
};
describe('desktop credential health', () => {
  it.each([
    [0, 'Expired'],
    [1, 'Expires within seven days'],
    [7 * 86400000, 'Expires within seven days'],
    [7 * 86400000 + 1, 'Healthy'],
  ] as const)('handles expiry boundary %s', (offset, label) => {
    expect(
      credentialLabel(
        {
          ...team,
          credential: {
            ...team.credential!,
            expiresAt: new Date(now + offset).toISOString(),
          },
        },
        now,
      ),
    ).toBe(label);
  });
  it('preserves unknown expiry for older APIs', () => {
    expect(credentialLabel(team, now)).toBe('Expiry unknown');
    expect(expiryLabel(undefined)).toBe('Expiry unknown');
    expect(credentialLabel({ ...team, available: false }, now)).toBe(
      'Unavailable',
    );
  });
});
