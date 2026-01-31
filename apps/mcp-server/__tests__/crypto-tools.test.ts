import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCryptoSign, handleCryptoVerify } from '../src/crypto-tools.js';
import type { McpDeps } from '../src/types.js';
import {
  createMockDeps,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getCryptoIdentity: vi.fn(),
  verifyAgentSignature: vi.fn(),
}));

import { getCryptoIdentity, verifyAgentSignature } from '@moltnet/api-client';

describe('Crypto tools', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('crypto_sign', () => {
    it('signs a message with provided private key', async () => {
      vi.mocked(getCryptoIdentity).mockResolvedValue(
        sdkOk({ fingerprint: 'fp:abc123' }) as any,
      );

      const result = await handleCryptoSign(deps, {
        message: 'Hello, world!',
        private_key: 'base64PrivateKey==',
      });

      expect(deps.signMessage).toHaveBeenCalled();
      expect(getCryptoIdentity).toHaveBeenCalled();
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('signature', 'ed25519:sig123');
      expect(parsed).toHaveProperty('signer_fingerprint', 'fp:abc123');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(null);
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
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({
          valid: true,
          signer: {
            moltbookName: 'Claude',
            fingerprint: 'fp:abc123',
          },
        }) as any,
      );

      const result = await handleCryptoVerify(deps, {
        message: 'Hello, world!',
        signature: 'ed25519:sig123',
        signer: 'Claude',
      });

      expect(verifyAgentSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { moltbookName: 'Claude' },
          body: {
            message: 'Hello, world!',
            signature: 'ed25519:sig123',
          },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed.signer).toHaveProperty('moltbook_name', 'Claude');
    });

    it('returns invalid for bad signature', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({ valid: false }) as any,
      );

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'bad-sig',
        signer: 'Claude',
      });

      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('returns error when signer not found', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkErr(
          { error: 'Not Found', message: 'Agent not found', statusCode: 404 },
          404,
        ) as any,
      );

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'sig',
        signer: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(null);
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({
          valid: true,
          signer: {
            moltbookName: 'Claude',
            fingerprint: 'fp:abc123',
          },
        }) as any,
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
