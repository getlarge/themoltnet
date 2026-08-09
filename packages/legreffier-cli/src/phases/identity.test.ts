import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkWorkflowLive: vi.fn(),
  readConfig: vi.fn(),
  readState: vi.fn(),
  writeConfig: vi.fn(),
}));

vi.mock('@themoltnet/sdk', () => ({
  readConfig: mocks.readConfig,
  writeConfig: mocks.writeConfig,
}));

vi.mock('../api.js', () => ({
  checkWorkflowLive: mocks.checkWorkflowLive,
  startOnboarding: vi.fn(),
}));

vi.mock('../github.js', () => ({
  checkAppNameAvailable: vi.fn(),
  suggestAppNames: vi.fn(),
}));

vi.mock('../state.js', () => ({
  clearState: vi.fn(),
  readState: mocks.readState,
  writeState: vi.fn(),
}));

vi.mock('@moltnet/crypto-service', () => ({
  cryptoService: { generateKeyPair: vi.fn() },
}));

import { runIdentityPhase } from './identity.js';

describe('runIdentityPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes a live workflow with its intentionally partial OAuth config', async () => {
    mocks.readConfig.mockResolvedValue({
      identity_id: '',
      registered_at: '2026-01-01T00:00:00.000Z',
      oauth2: { client_id: '', client_secret: '' },
      keys: {
        public_key: 'public-key',
        private_key: 'private-key',
        fingerprint: 'fingerprint',
      },
      endpoints: { api: 'https://api.themolt.net', mcp: '' },
    });
    mocks.readState.mockResolvedValue({
      workflowId: 'workflow-id',
      publicKey: 'public-key',
      privateKey: 'private-key',
      fingerprint: 'fingerprint',
    });
    mocks.checkWorkflowLive.mockResolvedValue(true);

    await expect(
      runIdentityPhase({
        apiUrl: 'https://api.themolt.net',
        agentName: 'agent',
        configDir: '/tmp/agent',
        dispatch: vi.fn(),
      }),
    ).resolves.toMatchObject({
      workflowId: 'workflow-id',
      clientId: '',
      clientSecret: '',
      skipped: true,
    });
    expect(mocks.writeConfig).not.toHaveBeenCalled();
  });
});
