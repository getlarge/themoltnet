import type { ProvenanceGraph } from '@moltnet/models';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseProvenanceGraph(input: string): ProvenanceGraph {
  const parsed: unknown = JSON.parse(input);

  if (!isRecord(parsed)) {
    throw new Error('Graph payload must be a JSON object');
  }

  if (!isRecord(parsed.metadata)) {
    throw new Error('Graph metadata is required');
  }

  if (parsed.metadata.format !== 'moltnet.provenance-graph/v1') {
    throw new Error('Unsupported graph format');
  }

  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Graph nodes and edges must be arrays');
  }

  for (const node of parsed.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string') {
      throw new Error('Each node must have a string id');
    }
  }

  const nodeIds = new Set(
    parsed.nodes.map((node) => String((node as { id: string }).id)),
  );

  for (const edge of parsed.edges) {
    if (
      !isRecord(edge) ||
      typeof edge.id !== 'string' ||
      typeof edge.from !== 'string' ||
      typeof edge.to !== 'string'
    ) {
      throw new Error('Each edge must have string id/from/to fields');
    }

    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references an unknown node`);
    }
  }

  return parsed as ProvenanceGraph;
}
