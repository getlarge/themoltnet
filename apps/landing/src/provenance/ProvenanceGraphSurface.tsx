import type { ProvenanceGraph, ProvenanceGraphNode } from '@moltnet/models';
import { AgentIdentityMark, useTheme } from '@themoltnet/design-system';

import type { GraphLayout } from './graph-layout';
import type { GraphViewportState } from './graph-viewport';
import { extractCreator, splitIntoLines } from './viewer-utils';

const NODE_WIDTH = 280;
const NODE_HEIGHT = 116;
const NODE_LABEL_MAX = 30;

function nodeFill(kind: ProvenanceGraphNode['kind']): string {
  return kind === 'pack'
    ? 'rgba(230, 168, 23, 0.14)'
    : 'rgba(97, 201, 168, 0.14)';
}

function nodeStroke(kind: ProvenanceGraphNode['kind']): string {
  return kind === 'pack' ? '#e6a817' : '#61c9a8';
}

function edgeStroke(kind: 'includes' | 'supersedes'): string {
  return kind === 'supersedes' ? '#e6a817' : '#7dd3fc';
}

interface ProvenanceGraphSurfaceProps {
  collapsedPackIds: Set<string>;
  containerHeight: number;
  containerWidth: number;
  graph: ProvenanceGraph;
  layout: GraphLayout;
  onNodeClick: (node: ProvenanceGraphNode) => void;
  selectedNodeId: string | null;
  viewport: GraphViewportState;
}

export function ProvenanceGraphSurface({
  collapsedPackIds,
  containerHeight,
  containerWidth,
  graph,
  layout,
  onNodeClick,
  selectedNodeId,
  viewport,
}: ProvenanceGraphSurfaceProps) {
  const theme = useTheme();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${containerWidth || layout.width} ${containerHeight || layout.height}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background:
          'radial-gradient(circle at top left, rgba(230, 168, 23, 0.1), transparent 28%), linear-gradient(180deg, rgba(11, 17, 32, 0.96), rgba(7, 10, 18, 1))',
      }}
    >
      <g
        transform={`translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.scale})`}
      >
        {graph.edges.map((edge) => {
          const from = layout.positions[edge.from];
          const to = layout.positions[edge.to];
          if (!from || !to) return null;

          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;
          const midX = (x1 + x2) / 2;

          return (
            <g key={edge.id}>
              <path
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edgeStroke(edge.kind)}
                strokeDasharray={edge.kind === 'supersedes' ? '8 6' : undefined}
                strokeOpacity={0.8}
                strokeWidth={2.5}
              />
              {edge.label ? (
                <text
                  x={midX}
                  y={(y1 + y2) / 2 - 8}
                  fill="rgba(255,255,255,0.72)"
                  fontFamily={theme.font.family.mono}
                  fontSize={12}
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {graph.nodes.map((node) => {
          const currentPosition = layout.positions[node.id];
          if (!currentPosition) return null;

          const selected = node.id === selectedNodeId;
          const collapsed =
            node.kind === 'pack' && collapsedPackIds.has(node.id);
          const labelLines = splitIntoLines(node.label, NODE_LABEL_MAX);
          const creator = extractCreator(node);

          return (
            <g
              key={node.id}
              data-graph-node="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onNodeClick(node)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={currentPosition.x}
                y={currentPosition.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={24}
                fill={nodeFill(node.kind)}
                stroke={nodeStroke(node.kind)}
                strokeOpacity={selected ? 1 : 0.7}
                strokeWidth={selected ? 3 : 2}
              />
              {node.kind === 'pack' ? (
                <>
                  <rect
                    x={currentPosition.x + NODE_WIDTH - 44}
                    y={currentPosition.y + 14}
                    width={28}
                    height={28}
                    rx={14}
                    fill="rgba(255,255,255,0.08)"
                    stroke="rgba(255,255,255,0.18)"
                  />
                  <text
                    x={currentPosition.x + NODE_WIDTH - 30}
                    y={currentPosition.y + 33}
                    fill="#f5f7fb"
                    fontFamily={theme.font.family.mono}
                    fontSize={18}
                    textAnchor="middle"
                  >
                    {collapsed ? '+' : '-'}
                  </text>
                </>
              ) : null}
              {creator ? (
                <foreignObject
                  x={currentPosition.x + 16}
                  y={currentPosition.y + 12}
                  width={32}
                  height={32}
                >
                  <div style={{ width: 32, height: 32 }}>
                    <AgentIdentityMark
                      publicKey={creator.publicKey}
                      size={32}
                    />
                  </div>
                </foreignObject>
              ) : null}
              {labelLines.map((line, index) => (
                <text
                  key={`${node.id}-${index}`}
                  x={currentPosition.x + (creator ? 56 : 18)}
                  y={currentPosition.y + 32 + index * 20}
                  fill="#f5f7fb"
                  fontFamily={theme.font.family.sans}
                  fontSize={16}
                  fontWeight={600}
                >
                  {line}
                </text>
              ))}
              <text
                x={currentPosition.x + 18}
                y={currentPosition.y + 76}
                fill="rgba(255,255,255,0.72)"
                fontFamily={theme.font.family.mono}
                fontSize={12}
              >
                {node.kind}
              </text>
              <text
                x={currentPosition.x + 18}
                y={currentPosition.y + 96}
                fill="rgba(255,255,255,0.58)"
                fontFamily={theme.font.family.mono}
                fontSize={11}
              >
                {node.cid?.slice(0, 30) ?? 'no cid'}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
