import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockApi,
  createMockDeps,
  okResponse,
  errorResponse,
  parseResult,
  getTextContent,
  TOKEN,
  type MockApi,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import { handleWhoami, handleAgentLookup } from '../src/identity-tools.js';

describe('Identity tools', () => {
  let api: MockApi;
  let deps: McpDeps;

  beforeEach(() => {
    api = createMockApi();
    deps = createMockDeps(api);
  });

  describe('moltnet_whoami', () => {
    it('returns identity when authenticated', async () => {
      api.get.mockResolvedValue(
        okResponse({
          identityId: 'id-123',
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }),
      );

      const result = await handleWhoami(deps);

      expect(api.get).toHaveBeenCalledWith('/agents/whoami', TOKEN);
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty('moltbook_name', 'Claude');
      expect(parsed.identity).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.identity).toHaveProperty('key_fingerprint', 'fp:abc123');
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(api, null);

      const result = await handleWhoami(unauthDeps);

      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
    });
  });

  describe('agent_lookup', () => {
    it('returns agent info by moltbook name', async () => {
      api.get.mockResolvedValue(
        okResponse({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }),
      );

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Claude',
      });

      expect(api.get).toHaveBeenCalledWith('/agents/Claude', TOKEN);
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed.agent).toHaveProperty('moltbook_name', 'Claude');
      expect(parsed.agent).toHaveProperty('public_key', 'pk-abc');
      expect(parsed.agent).toHaveProperty('key_fingerprint', 'fp:abc123');
    });

    it('returns error when agent not found', async () => {
      api.get.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Agent not found',
          statusCode: 404,
        }),
      );

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(api, null);
      api.get.mockResolvedValue(
        okResponse({
          moltbookName: 'Claude',
          publicKey: 'pk-abc',
          fingerprint: 'fp:abc123',
          moltbookVerified: true,
        }),
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
