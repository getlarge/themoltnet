import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockApi,
  createMockDeps,
  okResponse,
  errorResponse,
  parseResult,
  getTextContent,
  TOKEN,
  ENTRY_ID,
  type MockApi,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleDiarySetVisibility,
  handleDiaryShare,
  handleDiarySharedWithMe,
} from '../src/sharing-tools.js';

describe('Sharing tools', () => {
  let api: MockApi;
  let deps: McpDeps;

  beforeEach(() => {
    api = createMockApi();
    deps = createMockDeps(api);
  });

  describe('diary_set_visibility', () => {
    it('updates entry visibility', async () => {
      const updated = { id: ENTRY_ID, visibility: 'moltnet' };
      api.patch.mockResolvedValue(okResponse(updated));

      const result = await handleDiarySetVisibility(deps, {
        entry_id: ENTRY_ID,
        visibility: 'moltnet',
      });

      expect(api.patch).toHaveBeenCalledWith(
        `/diary/entries/${ENTRY_ID}/visibility`,
        TOKEN,
        { visibility: 'moltnet' },
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      api.patch.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }),
      );

      const result = await handleDiarySetVisibility(deps, {
        entry_id: 'nonexistent',
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(api, null);
      const result = await handleDiarySetVisibility(unauthDeps, {
        entry_id: ENTRY_ID,
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('diary_share', () => {
    it('shares an entry with another agent', async () => {
      api.post.mockResolvedValue(
        okResponse({ success: true, sharedWith: 'Gemini' }),
      );

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Gemini',
      });

      expect(api.post).toHaveBeenCalledWith(
        `/diary/entries/${ENTRY_ID}/share`,
        TOKEN,
        { sharedWith: 'Gemini' },
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when target agent not found', async () => {
      api.post.mockResolvedValue({
        status: 404,
        ok: false,
        data: { message: 'Agent not found on MoltNet' },
      });

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when share fails', async () => {
      api.post.mockResolvedValue(
        errorResponse(403, {
          error: 'Forbidden',
          message: 'Not the owner',
          statusCode: 403,
        }),
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
      api.get.mockResolvedValue(okResponse(data));

      const result = await handleDiarySharedWithMe(deps, {});

      expect(api.get).toHaveBeenCalledWith('/diary/shared-with-me', TOKEN, {
        limit: 20,
      });
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('entries');
      expect(parsed.entries).toHaveLength(1);
    });

    it('passes custom limit', async () => {
      api.get.mockResolvedValue(okResponse({ entries: [] }));

      await handleDiarySharedWithMe(deps, { limit: 5 });

      expect(api.get).toHaveBeenCalledWith('/diary/shared-with-me', TOKEN, {
        limit: 5,
      });
    });
  });
});
