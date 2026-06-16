import { describe, expect, it, vi } from 'vitest';

import {
  configuredProfileIds,
  validateConfiguredProfiles,
} from './validate-profiles.js';

const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

describe('configuredProfileIds', () => {
  it('collects distinct profileIds across steps', () => {
    const ids = configuredProfileIds({
      triage: { profileId: ID_A },
      implement: { profileId: ID_B },
      plan: { profileId: ID_A }, // duplicate
      notify: { maxAttempts: 2 }, // no profile
    });
    expect(ids.sort()).toEqual([ID_A, ID_B]);
  });

  it('returns empty when no step pins a profile', () => {
    expect(configuredProfileIds({ triage: { maxAttempts: 1 } })).toEqual([]);
  });
});

describe('validateConfiguredProfiles', () => {
  it('is a no-op when no profiles are configured', async () => {
    const get = vi.fn();
    await validateConfiguredProfiles({ get }, { triage: { maxAttempts: 1 } });
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves every configured profile', async () => {
    const get = vi.fn().mockResolvedValue({ id: 'ok' });
    await validateConfiguredProfiles(
      { get },
      { triage: { profileId: ID_A }, implement: { profileId: ID_B } },
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(ID_A);
    expect(get).toHaveBeenCalledWith(ID_B);
  });

  it('throws listing every profile that fails to resolve', async () => {
    const get = vi.fn(async (profileId: string) => {
      if (profileId === ID_B) throw new Error('404 not found');
      return { id: profileId };
    });
    await expect(
      validateConfiguredProfiles(
        { get },
        { triage: { profileId: ID_A }, implement: { profileId: ID_B } },
      ),
    ).rejects.toThrow(
      /could not be resolved[\s\S]*00000000-0000-4000-8000-00000000000b/,
    );
  });
});
