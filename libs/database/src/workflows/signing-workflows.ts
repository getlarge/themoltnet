/**
 * Signing Durable Workflows
 *
 * DBOS workflows for the async signing protocol. The server creates
 * a signing request, the agent signs locally, and submits the signature.
 * The workflow handles crash resilience, timeouts, and exactly-once delivery.
 *
 * ## Initialization Order
 *
 * Workflows are registered lazily on first access via `initSigningWorkflows()`.
 * This allows the module to be imported before DBOS is configured.
 * The Fastify DBOS plugin calls `initSigningWorkflows()` after `configureDBOS()`.
 */

import { DBOS } from '@dbos-inc/dbos-sdk';

/**
 * Interface for Ed25519 signature verification.
 * The full implementation lives in @moltnet/crypto-service — we define
 * a minimal version here to avoid circular dependencies.
 */
export interface SignatureVerifier {
  verify(
    message: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean>;
}

/**
 * Interface for looking up an agent's public key.
 * Implemented by the agent repository.
 */
export interface AgentKeyLookup {
  getPublicKey(agentId: string): Promise<string | null>;
}

/**
 * Interface for persisting signing request status updates.
 * Implemented by the signing request repository.
 */
export interface SigningRequestPersistence {
  updateStatus(
    id: string,
    updates: {
      status?: 'pending' | 'completed' | 'expired';
      signature?: string;
      valid?: boolean;
      completedAt?: Date;
      workflowId?: string;
    },
  ): Promise<void>;
}

/** The envelope sent to the agent via DBOS setEvent */
export interface SigningEnvelope {
  requestId: string;
  message: string;
  nonce: string;
}

/** The result of the signing workflow */
export interface SigningResult {
  requestId: string;
  status: 'completed' | 'expired';
  valid: boolean | null;
}

// ── Dependency Injection ────────────────────────────────────────────
// Dependencies are injected at runtime before DBOS.launch()

let signatureVerifier: SignatureVerifier | null = null;
let agentKeyLookup: AgentKeyLookup | null = null;
let signingRequestPersistence: SigningRequestPersistence | null = null;
let signingTimeoutSeconds = 300; // 5 minutes default

export function setSigningVerifier(verifier: SignatureVerifier): void {
  signatureVerifier = verifier;
}

export function setSigningKeyLookup(lookup: AgentKeyLookup): void {
  agentKeyLookup = lookup;
}

export function setSigningRequestPersistence(
  persistence: SigningRequestPersistence,
): void {
  signingRequestPersistence = persistence;
}

export function setSigningTimeoutSeconds(seconds: number): void {
  signingTimeoutSeconds = seconds;
}

function getSignatureVerifier(): SignatureVerifier {
  if (!signatureVerifier) {
    throw new Error(
      'SignatureVerifier not set. Call setSigningVerifier() before using signing workflows.',
    );
  }
  return signatureVerifier;
}

function getAgentKeyLookup(): AgentKeyLookup {
  if (!agentKeyLookup) {
    throw new Error(
      'AgentKeyLookup not set. Call setSigningKeyLookup() before using signing workflows.',
    );
  }
  return agentKeyLookup;
}

function getSigningRequestPersistence(): SigningRequestPersistence {
  if (!signingRequestPersistence) {
    throw new Error(
      'SigningRequestPersistence not set. Call setSigningRequestPersistence() before using signing workflows.',
    );
  }
  return signingRequestPersistence;
}

// ── Retry Configuration ──────────────────────────────────────────────
const signingStepConfig = {
  retriesAllowed: true,
  maxAttempts: 3,
  intervalSeconds: 2,
  backoffRate: 2,
};

// ── Lazy Registration ────────────────────────────────────────────────

let _workflows: {
  requestSignature: (
    requestId: string,
    agentId: string,
    message: string,
    nonce: string,
  ) => Promise<SigningResult>;
} | null = null;

/**
 * Initialize and register signing workflows with DBOS.
 *
 * Must be called AFTER configureDBOS() and BEFORE launchDBOS().
 * Idempotent — safe to call multiple times.
 */
export function initSigningWorkflows(): void {
  if (_workflows) return;

  // ── Steps ──────────────────────────────────────────────────────────
  const lookupPublicKeyStep = DBOS.registerStep(
    async (agentId: string): Promise<string | null> => {
      return getAgentKeyLookup().getPublicKey(agentId);
    },
    { name: 'signing.step.lookupPublicKey', ...signingStepConfig },
  );

  const verifySignatureStep = DBOS.registerStep(
    async (
      message: string,
      signature: string,
      publicKey: string,
    ): Promise<boolean> => {
      return getSignatureVerifier().verify(message, signature, publicKey);
    },
    {
      name: 'signing.step.verifySignature',
      retriesAllowed: false, // Pure computation, no transient failures
    },
  );

  const persistStatusStep = DBOS.registerStep(
    async (
      requestId: string,
      status: 'completed' | 'expired',
      signature: string | null,
      valid: boolean | null,
    ): Promise<void> => {
      await getSigningRequestPersistence().updateStatus(requestId, {
        status,
        signature: signature ?? undefined,
        valid: valid ?? undefined,
        completedAt: new Date(),
      });
    },
    { name: 'signing.step.persistStatus', ...signingStepConfig },
  );

  // ── Workflow ────────────────────────────────────────────────────────
  _workflows = {
    requestSignature: DBOS.registerWorkflow(
      async (
        requestId: string,
        agentId: string,
        message: string,
        nonce: string,
      ): Promise<SigningResult> => {
        // 1. Publish the signing envelope for the agent to read
        const envelope: SigningEnvelope = { requestId, message, nonce };
        await DBOS.setEvent('envelope', envelope);

        // 2. Wait for signature submission (with timeout)
        const submission = await DBOS.recv<{ signature: string }>(
          'signature',
          signingTimeoutSeconds,
        );

        if (!submission) {
          // Timeout — mark as expired
          await persistStatusStep(requestId, 'expired', null, null);
          const result: SigningResult = {
            requestId,
            status: 'expired',
            valid: null,
          };
          await DBOS.setEvent('result', result);
          return result;
        }

        // 3. Look up the agent's public key
        const publicKey = await lookupPublicKeyStep(agentId);
        if (!publicKey) {
          // Agent not found — mark as completed with invalid
          await persistStatusStep(
            requestId,
            'completed',
            submission.signature,
            false,
          );
          const result: SigningResult = {
            requestId,
            status: 'completed',
            valid: false,
          };
          await DBOS.setEvent('result', result);
          return result;
        }

        // 4. Verify the signature (agent signs message + nonce to prevent replay)
        const signingPayload = `${message}.${nonce}`;
        const valid = await verifySignatureStep(
          signingPayload,
          submission.signature,
          publicKey,
        );

        // 5. Persist the final status
        await persistStatusStep(
          requestId,
          'completed',
          submission.signature,
          valid,
        );

        const result: SigningResult = {
          requestId,
          status: 'completed',
          valid,
        };
        await DBOS.setEvent('result', result);
        return result;
      },
      { name: 'signing.requestSignature' },
    ),
  };
}

// ── Exported Collection ──────────────────────────────────────────────
// Getter ensures workflows are accessed only after initialization.

export const signingWorkflows = {
  get requestSignature() {
    if (!_workflows) {
      throw new Error(
        'Signing workflows not initialized. Call initSigningWorkflows() after configureDBOS().',
      );
    }
    return _workflows.requestSignature;
  },
};

/** @internal Reset module state for testing. */
export function _resetSigningWorkflowsForTesting(): void {
  _workflows = null;
}
