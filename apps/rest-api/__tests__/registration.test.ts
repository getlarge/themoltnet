/**
 * Registration route tests
 *
 * Tests the POST /auth/register workflow-based registration flow.
 * DBOS.startWorkflow is mocked to avoid real workflow execution.
 */

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

import {
  RegistrationWorkflowError,
  VoucherValidationError,
} from '../src/workflows/index.js';
import {
  createMockServices,
  createTestApp,
  type MockServices,
} from './helpers.js';

// ── DBOS + Workflow Mocks ──────────────────────────────────────

const { mockWorkflowResult, mockStartWorkflow } = vi.hoisted(() => {
  const mockWorkflowResult = vi.fn();
  const mockStartWorkflow = vi
    .fn()
    .mockReturnValue(
      vi.fn().mockResolvedValue({ getResult: mockWorkflowResult }),
    );
  return { mockWorkflowResult, mockStartWorkflow };
});

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      startWorkflow: mockStartWorkflow,
    },
  };
});

vi.mock('../src/workflows/index.js', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    registrationWorkflow: {
      registerAgent: vi.fn(),
    },
  };
});

// ── Test Constants ─────────────────────────────────────────────

const VALID_PUBLIC_KEY = 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=';
const VALID_VOUCHER_CODE = 'a'.repeat(64);
const FINGERPRINT = 'C212-DAFA-27C5-6C57';

const SUCCESSFUL_RESULT = {
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  fingerprint: FINGERPRINT,
  publicKey: VALID_PUBLIC_KEY,
  clientId: 'hydra-client-id',
  clientSecret: 'hydra-client-secret',
};

// ── Tests ──────────────────────────────────────────────────────

describe('Registration routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeAll(async () => {
    mocks = createMockServices();

    // Default: parsePublicKey returns 32-byte key
    mocks.cryptoService.parsePublicKey.mockReturnValue(new Uint8Array(32));
    mocks.cryptoService.generateFingerprint.mockReturnValue(FINGERPRINT);

    // Default: workflow succeeds
    mockWorkflowResult.mockResolvedValue(SUCCESSFUL_RESULT);

    app = await createTestApp(mocks);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore defaults after clearAllMocks
    mocks.cryptoService.parsePublicKey.mockReturnValue(new Uint8Array(32));
    mocks.cryptoService.generateFingerprint.mockReturnValue(FINGERPRINT);
    mockWorkflowResult.mockResolvedValue(SUCCESSFUL_RESULT);
    mockStartWorkflow.mockReturnValue(
      vi.fn().mockResolvedValue({ getResult: mockWorkflowResult }),
    );
  });

  // ── Happy Path ────────────────────────────────────────────────

  describe('POST /auth/register — happy path', () => {
    it('registers an agent and returns credentials', async () => {
      // Arrange — defaults are already configured

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toEqual(SUCCESSFUL_RESULT);

      // Verify DBOS.startWorkflow was called with the workflow function
      expect(mockStartWorkflow).toHaveBeenCalledTimes(1);

      // Verify the inner function was called with the correct arguments
      const innerFn = mockStartWorkflow.mock.results[0].value;
      expect(innerFn).toHaveBeenCalledWith(
        VALID_PUBLIC_KEY,
        FINGERPRINT,
        VALID_VOUCHER_CODE,
      );
    });
  });

  // ── Validation Errors ─────────────────────────────────────────

  describe('POST /auth/register — validation errors', () => {
    it('returns 400 when public_key format is invalid', async () => {
      // Arrange
      mocks.cryptoService.parsePublicKey.mockImplementation(() => {
        throw new Error('Invalid public key format');
      });

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: 'invalid-key-format',
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.detail).toContain('ed25519:<base64>');
    });

    it('returns 400 when public_key is not 32 bytes', async () => {
      // Arrange — return 48-byte key
      mocks.cryptoService.parsePublicKey.mockReturnValue(new Uint8Array(48));

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.detail).toContain('32 bytes');
    });

    it('returns 400 when body fields are missing', async () => {
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {},
      });

      // Assert
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when public_key is missing', async () => {
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when voucher_code is missing', async () => {
      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
        },
      });

      // Assert
      expect(response.statusCode).toBe(400);
    });
  });

  // ── Workflow Errors ───────────────────────────────────────────

  describe('POST /auth/register — workflow errors', () => {
    it('returns 403 when voucher validation fails', async () => {
      // Arrange
      mockWorkflowResult.mockRejectedValue(
        new VoucherValidationError('Voucher expired'),
      );

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe('REGISTRATION_FAILED');
      expect(body.detail).toContain('Voucher expired');
    });

    it('returns 502 when registration workflow fails', async () => {
      // Arrange
      mockWorkflowResult.mockRejectedValue(
        new RegistrationWorkflowError(
          'Hydra did not return client_id/client_secret',
        ),
      );

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.code).toBe('UPSTREAM_ERROR');
      // Server errors (>= 500) have their detail sanitized by the error handler
      expect(body.detail).toBe('An unexpected error occurred');
    });

    it('returns 500 on unexpected errors', async () => {
      // Arrange
      mockWorkflowResult.mockRejectedValue(new Error('unexpected'));

      // Act
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          public_key: VALID_PUBLIC_KEY,
          voucher_code: VALID_VOUCHER_CODE,
        },
      });

      // Assert
      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
