#!/usr/bin/env -S npx tsx
/* eslint-disable no-console */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  type ContextPackResponse,
  getContextPackById,
  listDiaryPacks,
} from '@moltnet/api-client';
import type { ProvenanceGraph } from '@moltnet/models';
import { connect } from '@themoltnet/sdk';

function printUsage(): void {
  console.error(`Usage: pnpm --filter @moltnet/tools graph:provenance [options]

Options:
  --pack-id <uuid>        Export provenance rooted at a persisted pack id
  --diary-id <uuid>       Resolve the newest pack in a diary when --pack-id is omitted
  --config-dir <path>     MoltNet config directory (defaults to ~/.config/moltnet)
  --api-url <url>         API base URL (default resolved by SDK)
  --depth <n>             Follow pack supersession ancestry to this depth (default: 2)
  --out <path>            Write JSON to file instead of stdout
`);
}

function summarizeEntry(title: string | null, content: string): string {
  if (title?.trim()) return title.trim();

  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= 42
    ? normalized
    : `${normalized.slice(0, 39).trimEnd()}...`;
}

function packNodeId(packId: string): string {
  return `pack:${packId}`;
}

function entryNodeId(entryId: string): string {
  return `entry:${entryId}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      'pack-id': { type: 'string' },
      'diary-id': { type: 'string' },
      'config-dir': { type: 'string' },
      'api-url': { type: 'string' },
      depth: { type: 'string', default: '2' },
      out: { type: 'string' },
    },
    strict: true,
  });

  const packIdArg =
    typeof values['pack-id'] === 'string' ? values['pack-id'] : undefined;
  const diaryIdArg =
    typeof values['diary-id'] === 'string' ? values['diary-id'] : undefined;

  if (!packIdArg && !diaryIdArg) {
    printUsage();
    throw new Error('Pass either --pack-id or --diary-id');
  }

  const depth = Number.parseInt(String(values.depth ?? '2'), 10);
  if (!Number.isFinite(depth) || depth < 0) {
    throw new Error('--depth must be a non-negative integer');
  }

  const agent = await connect({
    apiUrl:
      typeof values['api-url'] === 'string' ? values['api-url'] : undefined,
    configDir:
      typeof values['config-dir'] === 'string'
        ? values['config-dir']
        : undefined,
  });

  const auth = () => agent.getToken();
  const apiClient = agent.client;

  let rootPackId = packIdArg;

  if (!rootPackId) {
    if (!diaryIdArg) {
      throw new Error('Expected --diary-id when --pack-id is omitted');
    }

    const response = await listDiaryPacks({
      client: apiClient,
      auth,
      path: { id: diaryIdArg },
      query: { limit: 1 },
      throwOnError: true,
    });

    const pack = response.data?.items[0];
    if (!pack) {
      throw new Error(`No persisted packs found for diary ${diaryIdArg}`);
    }

    rootPackId = pack.id;
  }

  const packs = new Map<string, ContextPackResponse>();
  const queue: Array<{ packId: string; remainingDepth: number }> = [
    { packId: rootPackId, remainingDepth: depth },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;

    if (packs.has(next.packId)) continue;

    const response = await getContextPackById({
      client: apiClient,
      auth,
      path: { id: next.packId },
      query: { expand: 'entries' },
      throwOnError: true,
    });

    const pack = response.data;
    if (!pack) {
      throw new Error(`Pack ${next.packId} not found`);
    }

    packs.set(pack.id, pack);

    if (next.remainingDepth > 0 && pack.supersedesPackId) {
      queue.push({
        packId: pack.supersedesPackId,
        remainingDepth: next.remainingDepth - 1,
      });
    }
  }

  const nodes: ProvenanceGraph['nodes'] = [];
  const edges: ProvenanceGraph['edges'] = [];
  const seenEntries = new Set<string>();

  for (const pack of packs.values()) {
    nodes.push({
      id: packNodeId(pack.id),
      kind: 'pack',
      label: `${pack.packType} pack ${pack.id.slice(0, 8)}`,
      cid: pack.packCid,
      meta: {
        packId: pack.id,
        diaryId: pack.diaryId,
        packCid: pack.packCid,
        packType: pack.packType,
        packCodec: pack.packCodec,
        pinned: pack.pinned,
        createdAt: pack.createdAt,
        expiresAt: pack.expiresAt,
        supersedesPackId: pack.supersedesPackId,
      },
    });

    if (pack.supersedesPackId && packs.has(pack.supersedesPackId)) {
      edges.push({
        id: `${packNodeId(pack.id)}->${packNodeId(pack.supersedesPackId)}:supersedes`,
        from: packNodeId(pack.id),
        to: packNodeId(pack.supersedesPackId),
        kind: 'supersedes',
        label: 'supersedes',
      });
    }

    for (const item of pack.entries ?? []) {
      if (!seenEntries.has(item.entry.id)) {
        seenEntries.add(item.entry.id);
        nodes.push({
          id: entryNodeId(item.entry.id),
          kind: 'entry',
          label: summarizeEntry(item.entry.title, item.entry.content),
          cid: item.entry.contentHash,
          meta: {
            entryId: item.entry.id,
            diaryId: item.entry.diaryId,
            entryType: item.entry.entryType,
            contentHash: item.entry.contentHash,
            createdAt: item.entry.createdAt,
            updatedAt: item.entry.updatedAt,
            signed: item.entry.contentSignature !== null,
            title: item.entry.title,
            tags: item.entry.tags ?? [],
          },
        });
      }

      edges.push({
        id: `${packNodeId(pack.id)}->${entryNodeId(item.entry.id)}:includes`,
        from: packNodeId(pack.id),
        to: entryNodeId(item.entry.id),
        kind: 'includes',
        label: item.rank === null ? undefined : `rank ${item.rank}`,
        meta: {
          compressionLevel: item.compressionLevel,
          entryCidSnapshot: item.entryCidSnapshot,
          originalTokens: item.originalTokens,
          packedTokens: item.packedTokens,
          rank: item.rank,
        },
      });
    }
  }

  const graph: ProvenanceGraph = {
    metadata: {
      format: 'moltnet.provenance-graph/v1',
      generatedAt: new Date().toISOString(),
      rootNodeId: packNodeId(rootPackId),
      rootPackId,
      depth,
    },
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };

  const serialized = `${JSON.stringify(graph, null, 2)}\n`;
  const outPath = typeof values.out === 'string' ? values.out : undefined;

  if (outPath) {
    await writeFile(outPath, serialized, 'utf8');
    console.error(`[graph:provenance] wrote ${outPath}`);
    return;
  }

  process.stdout.write(serialized);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
