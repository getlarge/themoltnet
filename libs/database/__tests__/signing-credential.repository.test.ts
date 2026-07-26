import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createSigningCredentialRepository } from '../src/repositories/signing-credential.repository.js';
import type { SigningCredential } from '../src/schema.js';
import {
  createDrizzleTransactionRunner,
  type TransactionRunner,
} from '../src/transaction-context.js';

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
    'for',
  ]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.returning.mockResolvedValue([]);
  const db = {
    insert: vi.fn().mockReturnValue(chain),
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    delete: vi.fn().mockReturnValue(chain),
    transaction: vi.fn(),
  };
  db.transaction.mockImplementation(
    async (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );
  return { db: db as unknown as Database, chain };
}

const ID = '770e8400-e29b-41d4-a716-446655440002';
const HUMAN_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEAM_ID = '660e8400-e29b-41d4-a716-446655440001';

const credential: SigningCredential = {
  id: ID,
  ownerAgentId: null,
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
  let transactionRunner: TransactionRunner;

  beforeEach(() => {
    db = createMockDb();
    repository = createSigningCredentialRepository(db.db);
    transactionRunner = createDrizzleTransactionRunner(db.db);
  });

  it('creates a pending-approval human credential', async () => {
    db.chain.returning.mockResolvedValueOnce([credential]);

    const result = await repository.create({
      owner: { kind: 'human', id: HUMAN_ID },
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
      expect.objectContaining({
        ownerAgentId: null,
        ownerHumanId: HUMAN_ID,
      }),
    );
    expect(db.chain.values).not.toHaveBeenCalledWith(
      expect.objectContaining({ owner: expect.anything() }),
    );
    expect(db.chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: ID,
        actorHumanId: HUMAN_ID,
        fromStatus: 'pending_approval',
        toStatus: 'pending_approval',
        reason: 'credential_enrolled',
      }),
    );
    expect(result).toEqual(credential);
  });

  it('maps an agent owner to the concrete agent FK', async () => {
    db.chain.returning.mockResolvedValueOnce([
      { ...credential, ownerAgentId: ID, ownerHumanId: null },
    ]);

    await repository.create({
      owner: { kind: 'agent', id: ID },
      teamId: TEAM_ID,
      verificationMethod: 'human-hardware-previewsign',
      credentialType: 'test',
      algorithm: 'test',
      publicMaterial: { version: 1, publicKey: 'public' },
      enrollmentEvidence: { version: 1, proof: 'proof' },
      label: 'Agent-owned test credential',
      status: 'pending_approval',
    });

    expect(db.chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerAgentId: ID,
        ownerHumanId: null,
      }),
    );
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
    db.chain.for.mockResolvedValueOnce([{ status: 'pending_approval' }]);
    db.chain.returning.mockResolvedValueOnce([
      { ...credential, status: 'active' },
    ]);

    const result = await transactionRunner.runInTransaction(() =>
      repository.transition({
        id: ID,
        teamId: TEAM_ID,
        from: ['pending_approval'],
        to: 'active',
        approvedByHumanId: HUMAN_ID,
        actor: { kind: 'human', id: ID },
      }),
    );

    expect(db.chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        approvedByHumanId: HUMAN_ID,
      }),
    );
    expect(result?.credential.status).toBe('active');
    expect(result?.fromStatus).toBe('pending_approval');
    expect(db.db.insert).toHaveBeenCalled();
  });

  it('preserves the original approver on suspend', async () => {
    db.chain.for.mockResolvedValueOnce([{ status: 'active' }]);
    db.chain.returning.mockResolvedValueOnce([
      {
        ...credential,
        status: 'suspended',
        approvedByHumanId: HUMAN_ID,
      },
    ]);

    await transactionRunner.runInTransaction(() =>
      repository.transition({
        id: ID,
        teamId: TEAM_ID,
        from: ['active'],
        to: 'suspended',
        actor: { kind: 'agent', id: ID },
      }),
    );

    expect(db.chain.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ approvedByHumanId: expect.anything() }),
    );
  });

  it('rejects self-approval at the repository boundary', async () => {
    db.chain.for.mockResolvedValueOnce([]);

    await expect(
      transactionRunner.runInTransaction(() =>
        repository.transition({
          id: ID,
          teamId: TEAM_ID,
          from: ['pending_approval'],
          to: 'active',
          approvedByHumanId: HUMAN_ID,
          actor: { kind: 'human', id: HUMAN_ID },
        }),
      ),
    ).resolves.toBeNull();

    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('rejects approval by an agent at the repository boundary', async () => {
    await expect(
      repository.transition({
        id: ID,
        teamId: TEAM_ID,
        from: ['pending_approval'],
        to: 'active',
        actor: { kind: 'agent', id: ID },
      }),
    ).resolves.toBeNull();

    expect(db.db.select).not.toHaveBeenCalled();
    expect(db.db.update).not.toHaveBeenCalled();
  });

  it('requires an active transaction for lifecycle transitions', async () => {
    await expect(
      repository.transition({
        id: ID,
        teamId: TEAM_ID,
        from: ['active'],
        to: 'suspended',
        actor: { kind: 'human', id: ID },
      }),
    ).rejects.toThrow('TransactionRunner-managed transaction');

    expect(db.db.select).not.toHaveBeenCalled();
  });
});
