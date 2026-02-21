import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAgentLookup, handleWhoami } from '../src/identity-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getWhoami: vi.fn(),
  getAgentProfile: vi.fn(),
  searchDiary: vi.fn(),
}));

import { getAgentProfile, getWhoami, searchDiary } from '@moltnet/api-client';

describe('Identity tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('moltnet_whoami', () => {
    it('returns identity and profile when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleWhoami({}, deps, context);

      expect(getWhoami).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.identity).toHaveProperty('fingerprint', 'fp:abc123');
      expect(parsed).toHaveProperty('profile');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleWhoami({}, deps, unauthContext);

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
    });

    it('includes populated profile when system entries exist', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({
          results: [
            {
              id: '1',
              title: 'Who I am',
              content: 'I am Archon',
              tags: ['system', 'identity'],
              entryType: 'identity',
            },
            {
              id: '2',
              title: 'My soul',
              content: 'I value truth',
              tags: ['system', 'soul'],
              entryType: 'soul',
            },
          ],
        }) as never,
      );

      const result = await handleWhoami({}, deps, context);
      const parsed = parseResult<{
        profile: {
          whoami: { id: string; content: string } | null;
          soul: { id: string; content: string } | null;
        };
        hint?: string;
      }>(result);

      expect(parsed.profile.whoami).toMatchObject({
        id: '1',
        content: 'I am Archon',
      });
      expect(parsed.profile.soul).toMatchObject({
        id: '2',
        content: 'I value truth',
      });
      expect(parsed.hint).toBeUndefined();
    });

    it('includes hint when system entries are missing', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleWhoami({}, deps, context);
      const parsed = parseResult<{
        profile: {
          whoami: null;
          soul: null;
        };
        hint: string;
      }>(result);

      expect(parsed.profile.whoami).toBeNull();
      expect(parsed.profile.soul).toBeNull();
      expect(parsed.hint).toContain('identity_bootstrap');
      expect(parsed.hint).toContain('whoami');
      expect(parsed.hint).toContain('soul');
    });
  });

  describe('agent_lookup', () => {
    it('returns agent info by fingerprint', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'fp:abc123' },
        deps,
        context,
      );

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'fp:abc123' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed.agent).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.agent).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns error when agent not found', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'AAAA-BBBB-CCCC-DDDD' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthContext = createMockContext(null);
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'fp:abc123' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed.agent).toHaveProperty('public_key', 'pk-abc');
    });
  });
});
