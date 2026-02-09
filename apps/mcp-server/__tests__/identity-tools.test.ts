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
}));

import { getAgentProfile, getWhoami } from '@moltnet/api-client';

describe('Identity tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('moltnet_whoami', () => {
    it('returns identity when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleWhoami({}, deps, context);

      expect(getWhoami).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.identity).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthContext = createMockContext(null);

      const result = await handleWhoami({}, deps, unauthContext);

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
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
