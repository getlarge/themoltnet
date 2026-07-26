import { randomUUID } from 'node:crypto';

import { type AuthContext, KetoNamespace } from '@moltnet/auth';
import type { SigningCredential, SigningRequest } from '@moltnet/database';
import {
  assertNoPrivateSigningMaterial,
  normalizeSigningCredentialPublicMaterial,
  prepareSigningClaim,
  toSigningMethodReceipt,
  validateSigningCredentialRegistrationBinding,
  verifySigningReceipt,
} from '@moltnet/signing-workflows';

import {
  asSigningMethodJson,
  mapWorkflowError,
  namespace,
  requireHuman,
} from './signing-service.shared.js';
import type { SigningServiceDeps } from './signing-service.types.js';
import { SigningServiceError } from './signing-service-error.js';

const REGISTRATION_TTL_MS = 5 * 60 * 1000;
type VerificationMethod = SigningRequest['verificationMethod'];

export function createSigningCredentialService(deps: SigningServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const createId = deps.createId ?? randomUUID;

  async function canManage(actor: AuthContext, teamId: string) {
    return deps.permissionChecker.canManageTeamCredentials(
      teamId,
      actor.identityId,
      namespace(actor),
    );
  }

  return {
    async beginRegistration(input: {
      actor: AuthContext;
      teamId: string;
      verificationMethod: VerificationMethod;
      credentialType: string;
      algorithm: string;
      publicMaterial: SigningCredential['publicMaterial'];
      label: string;
    }) {
      const actor = requireHuman(
        input.actor,
        'A human session is required for credential enrollment',
      );
      if (
        !(await deps.permissionChecker.canAccessTeam(
          input.teamId,
          actor.identityId,
          KetoNamespace.Human,
        ))
      ) {
        throw new SigningServiceError('forbidden', 'Team access is required');
      }
      const id = createId();
      const expiresAt = new Date(now().getTime() + REGISTRATION_TTL_MS);
      try {
        assertNoPrivateSigningMaterial(input.publicMaterial);
        const normalizedPublicMaterial =
          normalizeSigningCredentialPublicMaterial({
            verificationMethod: input.verificationMethod,
            credentialType: input.credentialType,
            algorithm: input.algorithm,
            publicMaterial: asSigningMethodJson(input.publicMaterial),
          });
        const prepared = await prepareSigningClaim({
          operation: 'credential-registration',
          verificationMethod: input.verificationMethod,
          requestId: id,
          credentialId: id,
          teamId: input.teamId,
          claimantId: actor.humanId,
          purpose: 'signing-credential-registration',
          nonce: id,
          expiresAt: expiresAt.toISOString(),
          signingPayload: JSON.stringify({
            ceremony: 'signing-credential-registration',
            id,
            teamId: input.teamId,
          }),
          credentialPublicMaterial: normalizedPublicMaterial,
        });
        const challenge = {
          verificationMethod: input.verificationMethod,
          value: prepared.challenge,
        };
        await deps.signingCredentialRepository.createRegistration({
          id,
          ownerHumanId: actor.humanId,
          teamId: input.teamId,
          verificationMethod: input.verificationMethod,
          credentialType: input.credentialType,
          algorithm: input.algorithm,
          label: input.label,
          challenge,
          methodState: {
            verificationMethod: input.verificationMethod,
            value: prepared.verifierState,
          },
          expiresAt,
        });
        return { id, challenge, expiresAt };
      } catch (error) {
        mapWorkflowError(error);
      }
    },

    async completeRegistration(input: {
      actor: AuthContext;
      teamId: string;
      registrationId: string;
      publicMaterial: SigningCredential['publicMaterial'];
      receipt: {
        verificationMethod: VerificationMethod;
        value: Record<string, unknown>;
      };
    }) {
      const actor = requireHuman(
        input.actor,
        'A human session is required for credential enrollment',
      );
      try {
        return await deps.transactionRunner.runInTransaction(
          async () => {
            const registration =
              await deps.signingCredentialRepository.lockRegistrationForCompletion(
                input.registrationId,
                actor.humanId,
                input.teamId,
              );
            if (!registration) {
              throw new SigningServiceError(
                'conflict',
                'Credential registration is missing, expired, or already consumed',
              );
            }
            assertNoPrivateSigningMaterial(input.publicMaterial);
            const normalizedPublicMaterial =
              normalizeSigningCredentialPublicMaterial({
                verificationMethod: registration.verificationMethod,
                credentialType: registration.credentialType,
                algorithm: registration.algorithm,
                publicMaterial: asSigningMethodJson(input.publicMaterial),
              });
            validateSigningCredentialRegistrationBinding({
              verificationMethod: registration.verificationMethod,
              publicMaterial: normalizedPublicMaterial,
              verifierState: asSigningMethodJson(
                registration.methodState.value,
              ),
            });
            const evidence = await verifySigningReceipt({
              verificationMethod: registration.verificationMethod,
              requestId: registration.id,
              credentialId: registration.id,
              signingPayload: JSON.stringify({
                ceremony: 'signing-credential-registration',
                id: registration.id,
                teamId: input.teamId,
              }),
              verifierState: asSigningMethodJson(
                registration.methodState.value,
              ),
              operation: 'credential-registration',
              teamId: input.teamId,
              claimantId: actor.humanId,
              purpose: 'signing-credential-registration',
              nonce: registration.id,
              expiresAt: registration.expiresAt.toISOString(),
              credentialPublicMaterial: normalizedPublicMaterial,
              receipt: toSigningMethodReceipt({
                verificationMethod: input.receipt.verificationMethod,
                value: asSigningMethodJson(input.receipt.value),
              }),
            });
            const consumed =
              await deps.signingCredentialRepository.consumeRegistration(
                registration.id,
                actor.humanId,
              );
            if (!consumed) {
              throw new SigningServiceError(
                'conflict',
                'Credential registration was already consumed',
              );
            }
            if (
              evidence.details === undefined ||
              evidence.details === null ||
              Array.isArray(evidence.details) ||
              typeof evidence.details !== 'object'
            ) {
              throw new SigningServiceError(
                'validation_failed',
                'Signing method returned invalid enrollment evidence',
              );
            }
            return deps.signingCredentialRepository.create({
              owner: { kind: 'human', id: actor.humanId },
              teamId: input.teamId,
              verificationMethod: registration.verificationMethod,
              credentialType: registration.credentialType,
              algorithm: registration.algorithm,
              publicMaterial:
                normalizedPublicMaterial as SigningCredential['publicMaterial'],
              enrollmentEvidence:
                evidence.details as SigningCredential['enrollmentEvidence'],
              label: registration.label,
              status: 'pending_approval',
            });
          },
          { name: 'complete-signing-credential-registration' },
        );
      } catch (error) {
        if (error instanceof SigningServiceError) throw error;
        mapWorkflowError(error);
      }
    },

    async list(input: {
      actor: AuthContext;
      teamId: string;
      limit?: number;
      offset?: number;
    }) {
      const manager = await canManage(input.actor, input.teamId);
      let ownerHumanId: string | undefined;
      if (!manager) {
        ownerHumanId = requireHuman(input.actor).humanId;
      }
      return deps.signingCredentialRepository.list({
        teamId: input.teamId,
        ownerHumanId,
        limit: input.limit,
        offset: input.offset,
      });
    },

    async get(input: {
      actor: AuthContext;
      teamId: string;
      credentialId: string;
    }) {
      const credential = await deps.signingCredentialRepository.findById(
        input.credentialId,
      );
      if (!credential || credential.teamId !== input.teamId) {
        throw new SigningServiceError(
          'not_found',
          'Signing credential not found',
        );
      }
      const manager = await canManage(input.actor, input.teamId);
      if (
        !manager &&
        (input.actor.subjectType !== 'human' ||
          credential.ownerHumanId !== input.actor.humanId)
      ) {
        throw new SigningServiceError('forbidden', 'Forbidden');
      }
      return credential;
    },

    async transition(input: {
      actor: AuthContext;
      teamId: string;
      credentialId: string;
      action: 'approve' | 'suspend' | 'revoke';
      from: SigningCredential['status'][];
      to: SigningCredential['status'];
      reason?: string;
    }) {
      if (input.to === 'active' && input.actor.subjectType !== 'human') {
        throw new SigningServiceError(
          'forbidden',
          'Credential approval requires a human credential manager',
        );
      }
      if (!(await canManage(input.actor, input.teamId))) {
        throw new SigningServiceError(
          'forbidden',
          'Team credential management permission is required',
        );
      }
      const actor = {
        kind: input.actor.subjectType,
        id:
          input.actor.subjectType === 'human'
            ? input.actor.humanId
            : input.actor.identityId,
      } as const;
      const result = await deps.transactionRunner.runInTransaction(
        () =>
          deps.signingCredentialRepository.transition({
            id: input.credentialId,
            teamId: input.teamId,
            from: input.from,
            to: input.to,
            approvedByHumanId:
              input.to === 'active' && input.actor.subjectType === 'human'
                ? input.actor.humanId
                : undefined,
            actor,
            reason: input.reason,
          }),
        { name: `signing-credential-${input.action}` },
      );
      if (!result) {
        throw new SigningServiceError(
          'conflict',
          `Credential cannot transition to ${input.to}`,
        );
      }
      return result;
    },
  };
}
