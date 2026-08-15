import type { ProvenanceGraph } from '@moltnet/models';

const validNodeKinds = new Set(['pack', 'entry', 'rendered_pack']);
const validEdgeKinds = new Set(['includes', 'supersedes', 'rendered_from']);

export const MAX_PROVENANCE_INPUT_BYTES = 512 * 1024;
export const MAX_PROVENANCE_NODES = 250;
export const MAX_PROVENANCE_EDGES = 1_000;
export const MAX_PROVENANCE_DEPTH = 12;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_LABEL_LENGTH = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isCreator(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;

  if (value.kind === 'agent') {
    return (
      typeof value.identityId === 'string' &&
      typeof value.fingerprint === 'string' &&
      typeof value.publicKey === 'string'
    );
  }

  if (value.kind === 'human') {
    return (
      typeof value.humanId === 'string' &&
      (typeof value.identityId === 'string' || value.identityId === null)
    );
  }

  return false;
}

function isValidNode(node: unknown): node is ProvenanceGraph['nodes'][number] {
  if (
    !isRecord(node) ||
    typeof node.id !== 'string' ||
    node.id.length === 0 ||
    node.id.length > MAX_IDENTIFIER_LENGTH ||
    typeof node.label !== 'string' ||
    node.label.length === 0 ||
    node.label.length > MAX_LABEL_LENGTH ||
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
      (typeof node.meta.expiresAt === 'string' ||
        node.meta.expiresAt === null) &&
      isCreator(node.meta.creator)
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
    edge.id.length === 0 ||
    edge.id.length > MAX_IDENTIFIER_LENGTH ||
    typeof edge.from !== 'string' ||
    edge.from.length === 0 ||
    edge.from.length > MAX_IDENTIFIER_LENGTH ||
    typeof edge.to !== 'string' ||
    edge.to.length === 0 ||
    edge.to.length > MAX_IDENTIFIER_LENGTH ||
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
  if (new TextEncoder().encode(input).byteLength > MAX_PROVENANCE_INPUT_BYTES) {
    throw new Error('Graph JSON must be 512 KB or smaller');
  }

  const parsed: unknown = JSON.parse(input);

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.metadata) ||
    parsed.metadata.format !== 'moltnet.provenance-graph/v1' ||
    typeof parsed.metadata.generatedAt !== 'string' ||
    typeof parsed.metadata.rootNodeId !== 'string' ||
    typeof parsed.metadata.rootPackId !== 'string' ||
    typeof parsed.metadata.depth !== 'number' ||
    !Number.isInteger(parsed.metadata.depth) ||
    parsed.metadata.depth < 0 ||
    parsed.metadata.depth > MAX_PROVENANCE_DEPTH ||
    !Array.isArray(parsed.nodes) ||
    parsed.nodes.length === 0 ||
    parsed.nodes.length > MAX_PROVENANCE_NODES ||
    !Array.isArray(parsed.edges) ||
    parsed.edges.length > MAX_PROVENANCE_EDGES ||
    !parsed.nodes.every((node) => isValidNode(node)) ||
    !parsed.edges.every((edge) => isValidEdge(edge))
  ) {
    throw new Error(
      'Invalid provenance graph. Check its format, nodes, relationships, and requested depth.',
    );
  }

  const rootNodeId = parsed.metadata.rootNodeId;
  const rootPackId = parsed.metadata.rootPackId;
  const nodeIds = new Set(parsed.nodes.map((node) => node.id));
  if (nodeIds.size !== parsed.nodes.length) {
    throw new Error('Every provenance node must have a unique ID');
  }

  const edgeIds = new Set(parsed.edges.map((edge) => edge.id));
  if (edgeIds.size !== parsed.edges.length) {
    throw new Error('Every provenance relationship must have a unique ID');
  }

  const rootNode = parsed.nodes.find((node) => node.id === rootNodeId);
  if (
    !rootNode ||
    rootNode.kind !== 'pack' ||
    rootNode.meta.packId !== rootPackId
  ) {
    throw new Error('The declared root must match an existing pack node');
  }

  for (const edge of parsed.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references an unknown node`);
    }
  }

  return parsed as ProvenanceGraph;
}
