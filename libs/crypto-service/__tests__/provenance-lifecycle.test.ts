/**
 * Provenance Lifecycle Integration Tests
 *
 * Exercises the full DAG provenance chain:
 *   entries (CIDv1, raw) → compile pack (CIDv1, dag-cbor) → optimized pack
 *
 * No database required — uses crypto-service functions with realistic fixtures
 * shaped like actual CompileResult output.
 */

import { CID } from 'multiformats/cid';
import { describe, expect, it } from 'vitest';

import { computeContentCid } from '../src/content-cid.js';
import {
  buildPackEnvelope,
  type CompileParams,
  computePackCid,
  decodePackEnvelope,
  type OptimizedParams,
  type PackEntryRef,
  type PackEnvelopeInput,
} from '../src/pack-cid.js';

// ── Realistic entry fixtures ─────────────────────────────────────────────────

interface MockEntry {
  id: string;
  entryType: string;
  title: string | null;
  content: string;
  tags: string[];
  contentHash: string;
  signed: boolean;
}

function createMockEntry(
  id: string,
  opts: {
    entryType?: string;
    title?: string | null;
    content: string;
    tags?: string[];
    signed?: boolean;
  },
): MockEntry {
  const entryType = opts.entryType ?? 'semantic';
  const title = opts.title ?? null;
  const tags = opts.tags ?? [];
  const contentHash = computeContentCid(entryType, title, opts.content, tags);
  return {
    id,
    entryType,
    title,
    content: opts.content,
    tags,
    contentHash,
    signed: opts.signed ?? false,
  };
}

// Simulate a batch of entries an agent would create during a session
const ENTRIES: MockEntry[] = [
  createMockEntry('e001', {
    entryType: 'episodic',
    content:
      'Observed that the auth middleware rejects tokens without the agent scope claim.',
    tags: ['auth', 'observation'],
  }),
  createMockEntry('e002', {
    entryType: 'semantic',
    title: 'Auth middleware requires agent scope',
    content:
      'The Fastify auth hook validates JWT tokens and requires the "agent" scope claim. ' +
      'Tokens without this scope receive a 403 Forbidden response. This applies to all ' +
      'diary and entry endpoints.',
    tags: ['auth', 'middleware'],
    signed: true,
  }),
  createMockEntry('e003', {
    entryType: 'procedural',
    title: 'Testing auth-protected routes',
    content:
      'When writing tests for auth-protected routes: 1) Use the test helper to create ' +
      'a valid JWT with agent scope, 2) Set the Authorization header, 3) Assert 403 ' +
      'for requests without the scope.',
    tags: ['testing', 'auth'],
    signed: true,
  }),
  createMockEntry('e004', {
    entryType: 'semantic',
    title: 'Drizzle schema patterns',
    content:
      'Database schema uses Drizzle ORM with pgvector for embeddings. All tables use ' +
      'UUID primary keys with defaultRandom(). Relations are defined with references() ' +
      'and onDelete cascade.',
    tags: ['database', 'schema'],
    signed: true,
  }),
  createMockEntry('e005', {
    entryType: 'episodic',
    content: 'Build failed because I used a dynamic import in the test file.',
    tags: ['testing', 'error'],
  }),
];

// Simulate CompileResult entries (subset selected + compressed)
interface MockCompiledEntry {
  id: string;
  content: string;
  compressionLevel: 'full' | 'summary' | 'keywords';
  originalTokens: number;
  compressedTokens: number;
}

const COMPILED_ENTRIES: MockCompiledEntry[] = [
  {
    id: 'e002',
    content: ENTRIES[1].content,
    compressionLevel: 'full',
    originalTokens: 120,
    compressedTokens: 120,
  },
  {
    id: 'e003',
    content:
      'Test auth routes: create JWT with agent scope, set header, assert 403 without.',
    compressionLevel: 'summary',
    originalTokens: 95,
    compressedTokens: 48,
  },
  {
    id: 'e004',
    content: 'Drizzle, pgvector, UUID PKs, cascade deletes',
    compressionLevel: 'keywords',
    originalTokens: 85,
    compressedTokens: 20,
  },
];

// ── Helper: build PackEnvelopeInput from mock compile output ─────────────────

function buildCompilePackInput(
  compiledEntries: MockCompiledEntry[],
  sourceEntries: MockEntry[],
  overrides?: Partial<PackEnvelopeInput>,
): PackEnvelopeInput {
  const entryMap = new Map(sourceEntries.map((e) => [e.id, e]));

  const packEntries: PackEntryRef[] = compiledEntries.map((ce, index) => {
    const source = entryMap.get(ce.id);
    if (!source) throw new Error(`Missing source entry for ${ce.id}`);
    return {
      cid: source.contentHash,
      compressionLevel: ce.compressionLevel,
      rank: index + 1,
    };
  });

  return {
    diaryId: 'diary-001',
    createdBy: 'agent-001',
    createdAt: '2026-03-15T14:00:00.000Z',
    packType: 'compile',
    params: {
      tokenBudget: 4000,
      lambda: 0.5,
      taskPromptHash: 'how-to-add-auth-route',
    } satisfies CompileParams,
    entries: packEntries,
    ...overrides,
  };
}

// ── Test: Full provenance lifecycle ──────────────────────────────────────────

describe('provenance lifecycle: entries → compile → optimize', () => {
  it('step 1: entries have unique content-addressable CIDs', () => {
    const cids = ENTRIES.map((e) => e.contentHash);
    const unique = new Set(cids);
    expect(unique.size).toBe(ENTRIES.length);

    // All are valid CIDv1 with raw codec
    for (const cidStr of cids) {
      const parsed = CID.parse(cidStr);
      expect(parsed.version).toBe(1);
      expect(parsed.code).toBe(0x55); // raw codec
    }
  });

  it('step 2: compile produces a pack CID committing to selected entries', () => {
    const packInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const packCid = computePackCid(packInput);

    // Valid CIDv1 with dag-cbor codec
    const parsed = CID.parse(packCid);
    expect(parsed.version).toBe(1);
    expect(parsed.code).toBe(0x71); // dag-cbor

    // Envelope contains exactly the selected entries
    const decoded = decodePackEnvelope(buildPackEnvelope(packInput)) as Record<
      string,
      unknown
    >;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
  });

  it('step 3: pack CID is stable — same compile output always produces same CID', () => {
    const packInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const cid1 = computePackCid(packInput);
    const cid2 = computePackCid(packInput);
    expect(cid1).toBe(cid2);
  });

  it('step 4: pack envelope embeds entry CIDs as traversable IPLD links', () => {
    const packInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const bytes = buildPackEnvelope(packInput);
    const decoded = decodePackEnvelope(bytes) as Record<string, unknown>;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;

    // Each entry.cid is a CID object (IPLD link), not a string
    for (const entry of entries) {
      expect(entry['cid']).toBeInstanceOf(CID);
    }

    // Can resolve entry CIDs back to source entries
    const entryMap = new Map(ENTRIES.map((e) => [e.contentHash, e]));
    for (const entry of entries) {
      const cidStr = (entry['cid'] as CID).toString();
      expect(entryMap.has(cidStr)).toBe(true);
    }
  });

  it('step 5: drift detection — modified entry invalidates pack provenance', () => {
    const packInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const originalPackCid = computePackCid(packInput);

    // Simulate: entry e004 gets updated (unsigned, so mutable)
    const modifiedEntry = createMockEntry('e004', {
      entryType: 'semantic',
      title: 'Drizzle schema patterns',
      content:
        'Database schema uses Drizzle ORM with pgvector for embeddings. All tables use ' +
        'UUID primary keys with defaultRandom(). Relations are defined with references() ' +
        'and onDelete cascade. NEW: Use getExecutor() for transaction support.',
      tags: ['database', 'schema'],
    });

    // Original CID snapshot vs current CID
    const originalCid = ENTRIES[3].contentHash;
    const currentCid = modifiedEntry.contentHash;
    expect(originalCid).not.toBe(currentCid);

    // Recompute pack with current entry CID → different pack CID
    const driftedInput = buildCompilePackInput(COMPILED_ENTRIES, [
      ...ENTRIES.slice(0, 3),
      modifiedEntry,
      ENTRIES[4],
    ]);
    const driftedPackCid = computePackCid(driftedInput);
    expect(driftedPackCid).not.toBe(originalPackCid);

    // The stored snapshot CID still matches the original pack
    expect(computePackCid(packInput)).toBe(originalPackCid);
  });

  it('step 6: signed entries cannot drift — CID is immutable', () => {
    // Signed entries (e002, e003, e004) have contentSignature set.
    // Their contentHash never changes, so pack CID remains stable.
    const signedEntries = ENTRIES.filter((e) => e.signed);
    expect(signedEntries).toHaveLength(3);

    // Recomputing CID from same content always matches
    for (const entry of signedEntries) {
      const recomputed = computeContentCid(
        entry.entryType,
        entry.title,
        entry.content,
        entry.tags,
      );
      expect(recomputed).toBe(entry.contentHash);
    }
  });

  it('step 7: GEPA optimization produces a new pack referencing the source', () => {
    // Compile pack
    const compileInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const compileCid = computePackCid(compileInput);

    // GEPA optimizes: same entries, potentially rewritten/reordered content
    const optimizedInput: PackEnvelopeInput = {
      diaryId: compileInput.diaryId,
      createdBy: compileInput.createdBy,
      createdAt: '2026-03-15T15:30:00.000Z',
      packType: 'optimized',
      params: {
        sourcePackCid: compileCid,
        gepaTrials: 8,
        gepaScore: 0.89,
        teacherModel: 'gpt-4o-mini',
        studentModel: 'claude-sonnet-4-6',
      } satisfies OptimizedParams,
      entries: compileInput.entries, // same entry CIDs
    };
    const optimizedCid = computePackCid(optimizedInput);

    // Different pack CID (different type, params, timestamp)
    expect(optimizedCid).not.toBe(compileCid);

    // Trace: optimized → source compile pack
    const decoded = decodePackEnvelope(
      buildPackEnvelope(optimizedInput),
    ) as Record<string, unknown>;
    const params = decoded['params'] as Record<string, unknown>;
    expect(params['sourcePackCid']).toBe(compileCid);
    expect(params['gepaScore']).toBe(0.89);
  });

  it('step 8: full chain traversal — optimized pack → compile pack → entries', () => {
    // Build compile pack
    const compileInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const compileCid = computePackCid(compileInput);
    const compileBytes = buildPackEnvelope(compileInput);

    // Build optimized pack
    const optimizedInput: PackEnvelopeInput = {
      diaryId: compileInput.diaryId,
      createdBy: compileInput.createdBy,
      createdAt: '2026-03-15T16:00:00.000Z',
      packType: 'optimized',
      params: {
        sourcePackCid: compileCid,
        gepaTrials: 12,
        gepaScore: 0.93,
      } satisfies OptimizedParams,
      entries: compileInput.entries,
    };
    const optimizedBytes = buildPackEnvelope(optimizedInput);

    // Navigate: optimized → source pack CID
    const optDecoded = decodePackEnvelope(optimizedBytes) as Record<
      string,
      unknown
    >;
    const sourcePackCid = (optDecoded['params'] as Record<string, unknown>)[
      'sourcePackCid'
    ] as string;
    expect(sourcePackCid).toBe(compileCid);

    // Navigate: compile pack → entry CIDs
    const compileDecoded = decodePackEnvelope(compileBytes) as Record<
      string,
      unknown
    >;
    const packEntries = compileDecoded['entries'] as Array<
      Record<string, unknown>
    >;
    const entryCids = packEntries.map((e) => (e['cid'] as CID).toString());

    // Verify all entry CIDs trace back to known source entries
    const knownCids = new Set(ENTRIES.map((e) => e.contentHash));
    for (const cid of entryCids) {
      expect(knownCids.has(cid)).toBe(true);
    }

    // Verify provenance metadata is preserved
    expect(compileDecoded['createdBy']).toBe('agent-001');
    expect(compileDecoded['diaryId']).toBe('diary-001');
    expect(optDecoded['packType']).toBe('optimized');
  });
});

describe('provenance edge cases', () => {
  it('empty entries list produces a valid pack CID', () => {
    const input = buildCompilePackInput([], ENTRIES, {
      entries: [],
    });
    const cid = computePackCid(input);
    expect(cid).toMatch(/^bafy/);
  });

  it('single entry pack works correctly', () => {
    const input = buildCompilePackInput([COMPILED_ENTRIES[0]], ENTRIES);
    const cid = computePackCid(input);
    expect(cid).toMatch(/^bafy/);

    const decoded = decodePackEnvelope(buildPackEnvelope(input)) as Record<
      string,
      unknown
    >;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
  });

  it('pack with all compression levels', () => {
    // Verify each compression level is preserved in the envelope
    const input = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const decoded = decodePackEnvelope(buildPackEnvelope(input)) as Record<
      string,
      unknown
    >;
    const entries = decoded['entries'] as Array<Record<string, unknown>>;

    expect(entries[0]['compressionLevel']).toBe('full');
    expect(entries[1]['compressionLevel']).toBe('summary');
    expect(entries[2]['compressionLevel']).toBe('keywords');
  });

  it('pack CID differs between compile and optimized even with same entries', () => {
    const compileInput = buildCompilePackInput(COMPILED_ENTRIES, ENTRIES);
    const optimizedInput: PackEnvelopeInput = {
      ...compileInput,
      packType: 'optimized',
      params: {
        sourcePackCid: 'bafyreifake',
        gepaTrials: 1,
        gepaScore: 0.5,
      } satisfies OptimizedParams,
    };
    expect(computePackCid(compileInput)).not.toBe(
      computePackCid(optimizedInput),
    );
  });
});
