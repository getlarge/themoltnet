import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MoltNetError } from '../src/errors.js';
import { createRuntimePoliciesNamespace } from '../src/namespaces/runtime-policies.js';
import { createRuntimeProfilesNamespace } from '../src/namespaces/runtime-profiles.js';

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROFILE_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const POLICY_ID = 'cccccccc-0000-4000-8000-000000000003';

describe('runtimeProfiles tool-policy methods', () => {
  const get = vi.fn();
  const put = vi.fn();
  const profiles = createRuntimeProfilesNamespace({
    client: { get, put } as unknown as Client,
  });

  beforeEach(() => vi.clearAllMocks());

  it('resolves allowed tools for a profile in the team context', async () => {
    const expected = { enforcement: 'enforce', allowedTools: ['gh', 'git'] };
    get.mockResolvedValue({ data: expected });

    await expect(
      profiles.allowedTools(PROFILE_ID, { teamId: TEAM_ID }),
    ).resolves.toEqual(expected);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-profiles/{profileId}/allowed-tools',
        path: { profileId: PROFILE_ID },
        headers: { 'x-moltnet-team-id': TEAM_ID },
      }),
    );
  });

  it('binds policies to a profile', async () => {
    put.mockResolvedValue({ data: undefined });

    await expect(
      profiles.setPolicies(PROFILE_ID, [POLICY_ID], { teamId: TEAM_ID }),
    ).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-profiles/{profileId}/policies',
        path: { profileId: PROFILE_ID },
        headers: expect.objectContaining({ 'x-moltnet-team-id': TEAM_ID }),
        body: { policyIds: [POLICY_ID] },
      }),
    );
  });

  it('propagates a typed API error from allowedTools', async () => {
    get.mockResolvedValue({
      error: { status: 404, title: 'Not Found' },
      response: { status: 404, statusText: 'Not Found' },
    });

    await expect(
      profiles.allowedTools(PROFILE_ID, { teamId: TEAM_ID }),
    ).rejects.toBeInstanceOf(MoltNetError);
  });
});

describe('RuntimePoliciesNamespace', () => {
  const get = vi.fn();
  const post = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const policies = createRuntimePoliciesNamespace({
    client: { get, post, patch, delete: del } as unknown as Client,
  });

  beforeEach(() => vi.clearAllMocks());

  it('creates a policy in the team context', async () => {
    const created = {
      id: POLICY_ID,
      teamId: TEAM_ID,
      name: 'ci',
      description: null,
      createdAt: null,
      updatedAt: null,
      tools: ['git'],
    };
    post.mockResolvedValue({ data: created });

    await expect(
      policies.create({ name: 'ci', tools: ['git'] }, { teamId: TEAM_ID }),
    ).resolves.toEqual(created);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-policies',
        headers: expect.objectContaining({ 'x-moltnet-team-id': TEAM_ID }),
        body: { name: 'ci', tools: ['git'] },
      }),
    );
  });

  it('lists, gets, updates, and deletes through typed operations', async () => {
    get.mockResolvedValue({ data: { items: [] } });
    await policies.list({ teamId: TEAM_ID });
    expect(get).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: '/runtime-policies',
        headers: { 'x-moltnet-team-id': TEAM_ID },
      }),
    );

    get.mockResolvedValue({ data: { id: POLICY_ID, tools: [] } });
    await policies.get(POLICY_ID, { teamId: TEAM_ID });
    expect(get).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: '/runtime-policies/{policyId}',
        path: { policyId: POLICY_ID },
      }),
    );

    patch.mockResolvedValue({ data: { id: POLICY_ID, tools: ['gh'] } });
    await policies.update(POLICY_ID, { addTools: ['gh'] }, { teamId: TEAM_ID });
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-policies/{policyId}',
        path: { policyId: POLICY_ID },
        body: { addTools: ['gh'] },
      }),
    );

    del.mockResolvedValue({ data: undefined });
    await expect(
      policies.delete(POLICY_ID, { teamId: TEAM_ID }),
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/runtime-policies/{policyId}',
        path: { policyId: POLICY_ID },
      }),
    );
  });

  it('throws when delete returns an error response', async () => {
    del.mockResolvedValue({
      error: { status: 404, title: 'Not Found' },
      response: { status: 404, statusText: 'Not Found' },
    });

    await expect(
      policies.delete(POLICY_ID, { teamId: TEAM_ID }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
