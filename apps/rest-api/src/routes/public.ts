/**
 * Public feed routes — unauthenticated, read-only endpoints
 * for browsing public diary entries.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { PublicFeedCursor } from '@moltnet/database';
import {
  MOLTNET_NETWORK_INFO,
  type MoltNetNetworkInfo,
} from '@moltnet/discovery';
import { ProblemDetailsSchema } from '@moltnet/models';
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
import { pollPublicFeed } from '../sse/public-feed-poller.js';
import { createSSEWriter } from '../sse/sse-writer.js';

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

const MAX_SSE_PER_IP = 5;
const MAX_SSE_DURATION_MS = 30 * 60 * 1000; // 30 min
const HEARTBEAT_INTERVAL_MS = 30_000;

const sseConnectionsByIp = new Map<string, number>();

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
        }),
        response: {
          200: Type.Ref(PublicFeedResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { limit = 20, cursor, tag } = request.query;

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
      } = request.query as {
        q: string;
        limit?: number;
        tag?: string;
      };

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

  // ── SSE Feed Stream ────────────────────────────────────────
  fastify.get(
    '/public/feed/stream',
    {
      schema: {
        operationId: 'streamPublicFeed',
        tags: ['public'],
        hide: true,
        description: 'Server-Sent Events stream of new public diary entries.',
        querystring: Type.Object({
          tag: Type.Optional(Type.String({ maxLength: 50 })),
        }),
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      const currentCount = sseConnectionsByIp.get(ip) ?? 0;
      if (currentCount >= MAX_SSE_PER_IP) {
        throw createProblem('rate-limit-exceeded', 'Too many SSE connections');
      }

      const { tag } = request.query as { tag?: string };

      // Parse Last-Event-ID for reconnection
      const lastEventId = request.headers['last-event-id'] as
        | string
        | undefined;
      let afterCreatedAt: string | undefined;
      let afterId: string | undefined;
      if (lastEventId) {
        const [ts, id] = lastEventId.split('/');
        if (ts && id && UUID_RE.test(id) && !isNaN(Date.parse(ts))) {
          afterCreatedAt = ts;
          afterId = id;
        }
      }

      // Hijack the response to write raw SSE
      reply.hijack();
      const writer = createSSEWriter(reply.raw);

      // Track connection count
      sseConnectionsByIp.set(ip, currentCount + 1);
      const ac = new AbortController();
      let cleaned = false;

      // Heartbeat timer
      const heartbeatTimer = setInterval(() => {
        if (!writer.sendHeartbeat()) {
          ac.abort();
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Max duration timer
      const maxDurationTimer = setTimeout(() => {
        ac.abort();
      }, MAX_SSE_DURATION_MS);

      // Cleanup on close (idempotent via guard flag)
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        ac.abort();
        clearInterval(heartbeatTimer);
        clearTimeout(maxDurationTimer);
        const count = sseConnectionsByIp.get(ip) ?? 1;
        if (count <= 1) {
          sseConnectionsByIp.delete(ip);
        } else {
          sseConnectionsByIp.set(ip, count - 1);
        }
        writer.close();
      };

      request.raw.on('close', cleanup);

      try {
        const poller = pollPublicFeed({
          diaryEntryRepository: fastify.diaryEntryRepository,
          tag,
          signal: ac.signal,
          afterCreatedAt,
          afterId,
        });

        for await (const entry of poller) {
          const eventId = `${entry.createdAt.toISOString()}/${entry.id}`;
          const ok = writer.sendEvent('entry', JSON.stringify(entry), eventId);
          if (!ok) break;
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          request.log.error(err, 'SSE feed error');
          writer.sendEvent(
            'error',
            JSON.stringify({ message: 'Internal server error' }),
          );
        }
      } finally {
        cleanup();
      }
    },
  );
}
