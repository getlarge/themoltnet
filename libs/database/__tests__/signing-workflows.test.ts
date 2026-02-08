import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initSigningWorkflows,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningVerifier,
  signingWorkflows,
} from '../src/workflows/signing-workflows.js';

// Mock DBOS SDK
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
      setEvent: vi.fn(async (key: string, value: unknown) => {
        events[key] = value;
      }),
      recv: vi.fn(),
      send: vi.fn(),
      _events: events,
      _steps: registeredSteps,
      _workflows: registeredWorkflows,
    },
  };
});

// We need to import DBOS after mocking
import { DBOS } from '@dbos-inc/dbos-sdk';

describe('Signing Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initSigningWorkflows', () => {
    it('registers workflows with DBOS', () => {
      // initSigningWorkflows was already called by the import
      // but calling it again should be idempotent
      initSigningWorkflows();

      expect(DBOS.registerStep).toHaveBeenCalled();
      expect(DBOS.registerWorkflow).toHaveBeenCalled();
    });

    it('is idempotent — calling twice does not double-register', () => {
      const stepCallCount = vi.mocked(DBOS.registerStep).mock.calls.length;
      initSigningWorkflows();
      // Should not have registered additional steps
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
      });
      setSigningKeyLookup({
        getPublicKey: vi.fn().mockResolvedValue(PUBLIC_KEY),
      });
      setSigningRequestPersistence({
        updateStatus: vi.fn().mockResolvedValue(undefined),
      });
    });

    it('completes successfully when signature is valid', async () => {
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
  });
});
