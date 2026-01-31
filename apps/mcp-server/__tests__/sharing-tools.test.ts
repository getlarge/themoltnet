import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockServices,
  createMockDeps,
  createMockEntry,
  createMockAgent,
  parseResult,
  getTextContent,
  OWNER_ID,
  ENTRY_ID,
  OTHER_AGENT_ID,
  type MockServices,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleDiarySetVisibility,
  handleDiaryShare,
  handleDiarySharedWithMe,
} from '../src/sharing-tools.js';

describe('Sharing tools', () => {
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
  });

  describe('diary_set_visibility', () => {
    it('updates entry visibility', async () => {
      const updated = createMockEntry({ visibility: 'moltnet' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const result = await handleDiarySetVisibility(deps, {
        entry_id: ENTRY_ID,
        visibility: 'moltnet',
      });

      expect(mocks.diaryService.update).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        { visibility: 'moltnet' },
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed.entry.visibility).toBe('moltnet');
    });

    it('returns error when entry not found', async () => {
      mocks.diaryService.update.mockResolvedValue(null);

      const result = await handleDiarySetVisibility(deps, {
        entry_id: 'nonexistent',
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const result = await handleDiarySetVisibility(unauthDeps, {
        entry_id: ENTRY_ID,
        visibility: 'public',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('diary_share', () => {
    it('shares an entry with another agent', async () => {
      const agent = createMockAgent({
        identityId: OTHER_AGENT_ID,
        moltbookName: 'Gemini',
      });
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);
      mocks.diaryService.share.mockResolvedValue(true);

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Gemini',
      });

      expect(mocks.agentRepository.findByMoltbookName).toHaveBeenCalledWith(
        'Gemini',
      );
      expect(mocks.diaryService.share).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        OTHER_AGENT_ID,
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when target agent not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const result = await handleDiaryShare(deps, {
        entry_id: ENTRY_ID,
        with_agent: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when share fails', async () => {
      const agent = createMockAgent({
        identityId: OTHER_AGENT_ID,
        moltbookName: 'Gemini',
      });
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);
      mocks.diaryService.share.mockResolvedValue(false);

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
      const entries = [createMockEntry({ ownerId: OTHER_AGENT_ID })];
      mocks.diaryService.getSharedWithMe.mockResolvedValue(entries);

      const result = await handleDiarySharedWithMe(deps, {});

      expect(mocks.diaryService.getSharedWithMe).toHaveBeenCalledWith(
        OWNER_ID,
        20,
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('entries');
      expect(parsed.entries).toHaveLength(1);
    });

    it('passes custom limit', async () => {
      mocks.diaryService.getSharedWithMe.mockResolvedValue([]);

      await handleDiarySharedWithMe(deps, { limit: 5 });

      expect(mocks.diaryService.getSharedWithMe).toHaveBeenCalledWith(
        OWNER_ID,
        5,
      );
    });
  });
});
