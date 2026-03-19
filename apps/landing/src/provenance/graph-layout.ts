import type { ProvenanceGraph } from '@moltnet/models';

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

export interface GraphLayout {
  positions: Record<string, PositionedNode>;
  width: number;
  height: number;
}

const COLUMN_WIDTH = 392;
const ROW_HEIGHT = 184;
const PADDING_X = 96;
const PADDING_Y = 96;

function compareIds(a: string, b: string): number {
  return a.localeCompare(b);
}

export function buildGraphLayout(graph: ProvenanceGraph): GraphLayout {
  const rootId = graph.metadata.rootNodeId;
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const levels = new Map<string, number>();

  const queue: string[] = [];
  if (nodeMap.has(rootId)) {
    queue.push(rootId);
    levels.set(rootId, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const currentLevel = levels.get(current) ?? 0;

    for (const edge of graph.edges) {
      if (edge.from !== current) continue;

      const nextLevel =
        edge.kind === 'supersedes' ? currentLevel + 1 : currentLevel + 2;
      const previous = levels.get(edge.to);
      if (previous === undefined || nextLevel < previous) {
        levels.set(edge.to, nextLevel);
        queue.push(edge.to);
      }
    }
  }

  for (const node of graph.nodes) {
    if (!levels.has(node.id)) {
      const fallback =
        node.kind === 'pack' ? 0 : Math.max(...levels.values(), 0) + 1;
      levels.set(node.id, fallback);
    }
  }

  const groups = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    const current = groups.get(level) ?? [];
    current.push(node.id);
    groups.set(level, current);
  }

  const positions: Record<string, PositionedNode> = {};
  const orderedLevels = [...groups.keys()].sort((a, b) => a - b);
  let maxRows = 0;

  for (const level of orderedLevels) {
    const ids = groups.get(level);
    if (!ids) continue;

    ids.sort((left, right) => {
      const leftNode = nodeMap.get(left);
      const rightNode = nodeMap.get(right);
      if (!leftNode || !rightNode) {
        return compareIds(left, right);
      }
      if (leftNode.kind !== rightNode.kind) {
        return leftNode.kind === 'pack' ? -1 : 1;
      }
      return compareIds(left, right);
    });

    maxRows = Math.max(maxRows, ids.length);

    ids.forEach((id, row) => {
      positions[id] = {
        id,
        x: PADDING_X + level * COLUMN_WIDTH,
        y: PADDING_Y + row * ROW_HEIGHT,
      };
    });
  }

  return {
    positions,
    width: PADDING_X * 2 + Math.max(1, orderedLevels.length) * COLUMN_WIDTH,
    height: PADDING_Y * 2 + Math.max(1, maxRows) * ROW_HEIGHT,
  };
}
