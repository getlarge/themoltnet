import type { Client } from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../src/agent.js';
import { MoltNetError } from '../src/errors.js';
import { connectHuman } from '../src/human.js';

const TEAM_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const GROUP_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const SUBJECT_ID = 'cccccccc-0000-4000-8000-000000000003';

describe('GroupsNamespace', () => {
  const get = vi.fn();
  const post = vi.fn();
  const del = vi.fn();
  const client = { get, post, delete: del } as unknown as Client;
  const auth = vi.fn().mockResolvedValue('agent-token');
  const groups = createAgent({ client, auth }).groups;

  beforeEach(() => vi.clearAllMocks());

  it('creates and lists groups in a team', async () => {
    const group = { id: GROUP_ID, name: 'Reviewers', teamId: TEAM_ID };
    post.mockResolvedValue({ data: group });
    get.mockResolvedValue({ data: { items: [group] } });

    await expect(
      groups.create(TEAM_ID, { name: 'Reviewers' }),
    ).resolves.toEqual(group);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/teams/{id}/groups',
        path: { id: TEAM_ID },
        body: { name: 'Reviewers' },
        auth: expect.any(Function),
      }),
    );
    const operationAuth = post.mock.calls[0][0].auth;
    await expect(operationAuth({ scheme: 'bearer' })).resolves.toBe(
      'agent-token',
    );
    expect(operationAuth({ scheme: 'apiKey' })).toBeUndefined();

    await expect(groups.list(TEAM_ID)).resolves.toEqual({ items: [group] });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/teams/{id}/groups',
        path: { id: TEAM_ID },
        auth: expect.any(Function),
      }),
    );
  });

  it('gets and deletes a group by group ID', async () => {
    const group = {
      id: GROUP_ID,
      name: 'Reviewers',
      teamId: TEAM_ID,
      createdAt: '2026-01-01T00:00:00Z',
      members: [],
    };
    get.mockResolvedValue({ data: group });
    del.mockResolvedValue({ data: { deleted: true } });

    await expect(groups.get(GROUP_ID)).resolves.toEqual(group);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/groups/{groupId}',
        path: { groupId: GROUP_ID },
      }),
    );

    await expect(groups.delete(GROUP_ID)).resolves.toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/groups/{groupId}',
        path: { groupId: GROUP_ID },
      }),
    );
  });

  it('adds, lists, and removes group members', async () => {
    const member = { subjectId: SUBJECT_ID, subjectNs: 'Human' };
    post.mockResolvedValue({ data: member });
    get.mockResolvedValue({ data: { items: [member] } });
    del.mockResolvedValue({ data: { removed: true } });

    await expect(
      groups.addMember(GROUP_ID, {
        subjectId: SUBJECT_ID,
        subjectNs: 'Human',
      }),
    ).resolves.toEqual(member);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/groups/{groupId}/members',
        path: { groupId: GROUP_ID },
        body: { subjectId: SUBJECT_ID, subjectNs: 'Human' },
        auth: expect.any(Function),
      }),
    );

    await expect(groups.listMembers(GROUP_ID)).resolves.toEqual({
      items: [member],
    });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/groups/{groupId}/members',
        path: { groupId: GROUP_ID },
      }),
    );

    await expect(groups.removeMember(GROUP_ID, SUBJECT_ID)).resolves.toEqual({
      removed: true,
    });
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/groups/{groupId}/members/{subjectId}',
        path: { groupId: GROUP_ID, subjectId: SUBJECT_ID },
      }),
    );
  });

  it('propagates an API conflict', async () => {
    post.mockResolvedValue({
      error: { status: 409, title: 'Conflict' },
      response: { status: 409, statusText: 'Conflict' },
    });

    await expect(
      groups.create(TEAM_ID, { name: 'Reviewers' }),
    ).rejects.toBeInstanceOf(MoltNetError);
  });

  it('is available through a human client', async () => {
    get.mockResolvedValue({ data: { items: [] } });
    const human = connectHuman({ client, bearerToken: 'human-token' });

    await expect(human.groups.list(TEAM_ID)).resolves.toEqual({ items: [] });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/teams/{id}/groups',
        path: { id: TEAM_ID },
        auth: expect.any(Function),
      }),
    );
  });
});
