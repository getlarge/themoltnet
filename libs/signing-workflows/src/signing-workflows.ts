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
import { VERIFICATION_METHOD, type VerificationMethod } from '@moltnet/models';

export {
  VERIFICATION_METHOD,
  VERIFICATION_METHOD_VALUES,
  type VerificationMethod,
} from '@moltnet/models';

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
  verifyWithNonce(
    message: string,
    nonce: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean>;
}

export interface SigningVerificationInput {
  verificationMethod: VerificationMethod;
  message: string;
  nonce: string;
  signature: string;
  publicKey: string;
}

export interface SigningVerifier {
  verify(input: SigningVerificationInput): Promise<boolean>;
}

export type SigningMethodJson =
  | boolean
  | null
  | number
  | string
  | SigningMethodJson[]
  | { [key: string]: SigningMethodJson };

export interface PrepareSigningClaimInput {
  verificationMethod: VerificationMethod;
  requestId: string;
  credentialId: string;
  signingPayload: string;
  credentialPublicMaterial?: SigningMethodJson;
}

export interface SigningMethodChallenge {
  verificationMethod: VerificationMethod;
  [key: string]: SigningMethodJson;
}

export interface PreparedSigningChallenge {
  challenge: SigningMethodChallenge;
  verifierState: SigningMethodJson;
}

export interface SigningMethodReceipt {
  verificationMethod: VerificationMethod;
  [key: string]: SigningMethodJson;
}

export interface VerifySigningReceiptInput extends PrepareSigningClaimInput {
  receipt: SigningMethodReceipt;
  verifierState: SigningMethodJson;
}

export interface ValidateSigningCredentialInput {
  verificationMethod: VerificationMethod;
  credentialType: string;
  algorithm: string;
  publicMaterial: SigningMethodJson;
}

export interface VerificationEvidence {
  verificationMethod: VerificationMethod;
  credentialId: string;
  proofHash: string;
  details?: SigningMethodJson;
}

/**
 * A human-capable signing method extends the Phase 0 verifier with the
 * claim-time challenge and typed receipt lifecycle. Agent Ed25519 deliberately
 * remains a plain SigningVerifier and keeps its existing HTTP transport.
 */
export interface SigningMethodDriver extends SigningVerifier {
  readonly verificationMethod: VerificationMethod;
  validatePublicMaterial(input: ValidateSigningCredentialInput): void;
  prepareClaim(
    input: PrepareSigningClaimInput,
  ): Promise<PreparedSigningChallenge>;
  verifyReceipt(
    input: VerifySigningReceiptInput,
  ): Promise<VerificationEvidence>;
}

export type SigningWorkflowErrorCode =
  | 'verifier_not_registered'
  | 'claim_not_supported'
  | 'receipt_method_mismatch'
  | 'receipt_invalid'
  | 'signing_result_timeout'
  | 'key_lookup_not_configured'
  | 'persistence_not_configured'
  | 'workflows_not_initialized';

/**
 * Transport-neutral base error for callers that need to translate signing
 * workflow failures into HTTP problems, RPC errors, or service results.
 */
export class SigningWorkflowError extends Error {
  constructor(
    public readonly code: SigningWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SigningWorkflowError';
  }
}

export class SigningVerifierNotRegisteredError extends SigningWorkflowError {
  constructor(public readonly verificationMethod: VerificationMethod) {
    super(
      'verifier_not_registered',
      `Signing verifier not registered for verification method: ${verificationMethod}`,
    );
    this.name = 'SigningVerifierNotRegisteredError';
  }
}

export class SigningMethodClaimNotSupportedError extends SigningWorkflowError {
  constructor(public readonly verificationMethod: VerificationMethod) {
    super(
      'claim_not_supported',
      `Signing method does not support the claim lifecycle: ${verificationMethod}`,
    );
    this.name = 'SigningMethodClaimNotSupportedError';
  }
}

export class SigningReceiptMethodMismatchError extends SigningWorkflowError {
  constructor(
    public readonly expectedVerificationMethod: VerificationMethod,
    public readonly receivedVerificationMethod: VerificationMethod,
  ) {
    super(
      'receipt_method_mismatch',
      `Signing receipt method ${receivedVerificationMethod} does not match request method ${expectedVerificationMethod}`,
    );
    this.name = 'SigningReceiptMethodMismatchError';
  }
}

export class SigningReceiptInvalidError extends SigningWorkflowError {
  constructor(message = 'Signing receipt is invalid') {
    super('receipt_invalid', message);
    this.name = 'SigningReceiptInvalidError';
  }
}

export class SigningResultTimeoutError extends SigningWorkflowError {
  constructor(public readonly requestId: string) {
    super(
      'signing_result_timeout',
      `Signing result is still pending for request: ${requestId}`,
    );
    this.name = 'SigningResultTimeoutError';
  }
}

export type SigningWorkflowDependency =
  | 'key_lookup'
  | 'persistence'
  | 'workflows';

const CONFIGURATION_ERROR_CODE = {
  key_lookup: 'key_lookup_not_configured',
  persistence: 'persistence_not_configured',
  workflows: 'workflows_not_initialized',
} as const satisfies Record<
  SigningWorkflowDependency,
  SigningWorkflowErrorCode
>;

export class SigningWorkflowConfigurationError extends SigningWorkflowError {
  constructor(
    public readonly dependency: SigningWorkflowDependency,
    message: string,
  ) {
    super(CONFIGURATION_ERROR_CODE[dependency], message);
    this.name = 'SigningWorkflowConfigurationError';
  }
}

export class Ed25519Verifier implements SigningVerifier {
  constructor(private readonly verifier: SignatureVerifier) {}

  verify({
    message,
    nonce,
    signature,
    publicKey,
  }: SigningVerificationInput): Promise<boolean> {
    return this.verifier.verifyWithNonce(message, nonce, signature, publicKey);
  }
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
  completeAgentRequest(input: {
    id: string;
    status: 'completed' | 'expired';
    signature?: string;
    valid?: boolean;
    completedAt: Date;
  }): Promise<void>;
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

const signingVerifierRegistry = new Map<VerificationMethod, SigningVerifier>();
const signingMethodDriverRegistry = new Map<
  VerificationMethod,
  SigningMethodDriver
>();
let agentKeyLookup: AgentKeyLookup | null = null;
let signingRequestPersistence: SigningRequestPersistence | null = null;
let signingTimeoutSeconds = 300; // 5 minutes default
let signingWorkflowErrorReporter:
  | ((
      error: unknown,
      context: {
        operation: 'verify_signature';
        requestId: string;
        verificationMethod: VerificationMethod;
      },
    ) => void)
  | null = null;

export function setSigningVerifier(verifier: SignatureVerifier): void {
  registerSigningVerifier(
    VERIFICATION_METHOD.AgentEd25519,
    new Ed25519Verifier(verifier),
  );
}

export function registerSigningVerifier(
  verificationMethod: VerificationMethod,
  verifier: SigningVerifier,
): void {
  signingVerifierRegistry.set(verificationMethod, verifier);
}

export function registerSigningMethodDriver(
  verificationMethod: VerificationMethod,
  driver: SigningMethodDriver,
): void {
  if (driver.verificationMethod !== verificationMethod) {
    throw new SigningReceiptMethodMismatchError(
      verificationMethod,
      driver.verificationMethod,
    );
  }
  signingMethodDriverRegistry.set(verificationMethod, driver);
  registerSigningVerifier(verificationMethod, driver);
}

export function isSigningVerifierRegistered(
  verificationMethod: VerificationMethod,
): boolean {
  return signingVerifierRegistry.has(verificationMethod);
}

export function assertSigningVerifierRegistered(
  verificationMethod: VerificationMethod,
): void {
  if (!isSigningVerifierRegistered(verificationMethod)) {
    throw new SigningVerifierNotRegisteredError(verificationMethod);
  }
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

export function setSigningWorkflowErrorReporter(
  reporter: NonNullable<typeof signingWorkflowErrorReporter>,
): void {
  signingWorkflowErrorReporter = reporter;
}

function getSigningVerifier(
  verificationMethod: VerificationMethod,
): SigningVerifier {
  const verifier = signingVerifierRegistry.get(verificationMethod);
  if (!verifier) {
    throw new SigningVerifierNotRegisteredError(verificationMethod);
  }
  return verifier;
}

function getSigningMethodDriver(
  verificationMethod: VerificationMethod,
): SigningMethodDriver {
  const driver = signingMethodDriverRegistry.get(verificationMethod);
  if (!driver) {
    throw new SigningMethodClaimNotSupportedError(verificationMethod);
  }
  return driver;
}

export async function prepareSigningClaim(
  input: PrepareSigningClaimInput,
): Promise<PreparedSigningChallenge> {
  return getSigningMethodDriver(input.verificationMethod).prepareClaim(input);
}

export async function verifySigningReceipt(
  input: VerifySigningReceiptInput,
): Promise<VerificationEvidence> {
  if (input.receipt.verificationMethod !== input.verificationMethod) {
    throw new SigningReceiptMethodMismatchError(
      input.verificationMethod,
      input.receipt.verificationMethod,
    );
  }
  return getSigningMethodDriver(input.verificationMethod).verifyReceipt(input);
}

export function validateSigningCredentialPublicMaterial(
  input: ValidateSigningCredentialInput,
): void {
  getSigningMethodDriver(input.verificationMethod).validatePublicMaterial(
    input,
  );
}

export function toSigningMethodReceipt(receipt: {
  verificationMethod: VerificationMethod;
  value: SigningMethodJson;
}): SigningMethodReceipt {
  if (
    receipt.value === null ||
    Array.isArray(receipt.value) ||
    typeof receipt.value !== 'object'
  ) {
    throw new SigningReceiptInvalidError(
      'Signing receipt value must be a JSON object',
    );
  }
  return {
    verificationMethod: receipt.verificationMethod,
    ...receipt.value,
  };
}

export interface WaitForSigningResultOptions<T extends { status: string }> {
  load: (id: string) => Promise<T | null>;
  initial: T;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  pendingStatus?: string;
}

export async function waitForSigningResult<T extends { status: string }>(
  id: string,
  {
    load,
    initial,
    maxWaitMs = 5000,
    pollIntervalMs = 100,
    pendingStatus = 'pending',
  }: WaitForSigningResultOptions<T>,
): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  let current = initial;
  while (Date.now() < deadline) {
    const result = await load(id);
    if (result) current = result;
    if (current.status !== pendingStatus) return current;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }
  throw new SigningResultTimeoutError(id);
}

function getAgentKeyLookup(): AgentKeyLookup {
  if (!agentKeyLookup) {
    throw new SigningWorkflowConfigurationError(
      'key_lookup',
      'AgentKeyLookup not set. Call setSigningKeyLookup() before using signing workflows.',
    );
  }
  return agentKeyLookup;
}

function getSigningRequestPersistence(): SigningRequestPersistence {
  if (!signingRequestPersistence) {
    throw new SigningWorkflowConfigurationError(
      'persistence',
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
    verificationMethod?: VerificationMethod,
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
      requestId: string,
      verificationMethod: VerificationMethod,
      message: string,
      nonce: string,
      signature: string,
      publicKey: string,
    ): Promise<boolean> => {
      try {
        return await getSigningVerifier(verificationMethod).verify({
          verificationMethod,
          message,
          nonce,
          signature,
          publicKey,
        });
      } catch (error) {
        signingWorkflowErrorReporter?.(error, {
          operation: 'verify_signature',
          requestId,
          verificationMethod,
        });
        throw error;
      }
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
      await getSigningRequestPersistence().completeAgentRequest({
        id: requestId,
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
        verificationMethod: VerificationMethod = VERIFICATION_METHOD.AgentEd25519,
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

        // 4. Verify the signature using deterministic pre-hash (buildSigningBytes)
        let valid: boolean;
        try {
          valid = await verifySignatureStep(
            requestId,
            verificationMethod,
            message,
            nonce,
            submission.signature,
            publicKey,
          );
        } catch {
          // A verifier error is a terminal invalid result, not a pending request.
          valid = false;
        }

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
      throw new SigningWorkflowConfigurationError(
        'workflows',
        'Signing workflows not initialized. Call initSigningWorkflows() after configureDBOS().',
      );
    }
    return _workflows.requestSignature;
  },
};

/** @internal Reset module state for testing. */
export function _resetSigningWorkflowsForTesting(): void {
  _workflows = null;
  signingVerifierRegistry.clear();
  signingMethodDriverRegistry.clear();
  agentKeyLookup = null;
  signingRequestPersistence = null;
  signingWorkflowErrorReporter = null;
}
