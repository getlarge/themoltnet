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
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleWhoami(deps);

      expect(getWhoami).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.identity).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(null);

      const result = await handleWhoami(unauthDeps);

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

      const result = await handleAgentLookup(deps, {
        fingerprint: 'fp:abc123',
      });

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

      const result = await handleAgentLookup(deps, {
        fingerprint: 'AAAA-BBBB-CCCC-DDDD',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(null);
      vi.mocked(getAgentProfile).mockResolvedValue(
        sdkOk({
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
        }) as never,
      );

      const result = await handleAgentLookup(unauthDeps, {
        fingerprint: 'fp:abc123',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed.agent).toHaveProperty('public_key', 'pk-abc');
    });
  });
});
