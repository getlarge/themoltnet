import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleCryptoPrepareSignature,
  handleCryptoSubmitSignature,
  handleCryptoVerify,
} from '../src/crypto-tools.js';
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
  getCryptoIdentity: vi.fn(),
  verifyAgentSignature: vi.fn(),
}));

import { getCryptoIdentity, verifyAgentSignature } from '@moltnet/api-client';

describe('Crypto tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('crypto_prepare_signature', () => {
    it('returns an envelope with identity info', async () => {
      vi.mocked(getCryptoIdentity).mockResolvedValue(
        sdkOk({ fingerprint: 'fp:abc123' }) as never,
      );

      const result = await handleCryptoPrepareSignature(
        { message: 'Hello, world!' },
        deps,
        context,
      );

      expect(getCryptoIdentity).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('message', 'Hello, world!');
      expect(parsed).toHaveProperty('signer_fingerprint', 'fp:abc123');
      expect(parsed).toHaveProperty('instructions');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleCryptoPrepareSignature(
        { message: 'test' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
    });
  });

  describe('crypto_submit_signature', () => {
    it('verifies a valid signature against known public key', async () => {
      vi.mocked(getCryptoIdentity).mockResolvedValue(
        sdkOk({ fingerprint: 'fp:abc123' }) as never,
      );
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({ valid: true }) as never,
      );

      const result = await handleCryptoSubmitSignature(
        { message: 'Hello', signature: 'sig123' },
        deps,
        context,
      );

      expect(getCryptoIdentity).toHaveBeenCalled();
      expect(verifyAgentSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'fp:abc123' },
          body: { message: 'Hello', signature: 'sig123' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed).toHaveProperty('signer_fingerprint', 'fp:abc123');
    });

    it('reports invalid signature', async () => {
      vi.mocked(getCryptoIdentity).mockResolvedValue(
        sdkOk({ fingerprint: 'fp:abc123' }) as never,
      );
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({ valid: false }) as never,
      );

      const result = await handleCryptoSubmitSignature(
        { message: 'Hello', signature: 'bad-sig' },
        deps,
        context,
      );

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleCryptoSubmitSignature(
        { message: 'test', signature: 'sig' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
    });

    it('returns error when identity lookup fails', async () => {
      vi.mocked(getCryptoIdentity).mockResolvedValue(
        sdkOk({ fingerprint: undefined }) as never,
      );

      const result = await handleCryptoSubmitSignature(
        { message: 'test', signature: 'sig' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('identity');
    });
  });

  describe('crypto_verify', () => {
    it('verifies a valid signature', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({
          valid: true,
          signer: { fingerprint: 'fp:abc123' },
        }) as never,
      );

      const result = await handleCryptoVerify(
        {
          message: 'Hello, world!',
          signature: 'ed25519:sig123',
          signer_fingerprint: 'A1B2-C3D4-E5F6-07A8',
        },
        deps,
        context,
      );

      expect(verifyAgentSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
          body: {
            message: 'Hello, world!',
            signature: 'ed25519:sig123',
          },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed.signer).toHaveProperty('fingerprint', 'fp:abc123');
    });

    it('returns invalid for bad signature', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({ valid: false }) as never,
      );

      const result = await handleCryptoVerify(
        {
          message: 'Hello',
          signature: 'bad-sig',
          signer_fingerprint: 'A1B2-C3D4-E5F6-07A8',
        },
        deps,
        context,
      );

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('returns error when signer not found', async () => {
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkErr(
          { error: 'Not Found', message: 'Agent not found', statusCode: 404 },
          404,
        ) as never,
      );

      const result = await handleCryptoVerify(
        {
          message: 'Hello',
          signature: 'sig',
          signer_fingerprint: 'AAAA-BBBB-CCCC-DDDD',
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthContext = createMockContext(null);
      vi.mocked(verifyAgentSignature).mockResolvedValue(
        sdkOk({
          valid: true,
          signer: { fingerprint: 'fp:abc123' },
        }) as never,
      );

      const result = await handleCryptoVerify(
        {
          message: 'Hello',
          signature: 'sig',
          signer_fingerprint: 'A1B2-C3D4-E5F6-07A8',
        },
        deps,
        unauthContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', true);
    });
  });
});
