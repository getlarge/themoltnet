import type { Client } from '@moltnet/api-client';
import {
  createClient,
  createDiary,
  listDiaries,
  listTeams,
} from '@moltnet/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { connectHuman } from '../src/human.js';

vi.mock('@moltnet/api-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createClient: vi.fn(),
    createDiary: vi.fn(),
    listDiaries: vi.fn(),
    listTeams: vi.fn(),
  };
});

const mockClient = {} as Client;

describe('Human client facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a browser session client with cookies included by default', () => {
    vi.mocked(createClient).mockReturnValueOnce(mockClient);

    const human = connectHuman();

    expect(human.kind).toBe('human');
    expect(human.client).toBe(mockClient);
    expect(createClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.themolt.net',
      credentials: 'include',
    });
  });

  it('accepts an explicit API URL, credentials mode, fetch, and headers', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    vi.mocked(createClient).mockReturnValueOnce(mockClient);

    connectHuman({
      apiUrl: 'https://api.example.test/',
      credentials: 'same-origin',
      fetch: fetchImpl,
      headers: { 'x-app': 'docs' },
    });

    expect(createClient).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.test',
      credentials: 'same-origin',
      fetch: fetchImpl,
      headers: { 'x-app': 'docs' },
    });
  });

  it('uses X-Moltnet-Session-Token auth without treating it as bearer auth', async () => {
    vi.mocked(listTeams).mockResolvedValueOnce({
      data: { items: [] },
      error: undefined,
    } as any);

    const human = connectHuman({
      client: mockClient,
      sessionToken: 'human-session-token',
    });

    await human.teams.list();

    const call = vi.mocked(listTeams).mock.calls[0]?.[0];
    expect(call).toEqual(
      expect.objectContaining({
        client: mockClient,
        auth: expect.any(Function),
      }),
    );
    await expect(
      call?.auth?.({ type: 'apiKey', name: 'X-Moltnet-Session-Token' }),
    ).resolves.toBe('human-session-token');
    await expect(
      call?.auth?.({ type: 'http', scheme: 'bearer' }),
    ).resolves.toBeUndefined();
  });

  it('uses bearer auth when an OAuth access token is provided', async () => {
    vi.mocked(listTeams).mockResolvedValueOnce({
      data: { items: [] },
      error: undefined,
    } as any);

    const human = connectHuman({
      client: mockClient,
      bearerToken: async () => 'human-access-token',
    });

    await human.teams.list();

    const call = vi.mocked(listTeams).mock.calls[0]?.[0];
    await expect(
      call?.auth?.({ type: 'http', scheme: 'bearer' }),
    ).resolves.toBe('human-access-token');
    await expect(
      call?.auth?.({ type: 'apiKey', name: 'X-Moltnet-Session-Token' }),
    ).resolves.toBeUndefined();
  });

  it('passes team-scoped diary headers through diary creation', async () => {
    vi.mocked(createDiary).mockResolvedValueOnce({
      data: { id: 'diary-1' },
      error: undefined,
    } as any);

    const human = connectHuman({
      client: mockClient,
    });

    await human.diaries.create(
      { name: 'Project memory', visibility: 'moltnet' },
      { 'x-moltnet-team-id': 'team-1' },
    );

    expect(createDiary).toHaveBeenCalledWith(
      expect.objectContaining({
        client: mockClient,
        auth: undefined,
        body: { name: 'Project memory', visibility: 'moltnet' },
        headers: { 'x-moltnet-team-id': 'team-1' },
      }),
    );
  });

  it('passes team-scoped diary headers through diary listing', async () => {
    vi.mocked(listDiaries).mockResolvedValueOnce({
      data: { items: [] },
      error: undefined,
    } as any);

    const human = connectHuman({
      client: mockClient,
    });

    await human.diaries.list(undefined, { 'x-moltnet-team-id': 'team-1' });

    expect(listDiaries).toHaveBeenCalledWith(
      expect.objectContaining({
        client: mockClient,
        auth: undefined,
        query: undefined,
        headers: { 'x-moltnet-team-id': 'team-1' },
      }),
    );
  });
});
