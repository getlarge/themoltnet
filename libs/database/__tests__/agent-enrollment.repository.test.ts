import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import {
  createAgentEnrollmentRepository,
  hashAgentEnrollmentToken,
} from '../src/repositories/agent-enrollment.repository.js';

function createMockDb() {
  const chain = {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };
  const db = {
    insert: vi.fn().mockReturnValue(chain),
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
  return db as unknown as Database & { _chain: typeof chain };
}

describe('createAgentEnrollmentRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repository: ReturnType<typeof createAgentEnrollmentRepository>;

  beforeEach(() => {
    db = createMockDb();
    repository = createAgentEnrollmentRepository(db);
  });

  it('stores only a lowercase SHA-256 token hash', async () => {
    db._chain.returning.mockImplementationOnce(async () => [
      {
        id: 'enrollment-id',
        tokenHash: 'stored-hash',
      },
    ]);

    const result = await repository.create({
      creator: { kind: 'agent', id: 'agent-id' },
      expiresAt: new Date(Date.now() + 900_000),
      teamId: 'team-id',
    });

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const inserted = db._chain.values.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      tokenHash: hashAgentEnrollmentToken(result.token),
      creatorAgentId: 'agent-id',
      creatorHumanId: null,
      teamId: 'team-id',
    });
    expect(JSON.stringify(inserted)).not.toContain(result.token);
  });

  it('redeems with one conditional update and no select', async () => {
    db._chain.returning.mockResolvedValueOnce([{ id: 'enrollment-id' }]);

    await expect(
      repository.redeem('ABCDEF', 'resulting-agent-id'),
    ).resolves.toMatchObject({ id: 'enrollment-id' });

    expect(db.update).toHaveBeenCalledOnce();
    expect(db.select).not.toHaveBeenCalled();
    expect(db._chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ resultingAgentId: 'resulting-agent-id' }),
    );
  });

  it('returns null when redemption loses the conditional update', async () => {
    db._chain.returning.mockResolvedValueOnce([]);
    await expect(repository.redeem('hash', 'agent-id')).resolves.toBeNull();
  });

  it('revokes only by enrollment and team', async () => {
    db._chain.returning.mockResolvedValueOnce([{ id: 'enrollment-id' }]);
    await expect(
      repository.revoke('enrollment-id', 'team-id'),
    ).resolves.toMatchObject({ id: 'enrollment-id' });
    expect(db.update).toHaveBeenCalledOnce();
  });
});
