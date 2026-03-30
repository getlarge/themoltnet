import type { ProvenanceGraph } from '@moltnet/models';

const validNodeKinds = new Set(['pack', 'entry', 'rendered_pack']);
const validEdgeKinds = new Set(['includes', 'supersedes', 'rendered_from']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isCreator(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (isRecord(value) &&
      typeof value.identityId === 'string' &&
      typeof value.fingerprint === 'string' &&
      typeof value.publicKey === 'string')
  );
}

function isValidNode(node: unknown): node is ProvenanceGraph['nodes'][number] {
  if (
    !isRecord(node) ||
    typeof node.id !== 'string' ||
    typeof node.label !== 'string' ||
    !validNodeKinds.has(node.kind as string) ||
    !(typeof node.cid === 'string' || node.cid === null) ||
    !isRecord(node.meta)
  ) {
    return false;
  }

  if (node.kind === 'pack') {
    return (
      typeof node.meta.packId === 'string' &&
      typeof node.meta.diaryId === 'string' &&
      typeof node.meta.packCid === 'string' &&
      typeof node.meta.packType === 'string' &&
      typeof node.meta.packCodec === 'string' &&
      typeof node.meta.pinned === 'boolean' &&
      typeof node.meta.createdAt === 'string' &&
      (typeof node.meta.expiresAt === 'string' ||
        node.meta.expiresAt === null) &&
      (typeof node.meta.supersedesPackId === 'string' ||
        node.meta.supersedesPackId === null) &&
      isCreator(node.meta.creator)
    );
  }

  if (node.kind === 'rendered_pack') {
    return (
      typeof node.meta.renderedPackId === 'string' &&
      typeof node.meta.sourcePackId === 'string' &&
      typeof node.meta.diaryId === 'string' &&
      typeof node.meta.packCid === 'string' &&
      typeof node.meta.renderMethod === 'string' &&
      typeof node.meta.totalTokens === 'number' &&
      typeof node.meta.pinned === 'boolean' &&
      typeof node.meta.createdAt === 'string' &&
      (typeof node.meta.expiresAt === 'string' || node.meta.expiresAt === null)
    );
  }

  return (
    typeof node.meta.entryId === 'string' &&
    typeof node.meta.diaryId === 'string' &&
    typeof node.meta.entryType === 'string' &&
    (typeof node.meta.contentHash === 'string' ||
      node.meta.contentHash === null) &&
    typeof node.meta.createdAt === 'string' &&
    typeof node.meta.updatedAt === 'string' &&
    typeof node.meta.signed === 'boolean' &&
    (typeof node.meta.title === 'string' || node.meta.title === null) &&
    isStringArray(node.meta.tags) &&
    isCreator(node.meta.creator)
  );
}

function isValidEdge(edge: unknown): edge is ProvenanceGraph['edges'][number] {
  if (
    !isRecord(edge) ||
    typeof edge.id !== 'string' ||
    typeof edge.from !== 'string' ||
    typeof edge.to !== 'string' ||
    !validEdgeKinds.has(edge.kind as string)
  ) {
    return false;
  }

  if (!(edge.label === undefined || typeof edge.label === 'string')) {
    return false;
  }

  if (edge.meta === undefined) return true;
  if (!isRecord(edge.meta)) return false;

  return Object.values(edge.meta).every(
    (value) =>
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null,
  );
}

export function parseProvenanceGraph(input: string): ProvenanceGraph {
  const parsed: unknown = JSON.parse(input);

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.metadata) ||
    parsed.metadata.format !== 'moltnet.provenance-graph/v1' ||
    typeof parsed.metadata.generatedAt !== 'string' ||
    typeof parsed.metadata.rootNodeId !== 'string' ||
    typeof parsed.metadata.rootPackId !== 'string' ||
    typeof parsed.metadata.depth !== 'number' ||
    !Array.isArray(parsed.nodes) ||
    !Array.isArray(parsed.edges) ||
    !parsed.nodes.every((node) => isValidNode(node)) ||
    !parsed.edges.every((edge) => isValidEdge(edge))
  ) {
    throw new Error('Invalid provenance graph payload');
  }

  const nodeIds = new Set(parsed.nodes.map((node) => node.id));
  for (const edge of parsed.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references an unknown node`);
    }
  }

  return parsed as ProvenanceGraph;
}
