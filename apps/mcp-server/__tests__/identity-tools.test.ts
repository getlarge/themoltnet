import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAgentLookup, handleWhoami } from '../src/identity-tools.js';
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
  getWhoami: vi.fn(),
  getAgentProfile: vi.fn(),
  searchDiary: vi.fn(),
}));

import { getAgentProfile, getWhoami, searchDiary } from '@moltnet/api-client';

const WHOAMI_ARGS = { diary_id: DIARY_ID };

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
          clientId: 'client-abc',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleWhoami(WHOAMI_ARGS, deps, context);

      expect(getWhoami).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toMatchObject({
        authenticated: true,
        identity: {
          identityId: 'id-123',
          clientId: 'client-abc',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        },
      });
      expect(parsed).toHaveProperty('profile');
      expect(result.structuredContent).toEqual(parsed);
    });

    it('returns unauthenticated when no auth', async () => {
      const result = await handleWhoami(
        WHOAMI_ARGS,
        deps,
        createMockContext(null),
      );

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
    });

    it('includes populated profile when system entries exist', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          clientId: 'client-abc',
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

      const result = await handleWhoami(WHOAMI_ARGS, deps, context);
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

    it('searches only the provided diary_id', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          clientId: 'client-abc',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      await handleWhoami(WHOAMI_ARGS, deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ diaryId: DIARY_ID }),
        }),
      );
    });

    it('includes hint when system entries are missing', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          clientId: 'client-abc',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );
      vi.mocked(searchDiary).mockResolvedValue(sdkOk({ results: [] }) as never);

      const result = await handleWhoami(WHOAMI_ARGS, deps, context);
      const parsed = parseResult<{
        profile: { whoami: null; soul: null };
        hint: string;
      }>(result);

      expect(parsed.profile.whoami).toBeNull();
      expect(parsed.profile.soul).toBeNull();
      expect(parsed.hint).toContain('identity_bootstrap');
    });
  });

  describe('agent_lookup', () => {
    it('returns agent info by fingerprint', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'fp:abc123' },
        deps,
        context,
      );

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({ path: { fingerprint: 'fp:abc123' } }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toEqual({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' });
      expect(result.structuredContent).toEqual(parsed);
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

    it('preserves upstream lookup errors', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Internal Server Error',
          message: 'Profile service unavailable',
          statusCode: 500,
        }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'AAAA-BBBB-CCCC-DDDD' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Profile service unavailable');
    });

    it('does not require authentication', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({ publicKey: 'pk-abc', fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleAgentLookup(
        { fingerprint: 'fp:abc123' },
        deps,
        createMockContext(null),
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toMatchObject({ publicKey: 'pk-abc' });
    });
  });
});
