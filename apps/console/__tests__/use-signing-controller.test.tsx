import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSigningController } from '../src/signing/useSigningController.js';

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  beginRegistration: vi.fn(),
  claim: vi.fn(),
  completeRegistration: vi.fn(),
  completeRequest: vi.fn(),
  connect: vi.fn(),
  createCeremony: vi.fn(),
  getResult: vi.fn(),
  listCredentialsOptions: vi.fn(),
  listRequestsOptions: vi.fn(),
  reject: vi.fn(),
  revoke: vi.fn(),
  suspend: vi.fn(),
  useQuery: vi.fn(),
  waitForResult: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => ({
  approveSigningCredential: mocks.approve,
  beginSigningCredentialRegistration: mocks.beginRegistration,
  claimSigningRequest: mocks.claim,
  completeSigningCredentialRegistration: mocks.completeRegistration,
  completeSigningRequest: mocks.completeRequest,
  rejectSigningRequest: mocks.reject,
  revokeSigningCredential: mocks.revoke,
  suspendSigningCredential: mocks.suspend,
}));

vi.mock('@moltnet/api-client/query', () => ({
  listSigningCredentialsOptions: mocks.listCredentialsOptions,
  listSigningRequestsOptions: mocks.listRequestsOptions,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
}));

vi.mock('../src/api.js', () => ({
  getApiClient: () => ({ kind: 'authenticated-console-client' }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ signerUrl: 'http://127.0.0.1:17373' }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    selectedTeam: {
      id: '770e8400-e29b-41d4-a716-446655440002',
      name: 'Production',
      role: 'owner',
    },
  }),
}));

vi.mock('../src/signing/companion-client.js', () => ({
  createSignerCompanionClient: () => ({
    connect: mocks.connect,
    createCeremony: mocks.createCeremony,
    getResult: mocks.getResult,
    waitForResult: mocks.waitForResult,
  }),
}));

const teamId = '770e8400-e29b-41d4-a716-446655440002';
const credentialId = '880e8400-e29b-41d4-a716-446655440003';
const requestId = '660e8400-e29b-41d4-a716-446655440001';
const challenge = {
  verificationMethod: 'human-hardware-previewsign' as const,
  value: {
    verificationMethod: 'human-hardware-previewsign' as const,
    version: 1 as const,
    envelope: 'ZW52ZWxvcGU',
    digest: 'A'.repeat(43),
    additionalArguments: 'YXJndW1lbnRz',
    outerCredentialId: 'Y3JlZGVudGlhbA',
    outerPublicKey: {
      kty: 2 as const,
      algorithm: -7 as const,
      curve: 1 as const,
      x: 'B'.repeat(43),
      y: 'C'.repeat(43),
    },
    previewKeyHandle: 'aGFuZGxl',
  },
};
const receipt = {
  verificationMethod: 'human-hardware-previewsign' as const,
  value: { version: 1 as const, signature: 'MAYCAQECAQE' },
};
const publicMaterial = {
  version: 1 as const,
  outerCredentialId: 'Y3JlZGVudGlhbA',
  outerPublicKey: challenge.value.outerPublicKey,
  previewKeyHandle: 'aGFuZGxl',
  seedPublicKey: {
    kty: -65537 as const,
    algorithm: -65700 as const,
    derivedAlgorithm: -9 as const,
    blindingKey: challenge.value.outerPublicKey,
    kemKey: {
      kty: 2 as const,
      algorithm: -25 as const,
      curve: 1 as const,
      x: 'D'.repeat(43),
      y: 'E'.repeat(43),
    },
  },
};

function popupFixture() {
  return {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    location: { replace: vi.fn() },
  };
}

describe('useSigningController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({
      version: 1,
      token: 'process-capability',
      expiresAt: '2030-08-01T12:10:00.000Z',
    });
    mocks.listCredentialsOptions.mockReturnValue({ kind: 'credentials' });
    mocks.listRequestsOptions.mockReturnValue({ kind: 'requests' });
    mocks.useQuery.mockImplementation(
      (options: { kind: 'credentials' | 'requests' }) => ({
        data:
          options.kind === 'credentials'
            ? {
                items: [
                  {
                    id: credentialId,
                    status: 'active',
                    verificationMethod: 'human-hardware-previewsign',
                    teamId,
                  },
                ],
              }
            : {
                items: [
                  {
                    id: requestId,
                    status: 'pending',
                    verificationMethod: 'human-hardware-previewsign',
                    teamId,
                  },
                ],
              },
        error: null,
        isLoading: false,
        refetch: vi.fn(() => Promise.resolve()),
      }),
    );
  });

  it('builds selected-team credential and signable-request queries', async () => {
    const { result } = renderHook(() => useSigningController());

    await waitFor(() => {
      expect(result.current.companionStatus).toBe('connected');
    });
    expect(mocks.listCredentialsOptions).toHaveBeenCalledWith({
      client: { kind: 'authenticated-console-client' },
      headers: { 'x-moltnet-team-id': teamId },
      query: { limit: 100 },
    });
    expect(mocks.listRequestsOptions).toHaveBeenCalledWith({
      client: { kind: 'authenticated-console-client' },
      query: {
        limit: 100,
        scope: 'signable',
        status: ['pending', 'claimed'],
      },
    });
    expect(result.current.credentials).toHaveLength(1);
    expect(result.current.requests).toHaveLength(1);
  });

  it('keeps authenticated registration calls in Console around two local confirmations', async () => {
    const popup = popupFixture();
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    mocks.createCeremony
      .mockResolvedValueOnce({
        version: 1,
        id: 'enrollment',
        operation: 'credential-enrollment',
        approvalUrl: 'http://127.0.0.1:17373/ceremonies/enrollment',
        expiresAt: '2030-08-01T12:05:00.000Z',
      })
      .mockResolvedValueOnce({
        version: 1,
        id: 'registration-proof',
        operation: 'credential-registration',
        approvalUrl: 'http://127.0.0.1:17373/ceremonies/registration-proof',
        expiresAt: '2030-08-01T12:05:00.000Z',
      });
    mocks.waitForResult
      .mockResolvedValueOnce({
        version: 1,
        status: 'completed',
        operation: 'credential-enrollment',
        publicMaterial,
      })
      .mockResolvedValueOnce({
        version: 1,
        status: 'completed',
        operation: 'credential-registration',
        receipt,
      });
    mocks.beginRegistration.mockResolvedValue({
      data: { id: credentialId, challenge },
    });
    mocks.completeRegistration.mockResolvedValue({
      data: { id: credentialId },
    });
    const { result } = renderHook(() => useSigningController());

    await act(() => result.current.enroll('Operator key'));

    expect(mocks.beginRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': teamId },
        body: expect.objectContaining({
          label: 'Operator key',
          publicMaterial,
          verificationMethod: 'human-hardware-previewsign',
        }),
      }),
    );
    expect(mocks.completeRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: credentialId },
        body: { publicMaterial, receipt },
      }),
    );
    expect(popup.location.replace).toHaveBeenCalledTimes(2);
    expect(popup.close).toHaveBeenCalled();
  });

  it('claims, completes, rejects, and runs credential lifecycle through authenticated APIs', async () => {
    const popup = popupFixture();
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const request = {
      id: requestId,
      teamId,
      verificationMethod: 'human-hardware-previewsign' as const,
    };
    const credential = {
      id: credentialId,
    };
    mocks.claim.mockResolvedValue({
      data: { ...request, challenge },
    });
    mocks.createCeremony.mockResolvedValue({
      version: 1,
      id: 'signature',
      operation: 'signing-request',
      approvalUrl: 'http://127.0.0.1:17373/ceremonies/signature',
      expiresAt: '2030-08-01T12:05:00.000Z',
    });
    mocks.waitForResult.mockResolvedValue({
      version: 1,
      status: 'completed',
      operation: 'signing-request',
      receipt,
    });
    for (const mock of [
      mocks.completeRequest,
      mocks.reject,
      mocks.approve,
      mocks.suspend,
      mocks.revoke,
    ]) {
      mock.mockResolvedValue({ data: { id: requestId } });
    }
    const { result } = renderHook(() => useSigningController());

    await act(() => result.current.sign(request as never, credentialId));
    await act(() => result.current.reject(request as never));
    await act(() => result.current.approve(credential as never));
    await act(() => result.current.suspend(credential as never));
    await act(() => result.current.revoke(credential as never));

    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: requestId },
        body: { credentialId },
      }),
    );
    expect(mocks.completeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': teamId },
        path: { id: requestId },
        body: { receipt },
      }),
    );
    expect(mocks.reject).toHaveBeenCalled();
    expect(mocks.approve).toHaveBeenCalled();
    expect(mocks.suspend).toHaveBeenCalled();
    expect(mocks.revoke).toHaveBeenCalled();
  });
});
