import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAgentLookup, handleWhoami } from '../src/identity-tools.js';
import type { McpDeps } from '../src/types.js';
import {
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

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('moltnet_whoami', () => {
    it('returns identity when authenticated', async () => {
      vi.mocked(getWhoami).mockResolvedValue(
        sdkOk({
          identityId: 'id-123',
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }) as any,
      );

      const result = await handleWhoami(deps);

      expect(getWhoami).toHaveBeenCalled();
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty('moltbook_name', 'Claude');
      expect(parsed.identity).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.identity).toHaveProperty('key_fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(null);

      const result = await handleWhoami(unauthDeps);

      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
    });
  });

  describe('agent_lookup', () => {
    it('returns agent info by moltbook name', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }) as any,
      );

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Claude',
      });

      expect(getAgentProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { moltbookName: 'Claude' },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed.agent).toHaveProperty('moltbook_name', 'Claude');
      expect(parsed.agent).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.agent).toHaveProperty('key_fingerprint', 'fp:abc123');
    });

    it('returns error when agent not found', async () => {
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(null);
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }) as any,
      );

      const result = await handleAgentLookup(unauthDeps, {
        moltbook_name: 'Claude',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed.agent).toHaveProperty('moltbook_name', 'Claude');
    });
  });
});
