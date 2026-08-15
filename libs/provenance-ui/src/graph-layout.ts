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
  orientation: 'horizontal' | 'vertical';
}

export const GRAPH_NODE_WIDTH = 280;
export const GRAPH_NODE_HEIGHT = 116;

const COLUMN_WIDTH = 392;
const ROW_HEIGHT = 184;
const PADDING_X = 72;
const PADDING_Y = 72;
const VERTICAL_GAP = 64;

export function buildGraphLayout(
  graph: ProvenanceGraph,
  orientation: GraphLayout['orientation'] = 'horizontal',
): GraphLayout {
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
      const nextLevel = currentLevel + (edge.kind === 'includes' ? 2 : 1);
      const previous = levels.get(edge.to);
      if (previous === undefined || nextLevel < previous) {
        levels.set(edge.to, nextLevel);
        queue.push(edge.to);
      }
    }
  }

  for (const node of graph.nodes) {
    if (levels.has(node.id)) continue;
    const lastLevel = levels.size > 0 ? Math.max(...levels.values()) : 0;
    levels.set(node.id, node.kind === 'pack' ? 0 : lastLevel + 1);
  }

  const groups = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node.id]);
  }

  const positions: Record<string, PositionedNode> = {};
  const orderedLevels = [...groups.keys()].sort((a, b) => a - b);
  let maxRows = 0;

  if (orientation === 'vertical') {
    let row = 0;
    for (const level of orderedLevels) {
      const ids = groups.get(level);
      if (!ids) continue;
      ids.sort((left, right) => {
        const leftNode = nodeMap.get(left);
        const rightNode = nodeMap.get(right);
        if (leftNode?.kind !== rightNode?.kind) {
          return leftNode?.kind === 'pack' ? -1 : 1;
        }
        return left.localeCompare(right);
      });
      for (const id of ids) {
        positions[id] = {
          id,
          x: 32,
          y: 32 + row * (GRAPH_NODE_HEIGHT + VERTICAL_GAP),
        };
        row += 1;
      }
    }

    return {
      positions,
      width: GRAPH_NODE_WIDTH + 64,
      height:
        row === 0
          ? GRAPH_NODE_HEIGHT + 64
          : 64 + row * GRAPH_NODE_HEIGHT + (row - 1) * VERTICAL_GAP,
      orientation,
    };
  }

  for (const level of orderedLevels) {
    const ids = groups.get(level);
    if (!ids) continue;

    ids.sort((left, right) => {
      const leftNode = nodeMap.get(left);
      const rightNode = nodeMap.get(right);
      if (leftNode?.kind !== rightNode?.kind) {
        return leftNode?.kind === 'pack' ? -1 : 1;
      }
      return left.localeCompare(right);
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
    width:
      Math.max(
        ...Object.values(positions).map(
          (position) => position.x + GRAPH_NODE_WIDTH,
        ),
        GRAPH_NODE_WIDTH,
      ) + PADDING_X,
    height:
      Math.max(
        ...Object.values(positions).map(
          (position) => position.y + GRAPH_NODE_HEIGHT,
        ),
        GRAPH_NODE_HEIGHT,
      ) + PADDING_Y,
    orientation,
  };
}
