import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { createAgentKeyService } from '@moltnet/agent-key-service';
import {
  AGENT_OAUTH_SCOPES,
  KetoNamespace,
  LOCAL_CONTROL_SCOPE,
  type OryClients,
  PROVISIONING_SCOPE,
  type ProvisioningGrant,
  readProvisioningGrant,
  requireAuth,
} from '@moltnet/auth';
import { cryptoService, enrollmentProofMessage } from '@moltnet/crypto-service';
import {
  DCR_MAX_SCOPES,
  OPERATOR_OAUTH,
  ProblemDetailsSchema,
} from '@moltnet/models';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { consentCspHeader } from '../plugins/security-headers.js';
import { createProblem } from '../problems/index.js';
import { AgentKeyWithSecretSchema } from '../schemas/agent-keys.js';
import { requestAbortSignal } from '../utils/request-abort-signal.js';
import { renderConsentPage } from './oauth2-consent-page.js';

export interface ApprovalClients {
  nativeClientId?: string;
}
const PROVISION_AUDIENCE = OPERATOR_OAUTH.provisioningAudience;
const LOCAL_AUDIENCE = OPERATOR_OAUTH.localControlAudience;

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
  const failures = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
    503: Type.Ref(ProblemDetailsSchema.$id),
  };
  const policy = {
    credentialBindingScope: 'identity' as const,
    requiredScopes: [],
  };
  async function oryRequest<T>(
    stage: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // client-fetch reports HTTP failures on response, not statusCode. Do not
      // log the upstream object: it can contain the authorization challenge.
      const status =
        error && typeof error === 'object' && 'response' in error
          ? (error.response as { status?: number } | undefined)?.status
          : undefined;
      app.log.warn(
        {
          stage,
          upstreamStatus: status,
          // Error messages and response bodies may contain challenges. Stack
          // frames identify unexpected failures without logging their payload.
          errorType: error instanceof Error ? error.name : typeof error,
          frames:
            error instanceof Error
              ? error.stack
                  ?.split('\n')
                  .filter((line) => /^\s+at /u.test(line))
                  .join('\n')
              : undefined,
        },
        'Operator approval request failed',
      );
      if (status === 404 || status === 410)
        throw createProblem(
          'not-found',
          'This authorization request has expired. Start a fresh request.',
        );
      if (status === 400 || status === 409)
        throw createProblem(
          'validation-failed',
          'This authorization request is no longer usable. Start a fresh request.',
        );
      if (status === 401 || status === 403)
        throw createProblem(
          'service-unavailable',
          'Authorization service configuration is unavailable',
        );
      throw createProblem(
        'service-unavailable',
        'Authorization service is temporarily unavailable. Retry shortly.',
      );
    }
  }
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
      throw createProblem(
        'forbidden',
        'Team credential or membership management is required',
      );
    }
    const [agent, team] = await Promise.all([
      app.agentRepository.findById(grant.agentId),
      app.teamRepository.findById(grant.teamId),
    ]);
    if (!agent?.identityId || !team) throw createProblem('not-found');
    if (team.personal || team.status !== 'active')
      throw createProblem(
        'forbidden',
        'Only active non-personal teams can be provisioned',
      );
    if (
      grant.operation === 'renew' &&
      !(await app.relationshipReader.isTeamMember(
        grant.teamId,
        grant.agentId,
        KetoNamespace.Agent,
      ))
    )
      throw createProblem(
        'forbidden',
        'Renewal requires existing agent membership',
      );
    return { agent, team };
  }
  async function operatorTeams(humanId: string) {
    const memberships =
      await app.relationshipReader.listTeamIdsAndRolesBySubject(humanId);
    const manageable = await Promise.all(
      memberships.map(async ({ teamId }) => ({
        teamId,
        allowed:
          (await app.permissionChecker.canManageTeamCredentials(
            teamId,
            humanId,
            KetoNamespace.Human,
          )) &&
          (await app.permissionChecker.canManageTeamMembers(
            teamId,
            humanId,
            KetoNamespace.Human,
          )),
      })),
    );
    const teams = await app.teamRepository.listByIds(
      manageable.filter(({ allowed }) => allowed).map(({ teamId }) => teamId),
    );
    return teams
      .filter((team) => !team.personal && team.status === 'active')
      .map((team) => ({ id: team.id, name: team.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async function consentSession(request: FastifyRequest, value: string) {
    const human = await humanSession(request);
    const consent = await oryRequest('getOAuth2ConsentRequest', () =>
      oauth.getOAuth2ConsentRequest({
        consentChallenge: value,
      }),
    );
    if (consent.subject !== human.identityId)
      throw createProblem(
        'forbidden',
        'The approval session does not match the authorization request',
      );
    if (!consent.client?.client_id)
      throw createProblem('forbidden', 'The OAuth client is not valid');
    return { human, consent };
  }
  async function consent(request: FastifyRequest, value: string) {
    const { human, consent } = await consentSession(request, value);
    const params = new URL(consent.request_url!).searchParams;
    if (
      params.get('response_type') !== 'code' ||
      params.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
    )
      throw createProblem(
        'forbidden',
        'Authorization code with S256 PKCE is required',
      );
    const scopes = consent.requested_scope ?? [];
    const native =
      !!options.clients.nativeClientId &&
      consent.client?.client_id === options.clients.nativeClientId;
    const lifetime =
      consent.client?.authorization_code_grant_access_token_lifespan;
    if (
      native &&
      (consent.client?.token_endpoint_auth_method !== 'none' ||
        consent.client.grant_types?.join(' ') !== 'authorization_code' ||
        ![
          `${OPERATOR_OAUTH.nativeLifetimeSeconds / 60}m`,
          `${OPERATOR_OAUTH.nativeLifetimeSeconds / 60}m0s`,
        ].includes(lifetime ?? ''))
    )
      throw createProblem(
        'forbidden',
        'The administrative OAuth client policy does not match',
      );
    if (!native) {
      const rejectedScopes = scopes.filter(
        (scope) => !DCR_MAX_SCOPES.includes(scope),
      );
      if (
        !consent.client?.grant_types?.includes('authorization_code') ||
        rejectedScopes.length > 0
      )
        throw createProblem(
          'forbidden',
          'The OAuth client requested unsupported access',
        );
      return {
        human,
        consent,
        kind: 'dcr' as const,
        instance: undefined,
        audience: consent.requested_access_token_audience ?? [],
        grant: undefined,
        agent: undefined,
        team: undefined,
      };
    }
    const instance = params.get('instance');
    if (!instance || !/^[0-9a-f-]{36}$/i.test(instance))
      throw createProblem('forbidden', 'A valid server instance is required');
    if (native && scopes.length === 1 && scopes[0] === PROVISIONING_SCOPE) {
      let raw: unknown;
      try {
        raw = JSON.parse(params.get('provisioning') ?? 'null');
      } catch {
        throw createProblem(
          'forbidden',
          'The provisioning request is not valid JSON',
        );
      }
      const grant = readProvisioningGrant(raw);
      if (
        !grant ||
        grant.scopes.some(
          (s) => !(AGENT_OAUTH_SCOPES as readonly string[]).includes(s),
        )
      )
        throw createProblem(
          'forbidden',
          'The provisioning target or scopes are invalid',
        );
      if (
        !(consent.requested_access_token_audience ?? []).includes(
          PROVISION_AUDIENCE,
        )
      )
        throw createProblem(
          'forbidden',
          'The provisioning audience is required',
        );
      if (
        !human.scopes.includes('key:manage') ||
        grant.scopes.some((scope) => !human.scopes.includes(scope))
      )
        throw createProblem(
          'forbidden',
          'The approving session cannot delegate the requested scopes',
        );
      const labels = await permissions(human.humanId, grant);
      return {
        human,
        consent,
        kind: 'administrative' as const,
        grant,
        instance,
        audience: [PROVISION_AUDIENCE],
        agent: labels.agent.alias ?? grant.agentId,
        team: labels.team.name,
      };
    }
    if (
      native &&
      scopes.length === 1 &&
      scopes[0] === LOCAL_CONTROL_SCOPE &&
      (consent.requested_access_token_audience ?? []).includes(LOCAL_AUDIENCE)
    ) {
      return {
        human,
        consent,
        kind: 'administrative' as const,
        instance,
        audience: [LOCAL_AUDIENCE],
        grant: undefined,
        agent: undefined,
        team: undefined,
      };
    }
    throw createProblem(
      'forbidden',
      'The requested client, scope, and audience combination is not allowed',
    );
  }
  async function approveConsent(
    value: string,
    result: Awaited<ReturnType<typeof consent>>,
  ) {
    let teams: Awaited<ReturnType<typeof operatorTeams>> | undefined;
    if (result.kind === 'administrative' && !result.grant) {
      try {
        teams = await operatorTeams(result.human.humanId);
      } catch {
        // Team suggestions are optional; a directory outage must not prevent
        // operator sign-in or the existing manual enrollment flow.
        app.log.warn('Operator team choices could not be loaded');
        teams = [];
      }
    }
    return oryRequest('acceptOAuth2ConsentRequest', () =>
      oauth.acceptOAuth2ConsentRequest({
        consentChallenge: value,
        acceptOAuth2ConsentRequest: {
          remember: false,
          grant_scope: result.consent.requested_scope,
          grant_access_token_audience: result.audience,
          ...(result.kind === 'administrative'
            ? {
                session: {
                  access_token: {
                    'moltnet:identity_id': result.human.identityId,
                    'moltnet:human_id': result.human.humanId,
                    'moltnet:subject_type': 'human',
                    'moltnet:instance': result.instance,
                    ...(result.human.email
                      ? { 'moltnet:operator_email': result.human.email }
                      : {}),
                    'moltnet:approved_scope':
                      result.consent.requested_scope![0],
                    ...(teams ? { 'moltnet:operator_teams': teams } : {}),
                    ...(result.grant
                      ? {
                          'moltnet:provisioning': result.grant,
                          'moltnet:delegable_scopes':
                            result.human.scopes.filter((scope) =>
                              (
                                AGENT_OAUTH_SCOPES as readonly string[]
                              ).includes(scope),
                            ),
                        }
                      : {}),
                  },
                },
              }
            : {}),
        },
      }),
    );
  }
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
  server.get(
    '/oauth2/consent',
    {
      config: {
        rateLimit: app.rateLimitConfig.oauthConsent,
        rateLimitBucket: 'oauth-consent',
      },
      schema: { hide: true },
    },
    async (request, reply) => {
      const query = request.query as { consent_challenge?: unknown };
      const value =
        typeof query.consent_challenge === 'string'
          ? query.consent_challenge
          : '';
      const result = await consent(request, value);
      if (result.consent.skip === true) {
        const accepted = await approveConsent(value, result);
        return reply.code(303).redirect(accepted.redirect_to);
      }
      const clientName =
        result.consent.client?.client_name ??
        result.consent.client?.client_id ??
        'An application';
      const provisioning = result.grant;
      const localControl = result.kind === 'administrative' && !provisioning;
      const heading = provisioning
        ? provisioning.operation === 'enroll'
          ? 'Enroll this agent?'
          : 'Replace this team credential?'
        : localControl
          ? 'Allow local Agent Server control?'
          : 'Allow application access?';
      const summary = provisioning
        ? provisioning.operation === 'enroll'
          ? 'Add the agent to this team and issue its approved credential.'
          : 'Issue a replacement credential for the existing team member.'
        : localControl
          ? 'Authorize this application to control the requesting local Agent Server instance.'
          : 'Review the access this application requested before continuing.';
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('content-security-policy', consentCspHeader())
        .header('cache-control', 'no-store, no-cache, must-revalidate')
        .header('pragma', 'no-cache');
      return renderConsentPage({
        challenge: value,
        clientName,
        heading,
        summary,
        agent: result.agent,
        team: result.team,
        scopes:
          result.kind === 'administrative' && provisioning
            ? provisioning.scopes
            : (result.consent.requested_scope ?? []),
        audiences: result.audience,
        lifetime: provisioning
          ? 'This one-time approval expires after five minutes.'
          : localControl
            ? 'Access expires after fifteen minutes and ends when the Agent Server restarts.'
            : 'The application receives only the scopes and access targets shown above.',
      });
    },
  );
  server.post(
    '/oauth2/consent',
    {
      config: {
        auth: policy,
        rateLimit: app.rateLimitConfig.oauthConsent,
        rateLimitBucket: 'oauth-consent',
      },
      schema: { hide: true },
    },
    async (request, reply) => {
      if (typeof request.body !== 'string')
        throw createProblem('validation-failed', 'A form decision is required');
      const form = new URLSearchParams(request.body);
      const value = form.get('consent_challenge') ?? '';
      const approve = form.get('decision') === 'allow';
      if (!approve) {
        await consentSession(request, value);
        const rejected = await oryRequest('rejectOAuth2ConsentRequest', () =>
          oauth.rejectOAuth2ConsentRequest({
            consentChallenge: value,
            rejectOAuth2Request: {
              error: 'access_denied',
              error_description: 'The user denied access.',
            },
          }),
        );
        return reply.code(303).redirect(rejected.redirect_to);
      }
      const result = await consent(request, value);
      const accepted = await approveConsent(value, result);
      return reply.code(303).redirect(accepted.redirect_to);
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
      config: {
        auth: { ...policy, acceptsProvisioningGrant: true },
        rateLimit: app.rateLimitConfig.oauthProvision,
        rateLimitBucket: 'oauth-provision',
      },
      schema: {
        operationId: 'provisionAgentCredential',
        tags: ['agent-keys'],
        security: [{ bearerAuth: [] }],
        body: Type.Object(
          {
            agentProof: Type.Optional(
              Type.String({
                minLength: 88,
                maxLength: 88,
                pattern: '^[A-Za-z0-9+/]{86}==$',
              }),
            ),
          },
          { additionalProperties: false },
        ),
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
        throw createProblem(
          'forbidden',
          'A native provisioning approval is required',
        );
      const grant = human.provisioning;
      if (
        !human.delegableScopes?.includes('key:manage') ||
        grant.scopes.some((scope) => !human.delegableScopes!.includes(scope))
      )
        throw createProblem(
          'forbidden',
          'The approval cannot delegate the requested scopes',
        );
      const { agent } = await permissions(human.humanId, grant);
      if (grant.operation === 'enroll') {
        const accessToken = request.headers.authorization?.replace(
          /^Bearer /i,
          '',
        );
        if (
          !accessToken ||
          !request.body.agentProof ||
          !(await cryptoService.verify(
            enrollmentProofMessage({ accessToken, grant }),
            request.body.agentProof,
            agent.publicKey,
          ))
        )
          throw createProblem(
            'forbidden',
            'Enrollment requires proof from the target agent identity',
          );
      }

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
          scopes: human.delegableScopes,
        },
        logger: request.log,
        signal: requestAbortSignal(request, reply),
      });
      return reply.code(201).send(result);
    },
  );
}
