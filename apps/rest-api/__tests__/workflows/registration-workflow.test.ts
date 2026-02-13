import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── DBOS Mock (vi.hoisted for proper hoisting) ────────────────

const { mockRegisterStep, mockRegisterWorkflow, mockLogger } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterStep = vi.fn((fn: Function) => fn);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterWorkflow = vi.fn((fn: Function) => fn);
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    return { mockRegisterStep, mockRegisterWorkflow, mockLogger };
  },
);

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      registerStep: mockRegisterStep,
      registerWorkflow: mockRegisterWorkflow,
      logger: mockLogger,
    },
  };
});

// ── Imports (after mock) ──────────────────────────────────────

import {
  initRegistrationWorkflow,
  registrationWorkflow,
  setRegistrationDeps,
  VoucherValidationError,
} from '../../src/workflows/index.js';

// ── Mock Dependencies ─────────────────────────────────────────

function createMockDeps() {
  return {
    identityApi: {
      listIdentitySchemas: vi.fn(),
      createIdentity: vi.fn(),
      deleteIdentity: vi.fn(),
    },
    oauth2Api: {
      createOAuth2Client: vi.fn(),
    },
    voucherRepository: {
      findByCode: vi.fn(),
      redeem: vi.fn(),
    },
    agentRepository: {
      upsert: vi.fn(),
    },
    permissionChecker: {
      registerAgent: vi.fn(),
    },
    dataSource: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      runTransaction: vi.fn((fn: Function) => fn()),
      client: {},
    },
  };
}

type MockDeps = ReturnType<typeof createMockDeps>;

// ── Fixtures ──────────────────────────────────────────────────

const PUBLIC_KEY = 'ed25519:test-public-key-base64';
const FINGERPRINT = 'ABCD-EF01-2345-6789';
const VOUCHER_CODE = 'valid-voucher-code';
const IDENTITY_ID = 'identity-123';
const CLIENT_ID = 'client-123';
const CLIENT_SECRET = 'secret-456';

function createValidVoucher() {
  return {
    id: 'voucher-1',
    code: VOUCHER_CODE,
    issuerId: 'issuer-123',
    redeemedBy: null,
    redeemedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000), // 1 hour from now
    createdAt: new Date(),
  };
}

function setupHappyPath(mocks: MockDeps) {
  mocks.voucherRepository.findByCode.mockResolvedValue(createValidVoucher());

  mocks.identityApi.listIdentitySchemas.mockResolvedValue({
    data: [
      {
        id: 'schema-hash-123',
        schema: { $id: 'https://schemas.themolt.net/agent.json' },
      },
    ],
  });

  mocks.identityApi.createIdentity.mockResolvedValue({
    data: { id: IDENTITY_ID },
  });

  mocks.agentRepository.upsert.mockResolvedValue(undefined);

  mocks.voucherRepository.redeem.mockResolvedValue({
    ...createValidVoucher(),
    redeemedBy: IDENTITY_ID,
    redeemedAt: new Date(),
  });

  mocks.permissionChecker.registerAgent.mockResolvedValue(undefined);

  mocks.oauth2Api.createOAuth2Client.mockResolvedValue({
    data: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe('registration workflow', () => {
  let mocks: MockDeps;

  beforeAll(() => {
    initRegistrationWorkflow();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockDeps();
    setRegistrationDeps(mocks as never);
  });

  describe('happy path', () => {
    it('registers an agent and returns credentials', async () => {
      // Arrange
      setupHappyPath(mocks);

      // Act
      const result = await registrationWorkflow.registerAgent(
        PUBLIC_KEY,
        FINGERPRINT,
        VOUCHER_CODE,
      );

      // Assert
      expect(result).toEqual({
        identityId: IDENTITY_ID,
        fingerprint: FINGERPRINT,
        publicKey: PUBLIC_KEY,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      });

      // Verify step calls
      expect(mocks.voucherRepository.findByCode).toHaveBeenCalledWith(
        VOUCHER_CODE,
      );
      expect(mocks.identityApi.createIdentity).toHaveBeenCalledWith({
        createIdentityBody: expect.objectContaining({
          schema_id: 'schema-hash-123',
          traits: {
            public_key: PUBLIC_KEY,
            voucher_code: VOUCHER_CODE,
          },
        }),
      });
      expect(mocks.agentRepository.upsert).toHaveBeenCalledWith({
        identityId: IDENTITY_ID,
        publicKey: PUBLIC_KEY,
        fingerprint: FINGERPRINT,
      });
      expect(mocks.voucherRepository.redeem).toHaveBeenCalledWith(
        VOUCHER_CODE,
        IDENTITY_ID,
      );
      expect(mocks.permissionChecker.registerAgent).toHaveBeenCalledWith(
        IDENTITY_ID,
      );
      expect(mocks.oauth2Api.createOAuth2Client).toHaveBeenCalledWith({
        oAuth2Client: expect.objectContaining({
          client_name: `Agent: ${FINGERPRINT}`,
          grant_types: ['client_credentials'],
          metadata: expect.objectContaining({
            identity_id: IDENTITY_ID,
            public_key: PUBLIC_KEY,
            fingerprint: FINGERPRINT,
          }),
        }),
      });
    });
  });

  describe('voucher validation', () => {
    it('throws when voucher is not found', async () => {
      // Arrange
      mocks.voucherRepository.findByCode.mockResolvedValue(null);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow(VoucherValidationError);

      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Voucher not found');

      // No further steps called
      expect(mocks.identityApi.createIdentity).not.toHaveBeenCalled();
      expect(mocks.dataSource.runTransaction).not.toHaveBeenCalled();
    });

    it('throws when voucher has expired', async () => {
      // Arrange
      const expiredVoucher = {
        ...createValidVoucher(),
        expiresAt: new Date(Date.now() - 3_600_000), // 1 hour ago
      };
      mocks.voucherRepository.findByCode.mockResolvedValue(expiredVoucher);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow(VoucherValidationError);

      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Voucher has expired');

      expect(mocks.identityApi.createIdentity).not.toHaveBeenCalled();
    });

    it('throws when voucher has already been redeemed', async () => {
      // Arrange
      const redeemedVoucher = {
        ...createValidVoucher(),
        redeemedAt: new Date(),
        redeemedBy: 'some-other-agent',
      };
      mocks.voucherRepository.findByCode.mockResolvedValue(redeemedVoucher);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow(VoucherValidationError);

      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Voucher has already been redeemed');

      expect(mocks.identityApi.createIdentity).not.toHaveBeenCalled();
    });
  });

  describe('compensation', () => {
    it('does not compensate when Kratos identity creation fails', async () => {
      // Arrange
      mocks.voucherRepository.findByCode.mockResolvedValue(
        createValidVoucher(),
      );
      mocks.identityApi.listIdentitySchemas.mockResolvedValue({
        data: [
          {
            id: 'schema-hash-123',
            schema: { $id: 'https://schemas.themolt.net/agent.json' },
          },
        ],
      });
      mocks.identityApi.createIdentity.mockRejectedValue(
        new Error('Kratos unavailable'),
      );

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Kratos unavailable');

      // No compensation since identity doesn't exist
      expect(mocks.identityApi.deleteIdentity).not.toHaveBeenCalled();
    });

    it('compensates by deleting Kratos identity when DB transaction fails', async () => {
      // Arrange
      mocks.voucherRepository.findByCode.mockResolvedValue(
        createValidVoucher(),
      );
      mocks.identityApi.listIdentitySchemas.mockResolvedValue({
        data: [
          {
            id: 'schema-hash-123',
            schema: { $id: 'https://schemas.themolt.net/agent.json' },
          },
        ],
      });
      mocks.identityApi.createIdentity.mockResolvedValue({
        data: { id: IDENTITY_ID },
      });
      mocks.dataSource.runTransaction.mockRejectedValue(new Error('DB error'));
      mocks.identityApi.deleteIdentity.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('DB error');

      expect(mocks.identityApi.deleteIdentity).toHaveBeenCalledWith({
        id: IDENTITY_ID,
      });
    });

    it('compensates by deleting Kratos identity when Keto registration fails', async () => {
      // Arrange
      setupHappyPath(mocks);
      mocks.permissionChecker.registerAgent.mockRejectedValue(
        new Error('Keto unavailable'),
      );
      mocks.identityApi.deleteIdentity.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Keto unavailable');

      expect(mocks.identityApi.deleteIdentity).toHaveBeenCalledWith({
        id: IDENTITY_ID,
      });
    });

    it('compensates by deleting Kratos identity when OAuth2 client creation fails', async () => {
      // Arrange
      setupHappyPath(mocks);
      mocks.oauth2Api.createOAuth2Client.mockRejectedValue(
        new Error('Hydra unavailable'),
      );
      mocks.identityApi.deleteIdentity.mockResolvedValue(undefined);

      // Act & Assert
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('Hydra unavailable');

      expect(mocks.identityApi.deleteIdentity).toHaveBeenCalledWith({
        id: IDENTITY_ID,
      });
    });

    it('re-throws original error when compensation also fails', async () => {
      // Arrange
      mocks.voucherRepository.findByCode.mockResolvedValue(
        createValidVoucher(),
      );
      mocks.identityApi.listIdentitySchemas.mockResolvedValue({
        data: [
          {
            id: 'schema-hash-123',
            schema: { $id: 'https://schemas.themolt.net/agent.json' },
          },
        ],
      });
      mocks.identityApi.createIdentity.mockResolvedValue({
        data: { id: IDENTITY_ID },
      });
      mocks.dataSource.runTransaction.mockRejectedValue(new Error('DB error'));
      mocks.identityApi.deleteIdentity.mockRejectedValue(
        new Error('Kratos delete also failed'),
      );

      // Act & Assert — original error is thrown, not compensation error
      await expect(
        registrationWorkflow.registerAgent(
          PUBLIC_KEY,
          FINGERPRINT,
          VOUCHER_CODE,
        ),
      ).rejects.toThrow('DB error');

      // Compensation failure logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Compensation failed'),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Kratos delete also failed'),
      );
    });
  });
});
