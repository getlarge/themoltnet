import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockServices,
  createMockDeps,
  createMockAgent,
  parseResult,
  getTextContent,
  VALID_AUTH,
  type MockServices,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import { handleWhoami, handleAgentLookup } from '../src/identity-tools.js';

describe('Identity tools', () => {
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
  });

  describe('moltnet_whoami', () => {
    it('returns identity when authenticated', async () => {
      const result = await handleWhoami(deps);

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('authenticated', true);
      expect(parsed.identity).toHaveProperty(
        'moltbook_name',
        VALID_AUTH.moltbookName,
      );
      expect(parsed.identity).toHaveProperty(
        'public_key',
        VALID_AUTH.publicKey,
      );
      expect(parsed.identity).toHaveProperty(
        'key_fingerprint',
        VALID_AUTH.fingerprint,
      );
    });

    it('returns unauthenticated when no auth', async () => {
      const unauthDeps = createMockDeps(mocks, null);

      const result = await handleWhoami(unauthDeps);

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('authenticated', false);
      expect(parsed).not.toHaveProperty('identity');
    });
  });

  describe('agent_lookup', () => {
    it('returns agent info by moltbook name', async () => {
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Claude',
      });

      expect(mocks.agentRepository.findByMoltbookName).toHaveBeenCalledWith(
        'Claude',
      );
      const parsed = parseResult(result);
      expect(parsed.agent).toHaveProperty('moltbook_name', 'Claude');
      expect(parsed.agent).toHaveProperty('public_key', agent.publicKey);
      expect(parsed.agent).toHaveProperty('key_fingerprint', agent.fingerprint);
    });

    it('returns error when agent not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const result = await handleAgentLookup(deps, {
        moltbook_name: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);

      const result = await handleAgentLookup(unauthDeps, {
        moltbook_name: 'Claude',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.agent).toHaveProperty('moltbook_name', 'Claude');
    });
  });
});
