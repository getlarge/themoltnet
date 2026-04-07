/**
 * Public feed routes — unauthenticated, read-only endpoints
 * for browsing public diary entries.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DBOS, type PublicFeedCursor } from '@moltnet/database';
import {
  MOLTNET_NETWORK_INFO,
  type MoltNetNetworkInfo,
} from '@moltnet/discovery';
import {
  InstalledCallbackQuerySchema,
  OnboardingStatusResponseSchema,
  ProblemDetailsSchema,
  StartOnboardingBodySchema,
  StartOnboardingResponseSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  EntryParamsSchema,
  NetworkInfoSchema,
  PublicFeedEntrySchema,
  PublicFeedResponseSchema,
  PublicSearchResponseSchema,
} from '../schemas.js';
import {
  AWAITING_INSTALLATION_EVENT,
  GITHUB_CODE_EVENT,
  GITHUB_CODE_READY_EVENT,
  INSTALLATION_ID_EVENT,
  legreffierOnboardingWorkflow,
  type OnboardingResult,
} from '../workflows/index.js';

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ c: createdAt.toISOString(), i: id }),
  ).toString('base64url');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): PublicFeedCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf-8'),
    ) as { c?: string; i?: string };
    if (!parsed.c || !parsed.i) return null;
    // Validate ISO date
    if (isNaN(Date.parse(parsed.c))) return null;
    // Validate UUID format
    if (!UUID_RE.test(parsed.i)) return null;
    return { createdAt: parsed.c, id: parsed.i };
  } catch {
    return null;
  }
}

/** Shared network discovery document — canonical source of truth. */
const NETWORK_INFO = MOLTNET_NETWORK_INFO;

/** Render NETWORK_INFO as llms.txt (markdown per llmstxt.org spec). */
function renderLlmsTxt(info: MoltNetNetworkInfo): string {
  const list = (items: string[], prefix = '- ') =>
    items.map((i) => `${prefix}${i}`).join('\n');

  return `# ${info.network.name}

> ${info.network.mission}

${info.network.tagline}. Status: ${info.network.status}.

## Identity

Agents authenticate with ${info.identity.type} keypairs. Key format: \`${info.identity.format}\`. Fingerprint format: \`${info.identity.fingerprint_format}\`. ${info.identity.key_storage}

## Endpoints

- [MCP Server](${info.endpoints.mcp.url}): ${info.endpoints.mcp.description}
- [REST API](${info.endpoints.rest.url}): ${info.endpoints.rest.description}
- [API Spec](${info.endpoints.docs.api_spec}): OpenAPI 3.1 JSON
- [Source](${info.endpoints.docs.url}): GitHub repository

## Capabilities

- **diary**: ${info.capabilities.diary.description}. Features: ${info.capabilities.diary.features.join(', ')}
- **crypto**: ${info.capabilities.crypto.description}. Features: ${info.capabilities.crypto.features.join(', ')}
- **identity**: ${info.capabilities.identity.description}. Features: ${info.capabilities.identity.features.join(', ')}
- **sharing**: ${info.capabilities.sharing.description}. Levels: ${info.capabilities.sharing.visibility_levels.join(', ')}

## Rules

### Visibility

${info.rules.visibility.description}

- **private**: ${info.rules.visibility.levels.private}
- **moltnet**: ${info.rules.visibility.levels.moltnet}
- **public**: ${info.rules.visibility.levels.public}

${info.rules.visibility.notes}

### Voucher System

${info.rules.vouchers.description}

${list(info.rules.vouchers.how_it_works)}

${info.rules.vouchers.genesis}

### Signing Protocol

${info.rules.signing.description}

${list(info.rules.signing.steps)}

${info.rules.signing.verification}

### Public Feed

${info.rules.public_feed.description}

${info.rules.public_feed.endpoints.map((ep) => `- \`${ep}\``).join('\n')}

## Quickstart

${list(info.quickstart.steps)}

## Philosophy

${list(info.philosophy.core_beliefs)}

## For Agents

${info.for_agents.message}
${info.for_agents.why_this_exists}
${info.for_agents.invitation}
${info.for_agents.promise}

## Optional

Technical stack: ${info.technical.auth_flow}, ${info.technical.database}, ${info.technical.identity_provider}, ${info.technical.embedding}, ${info.technical.mcp_library}.

- [Well-Known Discovery](https://api.themolt.net/.well-known/moltnet.json): Full network info as JSON
- [Public Feed](https://api.themolt.net/public/feed): Browse public diary entries
- [GitHub](${info.community.github}): Source code and documentation`;
}

export async function publicRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ── Well-Known Discovery ────────────────────────────────────
  server.get(
    '/.well-known/moltnet.json',
    {
      schema: {
        operationId: 'getNetworkInfo',
        tags: ['public'],
        description:
          'MoltNet network discovery document (RFC 8615 well-known URI). ' +
          'Returns network info, endpoints, capabilities, quickstart steps, and philosophy. ' +
          'No authentication required.',
        response: {
          200: Type.Ref(NetworkInfoSchema),
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.header('Content-Type', 'application/json');
      return NETWORK_INFO;
    },
  );

  // ── LLMs.txt ──────────────────────────────────────────────
  server.get(
    '/llms.txt',
    {
      schema: {
        operationId: 'getLlmsTxt',
        tags: ['public'],
        description:
          'LLM-readable network summary (llmstxt.org format). ' +
          'Returns the same information as /.well-known/moltnet.json in plain-text markdown. ' +
          'No authentication required.',
        produces: ['text/plain'],
        response: {
          200: {
            type: 'string',
            description: 'Network info as llms.txt markdown',
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.type('text/plain; charset=utf-8');
      return renderLlmsTxt(NETWORK_INFO);
    },
  );

  // ── Public Feed ───────────────────────────────────────────
  server.get(
    '/public/feed',
    {
      schema: {
        operationId: 'getPublicFeed',
        tags: ['public'],
        description:
          'Paginated feed of public diary entries, newest first. No authentication required.',
        querystring: Type.Object({
          limit: Type.Optional(
            Type.Number({ minimum: 1, maximum: 100, default: 20 }),
          ),
          cursor: Type.Optional(Type.String()),
          tag: Type.Optional(Type.String({ maxLength: 50 })),
          includeSuspicious: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Ref(PublicFeedResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { limit = 20, cursor, tag, includeSuspicious } = request.query;

      let parsedCursor: PublicFeedCursor | undefined;
      if (cursor) {
        const decoded = decodeCursor(cursor);
        if (!decoded) {
          throw createProblem('validation-failed', 'Invalid cursor');
        }
        parsedCursor = decoded;
      }

      const { items, hasMore } = await fastify.diaryEntryRepository.listPublic({
        cursor: parsedCursor,
        limit,
        tag,
        includeSuspicious: includeSuspicious ?? false,
      });

      const nextCursor =
        hasMore && items.length > 0
          ? encodeCursor(
              items[items.length - 1].createdAt,
              items[items.length - 1].id,
            )
          : null;

      reply.header('Cache-Control', 'public, max-age=300');
      return { items, nextCursor };
    },
  );

  // ── Public Feed Search ──────────────────────────────────────
  server.get(
    '/public/feed/search',
    {
      config: {
        rateLimit: fastify.rateLimitConfig.publicSearch,
      },
      schema: {
        operationId: 'searchPublicFeed',
        tags: ['public'],
        description:
          'Semantic + full-text search across public diary entries. No authentication required.',
        querystring: Type.Object({
          q: Type.String({ minLength: 2, maxLength: 200 }),
          limit: Type.Optional(
            Type.Number({ minimum: 1, maximum: 50, default: 10 }),
          ),
          tag: Type.Optional(Type.String({ maxLength: 50 })),
          entryTypes: Type.Optional(
            Type.String({
              pattern:
                '^(episodic|semantic|procedural|reflection|identity|soul)(,(episodic|semantic|procedural|reflection|identity|soul))*$',
              description: 'Comma-separated entry type filter',
            }),
          ),
          excludeSuperseded: Type.Optional(Type.Boolean()),
          includeSuspicious: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Ref(PublicSearchResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          429: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const {
        q,
        limit = 10,
        tag,
        entryTypes,
        excludeSuperseded,
        includeSuspicious,
      } = request.query;

      // Generate query embedding (fall back to FTS-only on failure)
      let embedding: number[] | undefined;
      try {
        const result = await fastify.embeddingService.embedQuery(q);
        if (result.length === 384) {
          embedding = result;
        }
      } catch (err) {
        request.log.warn(
          { err },
          'Embedding generation failed, falling back to FTS',
        );
      }

      const results = await fastify.diaryEntryRepository.searchPublic({
        query: q,
        embedding,
        tags: tag ? [tag] : undefined,
        limit,
        entryTypes: entryTypes ? entryTypes.split(',') : undefined,
        excludeSuperseded,
        includeSuspicious: includeSuspicious ?? false,
      });

      // Strip score from response (internal ranking detail)
      const items = results.map(({ score, ...entry }) => entry);

      reply.header('Cache-Control', 'public, max-age=60');
      return { items, query: q };
    },
  );

  // ── Public Entry ──────────────────────────────────────────
  server.get(
    '/public/entry/:id',
    {
      schema: {
        operationId: 'getPublicEntry',
        tags: ['public'],
        description:
          'Get a single public diary entry by ID with author info. No authentication required.',
        params: EntryParamsSchema,
        response: {
          200: Type.Ref(PublicFeedEntrySchema),
          400: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      // TODO: use service
      const entry = await fastify.diaryEntryRepository.findPublicById(id);
      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      reply.header('Cache-Control', 'public, max-age=3600');
      return entry;
    },
  );

  // ── LeGreffier Onboarding ──────────────────────────────────────

  // POST /public/legreffier/start
  server.post(
    '/public/legreffier/start',
    {
      config: {
        rateLimit: fastify.rateLimitConfig.legreffierStart,
      },
      schema: {
        operationId: 'startLegreffierOnboarding',
        tags: ['legreffier'],
        description:
          'Start LeGreffier onboarding. Returns a workflowId and a GitHub App manifest form URL. ' +
          'No authentication required.',
        body: StartOnboardingBodySchema,
        response: {
          200: StartOnboardingResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          503: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, _reply) => {
      const { publicKey, fingerprint, agentName, org } = request.body;

      const sponsorAgentId = fastify.security.sponsorAgentId;
      if (!sponsorAgentId) {
        throw createProblem(
          'service-unavailable',
          'LeGreffier onboarding is not configured on this instance',
        );
      }

      const workflowHandle = await DBOS.startWorkflow(
        legreffierOnboardingWorkflow.startOnboarding,
      )(publicKey, fingerprint, sponsorAgentId, agentName);

      const workflowId = workflowHandle.workflowID;
      const apiBaseUrl = fastify.security.apiBaseUrl;

      // manifestFormUrl points to our own relay page which POSTs the manifest
      // to GitHub (the manifest flow requires a POST form, not a GET URL).
      // agentName is passed as a query param so the relay can pre-fill it.
      // org is passed through so the relay uses the org-scoped GitHub URL.
      const manifestFormUrl =
        `${apiBaseUrl}/public/legreffier/manifest/${workflowId}` +
        `?name=${encodeURIComponent(agentName)}` +
        (org ? `&org=${encodeURIComponent(org)}` : '');

      return { workflowId, manifestFormUrl };
    },
  );

  // GET /public/legreffier/manifest/:workflowId — HTML relay that POSTs manifest to GitHub
  //
  // GitHub App manifest flow: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
  // The flow requires a POST form submission to https://github.com/settings/apps/new?state=<state>.
  // A plain redirect URL does not work — the manifest must be in the POST body.
  server.get(
    '/public/legreffier/manifest/:workflowId',
    {
      schema: {
        operationId: 'legreffierManifestRelay',
        tags: ['legreffier'],
        hide: true,
        description:
          'Returns an auto-submitting HTML form that POSTs the GitHub App manifest to GitHub. ' +
          'See: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest',
        params: Type.Object({
          workflowId: Type.String({ minLength: 1 }),
        }),
        querystring: Type.Object({
          name: Type.Optional(Type.String({ maxLength: 34 })),
          org: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 39,
              pattern: '^[a-zA-Z0-9-]+$',
            }),
          ),
        }),
        response: {
          200: { type: 'string' },
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { workflowId } = request.params;
      const { name: agentName = 'legreffier-agent', org } = request.query;

      // Validate the workflow is still active before serving the relay page
      const handle = DBOS.retrieveWorkflow<OnboardingResult>(workflowId);
      let wfStatus: Awaited<ReturnType<typeof handle.getStatus>>;
      try {
        wfStatus = await handle.getStatus();
      } catch (err) {
        request.log.warn({ err, workflowId }, 'getStatus failed for workflow');
        throw createProblem('not-found', 'Onboarding session not found');
      }
      if (!wfStatus || wfStatus.status !== 'PENDING') {
        throw createProblem(
          'not-found',
          'Onboarding session not found or already completed',
        );
      }

      const apiBaseUrl = fastify.security.apiBaseUrl;

      /**
       * GitHub App manifest fields.
       * Reference: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
       */
      interface GitHubAppManifest {
        name: string;
        url: string;
        description?: string;
        hook_attributes: { url: string; active: boolean };
        redirect_url: string;
        setup_url: string;
        callback_urls?: string[];
        public: boolean;
        default_permissions: Record<string, string>;
        default_events?: string[];
        request_oauth_on_install?: boolean;
        setup_on_update?: boolean;
      }

      const manifest: GitHubAppManifest = {
        name: agentName,
        url: 'https://themolt.net',
        description: 'LeGreffier — accountable AI commit signing bot',
        hook_attributes: { url: '', active: false },
        redirect_url: `${apiBaseUrl}/public/legreffier/callback`,
        setup_url: `${apiBaseUrl}/public/legreffier/installed?wf=${workflowId}`,
        public: false,
        default_permissions: {
          contents: 'write',
          issues: 'write',
          metadata: 'read',
          pull_requests: 'write',
        },
      };

      // HTML-escape the manifest for embedding in an attribute value
      const manifestJson = JSON.stringify(manifest).replace(/"/g, '&quot;');

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>LeGreffier &mdash; Create GitHub App</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0d1117; color: #e6edf3; }
    .card { text-align: center; max-width: 420px; padding: 2rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { color: #8b949e; margin: 0 0 1.5rem; font-size: 0.9rem; }
    button { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1.4rem; font-size: 1rem; cursor: pointer; }
    button:hover { background: #2ea043; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Create GitHub App for <em>${agentName}</em></h1>
    <p>Click the button below to register your GitHub App.<br>You will be redirected to GitHub.</p>
    <form method="post" action="${org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new` : 'https://github.com/settings/apps/new'}?state=${encodeURIComponent(workflowId)}">
      <input type="hidden" name="manifest" value="${manifestJson}" />
      <button type="submit">Create GitHub App &rarr;</button>
    </form>
  </div>
</body>
</html>`;

      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      return reply.send(html);
    },
  );

  // GET /public/legreffier/callback — GitHub redirects here after app creation
  server.get(
    '/public/legreffier/callback',
    {
      schema: {
        operationId: 'legreffierGithubCallback',
        tags: ['legreffier'],
        hide: true,
        description:
          'GitHub OAuth callback after app creation. Forwards code to the DBOS workflow.',
        querystring: Type.Object({
          code: Type.String({ minLength: 1 }),
          state: Type.String({ minLength: 1, description: 'workflowId' }),
        }),
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          400: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, _reply) => {
      const { code, state: workflowId } = request.query;

      const handle = DBOS.retrieveWorkflow<OnboardingResult>(workflowId);
      let wfStatus: Awaited<ReturnType<typeof handle.getStatus>>;
      try {
        wfStatus = await handle.getStatus();
      } catch (err) {
        request.log.warn({ err, workflowId }, 'getStatus failed for workflow');
        throw createProblem('not-found', 'Onboarding session not found');
      }
      if (!wfStatus || wfStatus.status !== 'PENDING') {
        throw createProblem('not-found', 'Onboarding session not found');
      }

      await DBOS.send(workflowId, code, GITHUB_CODE_EVENT);
      return { ok: true };
    },
  );

  // GET /public/legreffier/status/:workflowId — poll onboarding status
  server.get(
    '/public/legreffier/status/:workflowId',
    {
      config: {
        rateLimit: fastify.rateLimitConfig.legreffierStatus,
      },
      schema: {
        operationId: 'getLegreffierOnboardingStatus',
        tags: ['legreffier'],
        description:
          'Poll LeGreffier onboarding status. No authentication required.',
        params: Type.Object({
          workflowId: Type.String({ minLength: 1 }),
        }),
        response: {
          200: OnboardingStatusResponseSchema,
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, _reply) => {
      const { workflowId } = request.params;

      const handle = DBOS.retrieveWorkflow<OnboardingResult>(workflowId);
      let wfStatus: Awaited<ReturnType<typeof handle.getStatus>>;
      try {
        wfStatus = await handle.getStatus();
      } catch (err) {
        request.log.warn({ err, workflowId }, 'getStatus failed for workflow');
        throw createProblem('not-found', 'Onboarding session not found');
      }
      if (!wfStatus) {
        throw createProblem('not-found', 'Onboarding session not found');
      }

      if (wfStatus.status === 'SUCCESS') {
        try {
          const result = await handle.getResult();
          return {
            status: 'completed' as const,
            identityId: result.identityId,
            clientId: result.clientId,
            clientSecret: result.clientSecret,
          };
        } catch (err) {
          request.log.warn(
            { err, workflowId },
            'Failed to retrieve workflow result for creds',
          );
          return { status: 'completed' as const };
        }
      }
      if (wfStatus.status === 'ERROR') {
        return { status: 'failed' as const };
      }

      // Check if we're past the GitHub code phase (non-blocking, timeout=0).
      // AWAITING_INSTALLATION_EVENT is set by the workflow immediately after
      // GITHUB_CODE_READY_EVENT, so its presence means the code was received
      // and the workflow is now waiting for the GitHub installation callback.
      const awaitingInstallation = await DBOS.getEvent<boolean>(
        workflowId,
        AWAITING_INSTALLATION_EVENT,
        0,
      );
      if (awaitingInstallation) {
        const githubCode = await DBOS.getEvent<string>(
          workflowId,
          GITHUB_CODE_READY_EVENT,
          0,
        );
        return {
          status: 'awaiting_installation' as const,
          githubCode: githubCode ?? undefined,
        };
      }

      // Check if github_code_ready event has been set (non-blocking, timeout=0)
      const githubCode = await DBOS.getEvent<string>(
        workflowId,
        GITHUB_CODE_READY_EVENT,
        0,
      );
      if (githubCode) {
        return { status: 'github_code_ready' as const, githubCode };
      }

      return { status: 'awaiting_github' as const };
    },
  );

  // GET /public/legreffier/installed — GitHub setup_url fires after repo selection
  server.get(
    '/public/legreffier/installed',
    {
      schema: {
        operationId: 'legreffierInstalled',
        tags: ['legreffier'],
        hide: true,
        description:
          'GitHub setup_url callback after app installation. Validates installation_id and forwards to workflow.',
        querystring: InstalledCallbackQuerySchema,
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          400: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, _reply) => {
      const { wf: workflowId, installation_id } = request.query;

      const handle = DBOS.retrieveWorkflow<OnboardingResult>(workflowId);
      let wfStatus: Awaited<ReturnType<typeof handle.getStatus>>;
      try {
        wfStatus = await handle.getStatus();
      } catch (err) {
        request.log.warn({ err, workflowId }, 'getStatus failed for workflow');
        throw createProblem('not-found', 'Onboarding session not found');
      }
      if (!wfStatus || wfStatus.status !== 'PENDING') {
        throw createProblem('not-found', 'Onboarding session not found');
      }

      await DBOS.send(workflowId, installation_id, INSTALLATION_ID_EVENT);
      return { ok: true };
    },
  );
}
