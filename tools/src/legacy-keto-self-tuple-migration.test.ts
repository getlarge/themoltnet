import { describe, expect, it, vi } from 'vitest';

import type { KetoTuple } from './legacy-keto-self-tuple-migration.js';
import { migrateLegacySelfTuples } from './legacy-keto-self-tuple-migration.js';

const legacyAgent: KetoTuple = {
  namespace: 'Agent',
  object: 'agent-1',
  relation: 'self',
  subject_id: 'agent-1',
};

function adapters(items: KetoTuple[]) {
  return {
    listTuples: vi.fn().mockResolvedValue({ items }),
    putTuple: vi.fn().mockResolvedValue(undefined),
    tupleExists: vi.fn().mockResolvedValue(true),
    checkSelfPermission: vi.fn().mockResolvedValue(true),
    deleteTuple: vi.fn().mockResolvedValue(undefined),
  };
}

describe('migrateLegacySelfTuples', () => {
  it('reports unknown direct subjects and changes only matching typed self tuples', async () => {
    const api = adapters([
      legacyAgent,
      {
        namespace: 'Team',
        object: 'team-1',
        relation: 'owners',
        subject_id: 'agent-1',
      },
    ]);

    const result = await migrateLegacySelfTuples(api, 'apply');

    expect(result.counts).toMatchObject({
      directSubjects: 2,
      migratable: 1,
      unknown: 1,
      copied: 1,
      verified: 1,
      deleted: 1,
    });
    expect(api.putTuple).toHaveBeenCalledWith({
      namespace: 'Agent',
      object: 'agent-1',
      relation: 'self',
      subject_set: { namespace: 'Agent', object: 'agent-1', relation: '' },
    });
    expect(api.deleteTuple).toHaveBeenCalledWith(legacyAgent);
    expect(result.unknown).toEqual([
      { namespace: 'Team', object: 'team-1', relation: 'owners' },
    ]);
  });

  it('does not copy, verify, or delete during a dry run', async () => {
    const api = adapters([legacyAgent]);

    const result = await migrateLegacySelfTuples(api, 'dry-run');

    expect(result.counts).toMatchObject({
      migratable: 1,
      copied: 0,
      deleted: 0,
    });
    expect(api.putTuple).not.toHaveBeenCalled();
    expect(api.tupleExists).not.toHaveBeenCalled();
    expect(api.deleteTuple).not.toHaveBeenCalled();
  });

  it('keeps the legacy tuple when replacement verification fails', async () => {
    const api = adapters([legacyAgent]);
    api.checkSelfPermission.mockResolvedValue(false);

    const result = await migrateLegacySelfTuples(api, 'apply');

    expect(result.counts).toMatchObject({
      copied: 1,
      verified: 0,
      deleted: 0,
      failed: 1,
    });
    expect(api.deleteTuple).not.toHaveBeenCalled();
  });
});
