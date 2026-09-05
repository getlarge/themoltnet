import type {
  AgentKeySubject,
  AgentKeyWithSecret,
  IssueAgentKeyInput,
} from '@moltnet/agent-key-service';
import {
  AGENT_IDENTITY_SCHEMA_ID,
  AGENT_OAUTH_SCOPES,
  KetoNamespace,
  type RelationshipWriter,
  TEAM_ROLE,
  type TeamInviteRole,
} from '@moltnet/auth';
import {
  type AgentRepository,
  DBOS,
  type DiaryRepository,
  type TeamRepository,
  type TransactionRunner,
} from '@moltnet/database';
import type { IdentityApi, OAuth2Api } from '@ory/client-fetch';

import { agentOAuth2ClientId } from '../utils/agent-oauth-client-id.js';
import type { Logger } from './logger.js';

export type RegistrationCredentialType = 'oauth2' | 'agent_key';

export type RegistrationMode =
  | { type: 'self' }
  | { type: 'team_invite'; inviteId: string; inviteCodeHash: string };

export interface RegistrationInput {
  credentialType: RegistrationCredentialType;
  fingerprint: string;
  idempotencyKey: string;
  mode: RegistrationMode;
  publicKey: string;
}

export function registrationInputsEqual(
  left: RegistrationInput,
  right: RegistrationInput,
): boolean {
  if (
    left.credentialType !== right.credentialType ||
    left.fingerprint !== right.fingerprint ||
    left.idempotencyKey !== right.idempotencyKey ||
    left.publicKey !== right.publicKey ||
    left.mode.type !== right.mode.type
  ) {
    return false;
  }
  return (
    left.mode.type === 'self' ||
    (left.mode.type === 'team_invite' &&
      right.mode.type === 'team_invite' &&
      left.mode.inviteId === right.mode.inviteId &&
      left.mode.inviteCodeHash === right.mode.inviteCodeHash)
  );
}

export type RegistrationCredential =
  | {
      type: 'oauth2';
      clientId: string;
      clientSecret: string;
    }
  | ({ type: 'agent_key' } & AgentKeyWithSecret);

export interface RegistrationResult {
  /** Internal agents.id — stable across Kratos identity recreation. */
  agentId: string;
  identityId: string;
  fingerprint: string;
  publicKey: string;
  credential: RegistrationCredential;
}

export interface RegistrationWorkflowResult {
  /** Internal agents.id — stable across Kratos identity recreation. */
  agentId: string;
  identityId: string;
  identityOwnedForCompensation: boolean;
  fingerprint: string;
  publicKey: string;
  teamId: string;
  credentialType: RegistrationCredentialType;
  credentialIdempotencyKey: string;
}

export class EnrollmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentValidationError';
  }
}

export class RegistrationWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationWorkflowError';
  }
}

export interface RegistrationDeps {
  identityApi: IdentityApi;
  oauth2Api: OAuth2Api;
  agentRepository: AgentRepository;
  diaryRepository: DiaryRepository;
  teamRepository: TeamRepository;
  relationshipWriter: RelationshipWriter;
  issueAgentKey: (input: IssueAgentKeyInput) => Promise<AgentKeyWithSecret>;
  transactionRunner: TransactionRunner;
  logger: Logger;
}

let deps: RegistrationDeps | null = null;

export function setRegistrationDeps(value: RegistrationDeps): void {
  deps = value;
}

function getDeps(): RegistrationDeps {
  if (!deps) {
    throw new Error(
      'Registration deps not set. Call setRegistrationDeps() before using registration workflows.',
    );
  }
  return deps;
}

type RegisterAgentFn = (
  input: RegistrationInput,
) => Promise<RegistrationWorkflowResult>;
type CompensateSelfRegistrationFn = (
  agentId: string,
  identityId: string | null,
  deleteIdentity: boolean,
) => Promise<void>;
type CompensateTeamEnrollmentFn = (
  teamId: string,
  inviteId: string | null,
  agentId: string,
  identityId: string | null,
  deleteIdentity: boolean,
) => Promise<void>;

let _workflow: RegisterAgentFn | null = null;
let _compensateSelfRegistration: CompensateSelfRegistrationFn | null = null;
let _compensateTeamEnrollment: CompensateTeamEnrollmentFn | null = null;

function isConflictError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response &&
    error.response.status === 409
  );
}

function getResponseStatus(error: unknown): number | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('response' in error) ||
    typeof error.response !== 'object' ||
    error.response === null ||
    !('status' in error.response) ||
    typeof error.response.status !== 'number'
  ) {
    return undefined;
  }
  return error.response.status;
}

/**
 * Issue the one-time bootstrap secret outside DBOS. Workflow inputs, step
 * outputs, events, and results are durable; bearer credentials must never be
 * stored in any of them. Repeating this call rotates/reissues the credential,
 * which also closes the HTTP response-loss gap.
 */
export async function issueRegistrationCredential(
  registration: RegistrationWorkflowResult,
): Promise<RegistrationResult> {
  let credential: RegistrationCredential;
  if (registration.credentialType === 'oauth2') {
    const { oauth2Api } = getDeps();
    const clientId = agentOAuth2ClientId(registration.agentId);
    const clientSecret = crypto.randomUUID();
    const oAuth2Client = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: `Agent: ${registration.fingerprint}`,
      grant_types: ['client_credentials'],
      response_types: [] as string[],
      token_endpoint_auth_method: 'client_secret_post',
      scope: AGENT_OAUTH_SCOPES.join(' '),
      metadata: {
        type: 'moltnet_agent',
        // agent_id is the durable lookup key used by the token webhook;
        // identity_id is retained as the Kratos binding and may go stale.
        agent_id: registration.agentId,
        identity_id: registration.identityId,
        public_key: registration.publicKey,
        fingerprint: registration.fingerprint,
      },
    };
    try {
      await oauth2Api.createOAuth2Client({ oAuth2Client });
    } catch (error) {
      if (!isConflictError(error)) throw error;
      await oauth2Api.setOAuth2Client({ id: clientId, oAuth2Client });
    }
    credential = { type: 'oauth2', clientId, clientSecret };
  } else {
    const subject: AgentKeySubject = {
      agentId: registration.agentId,
      scopes: [...AGENT_OAUTH_SCOPES],
      subjectNs: KetoNamespace.Agent,
      subjectType: 'agent',
    };
    const result = await getDeps().issueAgentKey({
      agentId: registration.agentId,
      idempotencyKey: registration.credentialIdempotencyKey,
      logger: getDeps().logger,
      name: 'Bootstrap credential',
      recoverReplayByRotation: true,
      subject,
      teamId: registration.teamId,
    });
    credential = { type: 'agent_key', ...result };
  }

  return {
    agentId: registration.agentId,
    identityId: registration.identityId,
    fingerprint: registration.fingerprint,
    publicKey: registration.publicKey,
    credential,
  };
}

export function initRegistrationWorkflow(): void {
  if (_workflow) return;

  const validateTeamInviteStep = DBOS.registerStep(
    async (
      inviteId: string,
    ): Promise<{ teamId: string; inviteId: string; role: TeamInviteRole }> => {
      const { teamRepository } = getDeps();
      const invite = await teamRepository.findInviteById(inviteId);
      if (!invite || invite.expiresAt < new Date()) {
        throw new EnrollmentValidationError('Invite is invalid or expired');
      }
      const team = await teamRepository.findById(invite.teamId);
      if (!team || team.personal || team.status !== 'active') {
        throw new EnrollmentValidationError(
          'Invite does not grant access to an active team',
        );
      }
      return { teamId: invite.teamId, inviteId: invite.id, role: invite.role };
    },
    { name: 'registration.step.validateTeamInvite', retriesAllowed: false },
  );

  const createKratosIdentityStep = DBOS.registerStep(
    async (
      publicKey: string,
      agentId: string,
      registrationWorkflowId: string,
    ): Promise<{ identityId: string; ownedForCompensation: boolean }> => {
      const { identityApi } = getDeps();
      const schemas = await identityApi.listIdentitySchemas();
      const agentSchema = schemas.find(
        (schema) =>
          (schema.schema as { $id?: string })?.$id === AGENT_IDENTITY_SCHEMA_ID,
      );
      if (!agentSchema) {
        throw new RegistrationWorkflowError(
          `Agent identity schema not found: ${AGENT_IDENTITY_SCHEMA_ID}`,
        );
      }
      try {
        const identity = await identityApi.createIdentity({
          createIdentityBody: {
            schema_id: agentSchema.id,
            traits: { public_key: publicKey },
            credentials: {
              // Kratos requires its agent schema to have a password credential.
              // Agents authenticate with OAuth2 or agent keys, so this random
              // throwaway password is never disclosed or used for authentication.
              password: {
                config: { password: `moltnet-${crypto.randomUUID()}` },
              },
            },
            // The identity points back at the agent it belongs to, mirroring
            // metadata_public.human_id for humans. This is the only way to get
            // from a bare Kratos identity to a MoltNet principal; agents.id is
            // the durable side of the binding, identity_id the disposable one.
            metadata_public: {
              agent_id: agentId,
            },
            metadata_admin: {
              moltnet_registration_workflow_id: registrationWorkflowId,
            },
          },
        });
        return { identityId: identity.id, ownedForCompensation: true };
      } catch (error) {
        if (!isConflictError(error)) throw error;

        // A create can commit in Kratos while its response is lost. The
        // public key is the schema's unique password credential identifier,
        // so reconcile the retry to that already-created identity.
        const identities = await identityApi.listIdentities({
          consistency: 'strong',
          credentialsIdentifier: publicKey,
        });
        const matches = identities.filter(
          (identity) =>
            identity.schema_id === agentSchema.id &&
            (identity.traits as { public_key?: unknown }).public_key ===
              publicKey,
        );
        if (matches.length !== 1) {
          throw new RegistrationWorkflowError(
            `Unable to reconcile Kratos identity for public key: found ${matches.length}`,
          );
        }
        const owner = (
          matches[0].metadata_admin as
            | { moltnet_registration_workflow_id?: unknown }
            | undefined
        )?.moltnet_registration_workflow_id;
        return {
          identityId: matches[0].id,
          ownedForCompensation: owner === registrationWorkflowId,
        };
      }
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
      await getDeps().relationshipWriter.registerAgent(identityId);
    },
    {
      name: 'registration.step.registerInKeto',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const grantPersonalTeamOwnerStep = DBOS.registerStep(
    async (teamId: string, identityId: string): Promise<void> => {
      await getDeps().relationshipWriter.grantTeamOwners(
        teamId,
        identityId,
        KetoNamespace.Agent,
      );
    },
    {
      name: 'registration.step.grantPersonalTeamOwner',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const grantTeamRoleStep = DBOS.registerStep(
    async (
      teamId: string,
      identityId: string,
      role: TeamInviteRole,
    ): Promise<void> => {
      const { relationshipWriter } = getDeps();
      switch (role) {
        case TEAM_ROLE.Manager:
          await relationshipWriter.grantTeamManagers(
            teamId,
            identityId,
            KetoNamespace.Agent,
          );
          return;
        case TEAM_ROLE.Executor:
          await relationshipWriter.grantTeamExecutors(
            teamId,
            identityId,
            KetoNamespace.Agent,
          );
          return;
        case TEAM_ROLE.Member:
          await relationshipWriter.grantTeamMembers(
            teamId,
            identityId,
            KetoNamespace.Agent,
          );
          return;
      }
    },
    {
      name: 'registration.step.grantTeamRole',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const grantPrivateDiaryStep = DBOS.registerStep(
    async (diaryId: string, teamId: string): Promise<void> => {
      await getDeps().relationshipWriter.grantDiaryTeam(diaryId, teamId);
    },
    {
      name: 'registration.step.grantPrivateDiary',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const deleteKratosIdentityStep = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      try {
        await getDeps().identityApi.deleteIdentity({ id: identityId });
      } catch (error) {
        if (getResponseStatus(error) !== 404) throw error;
      }
    },
    {
      name: 'registration.step.deleteKratosIdentity',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const cleanupTeamEnrollmentStep = DBOS.registerStep(
    async (teamId: string, identityId: string) => {
      const { relationshipWriter } = getDeps();
      const results = await Promise.allSettled([
        relationshipWriter.removeTeamMemberRelation(
          teamId,
          identityId,
          KetoNamespace.Agent,
        ),
        relationshipWriter.removeAgentRelations(identityId),
      ]);
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure): unknown => failure.reason),
          'Team enrollment cleanup failed',
        );
      }
    },
    {
      name: 'registration.step.cleanupTeamEnrollment',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const cleanupSelfRegistrationStep = DBOS.registerStep(
    async (
      identityId: string,
      teamId: string | null,
      diaryIds: string[],
    ): Promise<void> => {
      const { relationshipWriter } = getDeps();
      const cleanup = diaryIds.map((diaryId) =>
        relationshipWriter.removeDiaryRelations(diaryId),
      );
      if (teamId) {
        cleanup.push(
          relationshipWriter.removeTeamMemberRelation(
            teamId,
            identityId,
            KetoNamespace.Agent,
          ),
        );
      }
      cleanup.push(relationshipWriter.removeAgentRelations(identityId));
      const results = await Promise.allSettled(cleanup);
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure): unknown => failure.reason),
          'Self-registration cleanup failed',
        );
      }
    },
    {
      name: 'registration.step.cleanupSelfRegistration',
      retriesAllowed: true,
      maxAttempts: 5,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  _compensateSelfRegistration = DBOS.registerWorkflow(
    // agentId owns the team, diary and Keto grants; identityId is only the
    // Kratos identity to delete. They are distinct since the decoupling, and
    // conflating them would clean up nothing (both are uuids, so the compiler
    // cannot catch it). identityId is nullable: the agent row is created before
    // the identity, so compensation can run when no identity exists.
    async (
      agentId: string,
      identityId: string | null,
      deleteIdentity: boolean,
    ): Promise<void> => {
      const {
        agentRepository,
        diaryRepository,
        teamRepository,
        transactionRunner,
      } = getDeps();
      const inventory = await transactionRunner.runInTransaction(
        async () => {
          const team = await teamRepository.findPersonalByCreator({
            kind: 'agent',
            id: agentId,
          });
          const diaryIds = (
            await diaryRepository.listByCreator({
              kind: 'agent',
              id: agentId,
            })
          )
            .filter((diary) => !team || diary.teamId === team.id)
            .map((diary) => diary.id);
          return { teamId: team?.id ?? null, diaryIds };
        },
        { name: 'registration.tx.inventorySelfRegistration' },
      );

      await cleanupSelfRegistrationStep(
        agentId,
        inventory.teamId,
        inventory.diaryIds,
      );
      await transactionRunner.runInTransaction(
        async () => {
          for (const diaryId of inventory.diaryIds) {
            await diaryRepository.delete(diaryId);
          }
          if (inventory.teamId) {
            await teamRepository.delete(inventory.teamId);
          }
          await agentRepository.deleteById(agentId);
        },
        { name: 'registration.tx.compensateSelfRegistration' },
      );
      if (deleteIdentity && identityId) {
        await deleteKratosIdentityStep(identityId);
      }
    },
    { name: 'registration.compensateSelfRegistration' },
  );
  const compensateSelfRegistrationWorkflow = _compensateSelfRegistration;

  _compensateTeamEnrollment = DBOS.registerWorkflow(
    // As above: agentId is the Keto subject and the row to delete; identityId
    // is only the Kratos identity, and may be null when compensation runs
    // before the identity step completed.
    async (
      teamId: string,
      inviteId: string | null,
      agentId: string,
      identityId: string | null,
      deleteIdentity: boolean,
    ): Promise<void> => {
      await cleanupTeamEnrollmentStep(teamId, agentId);
      await getDeps().transactionRunner.runInTransaction(
        async () => {
          if (inviteId) {
            await getDeps().teamRepository.revertInviteClaim(inviteId);
          }
          await getDeps().agentRepository.deleteById(agentId);
        },
        { name: 'registration.tx.compensateTeamEnrollment' },
      );
      if (deleteIdentity && identityId) {
        await deleteKratosIdentityStep(identityId);
      }
    },
    { name: 'registration.compensateTeamEnrollment' },
  );
  const compensateTeamEnrollmentWorkflow = _compensateTeamEnrollment;

  _workflow = DBOS.registerWorkflow(
    async (input: RegistrationInput): Promise<RegistrationWorkflowResult> => {
      const invite =
        input.mode.type === 'team_invite'
          ? await validateTeamInviteStep(input.mode.inviteId)
          : null;
      const enrollmentTeamId = invite?.teamId ?? null;
      let claimedInviteId: string | null = null;

      // The agent row is created FIRST, with identity_id still NULL. Its id is
      // MoltNet's own, so it can be written into the Kratos identity's
      // metadata_public and used as the creator and Keto subject below —
      // none of which may depend on an identity that does not exist yet, and
      // that a future incident could delete again. Keyed on the fingerprint so
      // a retried registration resolves to the same row.
      const agent = await getDeps().transactionRunner.runInTransaction(
        async () =>
          getDeps().agentRepository.upsertByFingerprint({
            publicKey: input.publicKey,
            fingerprint: input.fingerprint,
          }),
        { name: 'registration.tx.createAgent' },
      );
      const agentId = agent.id;

      const identity = await createKratosIdentityStep(
        input.publicKey,
        agentId,
        DBOS.workflowID ?? `registration-${input.idempotencyKey}`,
      );
      const { identityId } = identity;
      try {
        const {
          agentRepository,
          diaryRepository,
          teamRepository,
          transactionRunner,
        } = getDeps();
        const persisted = await transactionRunner.runInTransaction(
          async () => {
            // Bind the agent to the identity it now owns.
            await agentRepository.relinkIdentity(agentId, identityId);
            if (input.mode.type === 'team_invite') {
              const claimed = await teamRepository.claimInvite(
                invite?.inviteId ?? '',
              );
              if (!claimed || claimed.teamId !== enrollmentTeamId) {
                throw new EnrollmentValidationError(
                  'Invite was redeemed by another registration request',
                );
              }
              claimedInviteId = claimed.id;
              return { teamId: claimed.teamId, privateDiaryId: null };
            }

            const existingTeam = await teamRepository.findPersonalByCreator({
              kind: 'agent',
              id: agentId,
            });
            const team =
              existingTeam ??
              (await teamRepository.create({
                name: input.fingerprint,
                personal: true,
                creator: { kind: 'agent', id: agentId },
                status: 'active',
              }));
            const existingDiary = (
              await diaryRepository.listByCreator({
                kind: 'agent',
                id: agentId,
              })
            ).find((diary) => diary.name === 'Private');
            const diary =
              existingDiary ??
              (await diaryRepository.create({
                creator: { kind: 'agent', id: agentId },
                name: 'Private',
                visibility: 'private',
                teamId: team.id,
              }));
            return { teamId: team.id, privateDiaryId: diary.id };
          },
          { name: 'registration.tx.persist' },
        );
        const teamId = persisted.teamId ?? enrollmentTeamId;

        await registerInKetoStep(agentId);
        if (input.mode.type === 'self') {
          await grantPersonalTeamOwnerStep(teamId, agentId);
          if (!persisted.privateDiaryId) {
            throw new RegistrationWorkflowError(
              'Private diary was not resolved',
            );
          }
          await grantPrivateDiaryStep(persisted.privateDiaryId, teamId);
        }
        if (input.mode.type === 'team_invite') {
          await grantTeamRoleStep(
            teamId,
            agentId,
            invite?.role ?? TEAM_ROLE.Member,
          );
        }

        return {
          agentId,
          identityId,
          identityOwnedForCompensation: identity.ownedForCompensation,
          fingerprint: input.fingerprint,
          publicKey: input.publicKey,
          teamId,
          credentialType: input.credentialType,
          credentialIdempotencyKey: input.idempotencyKey,
        };
      } catch (error) {
        const { logger } = getDeps();
        logger.error(
          { err: error, identityId },
          'registration.compensation_started',
        );
        const parentWorkflowId = DBOS.workflowID ?? identityId;
        if (input.mode.type === 'team_invite') {
          try {
            if (enrollmentTeamId) {
              const handle = await DBOS.startWorkflow(
                compensateTeamEnrollmentWorkflow,
                {
                  workflowID: `registration-team-compensation:${parentWorkflowId}`,
                },
              )(
                enrollmentTeamId,
                claimedInviteId,
                agentId,
                identityId,
                identity.ownedForCompensation,
              );
              await handle.getResult();
            }
          } catch (compensationError) {
            logger.error(
              { err: compensationError, identityId },
              'registration.enrollment_compensation_failed',
            );
          }
        } else if (input.mode.type === 'self') {
          try {
            const handle = await DBOS.startWorkflow(
              compensateSelfRegistrationWorkflow,
              { workflowID: `registration-compensation:${parentWorkflowId}` },
            )(agentId, identityId, identity.ownedForCompensation);
            await handle.getResult();
          } catch (compensationError) {
            logger.error(
              { err: compensationError, identityId },
              'registration.self_compensation_failed',
            );
          }
        }
        throw error;
      }
    },
    { name: 'registration.registerAgent' },
  );
}

export const registrationWorkflow = {
  get registerAgent() {
    if (!_workflow) {
      throw new Error(
        'Registration workflow not initialized. Call initRegistrationWorkflow() after configureDBOS().',
      );
    }
    return _workflow;
  },
  get compensateSelfRegistration() {
    if (!_compensateSelfRegistration) {
      throw new Error(
        'Registration workflow not initialized. Call initRegistrationWorkflow() after configureDBOS().',
      );
    }
    return _compensateSelfRegistration;
  },
};
