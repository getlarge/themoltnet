import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    apiBaseUrl: 'https://api.example.com',
    kratosUrl: 'https://auth.example.com',
    consoleUrl: 'https://console.example.com',
  }),
}));

describe('api client singleton', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module between tests so the singleton client + team id
    // start fresh. One of the few legitimate reasons for resetModules
    // (the singleton is per-module-load).
    vi.resetModules();
    mockCreateClient.mockImplementation((opts) => ({ __opts: opts }));
  });

  it('creates a client with no team header when teamId is not set', async () => {
    const { getApiClient } = await import('../src/api.js');
    getApiClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ headers: undefined }),
    );
  });

  it('creates a client with x-moltnet-team-id header after setTeamId', async () => {
    const { getApiClient, setTeamId } = await import('../src/api.js');
    setTeamId('team-alpha');
    getApiClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team-alpha' },
      }),
    );
  });

  it('invalidates the cached client when setTeamId changes the team', async () => {
    const { getApiClient, setTeamId } = await import('../src/api.js');
    setTeamId('team-alpha');
    const first = getApiClient();
    setTeamId('team-beta');
    const second = getApiClient();
    expect(first).not.toBe(second);
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team-beta' },
      }),
    );
  });

  it('returns the same client instance when setTeamId is called with the same team', async () => {
    const { getApiClient, setTeamId } = await import('../src/api.js');
    setTeamId('team-alpha');
    const first = getApiClient();
    setTeamId('team-alpha');
    const second = getApiClient();
    expect(first).toBe(second);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });
});
