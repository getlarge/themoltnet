/**
 * Identity Key Rotation Workflow
 *
 * Replaces an agent's Ed25519 identity key after the route has verified the
 * dual-signed rotation proof.
 *
 * Steps:
 * 1. Postgres (authoritative): compare-and-swap `agents.public_key`; the
 *    agents trigger closes the old key's history row and opens the new one,
 *    and the proof is attached to it — one transaction.
 * 2. Kratos: replace `traits.public_key` on the bound identity.
 * 3. Hydra: patch each agent client's `public_key`/`fingerprint` metadata and
 *    display name, then revoke its tokens. Revocation reaches opaque tokens;
 *    JWT access tokens are verified locally and expire on their own. Their
 *    stale key claims are harmless because the API reads the key from the
 *    agents row.
 * 4. Evict this process's auth caches for the identity and clients.
 *
 * Steps 2–4 are idempotent and retried. They reconcile Ory with the committed
 * database state; if they exhaust their retries the rotation has still
 * happened, and the logged repair is to fork the workflow from the failed
 * step. Signature verification never reads Ory, so old signatures keep
 * verifying through the history in the meantime.
 */

import type {
  AgentIdentityKeyRepository,
  AgentRepository,
} from '@moltnet/database';
import {
  AgentFingerprintConflictError,
  AgentIdentityKeyStaleError,
  DBOS,
  type IdentityKeyRotationProof,
  type TransactionRunner,
} from '@moltnet/database';
import type { IdentityApi, OAuth2Api } from '@ory/client-fetch';

import { upstreamStatus } from '../utils/upstream-status.js';
import type { Logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────

export interface IdentityKeyRotationInput {
  agentId: string;
  identityId: string | null;
  currentPublicKey: string;
  newPublicKey: string;
  newFingerprint: string;
  proof: IdentityKeyRotationProof;
  /** Hydra clients whose metadata names the agent's key. */
  clientIds: string[];
}

export type IdentityKeyRotationResult =
  | {
      status: 'rotated';
      agentId: string;
      publicKey: string;
      fingerprint: string;
      previousFingerprint: string;
    }
  /** The current key is no longer the one the proof retires. */
  | { status: 'stale' }
  /** The new key's fingerprint is already, or was once, in use. */
  | { status: 'conflict' };

export interface IdentityKeyRotationDeps {
  identityApi: Pick<IdentityApi, 'patchIdentity'>;
  oauth2Api: Pick<OAuth2Api, 'patchOAuth2Client' | 'deleteOAuth2Token'>;
  agentRepository: AgentRepository;
  agentIdentityKeyRepository: AgentIdentityKeyRepository;
  transactionRunner: TransactionRunner;
  /** Drop this process's cached auth state for the identity and clients. */
  evictAuthCaches: (input: {
    identityId: string | null;
    clientIds: string[];
  }) => Promise<void>;
  logger: Logger;
}

// ── Dependency Injection ───────────────────────────────────────

let deps: IdentityKeyRotationDeps | null = null;

export function setIdentityKeyRotationDeps(d: IdentityKeyRotationDeps): void {
  deps = d;
}

function getDeps(): IdentityKeyRotationDeps {
  if (!deps) {
    throw new Error(
      'Identity key rotation deps not set. Call setIdentityKeyRotationDeps() before using.',
    );
  }
  return deps;
}

// ── Lazy Registration ──────────────────────────────────────────

type RotateIdentityKeyFn = (
  input: IdentityKeyRotationInput,
) => Promise<IdentityKeyRotationResult>;

let _workflow: RotateIdentityKeyFn | null = null;

const reconcileStepConfig = {
  retriesAllowed: true,
  maxAttempts: 5,
  intervalSeconds: 2,
  backoffRate: 2,
};

export function initIdentityKeyRotationWorkflow(): void {
  if (_workflow) return;

  const updateKratosIdentityStep = DBOS.registerStep(
    async (identityId: string, publicKey: string): Promise<void> => {
      await getDeps().identityApi.patchIdentity({
        id: identityId,
        jsonPatch: [
          { op: 'replace', path: '/traits/public_key', value: publicKey },
        ],
      });
    },
    {
      name: 'identity.rotation.step.updateKratosIdentity',
      ...reconcileStepConfig,
    },
  );

  const updateHydraClientStep = DBOS.registerStep(
    async (
      clientId: string,
      publicKey: string,
      fingerprint: string,
    ): Promise<void> => {
      const { oauth2Api } = getDeps();
      try {
        await oauth2Api.patchOAuth2Client({
          id: clientId,
          jsonPatch: [
            {
              op: 'replace',
              path: '/client_name',
              value: `Agent: ${fingerprint}`,
            },
            { op: 'add', path: '/metadata/public_key', value: publicKey },
            { op: 'add', path: '/metadata/fingerprint', value: fingerprint },
          ],
        });
      } catch (err) {
        // An agent authenticating only with agent keys may have no client.
        if (upstreamStatus(err) === 404) return;
        throw err;
      }
      // Issued tokens carry the old key in their claims. This revokes the
      // opaque ones; JWTs are verified locally and run to expiry.
      await oauth2Api.deleteOAuth2Token({ clientId });
    },
    {
      name: 'identity.rotation.step.updateHydraClient',
      ...reconcileStepConfig,
    },
  );

  const evictAuthCachesStep = DBOS.registerStep(
    async (identityId: string | null, clientIds: string[]): Promise<void> => {
      await getDeps().evictAuthCaches({ identityId, clientIds });
    },
    { name: 'identity.rotation.step.evictAuthCaches', ...reconcileStepConfig },
  );

  _workflow = DBOS.registerWorkflow(
    async (
      input: IdentityKeyRotationInput,
    ): Promise<IdentityKeyRotationResult> => {
      const { agentRepository, agentIdentityKeyRepository } = getDeps();

      const committed = await getDeps().transactionRunner.runInTransaction(
        async (): Promise<
          | { status: 'rotated'; previousFingerprint: string }
          | { status: 'stale' }
          | { status: 'conflict' }
        > => {
          const agent = await agentRepository.findById(input.agentId);
          if (!agent) return { status: 'stale' };
          if (agent.publicKey === input.newPublicKey) {
            // A replayed transaction after the key already moved: success
            // only when the history proves this proof made that move.
            const current = await agentIdentityKeyRepository.findByFingerprint(
              input.newFingerprint,
            );
            if (current?.rotationProof?.message !== input.proof.message) {
              return { status: 'stale' };
            }
            const history = await agentIdentityKeyRepository.listForAgent(
              input.agentId,
            );
            const previous = history.find(
              (row) => row.publicKey === input.currentPublicKey,
            );
            return {
              status: 'rotated',
              previousFingerprint: previous?.fingerprint ?? '',
            };
          }
          try {
            await agentRepository.rotateIdentityKey({
              agentId: input.agentId,
              currentPublicKey: input.currentPublicKey,
              publicKey: input.newPublicKey,
              fingerprint: input.newFingerprint,
            });
          } catch (err) {
            if (err instanceof AgentIdentityKeyStaleError) {
              return { status: 'stale' };
            }
            if (err instanceof AgentFingerprintConflictError) {
              return { status: 'conflict' };
            }
            throw err;
          }
          await agentIdentityKeyRepository.attachRotationProof(
            input.agentId,
            input.newPublicKey,
            input.proof,
          );
          return {
            status: 'rotated',
            previousFingerprint: agent.fingerprint,
          };
        },
        { name: 'identity.rotation.tx.rotate' },
      );
      if (committed.status !== 'rotated') return committed;

      try {
        if (input.identityId) {
          await updateKratosIdentityStep(input.identityId, input.newPublicKey);
        }
        for (const clientId of input.clientIds) {
          await updateHydraClientStep(
            clientId,
            input.newPublicKey,
            input.newFingerprint,
          );
        }
        await evictAuthCachesStep(input.identityId, input.clientIds);
      } catch (err) {
        getDeps().logger.error(
          {
            err,
            agentId: input.agentId,
            workflowId: DBOS.workflowID,
            repair:
              'the key is rotated in Postgres; fork the failed DBOS workflow from its reconciliation step',
          },
          'identity.rotation.ory_reconciliation_exhausted',
        );
        throw err;
      }

      return {
        status: 'rotated',
        agentId: input.agentId,
        publicKey: input.newPublicKey,
        fingerprint: input.newFingerprint,
        previousFingerprint: committed.previousFingerprint,
      };
    },
    { name: 'identity.rotation.rotateIdentityKey' },
  );
}

// ── Exported Collection ────────────────────────────────────────

export const identityKeyRotationWorkflow = {
  get rotateIdentityKey(): RotateIdentityKeyFn {
    if (!_workflow) {
      throw new Error(
        'Identity key rotation workflow not initialized. Call initIdentityKeyRotationWorkflow().',
      );
    }
    return _workflow;
  },
};
