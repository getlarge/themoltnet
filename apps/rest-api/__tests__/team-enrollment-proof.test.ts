import { cryptoService } from '@moltnet/crypto-service';
import { buildTeamEnrollmentMessage } from '@moltnet/models';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { enrollTeamAgent } from '../src/services/team-enrollment.service.js';
import {
  createMockAgent,
  createMockServices,
  createTestApp,
  OWNER_ID,
} from './helpers.js';

vi.mock('../src/services/team-enrollment.service.js', () => ({
  enrollTeamAgent: vi.fn(),
}));
const mocks = createMockServices();
const identityApi = { getIdentity: vi.fn() };
const keyPair = await cryptoService.generateKeyPair();
const input = {
  subjectId: OWNER_ID,
  code: 'mlt_inv_abcdefghijklmnopqrstuv',
  expectedTeamId: 'aaaaaaaa-0000-4000-8000-000000000001',
  idempotencyKey: 'proof-request',
};
let app: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.agentRepository.findById.mockResolvedValue(
    createMockAgent({ publicKey: keyPair.publicKey }),
  );
  mocks.cryptoService.parsePublicKey.mockImplementation(
    cryptoService.parsePublicKey,
  );
  mocks.cryptoService.generateFingerprint.mockImplementation(
    cryptoService.generateFingerprint,
  );
  mocks.cryptoService.verify.mockImplementation(cryptoService.verify);
  identityApi.getIdentity.mockResolvedValue({ state: 'active' });
  // A sentinel response stops before serializing a one-time credential.
  vi.mocked(enrollTeamAgent).mockRejectedValue(
    Object.assign(new Error('enrollment reached'), { statusCode: 409 }),
  );
  app = await createTestApp(mocks, null, undefined, {
    identityApi,
    talosApi: { getJwks: vi.fn() },
  });
});
afterEach(async () => {
  await app.close();
});

async function send(overrides = {}, idempotencyKey = input.idempotencyKey) {
  const proof = await cryptoService.sign(
    buildTeamEnrollmentMessage(input),
    keyPair.privateKey,
  );
  return app.inject({
    method: 'POST',
    url: '/auth/enroll-team',
    headers: { 'idempotency-key': idempotencyKey },
    payload: {
      subjectId: input.subjectId,
      code: input.code,
      expectedTeamId: input.expectedTeamId,
      proof,
      ...overrides,
    },
  });
}

describe('existing identity enrollment proof', () => {
  it('accepts a locally signed proof without an API credential', async () => {
    await send();
    expect(enrollTeamAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        subjectId: input.subjectId,
        expectedTeamId: input.expectedTeamId,
        proofAuthenticated: true,
      }),
    );
  });

  it.each([
    { code: 'mlt_inv_bcdefghijklmnopqrstuvw' },
    { expectedTeamId: 'bbbbbbbb-0000-4000-8000-000000000002' },
    { subjectId: 'cccccccc-0000-4000-8000-000000000003' },
    { proof: 'invalid' },
  ])('rejects tampered proof inputs before redemption', async (change) => {
    expect((await send(change)).statusCode).toBeGreaterThanOrEqual(400);
    expect(enrollTeamAgent).not.toHaveBeenCalled();
    expect(identityApi.getIdentity).not.toHaveBeenCalled();
  });

  it('binds the idempotency header to the proof', async () => {
    expect(
      (await send({}, 'another-request')).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(enrollTeamAgent).not.toHaveBeenCalled();
  });

  it('rejects inactive identities before redemption', async () => {
    identityApi.getIdentity.mockResolvedValue({ state: 'inactive' });
    expect((await send()).statusCode).toBe(401);
    expect(enrollTeamAgent).not.toHaveBeenCalled();
  });

  it('rejects absent identities before proof verification', async () => {
    mocks.agentRepository.findById.mockResolvedValue(null);
    expect((await send()).statusCode).toBe(401);
    expect(enrollTeamAgent).not.toHaveBeenCalled();
  });
});
