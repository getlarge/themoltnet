import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkWorkflowLive: vi.fn(),
  readConfig: vi.fn(),
  readState: vi.fn(),
  startOnboarding: vi.fn(),
  writeState: vi.fn(),
  writeConfig: vi.fn(),
  checkAppNameAvailable: vi.fn(),
  generateKeyPair: vi.fn(),
  sign: vi.fn(),
}));

vi.mock('@themoltnet/sdk', () => ({
  buildSelfRegistrationMessage: (input: {
    idempotencyKey: string;
    publicKey: string;
    credentialType: string;
  }) =>
    `moltnet:register:self\n${input.idempotencyKey}\n${input.publicKey}\n${input.credentialType}`,
  readConfig: mocks.readConfig,
  writeConfig: mocks.writeConfig,
}));

vi.mock('../api.js', () => ({
  checkWorkflowLive: mocks.checkWorkflowLive,
  startOnboarding: mocks.startOnboarding,
}));

vi.mock('../github.js', () => ({
  checkAppNameAvailable: mocks.checkAppNameAvailable,
  suggestAppNames: vi.fn(),
}));

vi.mock('../state.js', () => ({
  clearState: vi.fn(),
  readState: mocks.readState,
  writeState: mocks.writeState,
}));

vi.mock('@moltnet/crypto-service', () => ({
  cryptoService: {
    generateKeyPair: mocks.generateKeyPair,
    sign: mocks.sign,
  },
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

  it('starts onboarding with a locally signed OAuth2 registration', async () => {
    mocks.readConfig.mockResolvedValue(null);
    mocks.readState.mockResolvedValue(null);
    mocks.checkAppNameAvailable.mockResolvedValue(true);
    mocks.generateKeyPair.mockResolvedValue({
      publicKey: 'ed25519:public-key',
      privateKey: 'private-key',
      fingerprint: 'AAAA-BBBB-CCCC-DDDD',
    });
    mocks.sign.mockResolvedValue('registration-proof');
    mocks.startOnboarding.mockResolvedValue({
      workflowId: 'workflow-id',
      manifestFormUrl: 'https://github.example/manifest',
    });

    await runIdentityPhase({
      apiUrl: 'https://api.themolt.net',
      agentName: 'agent',
      configDir: '/tmp/agent',
      dispatch: vi.fn(),
    });

    expect(mocks.startOnboarding).toHaveBeenCalledWith(
      'https://api.themolt.net',
      expect.objectContaining({
        publicKey: 'ed25519:public-key',
        fingerprint: 'AAAA-BBBB-CCCC-DDDD',
        proof: 'registration-proof',
        credentialType: 'oauth2',
        idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const request = mocks.startOnboarding.mock.calls[0][1];
    expect(mocks.sign).toHaveBeenCalledWith(
      `moltnet:register:self\n${request.idempotencyKey}\ned25519:public-key\noauth2`,
      'private-key',
    );
  });
});
