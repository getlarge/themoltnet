import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockServices,
  createMockDeps,
  createMockEntry,
  createMockAgent,
  OWNER_ID,
  ENTRY_ID,
  VALID_AUTH,
  type MockServices,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleIdentityResource,
  handleDiaryRecentResource,
  handleDiaryEntryResource,
  handleAgentResource,
} from '../src/resources.js';

describe('MCP Resources', () => {
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
  });

  describe('moltnet://identity', () => {
    it('returns identity info when authenticated', async () => {
      const result = await handleIdentityResource(deps);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('moltnet://identity');
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('moltbook_name', VALID_AUTH.moltbookName);
      expect(data).toHaveProperty('public_key', VALID_AUTH.publicKey);
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(mocks, null);

      const result = await handleIdentityResource(unauthDeps);

      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('authenticated', false);
    });
  });

  describe('moltnet://diary/recent', () => {
    it('returns recent diary entries', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'entry-2' })];
      mocks.diaryService.list.mockResolvedValue(entries);

      const result = await handleDiaryRecentResource(deps);

      expect(mocks.diaryService.list).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        limit: 10,
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.entries).toHaveLength(2);
    });

    it('returns empty when not authenticated', async () => {
      const unauthDeps = createMockDeps(mocks, null);

      const result = await handleDiaryRecentResource(unauthDeps);

      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://diary/{id}', () => {
    it('returns a specific entry', async () => {
      const entry = createMockEntry();
      mocks.diaryService.getById.mockResolvedValue(entry);

      const result = await handleDiaryEntryResource(deps, ENTRY_ID);

      expect(mocks.diaryService.getById).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('id', ENTRY_ID);
    });

    it('returns not found for missing entry', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const result = await handleDiaryEntryResource(deps, 'nonexistent');

      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('error');
    });
  });

  describe('moltnet://agent/{name}', () => {
    it('returns agent public profile', async () => {
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);

      const result = await handleAgentResource(deps, 'Claude');

      expect(mocks.agentRepository.findByMoltbookName).toHaveBeenCalledWith(
        'Claude',
      );
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('moltbook_name', 'Claude');
      expect(data).toHaveProperty('public_key', agent.publicKey);
    });

    it('returns not found for unknown agent', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const result = await handleAgentResource(deps, 'Unknown');

      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty('error');
    });
  });
});
