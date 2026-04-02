import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db.js';
import { createAttestationRepository } from '../src/repositories/attestation.repository.js';

function createMockDb() {
  const mockChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
  };
  return {
    insert: vi.fn().mockReturnValue(mockChain),
    select: vi.fn().mockReturnValue(mockChain),
    _chain: mockChain,
  } as unknown as Database & { _chain: typeof mockChain };
}

describe('createAttestationRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: ReturnType<typeof createAttestationRepository>;

  beforeEach(() => {
    db = createMockDb();
    repo = createAttestationRepository(db);
  });

  it('create inserts and returns an attestation', async () => {
    const mockAttestation = {
      id: '00000000-0000-0000-0000-000000000001',
      renderedPackId: '00000000-0000-0000-0000-000000000002',
      coverage: 0.86,
      grounding: 0.93,
      faithfulness: 1,
      composite: 0.86,
      judgeModel: 'claude-sonnet-4-6',
      judgeProvider: 'claude-code',
      judgeBinaryCid: 'sha256:abc123',
      rubricCid: null,
      createdBy: '00000000-0000-0000-0000-000000000003',
      transcript: 'Step 1...',
      createdAt: new Date(),
    };
    db._chain.returning.mockResolvedValue([mockAttestation]);

    const result = await repo.create({
      renderedPackId: mockAttestation.renderedPackId,
      coverage: mockAttestation.coverage,
      grounding: mockAttestation.grounding,
      faithfulness: mockAttestation.faithfulness,
      composite: mockAttestation.composite,
      judgeModel: mockAttestation.judgeModel,
      judgeProvider: mockAttestation.judgeProvider,
      judgeBinaryCid: mockAttestation.judgeBinaryCid,
      rubricCid: null,
      createdBy: mockAttestation.createdBy,
      transcript: mockAttestation.transcript,
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockAttestation);
  });

  it('findByRenderedPackId returns attestations ordered by composite desc', async () => {
    const mockAttestations = [
      { id: '1', composite: 0.93 },
      { id: '2', composite: 0.86 },
    ];
    db._chain.orderBy.mockResolvedValueOnce(mockAttestations);

    const result = await repo.findByRenderedPackId('pack-id');

    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual(mockAttestations);
  });

  it('findBestByRenderedPackId returns the highest composite', async () => {
    const best = { id: '1', composite: 0.93 };
    db._chain.limit.mockResolvedValue([best]);

    const result = await repo.findBestByRenderedPackId('pack-id');

    expect(result).toEqual(best);
  });

  it('findBestByRenderedPackId returns null when none exist', async () => {
    db._chain.limit.mockResolvedValue([]);

    const result = await repo.findBestByRenderedPackId('pack-id');

    expect(result).toBeNull();
  });
});
