import { isDeepStrictEqual } from 'node:util';

import { type AuthContext, teamRelationToRole } from '@moltnet/auth';
import { buildSigningBytes } from '@moltnet/crypto-service';
import { DBOS, type SigningRequest } from '@moltnet/database';
import { SIGNER_CONSTRAINT_TYPE, VERIFICATION_METHOD } from '@moltnet/models';
import {
  assertSigningVerifierRegistered,
  prepareSigningClaim,
  SigningResultTimeoutError,
  signingWorkflows,
  toSigningMethodReceipt,
  verifySigningReceipt,
  waitForSigningResult,
} from '@moltnet/signing-workflows';

import {
  asSigningMethodJson,
  mapWorkflowError,
  namespace,
  requireHuman,
} from './signing-service.shared.js';
import type { SigningServiceDeps } from './signing-service.types.js';
import { SigningServiceError } from './signing-service-error.js';

type VerificationMethod = SigningRequest['verificationMethod'];
type SignerConstraint = NonNullable<SigningRequest['signerConstraint']>;

interface EligibilityContext {
  humanId: string;
  identityId: string;
  rolesByTeam: Map<string, ReturnType<typeof teamRelationToRole>>;
  groupIds: Set<string>;
  groupTeamIds: Map<string, string>;
}

function signingPayload(row: SigningRequest): string {
  return Buffer.from(buildSigningBytes(row.message, row.nonce)).toString(
    'base64',
  );
}

function requester(actor: AuthContext) {
  return {
    id: actor.subjectType === 'human' ? actor.humanId : actor.identityId,
    type: actor.subjectType,
  } as const;
}

export function createSigningRequestService(deps: SigningServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function createEligibilityContext(
    actor: AuthContext,
  ): Promise<EligibilityContext | null> {
    if (actor.subjectType !== 'human') return null;
    const [roles, groupIds] = await Promise.all([
      deps.relationshipReader.listTeamIdsAndRolesBySubject(actor.identityId),
      deps.relationshipReader.listGroupIdsBySubject(actor.identityId),
    ]);
    const groups = await deps.groupRepository.findByIds(groupIds);
    return {
      humanId: actor.humanId,
      identityId: actor.identityId,
      rolesByTeam: new Map(
        roles.map(({ teamId, relation }) => [
          teamId,
          teamRelationToRole(relation),
        ]),
      ),
      groupIds: new Set(groupIds),
      groupTeamIds: new Map(
        [...groups.values()].map((group) => [group.id, group.teamId]),
      ),
    };
  }

  function isEligibleHuman(
    context: EligibilityContext | null,
    row: SigningRequest,
  ): boolean {
    if (!context || !row.teamId || !row.signerConstraint) return false;
    if (!context.rolesByTeam.has(row.teamId)) return false;
    const constraint = row.signerConstraint;
    switch (constraint.type) {
      case SIGNER_CONSTRAINT_TYPE.Human:
        return (
          constraint.id === context.humanId ||
          constraint.id === context.identityId
        );
      case SIGNER_CONSTRAINT_TYPE.TeamRole:
        return context.rolesByTeam.get(row.teamId) === constraint.id;
      case SIGNER_CONSTRAINT_TYPE.Group:
        return (
          context.groupIds.has(constraint.id) &&
          context.groupTeamIds.get(constraint.id) === row.teamId
        );
    }
  }

  return {
    async create(input: {
      actor: AuthContext;
      message: string;
      verificationMethod: VerificationMethod;
      teamId?: string;
      purpose?: string;
      signerConstraint?: SignerConstraint;
    }) {
      try {
        assertSigningVerifierRegistered(input.verificationMethod);
      } catch (error) {
        mapWorkflowError(error);
      }
      if (input.verificationMethod !== VERIFICATION_METHOD.AgentEd25519) {
        if (!input.teamId || !input.purpose || !input.signerConstraint) {
          throw new SigningServiceError(
            'validation_failed',
            'Delegated signing requires teamId, purpose, and signerConstraint',
          );
        }
        if (
          !(await deps.permissionChecker.canAccessTeam(
            input.teamId,
            input.actor.identityId,
            namespace(input.actor),
          ))
        ) {
          throw new SigningServiceError('forbidden', 'Forbidden');
        }
      }

      const agentId = input.actor.identityId;
      const expiresAt = new Date(
        now().getTime() + deps.signingTimeoutSeconds * 1000,
      );
      const created = await deps.signingRequestRepository.create({
        agentId,
        message: input.message,
        expiresAt,
        verificationMethod: input.verificationMethod,
        requestedBy: requester(input.actor),
        signerConstraint: input.signerConstraint,
        teamId: input.teamId,
        purpose: input.purpose,
      });

      if (input.verificationMethod === VERIFICATION_METHOD.AgentEd25519) {
        // This legacy workflow call and its signing bytes remain unchanged.
        const workflowHandle = await DBOS.startWorkflow(
          signingWorkflows.requestSignature,
          { workflowID: `signing-${created.id}` },
        )(
          created.id,
          agentId,
          input.message,
          created.nonce,
          created.verificationMethod,
        );
        await deps.signingRequestRepository.setWorkflowId(
          created.id,
          workflowHandle.workflowID,
        );
      }
      return created;
    },

    async list(input: {
      actor: AuthContext;
      scope: 'requested' | 'signable';
      status?: SigningRequest['status'][];
      limit?: number;
      offset?: number;
    }) {
      if (input.scope === 'signable' && input.actor.subjectType !== 'human') {
        return { items: [], total: 0 };
      }
      const eligibility =
        input.scope === 'signable'
          ? await createEligibilityContext(input.actor)
          : null;
      if (input.scope === 'signable' && eligibility?.rolesByTeam.size === 0) {
        return { items: [], total: 0 };
      }
      return input.scope === 'signable' && eligibility
        ? deps.signingRequestRepository.listSignable({
            teamRoles: [...eligibility.rolesByTeam].map(([teamId, role]) => ({
              teamId,
              role,
            })),
            humanIds: [eligibility.humanId, eligibility.identityId],
            groups: [...eligibility.groupTeamIds].map(([groupId, teamId]) => ({
              groupId,
              teamId,
            })),
            status: input.status?.filter(
              (value): value is 'pending' | 'claimed' =>
                value === 'pending' || value === 'claimed',
            ),
            limit: input.limit,
            offset: input.offset,
          })
        : deps.signingRequestRepository.list({
            agentId: input.actor.identityId,
            status: input.status,
            limit: input.limit,
            offset: input.offset,
          });
    },

    async get(input: { actor: AuthContext; requestId: string }) {
      const row = await deps.signingRequestRepository.findById(input.requestId);
      if (
        !row ||
        (row.agentId !== input.actor.identityId &&
          row.claimedByHumanId !==
            (input.actor.subjectType === 'human' ? input.actor.humanId : null))
      ) {
        throw new SigningServiceError('not_found', 'Signing request not found');
      }
      return row;
    },

    async claim(input: {
      actor: AuthContext;
      teamId: string;
      requestId: string;
      credentialId: string;
    }) {
      const actor = requireHuman(input.actor);
      const row = await deps.signingRequestRepository.findById(input.requestId);
      if (!row || row.teamId !== input.teamId || !row.signerConstraint) {
        throw new SigningServiceError('not_found', 'Signing request not found');
      }
      if (
        row.status === 'claimed' &&
        row.claimedByHumanId === actor.humanId &&
        row.signingCredentialId === input.credentialId &&
        row.expiresAt > now()
      ) {
        return row;
      }
      if (!isEligibleHuman(await createEligibilityContext(actor), row)) {
        throw new SigningServiceError('forbidden', 'Forbidden');
      }
      const credential =
        await deps.signingCredentialRepository.findActiveCompatible({
          id: input.credentialId,
          ownerHumanId: actor.humanId,
          teamId: row.teamId,
          verificationMethod: row.verificationMethod,
        });
      if (!credential) {
        throw new SigningServiceError(
          'validation_failed',
          'An active compatible signing credential is required',
        );
      }
      try {
        const prepared = await prepareSigningClaim({
          verificationMethod: row.verificationMethod,
          requestId: row.id,
          credentialId: credential.id,
          signingPayload: signingPayload(row),
          credentialPublicMaterial: asSigningMethodJson(
            credential.publicMaterial,
          ),
        });
        const claimed = await deps.signingRequestRepository.claim({
          id: row.id,
          humanId: actor.humanId,
          credentialId: credential.id,
          challenge: {
            verificationMethod: row.verificationMethod,
            value: prepared.challenge,
          },
          methodState: {
            verificationMethod: row.verificationMethod,
            value: prepared.verifierState,
          },
        });
        if (!claimed) {
          throw new SigningServiceError(
            'conflict',
            'Signing request was already claimed, completed, rejected, or expired',
          );
        }
        return claimed;
      } catch (error) {
        if (error instanceof SigningServiceError) throw error;
        mapWorkflowError(error);
      }
    },

    async complete(input: {
      actor: AuthContext;
      teamId: string;
      requestId: string;
      receipt: {
        verificationMethod: VerificationMethod;
        value: Record<string, unknown>;
      };
    }) {
      const actor = requireHuman(input.actor);
      const row = await deps.signingRequestRepository.findById(input.requestId);
      if (
        row?.teamId === input.teamId &&
        row.status === 'completed' &&
        row.claimedByHumanId === actor.humanId &&
        row.signingCredentialId &&
        isDeepStrictEqual(row.receipt, input.receipt)
      ) {
        return row;
      }
      if (
        row?.teamId === input.teamId &&
        row.status === 'claimed' &&
        row.claimedByHumanId !== actor.humanId
      ) {
        throw new SigningServiceError('forbidden', 'Forbidden');
      }
      if (
        !row ||
        row.teamId !== input.teamId ||
        row.status !== 'claimed' ||
        row.claimedByHumanId !== actor.humanId ||
        !row.signingCredentialId ||
        !row.methodState
      ) {
        throw new SigningServiceError(
          'conflict',
          'Signing request is not claimed by this human',
        );
      }
      const credential =
        await deps.signingCredentialRepository.findActiveCompatible({
          id: row.signingCredentialId,
          ownerHumanId: actor.humanId,
          teamId: row.teamId,
          verificationMethod: row.verificationMethod,
        });
      if (!credential) {
        throw new SigningServiceError(
          'validation_failed',
          'The claimed signing credential is no longer active',
        );
      }
      try {
        const completed = await deps.transactionRunner.runInTransaction(
          async () => {
            const locked =
              await deps.signingRequestRepository.lockClaimForCompletion({
                id: row.id,
                humanId: actor.humanId,
                credentialId: credential.id,
              });
            if (!locked?.methodState) {
              const current = await deps.signingRequestRepository.findById(
                row.id,
              );
              if (
                current?.status === 'completed' &&
                current.claimedByHumanId === actor.humanId &&
                current.signingCredentialId === credential.id &&
                isDeepStrictEqual(current.receipt, input.receipt)
              ) {
                return current;
              }
              throw new SigningServiceError(
                'conflict',
                'Signing request was already completed, rejected, or expired',
              );
            }
            await verifySigningReceipt({
              verificationMethod: locked.verificationMethod,
              requestId: locked.id,
              credentialId: credential.id,
              signingPayload: signingPayload(locked),
              credentialPublicMaterial: asSigningMethodJson(
                credential.publicMaterial,
              ),
              verifierState: asSigningMethodJson(locked.methodState.value),
              receipt: toSigningMethodReceipt({
                verificationMethod: input.receipt.verificationMethod,
                value: asSigningMethodJson(input.receipt.value),
              }),
            });
            return deps.signingRequestRepository.completeClaim({
              id: locked.id,
              humanId: actor.humanId,
              credentialId: credential.id,
              receipt: input.receipt,
              valid: true,
            });
          },
          { name: 'complete-signing-request' },
        );
        if (!completed) {
          throw new SigningServiceError(
            'conflict',
            'Signing request was already completed, rejected, or expired',
          );
        }
        return completed;
      } catch (error) {
        if (error instanceof SigningServiceError) throw error;
        mapWorkflowError(error);
      }
    },

    async reject(input: {
      actor: AuthContext;
      teamId: string;
      requestId: string;
      reason?: string;
    }) {
      const actor = requireHuman(input.actor);
      const row = await deps.signingRequestRepository.findById(input.requestId);
      if (!row || row.teamId !== input.teamId) {
        throw new SigningServiceError('not_found', 'Signing request not found');
      }
      const eligible = isEligibleHuman(
        await createEligibilityContext(actor),
        row,
      );
      if (
        (row.status === 'claimed' && row.claimedByHumanId !== actor.humanId) ||
        (row.status === 'pending' && !eligible)
      ) {
        throw new SigningServiceError('forbidden', 'Forbidden');
      }
      const rejected = await deps.signingRequestRepository.reject({
        id: row.id,
        humanId: actor.humanId,
        reason: input.reason,
      });
      if (!rejected) {
        throw new SigningServiceError(
          'conflict',
          'Signing request was already completed, rejected, or expired',
        );
      }
      return rejected;
    },

    async submitAgentSignature(input: {
      actor: AuthContext;
      requestId: string;
      signature: string;
    }) {
      const row = await deps.signingRequestRepository.findById(input.requestId);
      if (!row || row.agentId !== input.actor.identityId) {
        throw new SigningServiceError('not_found', 'Signing request not found');
      }
      if (row.verificationMethod !== VERIFICATION_METHOD.AgentEd25519) {
        throw new SigningServiceError(
          'validation_failed',
          'This request requires the delegated claim/complete flow; sign only supports agent-ed25519',
        );
      }
      if (
        row.status === 'expired' ||
        (row.expiresAt && row.expiresAt.getTime() <= now().getTime())
      ) {
        throw new SigningServiceError(
          'signing_request_expired',
          'This signing request has expired',
        );
      }
      if (row.status === 'completed') {
        throw new SigningServiceError(
          'signing_request_already_completed',
          'A signature has already been submitted for this request',
        );
      }
      if (!row.workflowId) {
        throw new SigningServiceError(
          'not_found',
          'Signing request workflow not initialized',
        );
      }
      await DBOS.send(
        row.workflowId,
        { signature: input.signature },
        'signature',
      );
      try {
        return await waitForSigningResult(input.requestId, {
          initial: row,
          load: (requestId) =>
            deps.signingRequestRepository.findById(requestId),
        });
      } catch (error) {
        if (error instanceof SigningResultTimeoutError) {
          throw new SigningServiceError(
            'conflict',
            'Signature was accepted but verification is still pending; retry the request',
            { cause: error },
          );
        }
        throw error;
      }
    },
  };
}
