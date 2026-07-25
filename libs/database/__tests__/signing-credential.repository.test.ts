import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createSigningCredentialRepository } from '../src/repositories/signing-credential.repository.js';
import type { SigningCredential } from '../src/schema.js';

function createMockDb() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'values',
    'returning',
    'from',
    'where',
    'limit',
    'offset',
    'orderBy',
    'set',
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.returning.mockResolvedValue([]);
  const db = {
    insert: vi.fn().mockReturnValue(chain),
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
  };
  return { db: db as unknown as Database, chain };
}

const ID = '770e8400-e29b-41d4-a716-446655440002';
const HUMAN_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEAM_ID = '660e8400-e29b-41d4-a716-446655440001';

const credential: SigningCredential = {
  id: ID,
  ownerType: 'human',
  ownerHumanId: HUMAN_ID,
  teamId: TEAM_ID,
  verificationMethod: 'human-hardware-previewsign',
  credentialType: 'test',
  algorithm: 'test',
  publicMaterial: { version: 1, publicKey: 'public' },
  enrollmentEvidence: { version: 1, proof: 'proof' },
  label: 'Test credential',
  status: 'pending_approval',
  approvedByHumanId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  activatedAt: null,
  suspendedAt: null,
  revokedAt: null,
};

describe('createSigningCredentialRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repository: ReturnType<typeof createSigningCredentialRepository>;

  beforeEach(() => {
    db = createMockDb();
    repository = createSigningCredentialRepository(db.db);
  });

  it('creates a pending-approval human credential', async () => {
    db.chain.returning.mockResolvedValueOnce([credential]);

    const result = await repository.create({
      ownerType: 'human',
      ownerHumanId: HUMAN_ID,
      teamId: TEAM_ID,
      verificationMethod: 'human-hardware-previewsign',
      credentialType: 'test',
      algorithm: 'test',
      publicMaterial: { version: 1, publicKey: 'public' },
      enrollmentEvidence: { version: 1, proof: 'proof' },
      label: 'Test credential',
      status: 'pending_approval',
    });

    expect(db.chain.values).toHaveBeenCalledWith(
      expect.not.objectContaining({
        privateKey: expect.anything(),
      }),
    );
    expect(result).toEqual(credential);
  });

  it('consumes an enrollment registration through a conditional update', async () => {
    db.chain.returning.mockResolvedValueOnce([]);

    await expect(
      repository.consumeRegistration(ID, HUMAN_ID),
    ).resolves.toBeNull();
    expect(db.chain.set).toHaveBeenCalledWith({
      consumedAt: expect.any(Date),
    });
  });

  it('only transitions from explicitly allowed lifecycle states', async () => {
    db.chain.returning.mockResolvedValueOnce([
      { ...credential, status: 'active' },
    ]);

    const result = await repository.transition({
      id: ID,
      teamId: TEAM_ID,
      from: ['pending_approval'],
      to: 'active',
      approvedByHumanId: HUMAN_ID,
    });

    expect(db.chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        approvedByHumanId: HUMAN_ID,
      }),
    );
    expect(result?.status).toBe('active');
  });
});
