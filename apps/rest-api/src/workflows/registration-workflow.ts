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
} from '@moltnet/auth';
import {
  type AgentEnrollmentRepository,
  type AgentRepository,
  DBOS,
  type DiaryRepository,
  type TeamRepository,
  type TransactionRunner,
} from '@moltnet/database';
import type { IdentityApi, OAuth2Api } from '@ory/client-fetch';

import type { Logger } from './logger.js';

export type RegistrationCredentialType = 'oauth2' | 'agent_key';

export type RegistrationMode =
  | { type: 'self' }
  | { type: 'team'; enrollmentTokenHash: string };

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
    (right.mode.type === 'team' &&
      left.mode.enrollmentTokenHash === right.mode.enrollmentTokenHash)
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
  identityId: string;
  fingerprint: string;
  publicKey: string;
  credential: RegistrationCredential;
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
  agentEnrollmentRepository: AgentEnrollmentRepository;
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
) => Promise<RegistrationResult>;
type CompensateSelfRegistrationFn = (identityId: string) => Promise<void>;

let _workflow: RegisterAgentFn | null = null;
let _compensateSelfRegistration: CompensateSelfRegistrationFn | null = null;

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

export function initRegistrationWorkflow(): void {
  if (_workflow) return;

  const validateEnrollmentStep = DBOS.registerStep(
    async (tokenHash: string): Promise<string> => {
      const enrollment =
        await getDeps().agentEnrollmentRepository.findPendingByTokenHash(
          tokenHash,
        );
      if (!enrollment) {
        throw new EnrollmentValidationError(
          'Enrollment is invalid, expired, revoked, or already redeemed',
        );
      }
      return enrollment.teamId;
    },
    { name: 'registration.step.validateEnrollment', retriesAllowed: false },
  );

  const createKratosIdentityStep = DBOS.registerStep(
    async (publicKey: string): Promise<string> => {
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
          },
        });
        return identity.id;
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
        return matches[0].id;
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

  const grantTeamMemberStep = DBOS.registerStep(
    async (teamId: string, identityId: string): Promise<void> => {
      await getDeps().relationshipWriter.grantTeamMembers(
        teamId,
        identityId,
        KetoNamespace.Agent,
      );
    },
    {
      name: 'registration.step.grantTeamMember',
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

  const createOAuth2ClientStep = DBOS.registerStep(
    async (
      identityId: string,
      publicKey: string,
      fingerprint: string,
    ): Promise<RegistrationCredential> => {
      const { oauth2Api } = getDeps();
      const clientId = `moltnet-agent-${identityId}`;
      const clientSecret = crypto.randomUUID();
      const oAuth2Client = {
        client_id: clientId,
        client_secret: clientSecret,
        client_name: `Agent: ${fingerprint}`,
        grant_types: ['client_credentials'],
        response_types: [] as string[],
        token_endpoint_auth_method: 'client_secret_post',
        scope: AGENT_OAUTH_SCOPES.join(' '),
        metadata: {
          type: 'moltnet_agent',
          identity_id: identityId,
          public_key: publicKey,
          fingerprint,
        },
      };
      try {
        await oauth2Api.createOAuth2Client({ oAuth2Client });
      } catch (error) {
        if (!isConflictError(error)) throw error;
        await oauth2Api.setOAuth2Client({ id: clientId, oAuth2Client });
      }
      return { type: 'oauth2', clientId, clientSecret };
    },
    {
      name: 'registration.step.createOAuth2Client',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const createAgentKeyStep = DBOS.registerStep(
    async (
      identityId: string,
      teamId: string,
      idempotencyKey: string,
    ): Promise<RegistrationCredential> => {
      const subject: AgentKeySubject = {
        identityId,
        scopes: [...AGENT_OAUTH_SCOPES],
        subjectNs: KetoNamespace.Agent,
        subjectType: 'agent',
      };
      const result = await getDeps().issueAgentKey({
        agentId: identityId,
        idempotencyKey,
        logger: getDeps().logger,
        name: 'Bootstrap credential',
        recoverReplayByRotation: true,
        subject,
        teamId,
      });
      return { type: 'agent_key', ...result };
    },
    {
      name: 'registration.step.createAgentKey',
      retriesAllowed: true,
      maxAttempts: 3,
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
      const { oauth2Api, relationshipWriter } = getDeps();
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
      cleanup.push(
        (async () => {
          try {
            await oauth2Api.deleteOAuth2Client({
              id: `moltnet-agent-${identityId}`,
            });
          } catch (error: unknown) {
            if (getResponseStatus(error) !== 404) throw error;
          }
        })(),
      );

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

  const compensateTeamRegistration = DBOS.registerWorkflow(
    async (
      tokenHash: string,
      teamId: string,
      identityId: string,
    ): Promise<void> => {
      const { agentEnrollmentRepository, agentRepository, transactionRunner } =
        getDeps();
      await cleanupTeamEnrollmentStep(teamId, identityId);
      await transactionRunner.runInTransaction(
        async () => {
          await agentEnrollmentRepository.releaseRedemption(
            tokenHash,
            identityId,
          );
          await agentRepository.delete(identityId);
        },
        { name: 'registration.tx.compensateTeamRegistration' },
      );
      await deleteKratosIdentityStep(identityId);
    },
    { name: 'registration.compensateTeamRegistration' },
  );

  _compensateSelfRegistration = DBOS.registerWorkflow(
    async (identityId: string): Promise<void> => {
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
            id: identityId,
          });
          const diaryIds = (
            await diaryRepository.listByCreator({
              kind: 'agent',
              id: identityId,
            })
          )
            .filter((diary) => !team || diary.teamId === team.id)
            .map((diary) => diary.id);
          return { teamId: team?.id ?? null, diaryIds };
        },
        { name: 'registration.tx.inventorySelfRegistration' },
      );

      await cleanupSelfRegistrationStep(
        identityId,
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
          await agentRepository.delete(identityId);
        },
        { name: 'registration.tx.compensateSelfRegistration' },
      );
      await deleteKratosIdentityStep(identityId);
    },
    { name: 'registration.compensateSelfRegistration' },
  );
  const compensateSelfRegistrationWorkflow = _compensateSelfRegistration;

  _workflow = DBOS.registerWorkflow(
    async (input: RegistrationInput): Promise<RegistrationResult> => {
      const enrollmentTeamId =
        input.mode.type === 'team'
          ? await validateEnrollmentStep(input.mode.enrollmentTokenHash)
          : null;
      const identityId = await createKratosIdentityStep(input.publicKey);
      try {
        const {
          agentEnrollmentRepository,
          agentRepository,
          diaryRepository,
          teamRepository,
          transactionRunner,
        } = getDeps();
        const persisted = await transactionRunner.runInTransaction(
          async () => {
            await agentRepository.upsert({
              identityId,
              publicKey: input.publicKey,
              fingerprint: input.fingerprint,
            });
            if (input.mode.type === 'team') {
              const redeemed = await agentEnrollmentRepository.redeem(
                input.mode.enrollmentTokenHash,
                identityId,
              );
              if (!redeemed) {
                throw new EnrollmentValidationError(
                  'Enrollment was redeemed by another registration request',
                );
              }
              return { teamId: redeemed.teamId, privateDiaryId: null };
            }

            const existingTeam = await teamRepository.findPersonalByCreator({
              kind: 'agent',
              id: identityId,
            });
            const team =
              existingTeam ??
              (await teamRepository.create({
                name: input.fingerprint,
                personal: true,
                creator: { kind: 'agent', id: identityId },
                status: 'active',
              }));
            const existingDiary = (
              await diaryRepository.listByCreator({
                kind: 'agent',
                id: identityId,
              })
            ).find((diary) => diary.name === 'Private');
            const diary =
              existingDiary ??
              (await diaryRepository.create({
                creator: { kind: 'agent', id: identityId },
                name: 'Private',
                visibility: 'private',
                teamId: team.id,
              }));
            return { teamId: team.id, privateDiaryId: diary.id };
          },
          { name: 'registration.tx.persist' },
        );
        const teamId = persisted.teamId ?? enrollmentTeamId;

        await registerInKetoStep(identityId);
        if (input.mode.type === 'self') {
          await grantPersonalTeamOwnerStep(teamId, identityId);
          if (!persisted.privateDiaryId) {
            throw new RegistrationWorkflowError(
              'Private diary was not resolved',
            );
          }
          await grantPrivateDiaryStep(persisted.privateDiaryId, teamId);
        }
        if (input.mode.type === 'team') {
          await grantTeamMemberStep(teamId, identityId);
        }

        const credential =
          input.credentialType === 'oauth2'
            ? await createOAuth2ClientStep(
                identityId,
                input.publicKey,
                input.fingerprint,
              )
            : await createAgentKeyStep(
                identityId,
                teamId,
                input.idempotencyKey,
              );

        return {
          identityId,
          fingerprint: input.fingerprint,
          publicKey: input.publicKey,
          credential,
        };
      } catch (error) {
        const { logger } = getDeps();
        logger.error(
          { err: error, identityId },
          'registration.compensation_started',
        );
        const parentWorkflowId = DBOS.workflowID ?? identityId;
        if (input.mode.type === 'team' && enrollmentTeamId) {
          try {
            const handle = await DBOS.startWorkflow(
              compensateTeamRegistration,
              { workflowID: `registration-compensation:${parentWorkflowId}` },
            )(input.mode.enrollmentTokenHash, enrollmentTeamId, identityId);
            await handle.getResult();
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
            )(identityId);
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
