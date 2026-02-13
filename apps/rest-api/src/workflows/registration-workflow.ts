/**
 * Registration Durable Workflow
 *
 * DBOS workflow for agent registration. Replaces the Kratos self-service
 * registration flow with a direct Admin API call, getting the real
 * identityId immediately instead of a placeholder.
 *
 * Steps:
 * 1. Validate voucher code
 * 2. Create Kratos identity via Admin API
 * 3. Persist agent + redeem voucher (DB transaction)
 * 4. Register agent in Keto
 * 5. Create OAuth2 client in Hydra
 *
 * Compensation: if steps 3-5 fail, the Kratos identity is deleted.
 *
 * ## Initialization Order
 *
 * Workflows are registered lazily via `initRegistrationWorkflow()`.
 * This allows the module to be imported before DBOS is configured.
 * Call `setRegistrationDeps()` before `initRegistrationWorkflow()`.
 */

import type { PermissionChecker } from '@moltnet/auth';
import {
  type AgentRepository,
  type DataSource,
  DBOS,
  type VoucherRepository,
} from '@moltnet/database';
import type { IdentityApi, OAuth2Api } from '@ory/client';

// ── Error Classes ──────────────────────────────────────────────

export class VoucherValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoucherValidationError';
  }
}

export class RegistrationWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationWorkflowError';
  }
}

// ── Types ──────────────────────────────────────────────────────

export interface RegistrationDeps {
  identityApi: IdentityApi;
  oauth2Api: OAuth2Api;
  voucherRepository: VoucherRepository;
  agentRepository: AgentRepository;
  permissionChecker: PermissionChecker;
  dataSource: DataSource;
}

export interface RegistrationResult {
  identityId: string;
  fingerprint: string;
  publicKey: string;
  clientId: string;
  clientSecret: string;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: RegistrationDeps | null = null;

export function setRegistrationDeps(d: RegistrationDeps): void {
  deps = d;
}

function getDeps(): RegistrationDeps {
  if (!deps) {
    throw new Error(
      'Registration deps not set. Call setRegistrationDeps() ' +
        'before using registration workflows.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type RegisterAgentFn = (
  publicKey: string,
  fingerprint: string,
  voucherCode: string,
) => Promise<RegistrationResult>;

let _workflow: RegisterAgentFn | null = null;

/**
 * Initialize and register the registration workflow with DBOS.
 *
 * Must be called AFTER configureDBOS() and setRegistrationDeps(),
 * and BEFORE launchDBOS().
 * Idempotent - safe to call multiple times.
 */
export function initRegistrationWorkflow(): void {
  if (_workflow) return; // Already initialized

  // ── Steps ──────────────────────────────────────────────────

  const validateVoucherStep = DBOS.registerStep(
    async (code: string): Promise<void> => {
      const { voucherRepository } = getDeps();
      const voucher = await voucherRepository.findByCode(code);
      if (!voucher) {
        throw new VoucherValidationError('Voucher not found');
      }
      if (voucher.redeemedAt !== null) {
        throw new VoucherValidationError('Voucher has already been redeemed');
      }
      if (voucher.expiresAt <= new Date()) {
        throw new VoucherValidationError('Voucher has expired');
      }
    },
    { name: 'registration.step.validateVoucher', retriesAllowed: false },
  );

  const createKratosIdentityStep = DBOS.registerStep(
    async (publicKey: string, voucherCode: string): Promise<string> => {
      const { identityApi } = getDeps();

      // Resolve the agent schema by matching $id containing "agent"
      const { data: schemas } = await identityApi.listIdentitySchemas();
      const agentSchema = schemas.find(
        (s) => (s.schema as { $id?: string })?.$id?.includes('agent') ?? false,
      );
      if (!agentSchema) {
        throw new RegistrationWorkflowError(
          'Agent identity schema not found — ensure the ' +
            'Ory project has a schema with $id containing ' +
            '"agent"',
        );
      }

      const { data: identity } = await identityApi.createIdentity({
        createIdentityBody: {
          schema_id: agentSchema.id,
          traits: {
            public_key: publicKey,
            voucher_code: voucherCode,
          },
          credentials: {
            password: {
              config: {
                password: `moltnet-${crypto.randomUUID()}`,
              },
            },
          },
        },
      });

      return identity.id;
    },
    {
      name: 'registration.step.createKratosIdentity',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const registerInKetoStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const { permissionChecker } = getDeps();
      await permissionChecker.registerAgent(identityId);
    },
    {
      name: 'registration.step.registerInKeto',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const createOAuth2ClientStep = DBOS.registerStep(
    async (
      identityId: string,
      publicKey: string,
      fingerprint: string,
    ): Promise<{ clientId: string; clientSecret: string }> => {
      const { oauth2Api } = getDeps();

      const { data: oauthClient } = await oauth2Api.createOAuth2Client({
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
      });

      if (!oauthClient.client_id || !oauthClient.client_secret) {
        throw new RegistrationWorkflowError(
          'Hydra did not return client_id/client_secret',
        );
      }

      return {
        clientId: oauthClient.client_id,
        clientSecret: oauthClient.client_secret,
      };
    },
    {
      name: 'registration.step.createOAuth2Client',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  // ── Workflow ─────────────────────────────────────────────────

  _workflow = DBOS.registerWorkflow(
    async (
      publicKey: string,
      fingerprint: string,
      voucherCode: string,
    ): Promise<RegistrationResult> => {
      // Step 1: Validate voucher
      await validateVoucherStep(voucherCode);

      // Step 2: Create Kratos identity
      const identityId = await createKratosIdentityStep(publicKey, voucherCode);

      // Steps 3-5 have compensation: delete Kratos identity on failure
      try {
        // Step 3: Persist agent + redeem voucher in a DB transaction
        const { dataSource, agentRepository, voucherRepository } = getDeps();
        await dataSource.runTransaction(
          async () => {
            await agentRepository.upsert({
              identityId,
              publicKey,
              fingerprint,
            });
            const redeemed = await voucherRepository.redeem(
              voucherCode,
              identityId,
            );
            if (!redeemed) {
              throw new RegistrationWorkflowError(
                'Voucher redemption failed during transaction',
              );
            }
          },
          { name: 'registration.tx.persist' },
        );

        // Step 4: Register in Keto
        await registerInKetoStep(identityId);

        // Step 5: Create OAuth2 client
        const { clientId, clientSecret } = await createOAuth2ClientStep(
          identityId,
          publicKey,
          fingerprint,
        );

        return {
          identityId,
          fingerprint,
          publicKey,
          clientId,
          clientSecret,
        };
      } catch (error: unknown) {
        // Compensation: delete the Kratos identity
        const errorMsg = error instanceof Error ? error.message : String(error);
        DBOS.logger.error(
          `Registration failed after Kratos identity creation ` +
            `(identityId=${identityId}): ${errorMsg}. ` +
            `Compensating by deleting identity.`,
        );

        try {
          const { identityApi } = getDeps();
          await identityApi.deleteIdentity({ id: identityId });
        } catch (compensationError: unknown) {
          const compMsg =
            compensationError instanceof Error
              ? compensationError.message
              : String(compensationError);
          DBOS.logger.error(
            `Compensation failed: could not delete Kratos ` +
              `identity (identityId=${identityId}): ${compMsg}`,
          );
        }

        throw error;
      }
    },
    { name: 'registration.registerAgent' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const registrationWorkflow = {
  get registerAgent() {
    if (!_workflow) {
      throw new Error(
        'Registration workflow not initialized. ' +
          'Call initRegistrationWorkflow() after ' +
          'configureDBOS().',
      );
    }
    return _workflow;
  },
};
