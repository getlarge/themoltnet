import type { KetoNamespace } from '@moltnet/auth';
import type {
  ContextPackWithCreator,
  ExpandedPackEntry,
  RenderedPack,
} from '@moltnet/database';
import type { ProvenanceGraph } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';

function summarizeEntry(title: string | null, content: string): string {
  if (title?.trim()) {
    return title.trim();
  }

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

function renderedPackNodeId(renderedPackId: string): string {
  return `rendered_pack:${renderedPackId}`;
}

interface BuildPackProvenanceGraphOptions {
  fastify: FastifyInstance;
  rootPack: ContextPackWithCreator;
  depth: number;
  identityId: string;
  subjectNs: KetoNamespace;
}

export async function buildPackProvenanceGraph({
  fastify,
  rootPack,
  depth,
  identityId,
  subjectNs,
}: BuildPackProvenanceGraphOptions): Promise<ProvenanceGraph> {
  const packs = new Map<string, ContextPackWithCreator>();
  const queue: Array<{ pack: ContextPackWithCreator; remainingDepth: number }> =
    [{ pack: rootPack, remainingDepth: depth }];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || packs.has(next.pack.id)) {
      continue;
    }

    packs.set(next.pack.id, next.pack);

    if (next.remainingDepth <= 0 || !next.pack.supersedesPackId) {
      continue;
    }

    const parent = await fastify.contextPackRepository.findById(
      next.pack.supersedesPackId,
    );
    if (!parent) {
      continue;
    }

    queue.push({
      pack: parent,
      remainingDepth: next.remainingDepth - 1,
    });
  }

  const visible = await fastify.permissionChecker.canReadPacks(
    Array.from(packs.keys()),
    identityId,
    subjectNs,
  );
  const visiblePackIds = Array.from(packs.keys()).filter(
    (packId) => visible.get(packId) ?? false,
  );
  const entriesByPack =
    await fastify.contextPackRepository.listEntriesExpandedByPackIds(
      visiblePackIds,
    );
  const renderedPacks = await fastify.renderedPackRepository.listBySourcePackIds(
    visiblePackIds,
  );

  const nodes: ProvenanceGraph['nodes'] = [];
  const edges: ProvenanceGraph['edges'] = [];
  const seenEntries = new Set<string>();

  for (const packId of visiblePackIds) {
    const pack = packs.get(packId);
    if (!pack) {
      continue;
    }

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
        createdAt: pack.createdAt.toISOString(),
        expiresAt: pack.expiresAt?.toISOString() ?? null,
        supersedesPackId: pack.supersedesPackId,
        creator: pack.creator ?? null,
      },
    });

    if (
      pack.supersedesPackId &&
      (visible.get(pack.supersedesPackId) ?? false) &&
      packs.has(pack.supersedesPackId)
    ) {
      edges.push({
        id: `${packNodeId(pack.id)}->${packNodeId(pack.supersedesPackId)}:supersedes`,
        from: packNodeId(pack.id),
        to: packNodeId(pack.supersedesPackId),
        kind: 'supersedes',
        label: 'supersedes',
      });
    }

    for (const item of entriesByPack.get(pack.id) ?? []) {
      pushEntryNode(nodes, seenEntries, item);
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

  for (const renderedPack of renderedPacks) {
    pushRenderedPackNode(nodes, renderedPack);
    edges.push({
      id: `${packNodeId(renderedPack.sourcePackId)}->${renderedPackNodeId(renderedPack.id)}:rendered_from`,
      from: packNodeId(renderedPack.sourcePackId),
      to: renderedPackNodeId(renderedPack.id),
      kind: 'rendered_from',
      label: 'rendered from',
    });
  }

  return {
    metadata: {
      format: 'moltnet.provenance-graph/v1',
      generatedAt: new Date().toISOString(),
      rootNodeId: packNodeId(rootPack.id),
      rootPackId: rootPack.id,
      depth,
    },
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function pushEntryNode(
  nodes: ProvenanceGraph['nodes'],
  seenEntries: Set<string>,
  item: ExpandedPackEntry,
): void {
  if (seenEntries.has(item.entry.id)) {
    return;
  }

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
      createdAt: item.entry.createdAt.toISOString(),
      updatedAt: item.entry.updatedAt.toISOString(),
      signed: item.entry.contentSignature !== null,
      title: item.entry.title,
      tags: item.entry.tags ?? [],
      creator: item.entry.creator ?? null,
    },
  });
}

function pushRenderedPackNode(
  nodes: ProvenanceGraph['nodes'],
  renderedPack: RenderedPack,
): void {
  nodes.push({
    id: renderedPackNodeId(renderedPack.id),
    kind: 'rendered_pack',
    label: `${renderedPack.renderMethod} ${renderedPack.id.slice(0, 8)}`,
    cid: renderedPack.packCid,
    meta: {
      renderedPackId: renderedPack.id,
      sourcePackId: renderedPack.sourcePackId,
      diaryId: renderedPack.diaryId,
      packCid: renderedPack.packCid,
      renderMethod: renderedPack.renderMethod,
      totalTokens: renderedPack.totalTokens,
      pinned: renderedPack.pinned,
      createdAt: renderedPack.createdAt.toISOString(),
      expiresAt: renderedPack.expiresAt?.toISOString() ?? null,
    },
  });
}
