import type {
  ContextPackWithCreator,
  ExpandedPackEntry,
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
}

export async function buildPackProvenanceGraph({
  fastify,
  rootPack,
  depth,
  identityId,
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
  );
  const visiblePackIds = Array.from(packs.keys()).filter(
    (packId) => visible.get(packId) ?? false,
  );
  const entriesByPack =
    await fastify.contextPackRepository.listEntriesExpandedByPackIds(
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

  // Batch-fetch rendered packs for all visible context packs (avoids N+1).
  // Auth: rendered packs inherit permissions from their source pack — if the
  // source pack is visible, its rendered versions are too.
  const allRenderedPacks =
    await fastify.renderedPackRepository.listBySourcePackIds(visiblePackIds);
  for (const rp of allRenderedPacks) {
    nodes.push({
      id: renderedPackNodeId(rp.id),
      kind: 'rendered_pack',
      label: `rendered ${rp.renderMethod} ${rp.id.slice(0, 8)}`,
      cid: rp.packCid,
      meta: {
        renderedPackId: rp.id,
        sourcePackId: rp.sourcePackId,
        diaryId: rp.diaryId,
        packCid: rp.packCid,
        renderMethod: rp.renderMethod,
        totalTokens: rp.totalTokens,
        pinned: rp.pinned,
        createdAt: rp.createdAt.toISOString(),
        expiresAt: rp.expiresAt?.toISOString() ?? null,
      },
    });
    edges.push({
      id: `${renderedPackNodeId(rp.id)}->${packNodeId(rp.sourcePackId)}:rendered_from`,
      from: renderedPackNodeId(rp.id),
      to: packNodeId(rp.sourcePackId),
      kind: 'rendered_from',
      label: rp.renderMethod,
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
