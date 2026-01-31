import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockApi,
  createMockDeps,
  okResponse,
  parseResult,
  getTextContent,
  TOKEN,
  type MockApi,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import { handleCryptoSign, handleCryptoVerify } from '../src/crypto-tools.js';

describe('Crypto tools', () => {
  let api: MockApi;
  let deps: McpDeps;

  beforeEach(() => {
    api = createMockApi();
    deps = createMockDeps(api);
  });

  describe('crypto_sign', () => {
    it('signs a message with provided private key', async () => {
      api.get.mockResolvedValue(okResponse({ fingerprint: 'fp:abc123' }));

      const result = await handleCryptoSign(deps, {
        message: 'Hello, world!',
        private_key: 'base64PrivateKey==',
      });

      expect(deps.signMessage).toHaveBeenCalled();
      expect(api.get).toHaveBeenCalledWith('/crypto/identity', TOKEN);
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('signature', 'ed25519:sig123');
      expect(parsed).toHaveProperty('signer_fingerprint', 'fp:abc123');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(api, null);
      const result = await handleCryptoSign(unauthDeps, {
        message: 'test',
        private_key: 'key',
      });

      expect(result.isError).toBe(true);
    });

    it('returns error when signing fails', async () => {
      deps.signMessage = vi
        .fn()
        .mockRejectedValue(new Error('Invalid private key'));

      const result = await handleCryptoSign(deps, {
        message: 'test',
        private_key: 'bad-key',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Invalid private key');
    });
  });

  describe('crypto_verify', () => {
    it('verifies a valid signature', async () => {
      api.post.mockResolvedValue(
        okResponse({
          valid: true,
          signer: {
            moltbookName: 'Claude',
            fingerprint: 'fp:abc123',
          },
        }),
      );

      const result = await handleCryptoVerify(deps, {
        message: 'Hello, world!',
        signature: 'ed25519:sig123',
        signer: 'Claude',
      });

      expect(api.post).toHaveBeenCalledWith('/agents/Claude/verify', TOKEN, {
        message: 'Hello, world!',
        signature: 'ed25519:sig123',
      });
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed.signer).toHaveProperty('moltbook_name', 'Claude');
    });

    it('returns invalid for bad signature', async () => {
      api.post.mockResolvedValue(okResponse({ valid: false }));

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'bad-sig',
        signer: 'Claude',
      });

      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('returns error when signer not found', async () => {
      api.post.mockResolvedValue({
        status: 404,
        ok: false,
        data: { message: 'Agent not found' },
      });

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'sig',
        signer: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(api, null);
      api.post.mockResolvedValue(
        okResponse({
          valid: true,
          signer: {
            moltbookName: 'Claude',
            fingerprint: 'fp:abc123',
          },
        }),
      );

      const result = await handleCryptoVerify(unauthDeps, {
        message: 'Hello',
        signature: 'sig',
        signer: 'Claude',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('valid', true);
    });
  });
});
