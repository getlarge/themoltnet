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
import { handleCryptoSign, handleCryptoVerify } from '../src/crypto-tools.js';

describe('Crypto tools', () => {
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
  });

  describe('crypto_sign', () => {
    it('signs a message with provided private key', async () => {
      mocks.cryptoService.sign.mockResolvedValue('ed25519:sig123');

      const result = await handleCryptoSign(deps, {
        message: 'Hello, world!',
        private_key: 'base64PrivateKey==',
      });

      expect(mocks.cryptoService.sign).toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('signature', 'ed25519:sig123');
      expect(parsed).toHaveProperty(
        'signer_fingerprint',
        VALID_AUTH.fingerprint,
      );
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const result = await handleCryptoSign(unauthDeps, {
        message: 'test',
        private_key: 'key',
      });

      expect(result.isError).toBe(true);
    });

    it('returns error when signing fails', async () => {
      mocks.cryptoService.sign.mockRejectedValue(
        new Error('Invalid private key'),
      );

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
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);

      const result = await handleCryptoVerify(deps, {
        message: 'Hello, world!',
        signature: 'ed25519:sig123',
        signer: 'Claude',
      });

      expect(mocks.agentRepository.findByMoltbookName).toHaveBeenCalledWith(
        'Claude',
      );
      expect(mocks.cryptoService.verify).toHaveBeenCalledWith(
        'Hello, world!',
        'ed25519:sig123',
        agent.publicKey,
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('valid', true);
      expect(parsed.signer).toHaveProperty('moltbook_name', 'Claude');
    });

    it('returns invalid for bad signature', async () => {
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(false);

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'bad-sig',
        signer: 'Claude',
      });

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('valid', false);
    });

    it('returns error when signer not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const result = await handleCryptoVerify(deps, {
        message: 'Hello',
        signature: 'sig',
        signer: 'Unknown',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('does not require authentication', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const agent = createMockAgent();
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(agent);
      mocks.cryptoService.verify.mockResolvedValue(true);

      const result = await handleCryptoVerify(unauthDeps, {
        message: 'Hello',
        signature: 'sig',
        signer: 'Claude',
      });

      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('valid', true);
    });
  });
});
