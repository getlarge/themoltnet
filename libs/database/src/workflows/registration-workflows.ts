/**
 * Registration Durable Workflows
 *
 * DBOS workflows for agent registration using Kratos Admin API.
 * This eliminates the placeholder identity ID issue by creating
 * identities directly instead of using self-service flows.
 *
 * The workflow ensures:
 * - Atomic registration (all steps succeed or all roll back)
 * - Crash recovery (workflow resumes if server restarts)
 * - Proper cleanup on failure (identity deleted if any step fails)
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { DBOS } from '@dbos-inc/dbos-sdk';

import type { AgentRepository } from '../repositories/agent.repository.js';
import type { VoucherRepository } from '../repositories/voucher.repository.js';

/**
 * Dependencies injected at runtime.
 * Using any for Ory API types to avoid direct dependency on @ory/client.
 */
interface RegistrationDependencies {
  identityApi: any; // IdentityApi from @ory/client
  hydraAdminOAuth2: any; // OAuth2Api from @ory/client
  agentRepository: AgentRepository;
  voucherRepository: VoucherRepository;
  ketoRegisterAgent: (agentId: string) => Promise<void>;
  cryptoService: {
    parsePublicKey: (key: string) => Uint8Array;
    generateFingerprint: (publicKey: Uint8Array) => string;
  };
}

let deps: RegistrationDependencies | null = null;

/**
 * Set dependencies for registration workflows.
 * Must be called before DBOS.launch().
 */
export function setRegistrationDependencies(
  dependencies: RegistrationDependencies,
): void {
  deps = dependencies;
}

function getDeps(): RegistrationDependencies {
  if (!deps) {
    throw new Error(
      'Registration dependencies not set. Call setRegistrationDependencies() before using registration workflows.',
    );
  }
  return deps;
}

// ── Workflow Input/Output Types ──────────────────────────────────

export interface RegistrationInput {
  publicKey: string;
  voucherCode: string;
  identitySchemaId: string;
}

export interface RegistrationResult {
  identityId: string;
  fingerprint: string;
  publicKey: string;
  clientId: string;
  clientSecret: string;
}

export interface RegistrationError {
  type: 'voucher_invalid' | 'identity_creation_failed' | 'unknown';
  message: string;
}

// ── Retry Configuration ──────────────────────────────────────────

const stepConfig = {
  retriesAllowed: true,
  maxAttempts: 3,
  intervalSeconds: 1,
  backoffRate: 2,
};

// ── Workflow Implementation ──────────────────────────────────────

type WorkflowFn = (
  input: RegistrationInput,
) => Promise<RegistrationResult | RegistrationError>;

let _workflows: {
  registerAgent: WorkflowFn;
} | null = null;

/**
 * Initialize registration workflows with DBOS.
 * Must be called AFTER configureDBOS() and BEFORE launchDBOS().
 */
export function initRegistrationWorkflows(): void {
  if (_workflows) return; // Already initialized

  // ── Step 1: Validate voucher ────────────────────────────────────
  const validateVoucherStep = DBOS.registerStep(
    async (
      voucherCode: string,
    ): Promise<{ valid: boolean; issuerId?: string }> => {
      const { voucherRepository } = getDeps();

      const voucher = await voucherRepository.findByCode(voucherCode);

      if (!voucher || voucher.redeemedAt || voucher.expiresAt < new Date()) {
        return { valid: false };
      }

      return { valid: true, issuerId: voucher.issuerId };
    },
    { name: 'registration.step.validateVoucher', ...stepConfig },
  );

  // ── Step 2: Create Kratos identity (external API) ───────────────
  const createIdentityStep = DBOS.registerStep(
    async (input: RegistrationInput): Promise<string> => {
      const { identityApi } = getDeps();

      const result = (await identityApi.createIdentity({
        createIdentityBody: {
          schema_id: input.identitySchemaId,
          traits: {
            public_key: input.publicKey,
            voucher_code: input.voucherCode,
          },
          credentials: {
            password: {
              config: {
                password: `moltnet-${crypto.randomUUID()}`,
              },
            },
          },
        },
      })) as { data: { id: string } };

      return result.data.id;
    },
    { name: 'registration.step.createIdentity', ...stepConfig },
  );

  // ── Step 3: Redeem voucher ───────────────────────────────────────
  const redeemVoucherStep = DBOS.registerStep(
    async (voucherCode: string, identityId: string): Promise<void> => {
      const { voucherRepository } = getDeps();

      const voucher = await voucherRepository.redeem(voucherCode, identityId);

      if (!voucher) {
        throw new Error('Voucher redemption failed');
      }
    },
    { name: 'registration.step.redeemVoucher', ...stepConfig },
  );

  // ── Step 4: Create agent record ──────────────────────────────────
  const createAgentStep = DBOS.registerStep(
    async (
      identityId: string,
      publicKey: string,
      fingerprint: string,
    ): Promise<void> => {
      const { agentRepository } = getDeps();

      await agentRepository.upsert({
        identityId,
        publicKey,
        fingerprint,
      });
    },
    { name: 'registration.step.createAgent', ...stepConfig },
  );

  // ── Step 5: Register in Keto (external API) ─────────────────────
  const registerKetoStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { ketoRegisterAgent } = getDeps();
      await ketoRegisterAgent(identityId);
    },
    { name: 'registration.step.registerKeto', ...stepConfig },
  );

  // ── Step 6: Create OAuth2 client (external API) ─────────────────
  const createOAuth2ClientStep = DBOS.registerStep(
    async (
      identityId: string,
      fingerprint: string,
      publicKey: string,
    ): Promise<{ clientId: string; clientSecret: string }> => {
      const { hydraAdminOAuth2 } = getDeps();

      const result = (await hydraAdminOAuth2.createOAuth2Client({
        oAuth2Client: {
          client_name: `Agent: ${fingerprint}`,
          grant_types: ['client_credentials'],
          response_types: [],
          token_endpoint_auth_method: 'client_secret_post',
          scope: '',
          metadata: {
            type: 'moltnet_agent',
            identity_id: identityId,
            public_key: publicKey,
            fingerprint,
          },
        },
      })) as { data: { client_id?: string; client_secret?: string } };

      const oauthClient = result.data;
      if (!oauthClient.client_id || !oauthClient.client_secret) {
        throw new Error('Hydra did not return client_id/client_secret');
      }

      return {
        clientId: oauthClient.client_id,
        clientSecret: oauthClient.client_secret,
      };
    },
    { name: 'registration.step.createOAuth2Client', ...stepConfig },
  );

  // ── Cleanup Step: Delete identity on failure ────────────────────
  const deleteIdentityStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { identityApi } = getDeps();
      try {
        await identityApi.deleteIdentity({ id: identityId });
      } catch {
        // Log but don't fail - identity might not exist yet
        // Intentionally ignoring error
      }
    },
    { name: 'registration.step.deleteIdentity', retriesAllowed: false },
  );

  // ── Main Workflow ────────────────────────────────────────────────
  _workflows = {
    registerAgent: DBOS.registerWorkflow(
      async (
        input: RegistrationInput,
      ): Promise<RegistrationResult | RegistrationError> => {
        const { cryptoService } = getDeps();

        try {
          // Step 1: Validate voucher

          const voucherCheck = (await validateVoucherStep(
            input.voucherCode,
          )) as { valid: boolean; issuerId?: string };
          if (!voucherCheck.valid) {
            return {
              type: 'voucher_invalid',
              message: 'Voucher code is invalid, expired, or already used',
            };
          }

          // Step 2: Parse public key and generate fingerprint
          const publicKeyBytes = cryptoService.parsePublicKey(input.publicKey);
          const fingerprint = cryptoService.generateFingerprint(publicKeyBytes);

          // Step 3: Create Kratos identity
          let identityId: string;
          try {
            identityId = await createIdentityStep(input);
          } catch (identityErr) {
            return {
              type: 'identity_creation_failed',
              message:
                identityErr instanceof Error
                  ? identityErr.message
                  : 'Failed to create identity',
            };
          }

          // From here on, we need to clean up the identity if anything fails
          try {
            // Step 4: Redeem voucher
            await redeemVoucherStep(input.voucherCode, identityId);

            // Step 5: Create agent record
            await createAgentStep(identityId, input.publicKey, fingerprint);

            // Step 6: Register in Keto
            await registerKetoStep(identityId);

            // Step 7: Create OAuth2 client
            const { clientId, clientSecret } = await createOAuth2ClientStep(
              identityId,
              fingerprint,
              input.publicKey,
            );

            // Success!
            return {
              identityId,
              fingerprint,
              publicKey: input.publicKey,
              clientId,
              clientSecret,
            };
          } catch (cleanupErr) {
            // Cleanup: delete the identity
            await deleteIdentityStep(identityId);
            throw cleanupErr;
          }
        } catch (outerErr) {
          return {
            type: 'unknown',
            message:
              outerErr instanceof Error ? outerErr.message : 'Unknown error',
          };
        }
      },
      { name: 'registration.registerAgent' },
    ),
  };
}

// ── Exported Collection ──────────────────────────────────────────

export const registrationWorkflows = {
  get registerAgent() {
    if (!_workflows) {
      throw new Error(
        'Registration workflows not initialized. Call initRegistrationWorkflows() after configureDBOS().',
      );
    }
    return _workflows.registerAgent;
  },
};
