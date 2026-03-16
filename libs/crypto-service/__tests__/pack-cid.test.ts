import { CID } from 'multiformats/cid';
import { describe, expect, it } from 'vitest';

import { computeContentCid } from '../src/content-cid.js';
import {
  buildPackEnvelope,
  type CompileParams,
  computePackCid,
  decodePackEnvelope,
  type PackEntryRef,
  type PackEnvelopeInput,
} from '../src/pack-cid.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntryCid(content: string, index: number): string {
  return computeContentCid('semantic', `Entry ${index}`, content, [
    `tag-${index}`,
  ]);
}

const ENTRY_CIDS = [
  makeEntryCid('First entry about authentication patterns', 0),
  makeEntryCid('Second entry about database schema design', 1),
  makeEntryCid('Third entry about testing conventions', 2),
];

type CompileInputOverrides = {
  diaryId?: string;
  createdBy?: string;
  createdAt?: string;
  params?: CompileParams;
  entries?: PackEntryRef[];
};

function makeCompileInput(
  overrides?: CompileInputOverrides,
): PackEnvelopeInput {
  return {
    diaryId: overrides?.diaryId ?? '550e8400-e29b-41d4-a716-446655440000',
    createdBy: overrides?.createdBy ?? '660e8400-e29b-41d4-a716-446655440001',
    createdAt: overrides?.createdAt ?? '2026-03-15T12:00:00.000Z',
    packType: 'compile',
    params: overrides?.params ?? {
      tokenBudget: 4000,
      lambda: 0.5,
      taskPromptHash: 'abc123',
    },
    entries: overrides?.entries ?? [
      { cid: ENTRY_CIDS[0], compressionLevel: 'full', rank: 1 },
      { cid: ENTRY_CIDS[1], compressionLevel: 'summary', rank: 2 },
      { cid: ENTRY_CIDS[2], compressionLevel: 'keywords', rank: 3 },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildPackEnvelope', () => {
  it('produces deterministic bytes for the same input', () => {
    const input = makeCompileInput();
    const bytes1 = buildPackEnvelope(input);
    const bytes2 = buildPackEnvelope(input);
    expect(bytes1).toEqual(bytes2);
  });

  it('produces different bytes when entry CIDs differ', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      entries: [
        {
          cid: makeEntryCid('Different content entirely', 99),
          compressionLevel: 'full',
          rank: 1,
        },
        ...input1.entries.slice(1),
      ],
    });
    const bytes1 = buildPackEnvelope(input1);
    const bytes2 = buildPackEnvelope(input2);
    expect(bytes1).not.toEqual(bytes2);
  });

  it('is order-independent — entries are sorted by rank', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      entries: [...input1.entries].reverse(),
    });
    const bytes1 = buildPackEnvelope(input1);
    const bytes2 = buildPackEnvelope(input2);
    expect(bytes1).toEqual(bytes2);
  });

  it('strips undefined params — CID stable regardless of explicit undefined', () => {
    const input1 = makeCompileInput({
      params: { tokenBudget: 4000, lambda: 0.5, taskPromptHash: undefined },
    });
    const input2 = makeCompileInput({
      params: { tokenBudget: 4000, lambda: 0.5 },
    });
    expect(buildPackEnvelope(input1)).toEqual(buildPackEnvelope(input2));
    expect(computePackCid(input1)).toBe(computePackCid(input2));
  });

  it('round-trips through decode', () => {
    const input = makeCompileInput();
    const bytes = buildPackEnvelope(input);
    const decoded = decodePackEnvelope(bytes) as Record<string, unknown>;

    expect(decoded).toHaveProperty('v', 'moltnet:pack:v1');
    expect(decoded).toHaveProperty('diaryId', input.diaryId);
    expect(decoded).toHaveProperty('createdBy', input.createdBy);
    expect(decoded).toHaveProperty('createdAt', input.createdAt);
    expect(decoded).toHaveProperty('packType', 'compile');
    expect(decoded).toHaveProperty('params');
    expect(decoded).toHaveProperty('entries');

    const entries = decoded['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
    // Entries should be sorted by rank
    expect(entries[0]).toHaveProperty('rank', 1);
    expect(entries[1]).toHaveProperty('rank', 2);
    expect(entries[2]).toHaveProperty('rank', 3);
  });

  it('embeds entry CIDs as IPLD CID links, not strings', () => {
    const input = makeCompileInput();
    const bytes = buildPackEnvelope(input);
    const decoded = decodePackEnvelope(bytes) as Record<string, unknown>;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;

    // DAG-CBOR decodes CID links back to CID objects
    for (const entry of entries) {
      expect(entry['cid']).toBeInstanceOf(CID);
    }
  });
});

describe('computePackCid', () => {
  it('produces a CIDv1 string starting with "bafy" (dag-cbor prefix)', () => {
    const cid = computePackCid(makeCompileInput());
    // dag-cbor CIDs start with "bafy" in base32lower (vs "bafk" for raw)
    expect(cid).toMatch(/^bafy/);
  });

  it('is deterministic', () => {
    const input = makeCompileInput();
    const cid1 = computePackCid(input);
    const cid2 = computePackCid(input);
    expect(cid1).toBe(cid2);
  });

  it('changes when any entry CID changes', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      entries: [
        {
          cid: makeEntryCid('Completely different content', 42),
          compressionLevel: 'full',
          rank: 1,
        },
        ...input1.entries.slice(1),
      ],
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('changes when compression level changes', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      entries: [
        { ...input1.entries[0], compressionLevel: 'keywords' },
        ...input1.entries.slice(1),
      ],
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('changes when parameters change', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      params: { tokenBudget: 8000, lambda: 0.7 },
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('changes when diaryId changes', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      diaryId: '770e8400-e29b-41d4-a716-446655440099',
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('changes when createdBy changes', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      createdBy: '880e8400-e29b-41d4-a716-446655440099',
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('changes when createdAt changes', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      createdAt: '2026-03-16T00:00:00.000Z',
    });
    expect(computePackCid(input1)).not.toBe(computePackCid(input2));
  });

  it('is stable across entry reordering (sorted by rank)', () => {
    const input1 = makeCompileInput();
    const input2 = makeCompileInput({
      entries: [...input1.entries].reverse(),
    });
    expect(computePackCid(input1)).toBe(computePackCid(input2));
  });

  it('produces a valid CIDv1 that round-trips through parse', () => {
    const cidStr = computePackCid(makeCompileInput());
    const parsed = CID.parse(cidStr);
    expect(parsed.version).toBe(1);
    expect(parsed.code).toBe(0x71); // dag-cbor codec
    expect(parsed.multihash.code).toBe(0x12); // sha2-256
    expect(parsed.multihash.digest.length).toBe(32);
    expect(parsed.toString()).toBe(cidStr);
  });

  it('works with optimized pack type', () => {
    const sourcePackCid = computePackCid(makeCompileInput());
    const input: PackEnvelopeInput = {
      diaryId: '550e8400-e29b-41d4-a716-446655440000',
      createdBy: '660e8400-e29b-41d4-a716-446655440001',
      createdAt: '2026-03-15T13:00:00.000Z',
      packType: 'optimized',
      params: {
        sourcePackCid,
        gepaTrials: 8,
        gepaScore: 0.85,
        teacherModel: 'gpt-4o-mini',
      },
      entries: [{ cid: ENTRY_CIDS[0], compressionLevel: 'full', rank: 1 }],
    };
    const cid = computePackCid(input);
    expect(cid).toMatch(/^bafy/);
    expect(cid).not.toBe(sourcePackCid);
  });
});

describe('decodePackEnvelope', () => {
  it('recovers all fields from encoded bytes', () => {
    const input = makeCompileInput();
    const bytes = buildPackEnvelope(input);
    const decoded = decodePackEnvelope(bytes) as Record<string, unknown>;

    expect(decoded['v']).toBe('moltnet:pack:v1');
    expect(decoded['diaryId']).toBe(input.diaryId);
    expect(decoded['createdBy']).toBe(input.createdBy);
    expect(decoded['createdAt']).toBe(input.createdAt);
    expect(decoded['packType']).toBe('compile');

    const params = decoded['params'] as Record<string, unknown>;
    expect(params['tokenBudget']).toBe(4000);
    expect(params['lambda']).toBe(0.5);
    expect(params['taskPromptHash']).toBe('abc123');

    const entries = decoded['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);

    // Verify each entry CID matches the original
    for (let i = 0; i < entries.length; i++) {
      const entryCid = entries[i]['cid'] as CID;
      expect(entryCid.toString()).toBe(ENTRY_CIDS[i]);
    }
  });

  it('recomputing CID from decoded envelope matches original', () => {
    const input = makeCompileInput();
    const originalCid = computePackCid(input);

    // Decode and re-encode should produce the same bytes (and same CID)
    const bytes = buildPackEnvelope(input);
    const decoded = decodePackEnvelope(bytes) as Record<string, unknown>;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;

    const reconstructedInput: PackEnvelopeInput = {
      diaryId: decoded['diaryId'] as string,
      createdBy: decoded['createdBy'] as string,
      createdAt: decoded['createdAt'] as string,
      packType: decoded['packType'] as 'compile',
      params: decoded['params'] as CompileParams,
      entries: entries.map((entry) => ({
        cid: (entry['cid'] as CID).toString(),
        compressionLevel: entry[
          'compressionLevel'
        ] as PackEntryRef['compressionLevel'],
        rank: entry['rank'] as number,
      })),
    };

    expect(computePackCid(reconstructedInput)).toBe(originalCid);
  });
});

describe('entry CID → pack CID provenance chain', () => {
  it('pack CID transitively commits to entry content', () => {
    // If entry content changes, entry CID changes, pack CID changes
    const entryCid1 = computeContentCid('semantic', 'Auth', 'OAuth2 flow', [
      'auth',
    ]);
    const entryCid2 = computeContentCid('semantic', 'Auth', 'OAuth3 flow', [
      'auth',
    ]);

    const packInput1 = makeCompileInput({
      entries: [{ cid: entryCid1, compressionLevel: 'full', rank: 1 }],
    });
    const packInput2 = makeCompileInput({
      entries: [{ cid: entryCid2, compressionLevel: 'full', rank: 1 }],
    });

    // Different entry content → different entry CIDs
    expect(entryCid1).not.toBe(entryCid2);
    // Different entry CIDs → different pack CIDs
    expect(computePackCid(packInput1)).not.toBe(computePackCid(packInput2));
  });

  it('drift detection: snapshot CID vs current CID', () => {
    // Simulate: entry was CID_a at pack time, then content changed to CID_b
    const originalCid = computeContentCid(
      'semantic',
      'DB Schema',
      'Use Drizzle ORM',
      ['database'],
    );
    const modifiedCid = computeContentCid(
      'semantic',
      'DB Schema',
      'Use Drizzle ORM with pgvector',
      ['database'],
    );

    // Pack was built with the original CID
    const packInput = makeCompileInput({
      entries: [{ cid: originalCid, compressionLevel: 'full', rank: 1 }],
    });
    const packCid = computePackCid(packInput);

    // Verify: recompute pack with current entry CID — should differ
    const recomputedInput = {
      ...packInput,
      entries: [
        { cid: modifiedCid, compressionLevel: 'full' as const, rank: 1 },
      ],
    };
    const recomputedCid = computePackCid(recomputedInput);

    expect(packCid).not.toBe(recomputedCid);
    // The stored packCid still matches the original snapshot
    expect(computePackCid(packInput)).toBe(packCid);
  });

  it('optimized pack references source compile pack CID', () => {
    // Step 1: compile pack
    const compileInput = makeCompileInput();
    const compileCid = computePackCid(compileInput);

    // Step 2: GEPA optimizes it → new pack
    const optimizedInput: PackEnvelopeInput = {
      diaryId: compileInput.diaryId,
      createdBy: compileInput.createdBy,
      createdAt: '2026-03-15T13:00:00.000Z',
      packType: 'optimized',
      params: {
        sourcePackCid: compileCid,
        gepaTrials: 8,
        gepaScore: 0.92,
      },
      entries: compileInput.entries, // same entries, rewritten content
    };
    const optimizedCid = computePackCid(optimizedInput);

    // Different CIDs (different createdAt, packType, params)
    expect(optimizedCid).not.toBe(compileCid);

    // Can trace back: decode optimized → params.sourcePackCid → compile pack
    const decoded = decodePackEnvelope(
      buildPackEnvelope(optimizedInput),
    ) as Record<string, unknown>;
    const params = decoded['params'] as Record<string, unknown>;
    expect(params['sourcePackCid']).toBe(compileCid);
  });
});
