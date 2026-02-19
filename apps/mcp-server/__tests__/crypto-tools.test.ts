import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleCryptoPrepareSignature,
  handleCryptoSigningStatus,
  handleCryptoSubmitSignature,
  handleCryptoVerify,
} from '../src/crypto-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createSigningRequest: vi.fn(),
  submitSignature: vi.fn(),
  getSigningRequest: vi.fn(),
  verifyCryptoSignature: vi.fn(),
}));

import {
  createSigningRequest,
  getSigningRequest,
  submitSignature,
  verifyCryptoSignature,
} from '@moltnet/api-client';

describe('Crypto tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('crypto_prepare_signature', () => {
    it('creates a signing request and returns envelope', async () => {
      vi.mocked(createSigningRequest).mockResolvedValue(
        sdkOk({
          id: 'req-123',
          message: 'Hello, world!',
          nonce: 'nonce-abc',
          status: 'pending',
          expiresAt: '2026-02-07T10:05:00Z',
        }) as never,
      );

      const result = await handleCryptoPrepareSignature(
        { message: 'Hello, world!' },
        deps,
        context,
      );

      expect(createSigningRequest).toHaveBeenCalled();
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('request_id', 'req-123');
      expect(parsed).toHaveProperty('message', 'Hello, world!');
      expect(parsed).toHaveProperty('nonce', 'nonce-abc');
      expect(parsed).toHaveProperty(
        'signing_payload',
        'Hello, world!.nonce-abc',
      );
      expect(parsed).toHaveProperty('status', 'pending');
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

    it('returns error when API call fails', async () => {
      vi.mocked(createSigningRequest).mockResolvedValue(
        sdkErr(
          { error: 'Internal', message: 'Server error', statusCode: 500 },
          500,
        ) as never,
      );

      const result = await handleCryptoPrepareSignature(
        { message: 'test' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
    });
  });

  describe('crypto_submit_signature', () => {
    it('submits a signature and returns result', async () => {
      vi.mocked(submitSignature).mockResolvedValue(
        sdkOk({
          id: 'req-123',
          status: 'completed',
          valid: true,
        }) as never,
      );

      const result = await handleCryptoSubmitSignature(
        { request_id: 'req-123', signature: 'ed25519:sig123' },
        deps,
        context,
      );

      expect(submitSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 'req-123' },
          body: { signature: 'ed25519:sig123' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed).toHaveProperty('status', 'completed');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleCryptoSubmitSignature(
        { request_id: 'req-123', signature: 'sig' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
    });
  });

  describe('crypto_signing_status', () => {
    it('returns signing request status', async () => {
      vi.mocked(getSigningRequest).mockResolvedValue(
        sdkOk({
          id: 'req-123',
          status: 'pending',
          valid: null,
          message: 'Hello',
          expiresAt: '2026-02-07T10:05:00Z',
        }) as never,
      );

      const result = await handleCryptoSigningStatus(
        { request_id: 'req-123' },
        deps,
        context,
      );

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('status', 'pending');
      expect(parsed).toHaveProperty('request_id', 'req-123');
    });

    it('returns error when not found', async () => {
      vi.mocked(getSigningRequest).mockResolvedValue(
        sdkErr(
          { error: 'Not Found', message: 'Not found', statusCode: 404 },
          404,
        ) as never,
      );

      const result = await handleCryptoSigningStatus(
        { request_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleCryptoSigningStatus(
        { request_id: 'req-123' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
    });
  });

  describe('crypto_verify', () => {
    it('verifies a valid signature', async () => {
      vi.mocked(verifyCryptoSignature).mockResolvedValue(
        sdkOk({ valid: true }) as never,
      );

      const result = await handleCryptoVerify(
        {
          signature: 'ed25519:sig123',
        },
        deps,
        context,
      );

      expect(verifyCryptoSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            signature: 'ed25519:sig123',
          },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', true);
    });

    it('returns invalid for bad signature', async () => {
      vi.mocked(verifyCryptoSignature).mockResolvedValue(
        sdkOk({ valid: false }) as never,
      );

      const result = await handleCryptoVerify(
        {
          signature: 'bad-sig',
        },
        deps,
        context,
      );

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('does not require authentication', async () => {
      const unauthContext = createMockContext(null);
      vi.mocked(verifyCryptoSignature).mockResolvedValue(
        sdkOk({ valid: true }) as never,
      );

      const result = await handleCryptoVerify(
        {
          signature: 'sig',
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
