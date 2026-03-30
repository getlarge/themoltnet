import type {
  ProvenanceGraph,
  ProvenanceGraphCreator,
  ProvenanceGraphNode,
} from '@moltnet/models';

export function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    const parts = value.map((item) =>
      typeof item === 'object' && item !== null
        ? JSON.stringify(item)
        : String(item),
    );
    return parts.join(', ') || '[]';
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return 'unsupported';
}

export function summarizeNodeId(value: string): string {
  return value.length <= 56 ? value : `${value.slice(0, 56)}...`;
}

export function extractCreator(
  node: ProvenanceGraphNode | null,
): ProvenanceGraphCreator | null {
  if (!node || !('creator' in node.meta)) return null;
  return node.meta.creator ?? null;
}

export function splitIntoLines(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) return [value];

  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);

  if (lines.length === 1 && lines[0]) {
    return [
      lines[0].slice(0, maxChars),
      `${lines[0].slice(maxChars, maxChars * 2)}...`,
    ];
  }

  if (lines.length > 2) {
    return [lines[0], `${lines[1].slice(0, Math.max(8, maxChars - 3))}...`];
  }

  return lines;
}

export function countEdges(
  graph: ProvenanceGraph | null,
  nodeId: string,
  kind: 'includes' | 'supersedes' | 'rendered_from',
): number {
  if (!graph) return 0;
  return graph.edges.filter(
    (edge) => edge.from === nodeId && edge.kind === kind,
  ).length;
}

export function toggleCollapsedPack(
  nodeId: string,
  previous: Set<string>,
): Set<string> {
  const next = new Set(previous);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
}

export function filterCollapsedGraph(
  graph: ProvenanceGraph,
  collapsedPackIds: Set<string>,
): ProvenanceGraph {
  if (collapsedPackIds.size === 0) return graph;

  const edges = graph.edges.filter(
    (edge) => !(edge.kind === 'includes' && collapsedPackIds.has(edge.from)),
  );

  const visibleNodeIds = new Set<string>([graph.metadata.rootNodeId]);
  for (const node of graph.nodes) {
    if (node.kind === 'pack') visibleNodeIds.add(node.id);
  }
  for (const edge of edges) {
    visibleNodeIds.add(edge.from);
    visibleNodeIds.add(edge.to);
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges,
  };
}
