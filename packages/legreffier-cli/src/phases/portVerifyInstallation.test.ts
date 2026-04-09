import { getInstallationToken } from '@themoltnet/github-agent';
import type { MoltNetConfig } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPortVerifyInstallationPhase } from './portVerifyInstallation.js';

vi.mock('@themoltnet/github-agent', () => ({
  getInstallationToken: vi.fn(),
}));

const baseConfig: MoltNetConfig = {
  identity_id: '11111111-1111-1111-1111-111111111111',
  registered_at: '2025-01-01T00:00:00.000Z',
  oauth2: { client_id: 'cid', client_secret: 'csec' },
  keys: {
    public_key: 'ed25519:abc',
    private_key: 'ed25519:priv',
    fingerprint: 'ed25519:fp',
  },
  endpoints: {
    api: 'https://api.themolt.net',
    mcp: 'https://mcp.themolt.net/mcp',
  },
  ssh: {
    private_key_path: '/tmp/id_ed25519',
    public_key_path: '/tmp/id_ed25519.pub',
  },
  git: {
    name: 'legreffier',
    email: '1+legreffier[bot]@users.noreply.github.com',
    signing: true,
    config_path: '/tmp/gitconfig',
  },
  github: {
    app_id: '2878569',
    app_slug: 'legreffier',
    installation_id: '99999',
    private_key_path: '/tmp/legreffier.pem',
  },
};

beforeEach(() => {
  vi.mocked(getInstallationToken).mockResolvedValue({
    token: 'ghs_faketoken',
    expiresAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runPortVerifyInstallationPhase', () => {
  it("returns 'ok' when repository_selection is 'all'", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 0,
          repository_selection: 'all',
          repositories: [],
        }),
      })),
    );

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('ok');
    expect(result.repositorySelection).toBe('all');
  });

  it("returns 'ok' when selected repos include currentRepo", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repository_selection: 'selected',
          repositories: [{ full_name: 'getlarge/themoltnet' }],
        }),
      })),
    );

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('ok');
    expect(result.accessibleRepos).toEqual(['getlarge/themoltnet']);
  });

  it("returns 'repo-not-in-scope' when selected repos exclude currentRepo", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          total_count: 1,
          repository_selection: 'selected',
          repositories: [{ full_name: 'getlarge/other-repo' }],
        }),
      })),
    );

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('repo-not-in-scope');
    expect(result.message).toContain('getlarge/themoltnet');
    expect(result.message).toContain('99999');
  });

  it("returns 'warning' when currentRepo is unknown", async () => {
    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('unable to determine current repo');
  });

  it("returns 'warning' when token minting throws", async () => {
    vi.mocked(getInstallationToken).mockRejectedValueOnce(
      new Error('pem decode failed'),
    );

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('pem decode failed');
  });

  it('follows Link rel="next" pagination to find currentRepo on a later page', async () => {
    const fetchMock = vi.fn();
    // Page 1: no currentRepo, Link header points to page 2
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'link'
            ? '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"'
            : null,
      },
      json: async () => ({
        total_count: 101,
        repository_selection: 'selected',
        repositories: Array.from({ length: 100 }, (_, i) => ({
          full_name: `getlarge/other-${i}`,
        })),
      }),
    });
    // Page 2: includes currentRepo
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        total_count: 101,
        repository_selection: 'selected',
        repositories: [{ full_name: 'getlarge/themoltnet' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.accessibleRepos?.length).toBe(101);
  });

  it("returns 'warning' on non-ok GitHub response", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      })),
    );

    const result = await runPortVerifyInstallationPhase({
      config: baseConfig,
      currentRepo: 'getlarge/themoltnet',
    });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('401');
  });
});
