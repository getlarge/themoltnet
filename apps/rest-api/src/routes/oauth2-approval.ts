import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { createAgentKeyService } from '@moltnet/agent-key-service';
import {
  AGENT_CREDENTIAL_SCOPES,
  KetoNamespace,
  LOCAL_CONTROL_SCOPE,
  PROVISIONING_SCOPE,
  readProvisioningGrant,
  requireAuth,
} from '@moltnet/auth';
import type { OryClients, ProvisioningGrant } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';
import { AgentKeyWithSecretSchema } from '../schemas/agent-keys.js';
import { requestAbortSignal } from '../utils/request-abort-signal.js';

export interface ApprovalClients {
  nativeClientId?: string;
  consoleClientId?: string;
}
const PROVISION_AUDIENCE = 'moltnet:provisioning';
const LOCAL_AUDIENCE = 'moltnet:agent-server';

/** Only administratively configured client IDs can enter these flows. */
export async function oauth2ApprovalRoutes(
  app: FastifyInstance,
  options: {
    ory: OryClients;
    clients: ApprovalClients;
  },
) {
  const server = app.withTypeProvider<TypeBoxTypeProvider>();
  const oauth = options.ory.oauth2;
  const challenge = Type.Object({
    challenge: Type.String({ minLength: 1, maxLength: 2048 }),
  });
  const redirectResponse = Type.Object({ redirect_to: Type.String() });
  const failures = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
  };
  const policy = {
    credentialBindingScope: 'identity' as const,
    requiredScopes: [],
  };
  async function humanSession(request: FastifyRequest) {
    // OAuth bearer credentials must not approve another OAuth grant.
    const human = await app.sessionResolver?.resolveSession({
      cookie: request.headers.cookie,
    });
    if (!human || human.subjectType !== 'human')
      throw createProblem('unauthorized');
    return human;
  }
  async function permissions(humanId: string, grant: ProvisioningGrant) {
    const ns = KetoNamespace.Human;
    if (
      !(await app.permissionChecker.canManageTeamCredentials(
        grant.teamId,
        humanId,
        ns,
      )) ||
      (grant.operation === 'enroll' &&
        !(await app.permissionChecker.canManageTeamMembers(
          grant.teamId,
          humanId,
          ns,
        )))
    ) {
      throw createProblem('forbidden');
    }
    const [agent, team] = await Promise.all([
      app.agentRepository.findById(grant.agentId),
      app.teamRepository.findById(grant.teamId),
    ]);
    if (!agent?.identityId || !team) throw createProblem('not-found');
    if (team.personal || team.status !== 'active')
      throw createProblem('forbidden');
    if (
      grant.operation === 'renew' &&
      !(await app.relationshipReader.isTeamMember(
        grant.teamId,
        grant.agentId,
        KetoNamespace.Agent,
      ))
    )
      throw createProblem('forbidden');
    return { agent: agent.alias ?? grant.agentId, team: team.name };
  }
  async function consent(request: FastifyRequest, value: string) {
    const human = await humanSession(request);
    const consent = await oauth.getOAuth2ConsentRequest({
      consentChallenge: value,
    });
    if (consent.subject !== human.identityId) throw createProblem('forbidden');
    const params = new URL(consent.request_url!).searchParams;
    if (
      params.get('response_type') !== 'code' ||
      params.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
    )
      throw createProblem('forbidden');
    const scopes = consent.requested_scope ?? [];
    const native =
      !!options.clients.nativeClientId &&
      consent.client?.client_id === options.clients.nativeClientId;
    const browser =
      !!options.clients.consoleClientId &&
      consent.client?.client_id === options.clients.consoleClientId;
    const lifetime =
      consent.client?.authorization_code_grant_access_token_lifespan;
    if (
      consent.client?.token_endpoint_auth_method !== 'none' ||
      consent.client.grant_types?.join(' ') !== 'authorization_code' ||
      (native && lifetime !== '5m' && lifetime !== '5m0s') ||
      (browser && lifetime !== '15m' && lifetime !== '15m0s')
    )
      throw createProblem('forbidden');
    const instance = params.get('instance');
    if (!instance || !/^[0-9a-f-]{36}$/i.test(instance))
      throw createProblem('forbidden');
    if (native && scopes.length === 1 && scopes[0] === PROVISIONING_SCOPE) {
      let raw: unknown;
      try {
        raw = JSON.parse(params.get('provisioning') ?? 'null');
      } catch {
        throw createProblem('forbidden');
      }
      const grant = readProvisioningGrant(raw);
      if (
        !grant ||
        grant.scopes.some(
          (s) => !(AGENT_CREDENTIAL_SCOPES as readonly string[]).includes(s),
        )
      )
        throw createProblem('forbidden');
      if (
        !(consent.requested_access_token_audience ?? []).includes(
          PROVISION_AUDIENCE,
        )
      )
        throw createProblem('forbidden');
      const labels = await permissions(human.humanId, grant);
      return {
        human,
        consent,
        grant,
        instance,
        audience: PROVISION_AUDIENCE,
        ...labels,
      };
    }
    if (
      (native || browser) &&
      scopes.length === 1 &&
      scopes[0] === LOCAL_CONTROL_SCOPE &&
      (consent.requested_access_token_audience ?? []).includes(LOCAL_AUDIENCE)
    ) {
      return {
        human,
        consent,
        instance,
        audience: LOCAL_AUDIENCE,
        grant: undefined,
        agent: undefined,
        team: undefined,
      };
    }
    throw createProblem('forbidden');
  }
  server.post(
    '/oauth2/login',
    {
      config: { auth: policy },
      schema: {
        operationId: 'acceptOperatorLogin',
        tags: ['oauth2'],
        security: [{ cookieAuth: [] }],
        body: challenge,
        response: { 200: redirectResponse, ...failures },
      },
    },
    async (request) => {
      const human = await humanSession(request);
      const login = await oauth.getOAuth2LoginRequest({
        loginChallenge: request.body.challenge,
      });
      if (
        !login.client?.client_id ||
        ![
          options.clients.nativeClientId,
          options.clients.consoleClientId,
        ].includes(login.client.client_id)
      )
        throw createProblem('forbidden');
      if (login.subject && login.subject !== human.identityId)
        throw createProblem('forbidden');
      return oauth.acceptOAuth2LoginRequest({
        loginChallenge: request.body.challenge,
        acceptOAuth2LoginRequest: {
          subject: human.identityId,
          remember: false,
        },
      });
    },
  );
  server.get(
    '/oauth2/consent',
    {
      config: { auth: policy },
      schema: {
        operationId: 'getOperatorConsent',
        tags: ['oauth2'],
        security: [{ cookieAuth: [] }],
        querystring: challenge,
        response: {
          200: Type.Object({
            operation: Type.String(),
            agent: Type.Optional(Type.String()),
            team: Type.Optional(Type.String()),
            agentId: Type.Optional(Type.String()),
            teamId: Type.Optional(Type.String()),
            permissions: Type.Array(Type.String()),
            instance: Type.String(),
          }),
          ...failures,
        },
      },
    },
    async (request) => {
      const result = await consent(request, request.query.challenge);
      return {
        operation: result.grant?.operation ?? 'local-control',
        agent: result.agent,
        team: result.team,
        agentId: result.grant?.agentId,
        teamId: result.grant?.teamId,
        permissions: result.grant?.scopes ?? [LOCAL_CONTROL_SCOPE],
        instance: result.instance,
      };
    },
  );
  server.post(
    '/oauth2/consent',
    {
      config: { auth: policy },
      schema: {
        operationId: 'acceptOperatorConsent',
        tags: ['oauth2'],
        security: [{ cookieAuth: [] }],
        response: { 200: redirectResponse, ...failures },
        body: Type.Object({ ...challenge.properties, approve: Type.Boolean() }),
      },
    },
    async (request) => {
      const result = await consent(request, request.body.challenge);
      if (!request.body.approve)
        return oauth.rejectOAuth2ConsentRequest({
          consentChallenge: request.body.challenge,
          rejectOAuth2Request: { error: 'access_denied' },
        });
      return oauth.acceptOAuth2ConsentRequest({
        consentChallenge: request.body.challenge,
        acceptOAuth2ConsentRequest: {
          remember: false,
          grant_scope: result.consent.requested_scope,
          grant_access_token_audience: [result.audience],
          session: {
            access_token: {
              'moltnet:identity_id': result.human.identityId,
              'moltnet:human_id': result.human.humanId,
              'moltnet:subject_type': 'human',
              'moltnet:instance': result.instance,
              ...(result.grant ? { 'moltnet:provisioning': result.grant } : {}),
            },
          },
        },
      });
    },
  );
  const keys = createAgentKeyService({
    agentRepository: app.agentRepository,
    relationshipReader: app.relationshipReader,
    permissionChecker: app.permissionChecker,
    talosApi: options.ory.apiKeys,
  });
  server.post(
    '/oauth2/provision',
    {
      preHandler: requireAuth,
      config: { auth: policy },
      schema: {
        operationId: 'provisionAgentCredential',
        tags: ['agent-keys'],
        security: [{ bearerAuth: [] }],
        body: Type.Object({}, { additionalProperties: false }),
        response: { 201: Type.Ref(AgentKeyWithSecretSchema.$id), ...failures },
      },
    },
    async (request, reply) => {
      const human = request.authContext;
      if (
        human?.subjectType !== 'human' ||
        !human.provisioning ||
        human.clientId !== options.clients.nativeClientId ||
        !human.scopes.includes(PROVISIONING_SCOPE)
      )
        throw createProblem('forbidden');
      const grant = human.provisioning;
      await permissions(human.humanId, grant);
      if (
        grant.operation === 'enroll' &&
        !(await app.relationshipReader.isTeamMember(
          grant.teamId,
          grant.agentId,
          KetoNamespace.Agent,
        ))
      ) {
        // Insert only: never remove or downgrade a concurrently assigned role.
        await options.ory.relationship.patchRelationships({
          relationshipPatch: [
            {
              action: 'insert',
              relation_tuple: {
                namespace: 'Team',
                object: grant.teamId,
                relation: 'members',
                subject_set: {
                  namespace: 'Agent',
                  object: grant.agentId,
                  relation: '',
                },
              },
            },
          ],
        });
      }
      const result = await keys.issue({
        bindingScope: 'team',
        teamId: grant.teamId,
        agentId: grant.agentId,
        scopes: grant.scopes,
        idempotencyKey: grant.idempotencyKey,
        name: 'Desktop team credential',
        subject: {
          subjectNs: KetoNamespace.Human,
          subjectType: 'human',
          subjectId: human.humanId,
          scopes: ['key:manage', ...grant.scopes],
        },
        logger: request.log,
        signal: requestAbortSignal(request, reply),
      });
      return reply.code(201).send(result);
    },
  );
}
