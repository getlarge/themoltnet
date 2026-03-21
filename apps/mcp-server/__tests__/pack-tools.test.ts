import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handlePacksCreate,
  handlePacksGet,
  handlePacksList,
  handlePacksPreview,
  handlePacksProvenance,
} from '../src/pack-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryCustomPack: vi.fn(),
  getContextPackById: vi.fn(),
  listDiaryPacks: vi.fn(),
  previewDiaryCustomPack: vi.fn(),
  getContextPackProvenanceById: vi.fn(),
  getContextPackProvenanceByCid: vi.fn(),
}));

import {
  createDiaryCustomPack,
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listDiaryPacks,
  previewDiaryCustomPack,
} from '@moltnet/api-client';

const PACK_ID = '110e8400-e29b-41d4-a716-446655440005';
const PACK_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

const mockPack = {
  id: PACK_ID,
  diaryId: DIARY_ID,
  packCid: PACK_CID,
  packCodec: 'dag-cbor',
  packType: 'compile',
  params: {},
  payload: {},
  createdBy: 'agent-001',
  supersedesPackId: null,
  pinned: false,
  expiresAt: null,
  createdAt: new Date().toISOString(),
};
const mockCustomPack = {
  ...mockPack,
  packType: 'custom',
  params: {
    recipe: 'ax-agent-selected',
    taskPrompt: 'Keto authorization debugging',
  },
  compileStats: {
    originalEntries: 3,
    includedEntries: 2,
    totalTokens: 240,
    tokensSaved: 180,
  },
  entries: [
    {
      entryId: '770e8400-e29b-41d4-a716-446655440002',
      rank: 1,
      compressionLevel: 'full',
      tokenCount: 120,
    },
    {
      entryId: '770e8400-e29b-41d4-a716-446655440003',
      rank: 2,
      compressionLevel: 'summary',
      tokenCount: 120,
    },
  ],
};

describe('Pack tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('packs_get', () => {
    it('returns pack by ID', async () => {
      vi.mocked(getContextPackById).mockResolvedValue(sdkOk(mockPack) as never);

      const result = await handlePacksGet({ pack_id: PACK_ID }, deps, context);

      expect(getContextPackById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: PACK_ID },
          query: {},
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('pack');
      expect(parsed.pack).toHaveProperty('id', PACK_ID);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handlePacksGet(
        { pack_id: PACK_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when pack not found', async () => {
      vi.mocked(getContextPackById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Pack not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handlePacksGet(
        { pack_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Pack not found');
    });
  });

  describe('packs_list', () => {
    it('returns list of packs for a diary', async () => {
      const data = {
        items: [mockPack],
        total: 1,
      };
      vi.mocked(listDiaryPacks).mockResolvedValue(sdkOk(data) as never);

      const result = await handlePacksList(
        { diary_id: DIARY_ID },
        deps,
        context,
      );

      expect(listDiaryPacks).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
          query: {},
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(1);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handlePacksList(
        { diary_id: DIARY_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails', async () => {
      vi.mocked(listDiaryPacks).mockResolvedValue(
        sdkErr({
          error: 'Internal Server Error',
          message: 'Server error',
          statusCode: 500,
        }) as never,
      );

      const result = await handlePacksList(
        { diary_id: DIARY_ID },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed to list packs');
    });
  });

  describe('packs_provenance', () => {
    const mockProvenance = {
      metadata: {
        format: 'moltnet.provenance-graph/v1',
        generatedAt: '2026-01-01T00:00:00Z',
        rootNodeId: 'pack:mock-pack-id',
        rootPackId: PACK_ID,
        depth: 2,
      },
      nodes: [{ id: 'pack:mock-pack-id', kind: 'pack', label: 'test pack' }],
      edges: [],
    };

    it('returns provenance when pack_id provided', async () => {
      vi.mocked(getContextPackProvenanceById).mockResolvedValue(
        sdkOk(mockProvenance) as never,
      );

      const result = await handlePacksProvenance(
        { pack_id: PACK_ID },
        deps,
        context,
      );

      expect(getContextPackProvenanceById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: PACK_ID },
          query: {},
        }),
      );
      expect(getContextPackProvenanceByCid).not.toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('metadata');
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
    });

    it('returns provenance when pack_cid provided', async () => {
      vi.mocked(getContextPackProvenanceByCid).mockResolvedValue(
        sdkOk(mockProvenance) as never,
      );

      const result = await handlePacksProvenance(
        { pack_cid: PACK_CID },
        deps,
        context,
      );

      expect(getContextPackProvenanceByCid).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { cid: PACK_CID },
          query: {},
        }),
      );
      expect(getContextPackProvenanceById).not.toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('metadata');
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
    });

    it('returns error when neither pack_id nor pack_cid provided', async () => {
      const result = await handlePacksProvenance({}, deps, context);

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain(
        'Exactly one of pack_id or pack_cid must be provided',
      );
      expect(getContextPackProvenanceById).not.toHaveBeenCalled();
      expect(getContextPackProvenanceByCid).not.toHaveBeenCalled();
    });

    it('returns error when both pack_id and pack_cid provided', async () => {
      const result = await handlePacksProvenance(
        { pack_id: PACK_ID, pack_cid: PACK_CID },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain(
        'Exactly one of pack_id or pack_cid must be provided',
      );
      expect(getContextPackProvenanceById).not.toHaveBeenCalled();
      expect(getContextPackProvenanceByCid).not.toHaveBeenCalled();
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handlePacksProvenance(
        { pack_id: PACK_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails for pack_id lookup', async () => {
      vi.mocked(getContextPackProvenanceById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Pack not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handlePacksProvenance(
        { pack_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Pack not found');
    });

    it('returns error when API fails for pack_cid lookup', async () => {
      vi.mocked(getContextPackProvenanceByCid).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Pack not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handlePacksProvenance(
        { pack_cid: 'bafy-nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Pack not found');
    });
  });

  describe('packs_preview', () => {
    it('returns a preview for an explicit custom pack selection', async () => {
      vi.mocked(previewDiaryCustomPack).mockResolvedValue(
        sdkOk(mockCustomPack) as never,
      );

      const result = await handlePacksPreview(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [
            { entry_id: 'entry-1', rank: 1 },
            { entry_id: 'entry-2', rank: 2 },
          ],
          token_budget: 260,
        },
        deps,
        context,
      );

      expect(previewDiaryCustomPack).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
          body: {
            packType: 'custom',
            params: { recipe: 'ax-agent-selected' },
            entries: [
              { entryId: 'entry-1', rank: 1 },
              { entryId: 'entry-2', rank: 2 },
            ],
            tokenBudget: 260,
            pinned: undefined,
          },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('packType', 'custom');
      expect(parsed).toHaveProperty('entries');
    });

    it('returns error when preview request is unauthenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handlePacksPreview(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [{ entry_id: 'entry-1', rank: 1 }],
        },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns API error message when preview fails', async () => {
      vi.mocked(previewDiaryCustomPack).mockResolvedValue(
        sdkErr({
          error: 'Bad Request',
          message: 'Validation failed',
          statusCode: 400,
          detail: 'Selected entry does not belong to the diary',
        }) as never,
      );

      const result = await handlePacksPreview(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [{ entry_id: 'entry-1', rank: 1 }],
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain(
        'Selected entry does not belong to the diary',
      );
    });
  });

  describe('packs_create', () => {
    it('creates a persisted custom pack for an explicit selection', async () => {
      vi.mocked(createDiaryCustomPack).mockResolvedValue(
        sdkOk({ ...mockCustomPack, pinned: true }) as never,
      );

      const result = await handlePacksCreate(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [
            { entry_id: 'entry-1', rank: 1 },
            { entry_id: 'entry-2', rank: 2 },
          ],
          token_budget: 260,
          pinned: true,
        },
        deps,
        context,
      );

      expect(createDiaryCustomPack).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
          body: {
            packType: 'custom',
            params: { recipe: 'ax-agent-selected' },
            entries: [
              { entryId: 'entry-1', rank: 1 },
              { entryId: 'entry-2', rank: 2 },
            ],
            tokenBudget: 260,
            pinned: true,
          },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('packType', 'custom');
      expect(parsed).toHaveProperty('pinned', true);
    });

    it('returns error when create request is unauthenticated', async () => {
      const unauthContext = createMockContext(null);

      const result = await handlePacksCreate(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [{ entry_id: 'entry-1', rank: 1 }],
        },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns API error message when create fails', async () => {
      vi.mocked(createDiaryCustomPack).mockResolvedValue(
        sdkErr({
          error: 'Forbidden',
          message: 'Forbidden',
          statusCode: 403,
          detail: 'Diary not accessible',
        }) as never,
      );

      const result = await handlePacksCreate(
        {
          diary_id: DIARY_ID,
          params: { recipe: 'ax-agent-selected' },
          entries: [{ entry_id: 'entry-1', rank: 1 }],
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Diary not accessible');
    });
  });
});
