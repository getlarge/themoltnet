import { createMetricCounter } from '@moltnet/observability';
import type { FastifyReply } from 'fastify';

const requests = createMetricCounter(
  'moltnet-rest-api',
  'diary.search.requests',
  'Successful searches by actual inference mode and fallback outcome',
);

export function reportSearchMode(
  reply: FastifyReply,
  visibility: 'private' | 'public',
  hasQuery: boolean,
  usedEmbedding: boolean | undefined,
): void {
  const mode = !hasQuery ? 'filters' : usedEmbedding ? 'hybrid' : 'full-text';
  reply.header('X-MoltNet-Search-Mode', mode);
  requests.add(1, {
    visibility,
    mode,
    fallback: hasQuery && usedEmbedding === false,
  });
}
