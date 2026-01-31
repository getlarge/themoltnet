import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDiarySetVisibility,
  handleDiaryShare,
  handleDiarySharedWithMe,
} from '../src/sharing-tools.js';
import type { McpDeps } from '../src/types.js';
import {
  createMockDeps,
  ENTRY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  setDiaryEntryVisibility: vi.fn(),
  shareDiaryEntry: vi.fn(),
  getSharedWithMe: vi.fn(),
}));

import {
  getSharedWithMe,
  setDiaryEntryVisibility,
  shareDiaryEntry,
} from '@moltnet/api-client';

describe('Sharing tools', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('diary_set_visibility', () => {
    it('updates entry visibility', async () => {
      const updated = { id: ENTRY_ID, visibility: 'moltnet' };
      vi.mocked(setDiaryEntryVisibility).mockResolvedValue(
        sdkOk(updated) as never,
      );

      const result = await handleDiarySetVisibility(deps, {
        entry_id: ENTRY_ID,
        visibility: 'moltnet',
      });

      expect(setDiaryEntryVisibility).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
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

      const result = await handleDiarySetVisibility(deps, {
        entry_id: 'nonexistent',
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(null);
      const result = await handleDiarySetVisibility(unauthDeps, {
        entry_id: ENTRY_ID,
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('diary_share', () => {
    it('shares an entry with another agent', async () => {
      vi.mocked(shareDiaryEntry).mockResolvedValue(
        sdkOk({ success: true, sharedWith: 'Gemini' }) as never,
      );

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Gemini',
      });

      expect(shareDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
          body: { sharedWith: 'Gemini' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when target agent not found', async () => {
      vi.mocked(shareDiaryEntry).mockResolvedValue(
        sdkErr(
          {
            error: 'Not Found',
            message: 'Agent not found on MoltNet',
            statusCode: 404,
          },
          404,
        ) as never,
      );

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when share fails', async () => {
      vi.mocked(shareDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Forbidden',
          message: 'Not the owner',
          statusCode: 403,
        }) as never,
      );

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Gemini',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed');
    });
  });

  describe('diary_shared_with_me', () => {
    it('lists entries shared with the agent', async () => {
      const data = {
        entries: [{ id: ENTRY_ID, content: 'shared entry' }],
      };
      vi.mocked(getSharedWithMe).mockResolvedValue(sdkOk(data) as never);

      const result = await handleDiarySharedWithMe(deps, {});

      expect(getSharedWithMe).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 20 },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('entries');
      expect(parsed.entries).toHaveLength(1);
    });

    it('passes custom limit', async () => {
      vi.mocked(getSharedWithMe).mockResolvedValue(
        sdkOk({ entries: [] }) as never,
      );

      await handleDiarySharedWithMe(deps, { limit: 5 });

      expect(getSharedWithMe).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 5 },
        }),
      );
    });
  });
});
