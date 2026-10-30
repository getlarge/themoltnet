import { createHash } from 'node:crypto';

import { DBOSErrors } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { RegistrationWorkflowError } from '../src/workflows/index.js';
import {
  createMockServices,
  createTestApp,
  type MockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const {
  mockGetEvent,
  mockIssueCredential,
  mockSend,
  mockStartWorkflow,
  mockWorkflowResult,
} = vi.hoisted(() => {
  const mockGetEvent = vi.fn();
  const mockWorkflowResult = vi.fn();
  const mockStartWorkflow = vi.fn();
  const mockIssueCredential = vi.fn();
  const mockSend = vi.fn();
  return {
    mockGetEvent,
    mockWorkflowResult,
    mockStartWorkflow,
    mockIssueCredential,
    mockSend,
  };
});

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      getEvent: mockGetEvent,
      send: mockSend,
      startWorkflow: mockStartWorkflow,
    },
  };
});

vi.mock('../src/workflows/index.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    issueRegistrationCredential: mockIssueCredential,
    registrationWorkflow: { registerAgent: vi.fn() },
  };
});

const PUBLIC_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
const FINGERPRINT = 'C212-DAFA-27C5-6C57';
const IDEMPOTENCY_KEY = 'a'.repeat(43);
const TOKEN = `mlt_inv_${'b'.repeat(22)}`;
const SUCCESS = {
  // Deliberately different from identityId: registration mints the agent row
  // first and the Kratos identity second, so the two ids never coincide.
  agentId: '550e8400-e29b-41d4-a716-4466554400aa',
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  fingerprint: FINGERPRINT,
  publicKey: PUBLIC_KEY,
  credential: {
    type: 'oauth2',
    clientId: 'hydra-client-id',
    clientSecret: 'hydra-client-secret',
  },
};

describe('registration routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks);
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cryptoService.parsePublicKey.mockReturnValue(new Uint8Array(32));
    mocks.cryptoService.generateFingerprint.mockReturnValue(FINGERPRINT);
    mocks.cryptoService.verify.mockResolvedValue(true);
    mocks.teamRepository.findInviteByCode.mockResolvedValue({
      id: 'invite-1',
    });
    mockWorkflowResult.mockResolvedValue({
      agentId: SUCCESS.agentId,
      identityId: SUCCESS.identityId,
      identityOwnedForCompensation: true,
      fingerprint: SUCCESS.fingerprint,
      publicKey: SUCCESS.publicKey,
      teamId: '660e8400-e29b-41d4-a716-446655440000',
      credentialType: 'oauth2',
      credentialIdempotencyKey: IDEMPOTENCY_KEY,
    });
    mockIssueCredential.mockResolvedValue(SUCCESS);
    mockGetEvent.mockImplementation(async () => mockWorkflowResult());
    mockSend.mockResolvedValue(undefined);
    mockStartWorkflow.mockReturnValue(
      vi.fn().mockImplementation(async (input) => ({
        getResult: mockWorkflowResult,
        getWorkflowInputs: vi.fn().mockResolvedValue([input]),
        workflowID: 'registration-workflow-id',
      })),
    );
  });

  it('self-registers with a signed nonce and selected credential', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(SUCCESS);
    expect(mocks.cryptoService.verify).toHaveBeenCalledWith(
      `moltnet:register:self\n${IDEMPOTENCY_KEY}\n${PUBLIC_KEY}\noauth2`,
      'signature',
      PUBLIC_KEY,
    );
    expect(mockStartWorkflow).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        queueName: 'registration',
        enqueueOptions: {
          deduplicationID:
            '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
        },
        duplicationPolicy: 'reject',
        timeoutMS: 300_000,
      }),
    );
    const workflowCall = mockStartWorkflow.mock.results[0].value;
    expect(workflowCall).toHaveBeenCalledWith(
      {
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
        credentialType: 'oauth2',
        idempotencyKey: IDEMPOTENCY_KEY,
        mode: { type: 'self' },
      },
      true,
    );
    expect(mockGetEvent).toHaveBeenCalledWith(
      'registration-workflow-id',
      'registration_ready',
      60,
    );
    expect(mockSend).toHaveBeenCalledWith(
      'registration-workflow-id',
      true,
      'credential_issued',
      'registration-workflow-id:credential_issued',
    );
  });

  it('enrolls from a team invite and binds the proof to the token hash', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/enroll',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        token: TOKEN,
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'agent_key',
      },
    });

    expect(response.statusCode).toBe(200);
    const actualHash = createHash('sha256').update(TOKEN).digest('hex');
    expect(mocks.cryptoService.verify).toHaveBeenCalledWith(
      `moltnet:register:team\n${actualHash}\n${IDEMPOTENCY_KEY}\n${PUBLIC_KEY}\nagent_key`,
      'signature',
      PUBLIC_KEY,
    );
    const workflowCall = mockStartWorkflow.mock.results[0].value;
    expect(workflowCall).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialType: 'agent_key',
        mode: {
          type: 'team_invite',
          inviteId: 'invite-1',
          inviteCodeHash: actualHash,
        },
      }),
      true,
    );
  });

  it('deduplicates equivalent encodings of the same public-key bytes', async () => {
    const equivalentPublicKey = PUBLIC_KEY.replace(/=$/, '');

    for (const publicKey of [PUBLIC_KEY, equivalentPublicKey]) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { 'idempotency-key': IDEMPOTENCY_KEY },
        payload: {
          publicKey,
          proof: 'signature',
          credentialType: 'oauth2',
        },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(mockStartWorkflow).toHaveBeenCalledTimes(2);
    expect(mockStartWorkflow.mock.calls[0][1]?.enqueueOptions).toEqual(
      mockStartWorkflow.mock.calls[1][1]?.enqueueOptions,
    );
  });

  it('rejects an invalid or malformed proof before starting the workflow', async () => {
    mocks.cryptoService.verify.mockRejectedValueOnce(new Error('bad base64'));
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'bad',
        credentialType: 'oauth2',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_SIGNATURE');
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('requires a 32-byte random base64url Idempotency-Key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': 'short' },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects reuse of a nonce for a modified registration request', async () => {
    mockStartWorkflow.mockReturnValueOnce(
      vi.fn().mockResolvedValue({
        getResult: mockWorkflowResult,
        getWorkflowInputs: vi.fn().mockResolvedValue([
          {
            publicKey: PUBLIC_KEY,
            fingerprint: FINGERPRINT,
            credentialType: 'agent_key',
            idempotencyKey: IDEMPOTENCY_KEY,
            mode: { type: 'self' },
          },
        ]),
        workflowID: 'registration-workflow-id',
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONFLICT');
    expect(mockWorkflowResult).not.toHaveBeenCalled();
  });

  it('returns 409 when the public key already has an active registration', async () => {
    mockStartWorkflow.mockImplementationOnce(() => async () => {
      throw new DBOSErrors.DBOSQueueDuplicatedError(
        'existing-workflow',
        'registration',
        PUBLIC_KEY,
      );
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(
      expect.objectContaining({
        code: 'CONFLICT',
        detail: 'A registration for this public key is already in progress',
        conflict: {
          constraint: 'registration_principal_in_progress',
          target: {
            resource: 'registration',
            keys: { state: 'in_progress' },
          },
        },
      }),
    );
    expect(mockWorkflowResult).not.toHaveBeenCalled();
  });

  it('maps durable workflow failures to an upstream problem', async () => {
    mockGetEvent.mockReturnValue(new Promise<void>(() => {}));
    mockWorkflowResult.mockRejectedValueOnce(
      new RegistrationWorkflowError('Hydra unavailable'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('UPSTREAM_ERROR');
  });

  it('maps a deserialized enrollment validation failure to a client problem', async () => {
    const error = new Error('Invite was redeemed by another request');
    error.name = 'EnrollmentValidationError';
    mockGetEvent.mockReturnValue(new Promise<void>(() => {}));
    mockWorkflowResult.mockRejectedValueOnce(error);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'idempotency-key': IDEMPOTENCY_KEY },
      payload: {
        publicKey: PUBLIC_KEY,
        proof: 'signature',
        credentialType: 'oauth2',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual(
      expect.objectContaining({
        code: 'REGISTRATION_FAILED',
        detail: 'Invite was redeemed by another request',
      }),
    );
  });

  describe('POST /auth/rotate-secret', () => {
    let rotateApp: FastifyInstance;

    beforeAll(async () => {
      rotateApp = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    });
    afterAll(async () => rotateApp.close());

    it('evicts cached OAuth contexts after Hydra rotates the secret', async () => {
      const response = await rotateApp.inject({
        method: 'POST',
        url: '/auth/rotate-secret',
        headers: { authorization: 'Bearer test-token' },
      });
      expect(response.statusCode).toBe(200);
      expect(rotateApp.tokenValidator.evictOAuthClient).toHaveBeenCalledWith(
        VALID_AUTH_CONTEXT.clientId,
      );
    });
  });
});
