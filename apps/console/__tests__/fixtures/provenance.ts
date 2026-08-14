/**
 * Fixtures mirroring what `buildPackProvenanceGraph`
 * (`apps/rest-api/src/routes/pack-provenance.ts`) actually emits — not an
 * invented shape.
 *
 * Verified against the builder:
 * - node ids are prefixed: `pack:<uuid>`, `entry:<uuid>`, `rendered_pack:<uuid>`
 * - `supersedes` runs newer pack -> older pack
 * - `includes` runs pack -> entry
 * - `rendered_from` runs **source pack -> rendered pack**
 * - nodes and edges are sorted by id
 */
import type {
  ProvenanceGraph,
  ProvenanceGraphEdge,
  ProvenanceGraphEdgeKind,
  ProvenanceGraphNode,
} from '@moltnet/models';

export const AGENT = {
  kind: 'agent' as const,
  identityId: '00000000-0000-4000-8000-00000000a9e7',
  fingerprint: '1671-B080-99BF-4270',
  publicKey: 'ed25519:SHfCplw8RRbre72h5NeGY+sPv4jFSt5xNaq+/uK8OWI=',
};

const uuid = (seed: string): string =>
  `${seed.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000`;

export const packNodeId = (seed: string) => `pack:${uuid(seed)}`;
export const entryNodeId = (seed: string) => `entry:${uuid(seed)}`;
export const renderedPackNodeId = (seed: string) =>
  `rendered_pack:${uuid(seed)}`;

export function packNode(
  seed: string,
  over: {
    pinned?: boolean;
    expiresAt?: string | null;
    createdAt?: string;
    supersedesPackId?: string | null;
    packType?: string;
  } = {},
): ProvenanceGraphNode {
  const id = uuid(seed);
  return {
    id: packNodeId(seed),
    kind: 'pack',
    label: `${over.packType ?? 'compile'} pack ${id.slice(0, 8)}`,
    cid: `bafypack${seed}`,
    meta: {
      packId: id,
      diaryId: uuid('diary'),
      packCid: `bafypack${seed}`,
      packType: over.packType ?? 'compile',
      packCodec: 'dag-cbor',
      pinned: over.pinned ?? false,
      createdAt: over.createdAt ?? '2026-08-01T00:00:00.000Z',
      expiresAt: over.expiresAt === undefined ? null : over.expiresAt,
      supersedesPackId:
        over.supersedesPackId === undefined ? null : over.supersedesPackId,
      creator: AGENT,
    },
  } as ProvenanceGraphNode;
}

export function entryNode(seed: string): ProvenanceGraphNode {
  const id = uuid(seed);
  return {
    id: entryNodeId(seed),
    kind: 'entry',
    label: `entry ${id.slice(0, 8)}`,
    cid: `bafyentry${seed}`,
    meta: {
      entryId: id,
      diaryId: uuid('diary'),
      entryType: 'semantic',
      contentHash: `bafyentry${seed}`,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      signed: true,
      title: `Entry ${seed}`,
      tags: ['decision'],
      creator: AGENT,
    },
  } as ProvenanceGraphNode;
}

export function renderedPackNode(
  seed: string,
  sourceSeed: string,
  over: {
    pinned?: boolean;
    expiresAt?: string | null;
    createdAt?: string;
  } = {},
): ProvenanceGraphNode {
  const id = uuid(seed);
  return {
    id: renderedPackNodeId(seed),
    kind: 'rendered_pack',
    label: `markdown ${id.slice(0, 8)}`,
    cid: `bafyrendered${seed}`,
    meta: {
      renderedPackId: id,
      sourcePackId: uuid(sourceSeed),
      diaryId: uuid('diary'),
      packCid: `bafyrendered${seed}`,
      renderMethod: 'markdown',
      totalTokens: 1234,
      pinned: over.pinned ?? false,
      createdAt: over.createdAt ?? '2026-08-02T00:00:00.000Z',
      expiresAt: over.expiresAt === undefined ? null : over.expiresAt,
      creator: AGENT,
    },
  } as ProvenanceGraphNode;
}

export function edge(
  from: string,
  to: string,
  kind: ProvenanceGraphEdgeKind,
): ProvenanceGraphEdge {
  return { id: `${from}->${to}:${kind}`, from, to, kind, label: kind };
}

export function graphFixture({
  nodes,
  edges,
  rootSeed = 'p1',
  depth = 3,
}: {
  nodes: ProvenanceGraphNode[];
  edges: ProvenanceGraphEdge[];
  rootSeed?: string;
  depth?: number;
}): ProvenanceGraph {
  return {
    metadata: {
      format: 'moltnet.provenance-graph/v1',
      generatedAt: '2026-08-14T00:00:00.000Z',
      rootNodeId: packNodeId(rootSeed),
      rootPackId: uuid(rootSeed),
      depth,
    },
    // The builder sorts both by id; mirror that so ordering assertions in the
    // consumer are testing the consumer, not fixture insertion order.
    nodes: [...nodes].sort((l, r) => l.id.localeCompare(r.id)),
    edges: [...edges].sort((l, r) => l.id.localeCompare(r.id)),
  };
}
