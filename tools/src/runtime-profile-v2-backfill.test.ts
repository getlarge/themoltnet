import type { RuntimeProfile } from '@moltnet/database';
import { describe, expect, it } from 'vitest';

import {
  planRuntimeProfileV2Backfill,
  verifyRuntimeProfileExport,
} from './runtime-profile-v2-backfill.js';

function profile(patch: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'legacy-profile',
    provider: 'anthropic',
    model: 'claude-sonnet',
    definitionVersion: 1,
    definitionCid: 'legacy',
    requiredTools: ['git', 'node'],
    requiredExecutables: [],
    sandbox: {
      network: { allowedHosts: ['example.com'] },
      snapshot: { setupCommands: ['apk add nodejs'] },
      resumeCommands: ['echo ready'],
    },
    ...patch,
  } as RuntimeProfile;
}

describe('runtime profile v2 backfill', () => {
  it('migrates v1 executable requirements and removes provisioning', async () => {
    const plan = await planRuntimeProfileV2Backfill(profile());

    expect(plan.changed).toBe(true);
    expect(plan.next.definitionVersion).toBe(2);
    expect(plan.next.requiredTools).toEqual([]);
    expect(plan.next.requiredExecutables).toEqual(['git', 'node']);
    expect(plan.next.sandbox).toEqual({
      network: { allowedHosts: ['example.com'] },
    });
    expect(plan.legacyProvisioning).toEqual({
      snapshot: { setupCommands: ['apk add nodejs'] },
      resumeCommands: ['echo ready'],
    });
  });

  it('does not reinterpret an already-migrated empty v2 profile', async () => {
    const row = profile({
      definitionVersion: 2,
      requiredTools: [],
      requiredExecutables: [],
      sandbox: {},
    });
    const plan = await planRuntimeProfileV2Backfill(row);

    expect(plan.changed).toBe(false);
    expect(plan.next).toBe(row);
  });

  it('verifies export count and profile ids', () => {
    const row = profile();
    expect(() =>
      verifyRuntimeProfileExport([{ id: row.id }], [row]),
    ).not.toThrow();
    expect(() => verifyRuntimeProfileExport([], [row])).toThrow(/row count/);
    expect(() => verifyRuntimeProfileExport([{ id: 'wrong' }], [row])).toThrow(
      /profile ids/,
    );
  });
});
