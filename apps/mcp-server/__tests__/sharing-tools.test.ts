import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDiarySetVisibility } from '../src/sharing-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  ENTRY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  setDiaryEntryVisibility: vi.fn(),
}));

import { setDiaryEntryVisibility } from '@moltnet/api-client';

describe('Sharing tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('diary_set_visibility', () => {
    it('updates entry visibility', async () => {
      const updated = { id: ENTRY_ID, visibility: 'moltnet' };
      vi.mocked(setDiaryEntryVisibility).mockResolvedValue(
        sdkOk(updated) as never,
      );

      const result = await handleDiarySetVisibility(
        { diary_ref: 'private', entry_id: ENTRY_ID, visibility: 'moltnet' },
        deps,
        context,
      );

      expect(setDiaryEntryVisibility).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private', id: ENTRY_ID },
          body: { visibility: 'moltnet' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(setDiaryEntryVisibility).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiarySetVisibility(
        { diary_ref: 'private', entry_id: 'nonexistent', visibility: 'public' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleDiarySetVisibility(
        { diary_ref: 'private', entry_id: ENTRY_ID, visibility: 'public' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
    });
  });
});
