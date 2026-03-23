import {
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listDiaryPacks,
} from '@moltnet/api-client';

import type { PacksNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

function renderPackMarkdown(
  id: string,
  pack: Awaited<ReturnType<PacksNamespace['get']>>,
): string {
  const entries = pack.entries ?? [];
  const sections = entries.map((entry, index) => {
    const title =
      entry.entry.title ?? `Entry ${index + 1} — ${entry.entryId.slice(0, 8)}`;
    return [
      `### ${title}`,
      '',
      `- Entry ID: \`${entry.entryId}\``,
      `- CID: \`${entry.entryCidSnapshot}\``,
      `- Compression: \`${entry.compressionLevel}\``,
      `- Tokens: ${entry.packedTokens ?? '?'}/${entry.originalTokens ?? '?'}`,
      '',
      entry.entry.content,
    ].join('\n');
  });

  return [
    `# Context Pack ${id}`,
    '',
    `Entries: ${entries.length}`,
    `Created: ${pack.createdAt}`,
    '',
    '---',
    '',
    ...sections,
    '',
  ].join('\n');
}

export function createPacksNamespace(context: AgentContext): PacksNamespace {
  const { client, auth } = context;

  return {
    async get(id, query) {
      return unwrapResult(
        await getContextPackById({
          client,
          auth,
          path: { id },
          query,
        }),
      );
    },

    async list(diaryId, query) {
      return unwrapResult(
        await listDiaryPacks({
          client,
          auth,
          path: { id: diaryId },
          query,
        }),
      );
    },

    async export(id) {
      const pack = unwrapResult(
        await getContextPackById({
          client,
          auth,
          path: { id },
          query: { expand: 'entries' },
        }),
      );
      return renderPackMarkdown(id, pack);
    },

    async getProvenance(id, query) {
      return unwrapResult(
        await getContextPackProvenanceById({
          client,
          auth,
          path: { id },
          query,
        }),
      );
    },

    async getProvenanceByCid(cid, query) {
      return unwrapResult(
        await getContextPackProvenanceByCid({
          client,
          auth,
          path: { cid },
          query,
        }),
      );
    },
  };
}
