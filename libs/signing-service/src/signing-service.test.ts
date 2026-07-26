import type { AuthContext } from '@moltnet/auth';
import { VERIFICATION_METHOD } from '@moltnet/models';
import { describe, expect, it, vi } from 'vitest';

import { createSigningService } from './signing-service.js';
import type { SigningServiceDeps } from './signing-service.types.js';
import type { SigningServiceError } from './signing-service-error.js';

const agent = {
  subjectType: 'agent',
  identityId: 'agent-identity',
} as AuthContext;

function createDeps(
  overrides: Partial<SigningServiceDeps> = {},
): SigningServiceDeps {
  return {
    signingCredentialRepository: {} as never,
    signingRequestRepository: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    } as never,
    transactionRunner: {} as never,
    permissionChecker: {
      canAccessTeam: vi.fn().mockResolvedValue(true),
      canManageTeamCredentials: vi.fn().mockResolvedValue(false),
    } as never,
    relationshipReader: {} as never,
    groupRepository: {} as never,
    signingTimeoutSeconds: 300,
    ...overrides,
  };
}

describe('createSigningService', () => {
  it('keeps signing credentials and signing requests behind one boundary', () => {
    const service = createSigningService(createDeps());

    expect(service.credentials).toBeDefined();
    expect(service.requests).toBeDefined();
  });

  it('returns no signable requests for an agent without querying storage', async () => {
    const deps = createDeps();
    const service = createSigningService(deps);

    const result = await service.requests.list({
      actor: agent,
      scope: 'signable',
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(deps.signingRequestRepository.list).not.toHaveBeenCalled();
  });

  it('validates delegated request metadata before repository writes', async () => {
    const create = vi.fn();
    const service = createSigningService(
      createDeps({
        signingRequestRepository: { create } as never,
      }),
    );

    await expect(
      service.requests.create({
        actor: agent,
        message: 'approve release',
        verificationMethod: VERIFICATION_METHOD.HumanHardwarePreviewSign,
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'validation_failed',
    } satisfies Partial<SigningServiceError>);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a human actor to approve a credential', async () => {
    const transition = vi.fn();
    const service = createSigningService(
      createDeps({
        signingCredentialRepository: { transition } as never,
      }),
    );

    await expect(
      service.credentials.transition({
        actor: agent,
        teamId: 'team-id',
        credentialId: 'credential-id',
        action: 'approve',
        from: ['pending_approval'],
        to: 'active',
      }),
    ).rejects.toMatchObject({
      name: 'SigningServiceError',
      code: 'forbidden',
    } satisfies Partial<SigningServiceError>);
    expect(transition).not.toHaveBeenCalled();
  });
});
