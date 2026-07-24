/* eslint-disable @typescript-eslint/unbound-method */
import { DBOS } from '@dbos-inc/dbos-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetSigningWorkflowsForTesting,
  assertSigningVerifierRegistered,
  initSigningWorkflows,
  isSigningVerifierRegistered,
  registerSigningVerifier,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningVerifier,
  signingWorkflows,
} from './signing-workflows.js';

function captureThrownError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected function to throw');
}

vi.mock('@dbos-inc/dbos-sdk', () => {
  const registeredSteps: Record<string, (...args: unknown[]) => unknown> = {};
  const registeredWorkflows: Record<string, (...args: unknown[]) => unknown> =
    {};
  const events: Record<string, unknown> = {};

  return {
    DBOS: {
      registerStep: vi.fn(
        (fn: (...args: unknown[]) => unknown, config: { name: string }) => {
          registeredSteps[config.name] = fn;
          return fn;
        },
      ),
      registerWorkflow: vi.fn(
        (fn: (...args: unknown[]) => unknown, config: { name: string }) => {
          registeredWorkflows[config.name] = fn;
          return fn;
        },
      ),
      setEvent: vi.fn((key: string, value: unknown) => {
        events[key] = value;
        return Promise.resolve();
      }),
      recv: vi.fn(),
      send: vi.fn(),
      _events: events,
      _steps: registeredSteps,
      _workflows: registeredWorkflows,
    },
  };
});

describe('Signing Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSigningWorkflowsForTesting();
  });

  describe('initSigningWorkflows', () => {
    it('registers workflows with DBOS', () => {
      initSigningWorkflows();

      expect(DBOS.registerStep).toHaveBeenCalled();
      expect(DBOS.registerWorkflow).toHaveBeenCalled();
    });

    it('is idempotent — calling twice does not double-register', () => {
      initSigningWorkflows();
      const stepCallCount = vi.mocked(DBOS.registerStep).mock.calls.length;
      initSigningWorkflows();

      expect(vi.mocked(DBOS.registerStep).mock.calls.length).toBe(
        stepCallCount,
      );
    });
  });

  describe('signingWorkflows.requestSignature', () => {
    it('is accessible after init', () => {
      initSigningWorkflows();
      expect(signingWorkflows.requestSignature).toBeDefined();
      expect(typeof signingWorkflows.requestSignature).toBe('function');
    });

    it('throws a typed error before initialization', () => {
      expect(
        captureThrownError(() => signingWorkflows.requestSignature),
      ).toEqual(
        expect.objectContaining({
          name: 'SigningWorkflowConfigurationError',
          code: 'workflows_not_initialized',
          dependency: 'workflows',
        }),
      );
    });
  });

  describe('requestSignature workflow', () => {
    const REQUEST_ID = '770e8400-e29b-41d4-a716-446655440002';
    const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
    const MESSAGE = 'Hello, world!';
    const NONCE = '880e8400-e29b-41d4-a716-446655440003';
    const SIGNATURE = 'ed25519:sig123';
    const PUBLIC_KEY = 'ed25519:pubkey123';

    beforeEach(() => {
      initSigningWorkflows();

      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(true),
        verifyWithNonce: vi.fn().mockResolvedValue(true),
      });
      setSigningKeyLookup({
        getPublicKey: vi.fn().mockResolvedValue(PUBLIC_KEY),
      });
      setSigningRequestPersistence({
        updateStatus: vi.fn().mockResolvedValue(undefined),
      });
    });

    it('completes successfully when signature is valid', async () => {
      const verifyWithNonce = vi.fn().mockResolvedValue(true);
      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(true),
        verifyWithNonce,
      });
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
      );

      expect(DBOS.setEvent).toHaveBeenCalledWith('envelope', {
        requestId: REQUEST_ID,
        message: MESSAGE,
        nonce: NONCE,
      });
      expect(DBOS.recv).toHaveBeenCalledWith('signature', expect.any(Number));
      expect(verifyWithNonce).toHaveBeenCalledWith(
        MESSAGE,
        NONCE,
        SIGNATURE,
        PUBLIC_KEY,
      );
      expect(result.status).toBe('completed');
      expect(result.valid).toBe(true);
      expect(result.requestId).toBe(REQUEST_ID);
    });

    it('marks as expired when signature times out', async () => {
      vi.mocked(DBOS.recv).mockResolvedValue(null);

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
      );

      expect(result.status).toBe('expired');
      expect(result.valid).toBeNull();
    });

    it('marks as invalid when public key not found', async () => {
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });
      setSigningKeyLookup({
        getPublicKey: vi.fn().mockResolvedValue(null),
      });

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
      );

      expect(result.status).toBe('completed');
      expect(result.valid).toBe(false);
    });

    it('marks as invalid when signature verification fails', async () => {
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });
      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(false),
        verifyWithNonce: vi.fn().mockResolvedValue(false),
      });

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
      );

      expect(result.status).toBe('completed');
      expect(result.valid).toBe(false);
    });

    it('dispatches verification by verification method', async () => {
      const hardwareVerifier = {
        verify: vi.fn().mockResolvedValue(true),
      };
      registerSigningVerifier('human-hardware-previewsign', hardwareVerifier);
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
        'human-hardware-previewsign',
      );

      expect(hardwareVerifier.verify).toHaveBeenCalledWith({
        verificationMethod: 'human-hardware-previewsign',
        message: MESSAGE,
        nonce: NONCE,
        signature: SIGNATURE,
        publicKey: PUBLIC_KEY,
      });
      expect(result.valid).toBe(true);
    });

    it('completes as invalid when the selected verifier throws', async () => {
      const updateStatus = vi.fn().mockResolvedValue(undefined);
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });
      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(true),
        verifyWithNonce: vi.fn().mockRejectedValue(new Error('malformed key')),
      });
      setSigningRequestPersistence({ updateStatus });

      const result = await signingWorkflows.requestSignature(
        REQUEST_ID,
        AGENT_ID,
        MESSAGE,
        NONCE,
      );

      expect(updateStatus).toHaveBeenCalledWith(
        REQUEST_ID,
        expect.objectContaining({
          status: 'completed',
          signature: SIGNATURE,
          valid: false,
        }),
      );
      expect(DBOS.setEvent).toHaveBeenCalledWith('result', {
        requestId: REQUEST_ID,
        status: 'completed',
        valid: false,
      });
      expect(result).toEqual({
        requestId: REQUEST_ID,
        status: 'completed',
        valid: false,
      });
    });

    it('throws a typed error when key lookup is not configured', async () => {
      _resetSigningWorkflowsForTesting();
      initSigningWorkflows();
      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(true),
        verifyWithNonce: vi.fn().mockResolvedValue(true),
      });
      setSigningRequestPersistence({
        updateStatus: vi.fn().mockResolvedValue(undefined),
      });
      vi.mocked(DBOS.recv).mockResolvedValue({ signature: SIGNATURE });

      await expect(
        signingWorkflows.requestSignature(REQUEST_ID, AGENT_ID, MESSAGE, NONCE),
      ).rejects.toEqual(
        expect.objectContaining({
          name: 'SigningWorkflowConfigurationError',
          code: 'key_lookup_not_configured',
          dependency: 'key_lookup',
        }),
      );
    });

    it('throws a typed error when persistence is not configured', async () => {
      _resetSigningWorkflowsForTesting();
      initSigningWorkflows();
      setSigningVerifier({
        verify: vi.fn().mockResolvedValue(true),
        verifyWithNonce: vi.fn().mockResolvedValue(true),
      });
      setSigningKeyLookup({
        getPublicKey: vi.fn().mockResolvedValue(PUBLIC_KEY),
      });
      vi.mocked(DBOS.recv).mockResolvedValue(null);

      await expect(
        signingWorkflows.requestSignature(REQUEST_ID, AGENT_ID, MESSAGE, NONCE),
      ).rejects.toEqual(
        expect.objectContaining({
          name: 'SigningWorkflowConfigurationError',
          code: 'persistence_not_configured',
          dependency: 'persistence',
        }),
      );
    });
  });

  describe('signing verifier registry', () => {
    it('reports whether a verification method can be fulfilled', () => {
      expect(isSigningVerifierRegistered('human-hardware-previewsign')).toBe(
        false,
      );

      registerSigningVerifier('human-hardware-previewsign', {
        verify: vi.fn().mockResolvedValue(true),
      });

      expect(isSigningVerifierRegistered('human-hardware-previewsign')).toBe(
        true,
      );
    });

    it('throws a typed error with the unavailable verification method', () => {
      expect(
        captureThrownError(() =>
          assertSigningVerifierRegistered('human-hardware-previewsign'),
        ),
      ).toEqual(
        expect.objectContaining({
          name: 'SigningVerifierNotRegisteredError',
          code: 'verifier_not_registered',
          verificationMethod: 'human-hardware-previewsign',
        }),
      );
    });
  });
});
