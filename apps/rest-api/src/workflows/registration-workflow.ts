import type {
  AgentKeySubject,
  AgentKeyWithSecret,
  IssueAgentKeyInput,
} from '@moltnet/agent-key-service';
import {
  AGENT_OAUTH_SCOPES,
  KetoNamespace,
  type RelationshipWriter,
} from '@moltnet/auth';
import {
  type AgentEnrollmentRepository,
  type AgentRepository,
  type DataSource,
  DBOS,
  type DiaryRepository,
  type TeamRepository,
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
  dataSource: DataSource;
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
          (schema.schema as { $id?: string })?.$id?.includes('agent') ?? false,
      );
      if (!agentSchema) {
        throw new RegistrationWorkflowError('Agent identity schema not found');
      }
      const identity = await identityApi.createIdentity({
        createIdentityBody: {
          schema_id: agentSchema.id,
          traits: { public_key: publicKey },
          credentials: {
            password: {
              config: { password: `moltnet-${crypto.randomUUID()}` },
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

  const createPersonalTeamStep = DBOS.registerStep(
    async (identityId: string, fingerprint: string): Promise<string> => {
      const { teamRepository } = getDeps();
      const existing = await teamRepository.findPersonalByCreator({
        kind: 'agent',
        id: identityId,
      });
      if (existing) return existing.id;
      const created = await teamRepository.create({
        name: fingerprint,
        personal: true,
        creator: { kind: 'agent', id: identityId },
        status: 'active',
      });
      return created.id;
    },
    {
      name: 'registration.step.createPersonalTeam',
      retriesAllowed: true,
      maxAttempts: 3,
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

  const createPrivateDiaryStep = DBOS.registerStep(
    async (identityId: string, teamId: string): Promise<void> => {
      const { diaryRepository, relationshipWriter } = getDeps();
      const existing = (
        await diaryRepository.listByCreator({
          kind: 'agent',
          id: identityId,
        })
      ).find((diary) => diary.name === 'Private');
      const diary =
        existing ??
        (await diaryRepository.create({
          creator: { kind: 'agent', id: identityId },
          name: 'Private',
          visibility: 'private',
          teamId,
        }));
      await relationshipWriter.grantDiaryTeam(diary.id, teamId);
    },
    {
      name: 'registration.step.createPrivateDiary',
      retriesAllowed: true,
      maxAttempts: 3,
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
      await getDeps().identityApi.deleteIdentity({ id: identityId });
    },
    {
      name: 'registration.step.deleteKratosIdentity',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  const compensateTeamEnrollmentStep = DBOS.registerStep(
    async (tokenHash: string, teamId: string, identityId: string) => {
      const {
        agentEnrollmentRepository,
        agentRepository,
        dataSource,
        relationshipWriter,
      } = getDeps();
      await relationshipWriter.removeTeamMemberRelation(
        teamId,
        identityId,
        KetoNamespace.Agent,
      );
      await relationshipWriter.removeAgentRelations(identityId);
      await dataSource.runTransaction(
        async () => {
          await agentEnrollmentRepository.releaseRedemption(
            tokenHash,
            identityId,
          );
          await agentRepository.delete(identityId);
        },
        { name: 'registration.tx.compensateEnrollment' },
      );
    },
    {
      name: 'registration.step.compensateTeamEnrollment',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  _compensateSelfRegistration = DBOS.registerStep(
    async (identityId: string): Promise<void> => {
      const {
        agentRepository,
        dataSource,
        diaryRepository,
        oauth2Api,
        relationshipWriter,
        teamRepository,
      } = getDeps();
      const team = await teamRepository.findPersonalByCreator({
        kind: 'agent',
        id: identityId,
      });
      const diaries = (
        await diaryRepository.listByCreator({
          kind: 'agent',
          id: identityId,
        })
      ).filter((diary) => !team || diary.teamId === team.id);
      for (const diary of diaries) {
        await relationshipWriter.removeDiaryRelations(diary.id);
      }
      if (team) {
        await relationshipWriter.removeTeamMemberRelation(
          team.id,
          identityId,
          KetoNamespace.Agent,
        );
      }
      await relationshipWriter.removeAgentRelations(identityId);
      try {
        await oauth2Api.deleteOAuth2Client({
          id: `moltnet-agent-${identityId}`,
        });
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof error.response === 'object' &&
          error.response !== null &&
          'status' in error.response
            ? error.response.status
            : undefined;
        if (status !== 404) throw error;
      }
      await dataSource.runTransaction(
        async () => {
          for (const diary of diaries) {
            await diaryRepository.delete(diary.id);
          }
          if (team) await teamRepository.delete(team.id);
          await agentRepository.delete(identityId);
        },
        { name: 'registration.tx.compensateSelfRegistration' },
      );
    },
    {
      name: 'registration.step.compensateSelfRegistration',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );
  const compensateSelfRegistrationStep = _compensateSelfRegistration;

  _workflow = DBOS.registerWorkflow(
    async (input: RegistrationInput): Promise<RegistrationResult> => {
      const enrollmentTeamId =
        input.mode.type === 'team'
          ? await validateEnrollmentStep(input.mode.enrollmentTokenHash)
          : null;
      const identityId = await createKratosIdentityStep(input.publicKey);
      let teamId: string | null = enrollmentTeamId;
      try {
        const { agentEnrollmentRepository, agentRepository, dataSource } =
          getDeps();
        await dataSource.runTransaction(
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
              teamId = redeemed.teamId;
            }
          },
          { name: 'registration.tx.persist' },
        );

        await registerInKetoStep(identityId);
        if (input.mode.type === 'self') {
          teamId = await createPersonalTeamStep(identityId, input.fingerprint);
          await grantPersonalTeamOwnerStep(teamId, identityId);
          await createPrivateDiaryStep(identityId, teamId);
        }
        if (!teamId) {
          throw new RegistrationWorkflowError(
            'Registration team was not resolved',
          );
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
        if (input.mode.type === 'team' && teamId) {
          try {
            await compensateTeamEnrollmentStep(
              input.mode.enrollmentTokenHash,
              teamId,
              identityId,
            );
          } catch (compensationError) {
            logger.error(
              { err: compensationError, identityId },
              'registration.enrollment_compensation_failed',
            );
          }
        } else if (input.mode.type === 'self') {
          try {
            await compensateSelfRegistrationStep(identityId);
          } catch (compensationError) {
            logger.error(
              { err: compensationError, identityId },
              'registration.self_compensation_failed',
            );
          }
        }
        try {
          await deleteKratosIdentityStep(identityId);
        } catch (compensationError) {
          logger.error(
            { err: compensationError, identityId },
            'registration.identity_compensation_failed',
          );
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
